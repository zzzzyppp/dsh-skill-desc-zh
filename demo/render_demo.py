#!/usr/bin/env python3
"""
Better Skill 展示视频渲染器（纯程序化生成，无需录屏）。

画面为示意界面（1920x1080 @ 30fps），内容取自 dsh-skill-desc-zh v0.6.0 的真实功能：
  - 单入口 Better Skill（三个 Tab：描述汉化 / 插件管理 / 技能管理）
  - 技能与命令描述汉化、插件更新检查、技能 CRUD / 禁用 / 回收站
输出：H.264 MP4（libx264，yuv420p，faststart），通过管道直接喂给 ffmpeg，不落中间帧。

用法:
  python3 demo/render_demo.py --out /Users/ypz/Downloads/better-skill-demo.mp4 \
      --poster /Users/ypz/Downloads/better-skill-demo-poster.png
"""
from __future__ import annotations

import argparse
import math
import re
import subprocess
import sys
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
FPS = 30
DURATION = 55.0

# ---------- palette ----------
BG_TOP = (13, 18, 27)
BG_BOT = (7, 10, 15)
PANEL = (19, 26, 37)
PANEL_2 = (23, 31, 44)
PANEL_3 = (28, 38, 54)
BORDER = (43, 56, 74)
BORDER_SOFT = (34, 45, 60)
TEXT = (231, 238, 248)
TEXT_DIM = (148, 164, 184)
TEXT_FAINT = (104, 120, 140)
ACCENT = (92, 157, 255)
ACCENT_2 = (94, 222, 190)
ACCENT_3 = (255, 184, 92)
DANGER = (255, 112, 112)
GREEN = (79, 214, 148)
OK_BG = (26, 52, 44)
WARN_BG = (56, 44, 24)
BLUE_BG = (26, 42, 68)

FONT_CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_MONO_CANDIDATES = [
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
]

_font_map: dict[tuple[int, bool, bool], ImageFont.FreeTypeFont] = {}


@lru_cache(maxsize=1)
def _mono_path() -> str:
    import os
    for p in FONT_MONO_CANDIDATES:
        if os.path.exists(p):
            return p
    return FONT_CJK


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold, mono)
    cached = _font_map.get(key)
    if cached is not None:
        return cached
    if mono:
        f = ImageFont.truetype(_mono_path(), size)
    else:
        idx = 1 if bold else 0
        try:
            f = ImageFont.truetype(FONT_CJK, size, index=idx)
        except OSError:
            f = ImageFont.truetype(FONT_CJK, size, index=0)
    _font_map[key] = f
    return f


# ---------- easing ----------
def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def ease_out(x: float) -> float:
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_in_out(x: float) -> float:
    x = clamp(x)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def prog(t: float, t0: float, dur: float) -> float:
    if dur <= 0:
        return 1.0 if t >= t0 else 0.0
    return ease_out((t - t0) / dur)


def appear(t: float, t0: float, dur: float = 0.45) -> float:
    """0..1 with soft fade (used for opacity)."""
    return ease_out(clamp((t - t0) / dur))


def lerp(a: float, b: float, k: float) -> float:
    return a + (b - a) * clamp(k)


def slide_in(t: float, t0: float, dist: float = 26.0, dur: float = 0.5) -> float:
    return (1.0 - prog(t, t0, dur)) * dist


# ---------- text helpers ----------
_TOKEN_RE = re.compile(r"[A-Za-z0-9_@./:+\-~^]+|\s+|[\u4e00-\u9fff]|[^\s]")


def wrap_text(s: str, size: int, max_w: int, bold: bool = False, mono: bool = False) -> list[str]:
    f = font(size, bold, mono)
    tokens = _TOKEN_RE.findall(s)
    lines: list[str] = []
    cur = ""
    for tok in tokens:
        cand = cur + tok
        if not cur or _text_w(cand, f) <= max_w:
            cur = cand
        else:
            lines.append(cur.rstrip())
            cur = tok if tok.strip() else ""
    if cur:
        lines.append(cur)
    return lines


def fit_text(s: str, size: int, max_w: float, bold: bool = False, mono: bool = False) -> str:
    """Truncate with a single ellipsis so the text never overflows its column."""
    f = font(size, bold, mono)
    if _text_w(s, f) <= max_w:
        return s
    out = s
    while out and _text_w(out + "…", f) > max_w:
        out = out[:-1]
    return (out + "…") if out else "…"


def _text_w(s: str, f: ImageFont.FreeTypeFont) -> float:
    return f.getlength(s)


def T(d: ImageDraw.ImageDraw, xy, s: str, size: int, color=TEXT, bold=False, mono=False, anchor="la"):
    d.text(xy, s, font=font(size, bold, mono), fill=color, anchor=anchor)


def T_wrapped(d, x, y, s, size, max_w, color=TEXT_DIM, bold=False, line_gap=7, max_lines=2):
    lines = wrap_text(s, size, max_w, bold)
    for i, line in enumerate(lines[:max_lines]):
        T(d, (x, y + i * (size + line_gap)), line, size, color, bold)
    return y + min(len(lines), max_lines) * (size + line_gap)


# ---------- shape helpers ----------
def rr(d: ImageDraw.ImageDraw, box, r: int = 12, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def panel(d: ImageDraw.ImageDraw, box, r=14, fill=PANEL, border=BORDER_SOFT, width=1):
    rr(d, box, r, fill=fill, outline=border, width=width)
    # top highlight
    x0, y0, x1, _ = box
    d.line([(x0 + r, y0 + 1), (x1 - r, y0 + 1)], fill=(255, 255, 255, 16), width=1)


def chip(d, xy, text, size=15, fg=TEXT_DIM, bg=(30, 40, 55), r=999, padx=11, pady=5, mono=False):
    f = font(size, False, mono)
    tw = _text_w(text, f)
    x, y = xy
    h = size + pady * 2
    rr(d, (x, y, x + tw + padx * 2, y + h), r, fill=bg)
    d.text((x + padx, y + pady - 1), text, font=f, fill=fg, anchor="la")
    return x + tw + padx * 2


def status_dot(d, xy, color=GREEN, r=6):
    x, y = xy
    d.ellipse((x - r, y - r, x + r, y + r), fill=color)


def cursor(frame: Image.Image, x: float, y: float, scale: float = 1.0):
    d = ImageDraw.Draw(frame)
    pts = [(0, 0), (0, 20), (5, 15), (9, 24), (13, 22), (9, 13), (16, 13)]
    poly = [(x + px * scale, y + py * scale) for px, py in pts]
    d.polygon(poly, fill=(240, 245, 255), outline=(18, 24, 34))
    d.line(poly + [poly[0]], fill=(18, 24, 34), width=2)


def ripple(frame: Image.Image, x: float, y: float, t: float, t0: float, color=ACCENT, dur=0.5):
    p = (t - t0) / dur
    if not (0 <= p <= 1):
        return
    r = int(10 + 46 * ease_out(p))
    a = int(190 * (1 - p))
    tile = Image.new("RGBA", (r * 2 + 8, r * 2 + 8), (0, 0, 0, 0))
    dd = ImageDraw.Draw(tile)
    dd.ellipse((4, 4, 4 + r * 2, 4 + r * 2), outline=color + (a,), width=3)
    frame.paste(tile, (int(x) - r - 4, int(y) - r - 4), tile)


def cursor_path(t: float, keys: list[tuple[float, float, float]]) -> tuple[float, float]:
    """keys: [(t, x, y)] sorted; smooth ease between points."""
    if t <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for (t0, x0, y0), (t1, x1, y1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = ease_in_out((t - t0) / (t1 - t0))
            return lerp(x0, x1, k), lerp(y0, y1, k)
    return keys[-1][1], keys[-1][2]


def toast(frame: Image.Image, t: float, t0: float, text: str, icon="✓", color=GREEN, dur=2.6):
    k = clamp((t - t0) / 0.35)
    if k <= 0:
        return
    out = clamp((t - (t0 + dur)) / 0.4)
    alpha = int(255 * k * (1 - out))
    if alpha <= 0:
        return
    d0 = ImageDraw.Draw(frame)
    f = font(20, True)
    tw = _text_w(text, f)
    w = int(tw + 96)
    x = (W - w) // 2
    y = H - 168 + int((1 - k) * 20)
    tile = Image.new("RGBA", (w, 64), (0, 0, 0, 0))
    dd = ImageDraw.Draw(tile)
    dd.rounded_rectangle((0, 0, w - 1, 63), radius=16, fill=(22, 30, 42, alpha), outline=color + (min(255, alpha),), width=2)
    dd.ellipse((18, 20, 44, 46), fill=color + (min(255, alpha),))
    dd.line([(25, 33), (30, 39), (39, 27)], fill=(10, 16, 22, alpha), width=3)
    dd.text((60, 31), text, font=f, fill=(228, 238, 248, alpha), anchor="lm")
    frame.paste(tile, (x, y), tile)


def fader(frame: Image.Image, alpha: float, color=(0, 0, 0)) -> Image.Image:
    if alpha <= 0:
        return frame
    if alpha >= 1:
        return Image.new("RGB", (W, H), color)
    return Image.blend(frame, Image.new("RGB", (W, H), color), alpha)


# ---------- static background ----------
def build_background() -> Image.Image:
    yy = np.linspace(0.0, 1.0, H)[:, None]
    xx = np.linspace(0.0, 1.0, W)[None, :]
    top = np.array(BG_TOP, dtype=np.float64)
    bot = np.array(BG_BOT, dtype=np.float64)
    base = top[None, None, :] * (1 - yy)[:, :, None] + bot[None, None, :] * yy[:, :, None]
    base = np.broadcast_to(base, (H, W, 3)).copy()

    # radial glows
    for (cx, cy, rad, color, strength) in [
        (0.78, 0.10, 0.62, (46, 92, 168), 0.55),
        (0.12, 0.92, 0.55, (24, 78, 96), 0.42),
        (0.5, 0.02, 0.5, (58, 62, 140), 0.22),
    ]:
        dist = np.sqrt((xx - cx) ** 2 + ((yy - cy) * (H / W)) ** 2 * (W / H) ** 2)
        glow = np.exp(-(dist / rad) ** 2 * 3.2) * strength
        base += glow[:, :, None] * np.array(color, dtype=np.float64)[None, None, :]

    # vignette
    vig = 1 - 0.55 * np.clip(((xx - 0.5) ** 2 * 2.4 + (yy - 0.5) ** 2 * 2.0), 0, 1)
    base *= vig[:, :, None]

    # faint dot grid
    grid = np.zeros((H, W), dtype=np.float64)
    step = 64
    grid[::step, :] = 1.0
    grid[:, ::step] = 1.0
    base += grid[:, :, None] * np.array((26, 38, 56), dtype=np.float64)[None, None, :] * 0.35

    # top sheen
    sheen = np.clip(1.0 - yy * 5.0, 0, 1) ** 2 * 0.05
    base += sheen[:, :, None] * 255

    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


# ---------- scene pieces ----------
def draw_logo(frame: Image.Image, cx: float, cy: float, scale: float = 1.0, rot: float = 0.0):
    d = ImageDraw.Draw(frame)
    s = 78 * scale
    box = (cx - s, cy - s, cx + s, cy + s)
    rr(d, box, int(s * 0.55), fill=(23, 33, 50), outline=BORDER, width=2)
    rr(d, (box[0] + 8, box[1] + 8, box[2] - 8, box[3] - 8), int(s * 0.42), fill=(16, 23, 34), outline=(38, 62, 96), width=1)
    # "译" glyph + spark
    T(d, (cx, cy + 2), "译", 58 if scale > 1 else 26, ACCENT, bold=True, anchor="mm")
    d.ellipse((cx + s * 0.42, cy - s * 0.55, cx + s * 0.42 + 10 * scale + 2, cy - s * 0.55 + 10 * scale + 2), fill=ACCENT_2)


def draw_window(frame: Image.Image, t: float, off: float = 0.0, scale_k: float = 1.0):
    """Returns (content_box, sidebar_box) in final coords; draws app chrome."""
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = 250, 118 + off, 1670, 962 + off
    if scale_k != 1.0:
        pass
    # outer shadow-ish glow
    rr(d, (x0 - 2, y0 - 2, x1 + 2, y1 + 2), 22, fill=None, outline=(48, 66, 92), width=2)
    rr(d, (x0, y0, x1, y1), 20, fill=(16, 22, 32), outline=BORDER)
    # title bar
    d.line([(x0 + 20, y0 + 46), (x1 - 20, y0 + 46)], fill=BORDER_SOFT)
    for i, c in enumerate([(255, 108, 100), (255, 196, 92), (86, 208, 128)]):
        d.ellipse((x0 + 22 + i * 22, y0 + 18, x0 + 34 + i * 22, y0 + 30), fill=c)
    T(d, (x0 + 112, y0 + 14), "DeepSeek Harness · 设置", 15, TEXT_FAINT)
    # sidebar
    sx0, sy0, sx1, sy1 = x0, y0 + 46, x0 + 288, y1
    d.rectangle((sx0, sy0, sx1, sy1), fill=(14, 20, 29))
    d.line([(sx1, sy0), (sx1, sy1)], fill=BORDER_SOFT)
    T(d, (sx0 + 24, sy0 + 22), "设置", 24, TEXT, bold=True)
    nav = ["常规", "模型与账号", "插件", "Better Skill", "关于"]
    for i, name in enumerate(nav):
        yy = sy0 + 88 + i * 56
        active = name == "Better Skill"
        if active:
            hl = prog(t, 7.55, 0.4)
            if hl > 0:
                rr(d, (sx0 + 14, yy - 12, sx1 - 14, yy + 32), 10, fill=(30, 47, 74), outline=(58, 96, 150), width=1)
                d.rectangle((sx0 + 14, yy - 4, sx0 + 17, yy + 24), fill=ACCENT)
        T(d, (sx0 + 26, yy), name, 18, TEXT if active else TEXT_DIM, bold=active)
        if active:
            chip(d, (sx1 - 92, yy - 2), "入口", 12, ACCENT_2, (22, 44, 40))
    T_wrapped(d, sx0 + 26, sy1 - 96, "三个功能已合并为这个入口", 14, 220, TEXT_FAINT, max_lines=2)
    # content area
    cx0, cy0 = sx1 + 1, sy0
    return (sx1 + 1, sy0, x1, sy1), (sx0, sy0, sx1, sy1)


def draw_page_header(d: ImageDraw.ImageDraw, box, t: float, active_tab: int, tab_switch_t: float):
    x0, y0, x1, y1 = box
    T(d, (x0 + 40, y0 + 34), "Better Skill", 40, TEXT, bold=True)
    T(d, (x0 + 40, y0 + 86), "技能与命令描述汉化 · 插件管理 · 技能管理", 17, TEXT_DIM)
    chip(d, (x0 + 40, y0 + 120), "v0.6.0", 13, ACCENT, (25, 40, 64), mono=True)
    chip(d, (x0 + 128, y0 + 120), "MIT · 开源", 13, TEXT_DIM, (28, 38, 52))
    # tabs
    tabs = [("描述汉化", 0), ("插件管理", 1), ("技能管理", 2)]
    bx = x0 + 40
    by = y0 + 168
    tab_w = 168
    d.line([(x0 + 40, by + 50), (x1 - 40, by + 50)], fill=BORDER_SOFT)
    for i, (label, idx) in enumerate(tabs):
        xx = bx + i * tab_w
        act = idx == active_tab
        T(d, (xx + 20, by + 12), label, 20, TEXT if act else TEXT_DIM, bold=act)
        if act:
            k = 1.0
            rr(d, (xx + 16, by + 44, xx + tab_w - 28, by + 48), 2, fill=ACCENT)
        # click pulse
        for ct in CLICK_TABS.get(idx, []):
            ripple(d_frame_ref[0], xx + 70, by + 28, t, ct, ACCENT, 0.45)


CLICK_TABS: dict[int, list[float]] = {1: [14.6], 2: [26.6]}
d_frame_ref: list[Image.Image] = [None]


# ---------- Tab 1: translation ----------
def draw_tab_translate(frame: Image.Image, box, t: float):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = box
    top = y0 + 250
    # status card
    panel(d, (x0 + 40, top, x1 - 40, top + 136), 14, PANEL_2)
    restored = 11.4 <= t < 13.0
    status_dot(d, (x0 + 70, top + 32), ACCENT_3 if restored else GREEN)
    T(d, (x0 + 92, top + 18), "已还原为英文" if restored else "已生效（phase=active）", 20, TEXT, bold=True)
    T(d, (x0 + 92, top + 52), "中文 12/12 · 命令 3/3 · 项目 /Applications/dsh · 宿主 0.2.1-rc.2", 16, TEXT_DIM)
    state_txt = "provider 已下架 · 技能列表回到英文原文，随时可再应用" if restored else "三层覆盖已就绪 · 一键还原不影响任何源文件"
    state_fg = ACCENT_3 if restored else GREEN
    status_dot(d, (x0 + 70, top + 104), state_fg, 5)
    T(d, (x0 + 90, top + 94), state_txt, 15, state_fg)
    # buttons
    bx = x1 - 330
    for i, (label, accent) in enumerate([("应用", True), ("还原", False), ("刷新", False)]):
        w = 92
        xx = bx + i * 104
        rr(d, (xx, top + 46, xx + w, top + 90), 10, fill=(32, 66, 116) if accent else (28, 37, 50),
           outline=(70, 120, 190) if accent else BORDER_SOFT)
        T(d, (xx + w / 2, top + 68), label, 16, TEXT if accent else TEXT_DIM, bold=accent, anchor="mm")
        if accent:
            ripple(frame, xx + w / 2, top + 68, t, 13.0, ACCENT)
        else:
            ripple(frame, xx + w / 2, top + 68, t, 11.4, TEXT_DIM)

    # table header
    ty = top + 164
    cols = [(x0 + 40, "目标", 240), (x0 + 300, "描述", 520), (x0 + 830, "来源 / 状态", 260)]
    for cx, label, _ in cols:
        T(d, (cx, ty), label, 14, TEXT_FAINT)
    d.line([(x0 + 40, ty + 26), (x1 - 40, ty + 26)], fill=BORDER_SOFT)

    rows = [
        ("office", "创建、编辑、检查或转换 Office 文档、电子表格、演示文稿和 PDF", "global/provider", GREEN),
        ("office-docx", "创建、读取、编辑并校验 Word 文档（.docx）", "global/provider", GREEN),
        ("office-xlsx", "读取、创建、编辑并校验 Excel 工作簿与公式（.xlsx）", "global/provider", GREEN),
        ("browser-skill", "通过注入的 bsk_* 工具自动化已登录的 Chromium 浏览器", "runtime · agent 层覆盖", ACCENT_2),
        ("agent-experience", "编写面向模型的工具定义、技能与多步工作流时使用", "preset/shadow", ACCENT_2),
        ("/agent-teams", "以多智能体团队运行一个目标（你将成为队长）", "command/agent", ACCENT_3),
    ]
    en_rows = {
        "office": "Create, edit, inspect, or convert Office documents and PDFs",
        "office-docx": "Create, read, edit, and validate Word documents (.docx)",
        "office-xlsx": "Read, create, edit, and validate Excel workbooks and formulas (.xlsx)",
        "browser-skill": "Automate the user's logged-in Chromium through injected bsk_* tools",
        "agent-experience": "Use when writing model-facing tool definitions and workflows",
        "/agent-teams": "Run a goal with a multi-agent team (you become the captain)",
    }
    ry = ty + 40
    for i, (name, desc, src, color) in enumerate(rows):
        k = prog(t, 10.0 + i * 0.12, 0.5)
        if k <= 0:
            continue
        alpha_off = int((1 - k) * 22)
        yy = ry + i * 50 + alpha_off
        if restored:
            desc = en_rows.get(name, desc)
        if i % 2 == 0:
            rr(d, (x0 + 34, yy - 8, x1 - 34, yy + 38), 8, fill=(18, 25, 36))
        T(d, (x0 + 40 + 12, yy + 8), name, 17, TEXT, mono=True if name.startswith("/") else False)
        T_wrapped(d, x0 + 312, yy + 9, fit_text(desc, 15, 496), 15, 500, TEXT_DIM if not restored else (168, 176, 190), max_lines=1)
        state_fg = ACCENT_3 if restored else color
        state_txt = "英文 · 已还原" if restored else "中文"
        chip(d, (x0 + 830, yy + 4), state_txt, 13, state_fg, (34, 44, 58))
        chip(d, (x0 + 950, yy + 4), src, 13, TEXT_FAINT, (28, 36, 48))
    T(d, (x0 + 40, ry + len(rows) * 50 + 6), "… 其余技能与命令同样按来源分层覆盖（不改宿主文件）", 14, TEXT_FAINT)
    # demo footnote
    T(d, (x1 - 40, y1 - 26), "界面示意 · 实际以 DSH 页面为准", 12, (86, 100, 118), anchor="ra")

    # cursor
    keys = [
        (10.2, x1 - 300, top + 68),
        (11.0, x1 - 300, top + 68),
        (11.4, x1 - 196, top + 68),
        (12.2, x1 - 196, top + 68),
        (13.0, x1 - 300, top + 68),
        (13.6, x1 - 300, top + 68),
    ]
    if 10.2 <= t <= 13.7:
        cx, cy = cursor_path(t, keys)
        ripple(frame, cx, cy, t, 11.4, TEXT_DIM, 0.45)
        ripple(frame, cx, cy, t, 13.0, ACCENT, 0.45)
        cursor(frame, cx, cy, 1.15)


# ---------- Tab 2: plugins ----------
PLUGIN_ROWS = [
    ("@nanmicoder/dsh-agent-teams", "0.1.25", "0.1.26", True),
    ("@michengai/dsh-skills-manager", "1.2.9", "1.2.11", True),
    ("@xmanrui/dsh-im", "5.2.0", "5.3.0", True),
    ("dsh-context", "0.73.3", "0.74.0", True),
    ("@wxg-prc-cpg/browser-skill-dsh-plugin", "0.3.3", "0.3.3", False),
    ("billion-context", "0.1.204", "0.1.204", False),
]


def draw_tab_plugins(frame: Image.Image, box, t: float):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = box
    top = y0 + 250
    checked = t >= 17.4
    panel(d, (x0 + 40, top, x1 - 40, top + 96), 14, PANEL_2)
    T(d, (x0 + 68, top + 22), "插件管理", 20, TEXT, bold=True)
    T(d, (x0 + 68, top + 54), "只管理第三方 npm 插件；启用/禁用/卸载仍在「设置 → 插件」", 15, TEXT_DIM)
    T(d, (x0 + 68, top + 74), "更新走宿主 pluginManager：保留兼容性闸门与构建脚本批准", 13, TEXT_FAINT)
    # check button
    bx = x1 - 320
    rr(d, (bx, top + 26, bx + 132, top + 70), 10, fill=(32, 66, 116), outline=(70, 120, 190))
    if t < 17.4:
        T(d, (bx + 66, top + 48), "检查更新", 16, TEXT, bold=True, anchor="mm")
    else:
        T(d, (bx + 66, top + 48), "已检查", 16, TEXT_DIM, anchor="mm")
    T(d, (bx + 148, top + 38), "16 个插件", 14, TEXT_FAINT)
    T(d, (bx + 148, top + 58), f"{sum(1 for r in PLUGIN_ROWS if r[3])} 个可更新", 14, ACCENT if checked else TEXT_FAINT)
    ripple(frame, bx + 66, top + 48, t, 16.0, ACCENT)

    # rows
    ty = top + 128
    T(d, (x0 + 40, ty), "插件", 14, TEXT_FAINT)
    T(d, (x0 + 560, ty), "当前版本", 14, TEXT_FAINT)
    T(d, (x0 + 690, ty), "最新版本", 14, TEXT_FAINT)
    T(d, (x0 + 830, ty), "状态", 14, TEXT_FAINT)
    d.line([(x0 + 40, ty + 24), (x1 - 40, ty + 24)], fill=BORDER_SOFT)
    ry = ty + 38
    updating_row = 0
    update_done = t >= 21.0
    for i, (name, cur, latest, has_update) in enumerate(PLUGIN_ROWS):
        k = prog(t, 15.0 + i * 0.1, 0.45)
        if k <= 0:
            continue
        yy = ry + i * 52 + int((1 - k) * 18)
        if i % 2 == 0:
            rr(d, (x0 + 34, yy - 8, x1 - 34, yy + 36), 8, fill=(18, 25, 36))
        T(d, (x0 + 40, yy + 6), fit_text(name, 16, 480, mono=True), 16, TEXT, mono=True)
        T(d, (x0 + 560, yy + 7), cur, 15, TEXT_DIM, mono=True)
        shown_latest = latest if (checked or not has_update) else "…"
        shown_latest = "0.1.26 ✓" if (i == updating_row and update_done) else shown_latest
        T(d, (x0 + 690, yy + 7), shown_latest, 15, ACCENT if (checked and has_update) else TEXT_DIM, mono=True)
        if has_update:
            if i == updating_row and checked and t >= 18.6 and not update_done:
                T(d, (x0 + 830, yy + 7), "更新中…", 14, ACCENT_3)
                pw = int(clamp((t - 18.6) / 2.4) * 150)
                rr(d, (x0 + 830, yy + 28, x0 + 830 + 150, yy + 32), 2, fill=(40, 52, 70))
                rr(d, (x0 + 830, yy + 28, x0 + 830 + pw, yy + 32), 2, fill=ACCENT)
            elif i == updating_row and update_done:
                chip(d, (x0 + 830, yy + 2), "已更新 · 需重启", 13, ACCENT_2, OK_BG)
            elif checked:
                chip(d, (x0 + 830, yy + 2), "可更新", 13, ACCENT, BLUE_BG)
                rr(d, (x0 + 960, yy + 1, x0 + 1030, yy + 31), 8, fill=(32, 66, 116), outline=(70, 120, 190))
                T(d, (x0 + 995, yy + 16), "更新", 14, TEXT, bold=True, anchor="mm")
                ripple(frame, x0 + 995, yy + 16, t, 18.6, ACCENT)
            else:
                chip(d, (x0 + 830, yy + 2), "…", 13, TEXT_FAINT, (30, 38, 50))
        else:
            chip(d, (x0 + 830, yy + 2), "已是最新", 13, GREEN, OK_BG)
    T(d, (x0 + 40, ry + len(PLUGIN_ROWS) * 52 + 8), "失败分类：隔离期 · 需要批准构建脚本 · 版本不兼容 · 网络错误，均给出可操作提示", 14, TEXT_FAINT)
    T(d, (x1 - 40, y1 - 26), "界面示意 · 实际以 DSH 页面为准", 12, (86, 100, 118), anchor="ra")
    if update_done:
        toast(frame, t, 21.0, "dsh-agent-teams 已更新到 0.1.26（重启后生效）")

    keys = [(14.2, x1 - 300, y0 + 220), (15.6, bx + 66, top + 48), (17.8, bx + 66, top + 48),
            (18.6, x0 + 995, ry + 16), (20.4, x0 + 995, ry + 16), (22.6, x0 + 995, ry + 16)]
    if 14.2 <= t <= 22.8:
        cx, cy = cursor_path(t, keys)
        ripple(frame, cx, cy, t, 16.0, ACCENT, 0.45)
        ripple(frame, cx, cy, t, 18.6, ACCENT, 0.45)
        cursor(frame, cx, cy, 1.15)


# ---------- Tab 3: skills ----------
SKILL_ROWS = [
    ("demo-notes", "user", "中文", None),
    ("品牌规范", "user", "中文", None),
    ("release-helper", "project", "英文", None),
    ("old-scratch", "user", "已禁用", None),
]


def draw_tab_skills(frame: Image.Image, box, t: float):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = box
    top = y0 + 250
    selected = 0 if t < 29.2 else (1 if t < 36.6 else 0)
    # left list
    panel(d, (x0 + 40, top, x0 + 540, y1 - 90), 14, PANEL_2)
    T(d, (x0 + 68, top + 22), "技能管理", 20, TEXT, bold=True)
    T(d, (x0 + 68, top + 54), "用户 / 项目技能 · 写前快照 · frontmatter 校验", 13, TEXT_FAINT)
    rr(d, (x0 + 68, top + 84, x0 + 220, top + 120), 9, fill=(32, 66, 116), outline=(70, 120, 190))
    T(d, (x0 + 144, top + 102), "＋ 新建技能", 15, TEXT, bold=True, anchor="mm")
    if t >= 34.2:
        # delete confirmation dialog
        pass
    ry = top + 136
    for i, (name, src, state, _x) in enumerate(SKILL_ROWS):
        k = prog(t, 27.2 + i * 0.1, 0.45)
        if k <= 0:
            continue
        yy = ry + i * 62 + int((1 - k) * 16)
        act = i == selected
        if act:
            rr(d, (x0 + 56, yy - 8, x0 + 524, yy + 44), 10, fill=(30, 46, 70), outline=(52, 84, 128))
        else:
            rr(d, (x0 + 56, yy - 8, x0 + 524, yy + 44), 10, fill=(20, 27, 38))
        T(d, (x0 + 72, yy + 4), fit_text(name, 17, 300, bold=act, mono=False if any("\u4e00" <= c <= "\u9fff" for c in name) else True), 17, TEXT, bold=act, mono=False if any("\u4e00" <= c <= "\u9fff" for c in name) else True)
        T(d, (x0 + 72, yy + 28), f"{src} · 可写", 12, TEXT_FAINT)
        if state == "已禁用":
            chip(d, (x0 + 420, yy + 6), "已禁用", 12, DANGER, (58, 28, 30))
        elif state == "中文":
            chip(d, (x0 + 420, yy + 6), "中文", 12, GREEN, OK_BG)
        else:
            chip(d, (x0 + 420, yy + 6), "英文", 12, ACCENT_3, WARN_BG)
    T(d, (x0 + 68, y1 - 156), "回收站：删除的记录（可恢复）", 14, TEXT_FAINT)
    rr(d, (x0 + 56, y1 - 132, x0 + 524, y1 - 90), 10, fill=(20, 27, 38), outline=BORDER_SOFT)
    T(d, (x0 + 72, y1 - 122), "old-scratch · 已移入废纸篓", 14, TEXT_DIM)
    if t >= 37.2:
        rr(d, (x0 + 428, y1 - 128, x0 + 508, y1 - 98), 8, fill=(32, 66, 116), outline=(70, 120, 190))
        T(d, (x0 + 468, y1 - 113), "恢复", 13, TEXT, bold=True, anchor="mm")
        ripple(frame, x0 + 468, y1 - 113, t, 37.2, ACCENT)

    # right detail / editor
    px0, py0, px1, py1 = x0 + 570, top, x1 - 40, y1 - 34
    panel(d, (px0, py0, px1, py1), 14, PANEL_2)
    name = SKILL_ROWS[selected][0]
    T(d, (px0 + 28, py0 + 22), name, 24, TEXT, bold=True, mono=False if any("\u4e00" <= c <= "\u9fff" for c in name) else True)
    chip(d, (px0 + 28 + (_text_w(name, font(24, True)) + 18), py0 + 28), "已中文化", 13, GREEN, OK_BG)
    T(d, (px0 + 28, py0 + 62), "来源：用户级 · ~/.dsh/skills/demo-notes/SKILL.md", 13, TEXT_FAINT)
    d.line([(px0 + 28, py0 + 90), (px1 - 28, py0 + 90)], fill=BORDER_SOFT)
    # description before/after
    T(d, (px0 + 28, py0 + 108), "description", 13, TEXT_FAINT, mono=True)
    en = "Keep concise notes for demos and walkthroughs."
    zh = "为演示与走查保留简洁的笔记。"
    T_wrapped(d, px0 + 28, py0 + 132, en, 14, px1 - px0 - 56, (128, 140, 156), max_lines=2)
    T(d, (px0 + 28, py0 + 186), "→", 16, ACCENT)
    T_wrapped(d, px0 + 58, py0 + 184, zh, 16, px1 - px0 - 86, TEXT, max_lines=2)
    # body preview
    T(d, (px0 + 28, py0 + 242), "正文（预览）", 13, TEXT_FAINT)
    panel(d, (px0 + 28, py0 + 266, px1 - 28, py0 + 412), 10, (16, 22, 32), BORDER_SOFT)
    body = ["# demo-notes", "", "用于演示「Better Skill」技能管理能力：", "- 列表 / 详情 / 编辑", "- 禁用不改源文件", "- 删除进废纸篓，可恢复"]
    for i, line in enumerate(body):
        is_cjk = any("\u4e00" <= c <= "\u9fff" for c in line)
        T(d, (px0 + 46, py0 + 282 + i * 24), line, 14, TEXT_DIM if line.startswith("-") else TEXT, mono=not is_cjk)
    # action buttons row
    by = py0 + 436
    actions = [("编辑", True), ("禁用", False), ("删除", False)]
    for i, (label, primary) in enumerate(actions):
        xx = px0 + 28 + i * 106
        rr(d, (xx, by, xx + 92, by + 40), 9, fill=(32, 66, 116) if primary else (28, 37, 50),
           outline=(70, 120, 190) if primary else BORDER_SOFT)
        T(d, (xx + 46, by + 20), label, 15, TEXT if primary else TEXT_DIM, bold=primary, anchor="mm")
    if t >= 30.2 and t < 32.8:
        # in-place editor over the description block
        ov_y0 = py0 + 96
        panel(d, (px0 + 28, ov_y0, px1 - 28, ov_y0 + 160), 12, (24, 33, 46), (70, 104, 150), 2)
        T(d, (px0 + 50, ov_y0 + 18), "编辑 description（mtime 乐观锁）", 15, TEXT, bold=True)
        rr(d, (px0 + 50, ov_y0 + 48, px1 - 50, ov_y0 + 108), 8, fill=(16, 22, 32), outline=BORDER)
        typed = zh[: max(0, int((t - 30.4) / 0.9 * len(zh)))]
        T(d, (px0 + 64, ov_y0 + 70), typed + ("▍" if int(t * 3) % 2 else ""), 15, TEXT)
    if t >= 32.8:
        toast(frame, t, 32.8, "已保存 · 已留快照 · 可用 mtime 检测冲突", color=ACCENT_2)
    if t >= 34.0:
        toast(frame, t, 34.0, "已禁用（不改源文件，agent 层影子生效）", color=ACCENT_3)
    if t >= 35.4:
        toast(frame, t, 35.4, "已移入系统废纸篓 · 可在回收站恢复", color=ACCENT_3)
    if t >= 38.2:
        toast(frame, t, 38.2, "已恢复到原路径 · 状态同步更新", color=GREEN)
    T(d, (x1 - 40, y1 - 26), "界面示意 · 实际以 DSH 页面为准", 12, (86, 100, 118), anchor="ra")

    keys = [(26.8, x1 - 700, y0 + 220), (28.2, x0 + 300, ry + 12), (30.0, px0 + 74, by + 20),
            (33.6, px0 + 180, by + 20), (35.4, px0 + 286, by + 20), (37.2, x0 + 468, y1 - 113)]
    if 26.8 <= t <= 38.4:
        cx, cy = cursor_path(t, keys)
        ripple(frame, cx, cy, t, 30.0, ACCENT, 0.45)
        ripple(frame, cx, cy, t, 34.0, DANGER, 0.45)
        ripple(frame, cx, cy, t, 35.4, DANGER, 0.45)
        ripple(frame, cx, cy, t, 37.2, ACCENT, 0.45)
        cursor(frame, cx, cy, 1.15)


# ---------- intro ----------
def draw_intro(frame: Image.Image, t: float):
    d = ImageDraw.Draw(frame)
    logo_k = prog(t, 0.5, 0.6)
    if logo_k > 0:
        draw_logo(frame, W / 2, 300, scale=1.0 + 0.06 * math.sin(t * 1.4))
    for i, (label, sub) in enumerate([
        ("技能 / 命令描述汉化", "12 个技能 · 3 条斜杠命令"),
        ("插件管理", "检查更新 · 一键更新"),
        ("技能管理", "新建 / 编辑 / 禁用 / 回收站"),
    ]):
        t0 = 2.6 + i * 0.22
        k = prog(t, t0, 0.5)
        if k <= 0:
            continue
        y = 560 + i * 78 + int((1 - k) * 26)
        chip(d, (W / 2 - 300, y), "●", 12, ACCENT_2, (22, 40, 36), r=20, padx=10, pady=8)
        T(d, (W / 2 - 258, y - 2), label, 26, TEXT, bold=True)
        T(d, (W / 2 + 120, y + 4), sub, 16, TEXT_DIM)
    k = prog(t, 1.1, 0.7)
    if k > 0:
        T(d, (W / 2, 430 + int((1 - k) * 18)), "Better Skill", 92, TEXT, bold=True, anchor="mm")
    k = prog(t, 1.6, 0.7)
    if k > 0:
        T(d, (W / 2, 500 + int((1 - k) * 14)), "一个入口 · 三块功能 · 一切可回滚", 26, TEXT_DIM, anchor="mm")
    k = prog(t, 2.0, 0.6)
    if k > 0:
        chip(d, (W / 2 - 88, 800), "v0.6.0", 15, ACCENT, (25, 40, 64), padx=16, pady=8, mono=True)
        chip(d, (W / 2 + 8, 800), "MIT · 开源", 15, TEXT_DIM, (28, 38, 52), padx=16, pady=8)


# ---------- outro ----------
def draw_outro(frame: Image.Image, t: float):
    d = ImageDraw.Draw(frame)
    # feature cards
    cards = [
        ("译", "描述汉化", ["12 个技能 + 3 条命令", "LLM + 内置词典兜底", "随时还原原文"]),
        ("更", "插件管理", ["列表 · 检查更新 · 一键更新", "保留宿主兼容性闸门", "失败给出可操作提示"]),
        ("管", "技能管理", ["新建 / 编辑 / 禁用", "删除走系统废纸篓", "回收站可恢复"]),
    ]
    for i, (glyph, title, lines) in enumerate(cards):
        k = prog(t, 41.0 + i * 0.18, 0.55)
        if k <= 0:
            continue
        x = 250 + i * 480
        y = 240 + int((1 - k) * 30)
        panel(d, (x, y, x + 440, y + 300), 18, PANEL_2, BORDER)
        rr(d, (x + 30, y + 30, x + 96, y + 96), 20, fill=(28, 46, 74), outline=(58, 96, 150))
        T(d, (x + 63, y + 63), glyph, 32, ACCENT, bold=True, anchor="mm")
        T(d, (x + 30, y + 122), title, 28, TEXT, bold=True)
        for j, line in enumerate(lines):
            status_dot(d, (x + 42, y + 180 + j * 36), ACCENT_2, 4)
            T(d, (x + 58, y + 168 + j * 36), line, 17, TEXT_DIM)
    # repo card
    k = prog(t, 42.4, 0.6)
    if k > 0:
        y = 620 + int((1 - k) * 24)
        panel(d, (360, y, 1560, y + 150), 18, (22, 31, 44), (56, 78, 108))
        T(d, (400, y + 26), "开源 · 可自行构建", 22, TEXT, bold=True)
        T(d, (400, y + 66), "github.com/zzzzyppp/dsh-skill-desc-zh", 24, ACCENT, mono=True)
        chip(d, (400, y + 108), "MIT", 14, TEXT_DIM, (30, 40, 54))
        chip(d, (468, y + 108), "v0.6.0", 14, ACCENT, (25, 40, 64), mono=True)
        chip(d, (560, y + 108), "DSH 0.2.1-rc.2", 14, TEXT_DIM, (30, 40, 54), mono=True)
        chip(d, (716, y + 108), "终端重启后生效", 14, TEXT_DIM, (30, 40, 54))
    # end mark
    k = prog(t, 44.0, 0.6)
    if k > 0:
        draw_logo(frame, W / 2, 860, scale=0.62)
        T(d, (W / 2 + 70, 848), "Better Skill", 34, TEXT, bold=True)
        T(d, (W / 2 + 72, 892), "让 DSH 用起来更顺手", 18, TEXT_DIM)


# ---------- main timeline ----------
def render_frame(t: float) -> Image.Image:
    frame = bg.copy()
    d = ImageDraw.Draw(frame)
    d_frame_ref[0] = frame

    # scene 1: intro 0 - 7
    if t < 7.1:
        draw_intro(frame, t)
        return fader(frame, max(1 - clamp(t / 0.75), clamp((t - 6.4) / 0.7)))

    # scene 2: app window & better skill page  7 - 40
    if t < 40.15:
        off = (1 - prog(t, 7.0, 0.9)) * 34
        (cbox, sbox) = draw_window(frame, t, off)
        px0, py0, px1, py1 = cbox
        # page content appears after clicking Better Skill
        page_k = prog(t, 9.0, 0.55)
        if page_k > 0:
            active = 0 if t < 14.6 else (1 if t < 26.6 else 2)
            draw_page_header(d, (px0, py0, px1, py1), t, active, 0)
            # slide content horizontally on tab change
            content_box = (px0, py0, px1, py1)
            switch_t = 14.6 if active == 1 else (26.6 if active == 2 else None)
            ox = 0
            if switch_t is not None:
                ox = int((1 - prog(t, switch_t, 0.45)) * 80)
            if active == 0:
                draw_tab_translate(frame, content_box, t)
            elif active == 1:
                draw_tab_plugins(frame, content_box, t)
            else:
                draw_tab_skills(frame, content_box, t)
        else:
            T(d, (px0 + 40, py0 + 40), "设置", 34, TEXT_DIM, bold=True)
        # cursor for click on Better Skill row
        if 8.0 <= t <= 9.4:
            cx, cy = cursor_path(t, [(8.0, px0 + 400, py0 + 600), (8.85, sbox[0] + 150, sbox[1] + 88 + 3 * 56)])
            ripple(frame, cx, cy, t, 8.85, ACCENT, 0.5)
            cursor(frame, cx, cy, 1.15)
        return fader(frame, max(1 - clamp((t - 7.1) / 0.8), clamp((t - 39.6) / 0.5)))

    # scene 3: outro 40 - 55
    draw_outro(frame, t)
    return fader(frame, max(1 - clamp((t - 40.15) / 0.5), clamp((t - 53.8) / 1.2)))


def main() -> int:
    global bg
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--poster", default="")
    ap.add_argument("--ffmpeg", default="/Users/ypz/Library/Application Support/bilibili/ffmpeg/ffmpeg")
    ap.add_argument("--fps", type=int, default=FPS)
    args = ap.parse_args()

    bg = build_background()
    total = int(DURATION * args.fps)

    cmd = [
        args.ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(args.fps), "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", args.out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    poster_t = 19.6
    poster_saved = False
    for i in range(total):
        t = i / args.fps
        frame = render_frame(t)
        if args.poster and not poster_saved and t >= poster_t:
            frame.save(args.poster)
            poster_saved = True
        proc.stdin.write(frame.tobytes())
        if i % 300 == 0:
            print(f"frame {i}/{total} ({t:.1f}s)", flush=True)
    proc.stdin.close()
    code = proc.wait()
    if code != 0:
        print(f"ffmpeg exited with {code}", file=sys.stderr)
        return code
    print(f"done: {args.out} ({total} frames, {DURATION}s)")
    return 0


bg = None  # type: ignore[assignment]

if __name__ == "__main__":
    sys.exit(main())
