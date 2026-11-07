#!/usr/bin/env python3
"""
Better Skill 展示视频 · Apple Keynote 风格版（程序化生成，无录屏）。

视觉语言：纯黑背景、极大字号、SF Pro 可变字重、渐变文字、聚焦模糊入画、
细如发丝的分隔线、玻璃质感胶囊、克制的苹果蓝点缀、极慢的位移与光扫。

时间轴（60s @ 24fps）：
  0.0– 7.0  片头：DEEPSEEK HARNESS → Better Skill 标题（模糊聚焦 + 光扫）
  7.0–16.0  三个入口浮入 → 收拢 → 合并为 Better Skill 胶囊
 16.0–26.5  01 描述汉化：英文 → 中文 的替换瞬间
 26.5–36.0  02 插件管理：版本号 0.1.25 → 0.1.26 逐行滑入
 36.0–46.0  03 技能管理：新建。编辑。禁用。删除。→ 删除，也进废纸篓。
 46.0–53.0  「一切，都可回滚。」
 53.0–60.0  开源仓库 + Better Skill 收尾

输出：H.264 MP4（1920x1080 / 24fps / 无音轨，BGM 由 make_keynote_bgm.py 另外合成后合入）。
"""
from __future__ import annotations

import argparse
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FPS = 24
DURATION = 60.0

# ---------- apple-ish palette ----------
WHITE = (245, 245, 247)
GRAY = (161, 161, 166)
GRAY_DIM = (110, 110, 115)
GRAY_FAINT = (72, 72, 76)
BLUE = (41, 151, 255)
GREEN = (48, 209, 88)
HAIR = (58, 58, 60)

SF_PATH = "/System/Library/Fonts/SFNS.ttf"
SF_MONO = "/System/Library/Fonts/SFNSMono.ttf"
CJK_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"
CJK_W3, CJK_W6 = 0, 2

_cache: dict[tuple, ImageFont.FreeTypeFont] = {}


def sf(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    key = ("sf", size, weight)
    f = _cache.get(key)
    if f is None:
        f = ImageFont.truetype(SF_PATH, size)
        try:
            f.set_variation_by_name(weight)
        except Exception:
            pass
        _cache[key] = f
    return f


def mono(size: int, weight: str = "Light") -> ImageFont.FreeTypeFont:
    key = ("mono", size, weight)
    f = _cache.get(key)
    if f is None:
        f = ImageFont.truetype(SF_MONO, size)
        try:
            f.set_variation_by_name(weight)
        except Exception:
            pass
        _cache[key] = f
    return f


def cjk(size: int, weight: str = "W3") -> ImageFont.FreeTypeFont:
    key = ("cjk", size, weight)
    f = _cache.get(key)
    if f is None:
        idx = CJK_W6 if weight in ("W6", "Semibold", "Bold") else CJK_W3
        f = ImageFont.truetype(CJK_PATH, size, index=idx)
        _cache[key] = f
    return f


# ---------- easing ----------
def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def ease(x: float) -> float:
    """Apple-ish slow-in slow-out (quintic)."""
    x = clamp(x)
    return 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3


def ease_out(x: float) -> float:
    x = clamp(x)
    return 1 - (1 - x) ** 4


def k(t: float, t0: float, dur: float, kind=ease) -> float:
    if dur <= 0:
        return 1.0 if t >= t0 else 0.0
    return kind((t - t0) / dur)


def win(t: float, t_in: float, t_out: float, din: float = 0.7, dout: float = 0.7) -> float:
    """Opacity window with ease-in and ease-out."""
    if t <= t_in or t >= t_out:
        return 0.0
    a = ease(clamp((t - t_in) / din))
    b = 1 - ease(clamp((t - (t_out - dout)) / dout))
    return min(a, b)


def lerp(a: float, b: float, x: float) -> float:
    return a + (b - a) * clamp(x)


# ---------- text layers ----------
def text_layer(
    text: str,
    font: ImageFont.FreeTypeFont,
    color=WHITE,
    gradient: tuple | None = None,
    pad: int = 24,
) -> Image.Image:
    """Render text on a transparent layer, tightly cropped (with small padding)."""
    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    box = probe.textbbox((0, 0), text, font=font, anchor="la")
    tw, th = int(box[2] + pad * 2), int(box[3] + pad * 2)
    layer = Image.new("RGBA", (max(tw, 4), max(th, 4)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((pad - box[0], pad - box[1]), text, font=font, fill=color + (255,), anchor="la")
    if gradient is not None:
        layer = _apply_gradient(layer, gradient)
    return layer


def _apply_gradient(layer: Image.Image, colors: tuple) -> Image.Image:
    w, h = layer.size
    top, bottom = np.array(colors[0], float), np.array(colors[1], float)
    ramp = np.linspace(0.0, 1.0, h)[:, None, None]
    arr = (top[None, None, :] * (1 - ramp) + bottom[None, None, :] * ramp)
    arr = np.broadcast_to(arr, (h, w, 3)).astype(np.uint8)
    grad = Image.fromarray(arr, "RGB")
    mask = layer.split()[3]
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def paste(frame: Image.Image, layer: Image.Image, x: float, y: float, anchor="mm",
          alpha: float = 1.0, blur: float = 0.0, scale: float = 1.0):
    if alpha <= 0.001 or layer is None:
        return
    im = layer
    if abs(scale - 1.0) > 1e-3:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    if blur > 0.05:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    if alpha < 0.999:
        a = im.split()[3].point(lambda v: int(v * alpha))
        im = im.copy()
        im.putalpha(a)
    ax = {"lm": 0, "la": 0, "mm": im.width // 2, "ma": im.width // 2,
          "rm": im.width, "ra": im.width, "cm": im.width // 2}[anchor]
    ay = {"lm": im.height // 2, "la": 0, "mm": im.height // 2, "ma": 0,
          "rm": im.height // 2, "ra": 0, "cm": 0}[anchor]
    frame.paste(im, (int(x - ax), int(y - ay)), im)


def sweep(layer: Image.Image, progress: float, strength: float = 1.0) -> Image.Image:
    """A soft specular light band travelling across the glyphs."""
    if progress <= 0 or progress >= 1:
        return layer
    w, h = layer.size
    xs = np.arange(w)[None, :]
    center = progress * (w + h * 0.6) - h * 0.3
    band = np.exp(-((xs - center) / (w * 0.11)) ** 2) * strength
    band = np.broadcast_to(band, (h, w))
    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    overlay[..., 0:3] = 255
    overlay[..., 3] = (band * 255).astype(np.uint8)
    glow = Image.fromarray(overlay, "RGBA")
    glow.putalpha(Image.composite(glow.split()[3], Image.new("L", (w, h), 0), layer.split()[3]))
    return Image.alpha_composite(layer, glow)


def hairline(frame: Image.Image, cx: float, y: float, length: float, alpha: float = 1.0,
             color=HAIR, thick: int = 1):
    if alpha <= 0 or length <= 0.5:
        return
    d = ImageDraw.Draw(frame)
    a = int(255 * clamp(alpha))
    x0 = int(cx - length / 2)
    x1 = int(cx + length / 2)
    d.line([(x0, int(y)), (x1, int(y))], fill=color + (a,), width=thick)


# ---------- small vector glyphs ----------
def glyph_arrow_right(d: ImageDraw.ImageDraw, x: float, y: float, size: float, color=BLUE, alpha=255):
    s = size
    c = color + (alpha,)
    d.line([(x - s / 2, y), (x + s / 2, y)], fill=c, width=3)
    d.line([(x + s / 2 - s * 0.28, y - s * 0.28), (x + s / 2, y)], fill=c, width=3)
    d.line([(x + s / 2 - s * 0.28, y + s * 0.28), (x + s / 2, y)], fill=c, width=3)


def glyph_check(frame: Image.Image, x: float, y: float, r: float = 20, color=GREEN, alpha=1.0):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", (int(r * 2 + 8), int(r * 2 + 8)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * clamp(alpha))
    d.ellipse((4, 4, 4 + 2 * r, 4 + 2 * r), outline=color + (a,), width=2)
    d.line([(4 + r * 0.62, 4 + r * 1.02), (4 + r * 0.92, 4 + r * 1.32), (4 + r * 1.42, 4 + r * 0.7)],
           fill=color + (a,), width=2)
    frame.paste(layer, (int(x - r - 4), int(y - r - 4)), layer)


def glyph_trash(frame: Image.Image, x: float, y: float, size: float = 26, color=GRAY, alpha=1.0):
    if alpha <= 0:
        return
    s = size
    layer = Image.new("RGBA", (int(s * 2), int(s * 2)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * clamp(alpha))
    c = color + (a,)
    cx, cy = s, s
    d.line([(cx - s * 0.45, cy - s * 0.55), (cx + s * 0.45, cy - s * 0.55)], fill=c, width=2)
    d.line([(cx - s * 0.12, cy - s * 0.7), (cx + s * 0.12, cy - s * 0.7)], fill=c, width=2)
    d.rounded_rectangle((cx - s * 0.36, cy - s * 0.42, cx + s * 0.36, cy + s * 0.62), radius=3, outline=c, width=2)
    for dx in (-s * 0.14, s * 0.14):
        d.line([(cx + dx, cy - s * 0.2), (cx + dx, cy + s * 0.34)], fill=c, width=2)
    frame.paste(layer, (int(x - s), int(y - s)), layer)


# ---------- background & grain ----------
def build_background() -> Image.Image:
    yy = np.linspace(0, 1, H)[:, None]
    xx = np.linspace(0, 1, W)[None, :]
    base = np.zeros((H, W, 3), float) + 3.0
    for cx, cy, rad, amp, color in [
        (0.5, 0.34, 0.52, 0.9, (9, 11, 18)),
        (0.5, 0.92, 0.6, 0.55, (7, 8, 13)),
    ]:
        dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        glow = np.exp(-(dist / rad) ** 2 * 3.0) * amp
        base += glow[:, :, None] * np.array(color, float)[None, None, :]
    base *= (1 - 0.35 * np.clip(((xx - 0.5) ** 2 * 1.2 + (yy - 0.5) ** 2 * 1.0), 0, 1))[:, :, None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


_GRAIN: Image.Image | None = None


def grain_layer() -> Image.Image:
    global _GRAIN
    if _GRAIN is None:
        rng = np.random.default_rng(5)
        g = rng.integers(0, 255, (H + 128, W + 128), dtype=np.uint8)
        arr = np.stack([g, g, g, np.full_like(g, 10)], axis=-1).astype(np.uint8)
        arr[..., 3] = 9
        _GRAIN = Image.fromarray(arr, "RGBA")
    return _GRAIN


# ---------- shared UI fragments ----------
def glass_pill(frame: Image.Image, cx: float, cy: float, w: float, h: float, alpha: float = 1.0, scale: float = 1.0):
    if alpha <= 0:
        return
    w, h = int(w * scale), int(h * scale)
    layer = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # outer soft glow
    for i in range(18, 0, -1):
        a = int(5 * alpha)
        d.rounded_rectangle((40 - i, 40 - i, 40 + w + i, 40 + h + i), radius=24 + i,
                            outline=(120, 140, 170, a), width=2)
    d.rounded_rectangle((40, 40, 40 + w, 40 + h), radius=22, fill=(28, 28, 30, int(235 * alpha)),
                        outline=(255, 255, 255, int(46 * alpha)), width=1)
    d.rounded_rectangle((41, 41, 39 + w, 39 + h), radius=21, outline=(255, 255, 255, int(18 * alpha)), width=1)
    frame.paste(layer, (int(cx - (w + 80) / 2), int(cy - (h + 80) / 2)), layer)


# ---------- scenes ----------
def scene_opening(frame: Image.Image, t: float):
    a = win(t, 0.0, 7.0, 0.01, 0.9)
    if a <= 0:
        return
    # tiny top label
    a1 = win(t, 0.5, 6.4, 0.9, 0.7)
    lab = text_layer("DEEPSEEK  HARNESS", sf(15, "Medium"), GRAY_DIM)
    paste(frame, lab, W / 2, 356, "mm", a1)
    # title
    kt = k(t, 1.15, 1.5)
    title = text_layer("Better Skill", sf(172, "Semibold"), gradient=((255, 255, 255), (206, 206, 212)))
    if kt > 0:
        title_s = sweep(title, k(t, 2.9, 1.6))
        paste(frame, title_s, W / 2, 520 + (1 - kt) * 14, "mm",
              alpha=kt, blur=(1 - kt) * 16, scale=0.972 + 0.028 * kt)
    # hairline
    hk = k(t, 2.35, 1.2)
    hairline(frame, W / 2, 604, 560 * hk, alpha=hk, color=(90, 90, 96))
    # subtitle
    sk = k(t, 2.7, 1.2)
    sub = text_layer("技能 · 插件 · 一处管理", cjk(34, "W3"), GRAY)
    paste(frame, sub, W / 2, 668 + (1 - sk) * 10, "mm", sk)
    # small version line
    vk = k(t, 3.4, 1.0)
    ver = text_layer("v0.6.0      MIT      FOR  DEEPSEEK  HARNESS", mono(14, "Regular"), GRAY_FAINT)
    paste(frame, ver, W / 2, 730, "mm", vk * 0.9)


def scene_merge(frame: Image.Image, t: float):
    """三个入口 → 合并为一个：三张玻璃卡片浮入、收拢、汇聚成 Better Skill 胶囊。"""
    if t < 7.0 or t > 16.0:
        return
    a = win(t, 7.0, 16.0, 0.6, 0.8)
    if a <= 0:
        return
    entries = [
        ("描述汉化", "12 技能 · 3 命令"),
        ("插件管理", "检查更新 · 一键更新"),
        ("技能管理", "新建 · 编辑 · 删除"),
    ]
    conv = ease(clamp((t - 9.9) / 1.0))
    for i, (title, sub) in enumerate(entries):
        ap = k(t, 7.25 + i * 0.24, 0.9)
        if ap <= 0:
            continue
        cx = lerp([420, 960, 1500][i], 960.0, conv * 0.34)
        cy = 548 - conv * 10
        sc = (0.94 + 0.06 * ap) * (1.0 - 0.30 * conv)
        alpha = ap * (1.0 - clamp((t - 9.9) / 1.05))
        _entry_card(frame, cx, cy, 360, 176, title, sub, alpha * a, sc)
    # center glow + glass pill
    pk = k(t, 10.65, 0.75)
    if pk > 0:
        glow = Image.new("RGBA", (900, 420), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for r in range(200, 0, -4):
            gd.ellipse((450 - r, 210 - int(r * 0.52), 450 + r, 210 + int(r * 0.52)),
                       fill=(41, 120, 255, int(3 * (1 - r / 200) * 255 * pk * a * 0.20)))
        glow = glow.filter(ImageFilter.GaussianBlur(40))
        frame.paste(glow, (int(960 - 450), int(540 - 210)), glow)
        glass_pill(frame, 960, 540, 540, 104, alpha=a * pk, scale=0.86 + 0.14 * pk)
        name = text_layer("Better Skill", sf(30, "Semibold"), WHITE)
        paste(frame, name, 726, 540, "lm", a * pk)
        chip = text_layer("一个入口", cjk(18, "W3"), GRAY)
        paste(frame, chip, 1190, 540, "rm", a * pk)
    # caption
    ck = k(t, 12.2, 1.0)
    if ck > 0:
        cap = text_layer("三块功能，一个入口。", cjk(26, "W3"), GRAY)
        paste(frame, cap, W / 2, 668 + (1 - ck) * 12, "mm", a * ck)


def _entry_card(frame: Image.Image, cx: float, cy: float, w: float, h: float,
                title: str, sub: str, alpha: float, scale: float = 1.0):
    if alpha <= 0:
        return
    w, h = int(w * scale), int(h * scale)
    layer = Image.new("RGBA", (w + 96, h + 96), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = 48, 48, 48 + w, 48 + h
    # soft shadow / halo
    for i in range(22, 0, -2):
        d.rounded_rectangle((x0 - i, y0 - i + 8, x1 + i, y1 + i + 10), radius=26 + i,
                            fill=(0, 0, 0, int(1.4 * alpha)))
    d.rounded_rectangle((x0, y0, x1, y1), radius=24, fill=(24, 25, 28, int(238 * alpha)),
                        outline=(255, 255, 255, int(42 * alpha)), width=1)
    d.rounded_rectangle((x0 + 1, y0 + 1, x1 - 1, y0 + h // 2), radius=23,
                        fill=(255, 255, 255, int(7 * alpha)))
    frame.paste(layer, (int(cx - (w + 96) / 2), int(cy - (h + 96) / 2)), layer)
    tl = text_layer(title, cjk(26, "W6"), WHITE)
    paste(frame, tl, cx, cy - 18, "mm", alpha)
    sl = text_layer(sub, cjk(14, "W3"), GRAY_DIM)
    paste(frame, sl, cx, cy + 34, "mm", alpha)


def chapter_header(frame: Image.Image, t: float, t0: float, num: str, title: str,
                   subtitle: str, alpha: float):
    if alpha <= 0:
        return
    nk = k(t, t0, 1.1)
    num_l = text_layer(num, sf(190, "Ultralight"), gradient=((116, 116, 122), (54, 54, 58)))
    paste(frame, num_l, 168, 240 + (1 - nk) * 18, "la", alpha * nk)
    tk = k(t, t0 + 0.5, 1.1)
    title_l = text_layer(title, cjk(84, "W6"), gradient=((255, 255, 255), (196, 196, 200)))
    paste(frame, title_l, 180, 452 + (1 - tk) * 16, "la", alpha * tk, blur=(1 - tk) * 8)
    sk = k(t, t0 + 1.0, 1.2)
    sub_l = text_layer(subtitle, cjk(32, "W3"), GRAY)
    paste(frame, sub_l, 184, 578, "la", alpha * sk)


def scene_feature1(frame: Image.Image, t: float):
    a = win(t, 16.2, 26.4, 0.8, 0.7)
    if a <= 0:
        return
    chapter_header(frame, t, 16.2, "01", "描述汉化", "12 个技能。3 条斜杠命令。全部中文。", a)
    # english → chinese replacement
    ex = k(t, 19.0, 1.0)
    out_en = 1 - k(t, 20.7, 0.7)
    if ex > 0 and out_en > 0:
        en = text_layer("Create, edit, inspect, or convert Office documents.",
                        sf(38, "Light"), GRAY)
        paste(frame, en, W / 2, 720, "mm", a * ex * out_en, blur=(1 - ex) * 8)
    cx = k(t, 20.9, 1.2)
    if cx > 0:
        zh = text_layer("创建、编辑、检查或转换 Office 文档。", cjk(44, "W6"), WHITE)
        zh = sweep(zh, k(t, 22.6, 1.4), strength=0.55)
        paste(frame, zh, W / 2, 720 + (1 - cx) * 12, "mm", a * cx, blur=(1 - cx) * 8)
    # footer
    fk = win(t, 23.0, 26.2, 0.8, 0.5)
    if fk > 0:
        hairline(frame, W / 2, 800, 520 * k(t, 23.0, 0.9), alpha=fk * 0.6)
        glyph_check(frame, W / 2 - 96, 852, 14, GREEN, fk)
        cap = text_layer("随时还原原文", cjk(22, "W3"), GRAY)
        paste(frame, cap, W / 2 - 66, 852, "lm", fk)


def scene_feature2(frame: Image.Image, t: float):
    a = win(t, 26.6, 36.0, 0.8, 0.7)
    if a <= 0:
        return
    chapter_header(frame, t, 26.6, "02", "插件管理", "检查更新。一键更新。", a)
    rows = [
        ("@nanmicoder/dsh-agent-teams", "0.1.25", "0.1.26"),
        ("@michengai/dsh-skills-manager", "1.2.9", "1.2.11"),
        ("dsh-context", "0.73.3", "0.74.0"),
    ]
    for i, (name, cur, latest) in enumerate(rows):
        t0 = 29.3 + i * 0.45
        rk = k(t, t0, 1.0)
        if rk <= 0:
            continue
        y = 700 + i * 72
        nl = text_layer(name, mono(26, "Regular"), WHITE if rk > 0.5 else GRAY)
        paste(frame, nl, 180, y, "lm", a * rk * (0.65 + 0.35 * rk))
        cl = text_layer(cur, mono(24, "Regular"), GRAY_DIM)
        paste(frame, cl, 1112, y, "rm", a * rk)
        arrow_k = k(t, t0 + 0.35, 0.8)
        if arrow_k > 0:
            d = ImageDraw.Draw(frame)
            glyph_arrow_right(d, 1146, y, 34 * arrow_k, BLUE, int(255 * a * arrow_k))
        lk = k(t, t0 + 0.5, 0.9)
        ll = text_layer(latest, mono(26, "Regular"), WHITE)
        paste(frame, ll, 1180, y, "lm", a * lk, blur=(1 - lk) * 6)
    fk = win(t, 33.6, 35.8, 0.8, 0.5)
    if fk > 0:
        cap = text_layer("更新走宿主 pluginManager · 保留兼容性闸门与构建脚本批准",
                         cjk(21, "W3"), GRAY)
        paste(frame, cap, W / 2, 950, "mm", fk)


def scene_feature3(frame: Image.Image, t: float):
    a = win(t, 36.1, 46.0, 0.8, 0.7)
    if a <= 0:
        return
    chapter_header(frame, t, 36.1, "03", "技能管理", "新建。编辑。禁用。删除。", a)
    words = ["新建", "编辑", "禁用", "删除"]
    for i, w in enumerate(words):
        t0 = 38.9 + i * 0.28
        rk = k(t, t0, 0.8)
        if rk <= 0:
            continue
        x = 220 + i * 340
        wl = text_layer(w, cjk(54, "W6"), WHITE if i < 3 else (255, 120, 120))
        paste(frame, wl, x, 700 + (1 - rk) * 10, "lm", a * rk, blur=(1 - rk) * 6)
        if i < 3:
            d = ImageDraw.Draw(frame)
            d.line([(x + 118, 680), (x + 118, 720)], fill=HAIR + (int(180 * a * rk),), width=1)
    # trash statement
    tk = k(t, 42.3, 1.0)
    if tk > 0:
        st = text_layer("删除，也进废纸篓。", cjk(48, "W6"), gradient=((255, 255, 255), (188, 188, 192)))
        paste(frame, st, W / 2, 838, "mm", a * tk, blur=(1 - tk) * 8)
        glyph_trash(frame, W / 2 - 300, 838, 22, GRAY, a * tk)
    ck = win(t, 43.6, 45.8, 0.7, 0.4)
    if ck > 0:
        cap = text_layer("不改源文件 · 快照留档 · 可恢复", cjk(21, "W3"), GRAY)
        paste(frame, cap, W / 2, 924, "mm", ck)


def scene_trust(frame: Image.Image, t: float):
    a = win(t, 46.2, 53.0, 0.8, 0.7)
    if a <= 0:
        return
    tk = k(t, 46.4, 1.1)
    head = text_layer("一切，都可回滚。", cjk(74, "W6"), gradient=((255, 255, 255), (186, 186, 190)))
    paste(frame, head, W / 2, 430 + (1 - tk) * 14, "mm", a * tk, blur=(1 - tk) * 10)
    items = [("立即还原", "restore"), ("废纸篓恢复", "trash"), ("升级自愈", "heal")]
    for i, (name, _key) in enumerate(items):
        t0 = 48.4 + i * 0.35
        rk = k(t, t0, 0.9)
        if rk <= 0:
            continue
        x = W / 2 + (i - 1) * 380
        n = text_layer(name, cjk(28, "W3"), WHITE)
        paste(frame, n, x, 610 + (1 - rk) * 12, "mm", a * rk)
        hairline(frame, x, 662, 190 * rk, alpha=a * rk * 0.5)
    sub = win(t, 50.2, 52.8, 0.7, 0.4)
    if sub > 0:
        cap = text_layer("译文可还原 · 删除可找回 · 宿主升级后自动重建", cjk(20, "W3"), GRAY_DIM)
        paste(frame, cap, W / 2, 760, "mm", sub)


def scene_end(frame: Image.Image, t: float):
    a = win(t, 53.1, 60.01, 0.8, 1.0)
    if a <= 0:
        return
    ok = k(t, 53.2, 1.0)
    cap = text_layer("开源。可自行构建。", cjk(24, "W3"), GRAY)
    paste(frame, cap, W / 2, 348, "mm", a * ok)
    rk = k(t, 53.9, 1.2)
    repo = text_layer("github.com/zzzzyppp/dsh-skill-desc-zh", mono(38, "Regular"), WHITE)
    repo = sweep(repo, k(t, 55.4, 1.6), strength=0.7)
    paste(frame, repo, W / 2, 430 + (1 - rk) * 10, "mm", a * rk, blur=(1 - rk) * 6)
    chips_k = k(t, 54.8, 1.0)
    if chips_k > 0:
        labels = ["MIT", "v0.6.0", "DSH 0.2.1-rc.2"]
        total = sum(ImageDraw.Draw(Image.new("RGB", (4, 4))).textlength(t, font=mono(15, "Regular")) for t in labels)
        widths = [ImageDraw.Draw(Image.new("RGB", (4, 4))).textlength(t, font=mono(15, "Regular")) + 30 for t in labels]
        x = W / 2 - (sum(widths) + 20 * (len(labels) - 1)) / 2
        for lab, wch in zip(labels, widths):
            layer = Image.new("RGBA", (int(wch), 40), (0, 0, 0, 0))
            dd = ImageDraw.Draw(layer)
            dd.rounded_rectangle((0, 0, int(wch) - 1, 39), radius=20, fill=(28, 28, 30, int(200 * a * chips_k)),
                                 outline=(255, 255, 255, int(26 * a * chips_k)), width=1)
            dd.text((wch / 2, 20), lab, font=mono(15, "Regular"), fill=GRAY + (int(255 * a * chips_k),), anchor="mm")
            frame.paste(layer, (int(x), int(500)), layer)
            x += wch + 20
    # final mark
    mk = k(t, 56.1, 1.2)
    if mk > 0:
        glass_pill(frame, W / 2, 646, 96, 96, alpha=a * mk, scale=0.9 + 0.1 * mk)
        yw = text_layer("译", cjk(44, "W6"), WHITE)
        paste(frame, yw, W / 2, 646, "mm", a * mk)
        name = text_layer("Better Skill.", sf(58, "Semibold"), gradient=((255, 255, 255), (170, 170, 176)))
        paste(frame, name, W / 2, 786, "mm", a * mk, blur=(1 - mk) * 8)
    fk = k(t, 57.2, 1.2)
    foot = text_layer("为 DeepSeek Harness 而做", cjk(20, "W3"), GRAY_DIM)
    paste(frame, foot, W / 2, 862, "mm", a * fk * 0.95)


SCENES = [scene_opening, scene_merge, scene_feature1, scene_feature2,
          scene_feature3, scene_trust, scene_end]


def render_frame(t: float) -> Image.Image:
    frame = bg.copy()
    for fn in SCENES:
        fn(frame, t)
    # global fade in/out
    gi = clamp(t / 0.9)
    go = clamp((DURATION - t) / 1.4)
    if gi < 1:
        frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), frame, ease(gi))
    if go < 1:
        frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), frame, ease(go))
    # film grain (cheap: reuse one tile with random offset)
    g = grain_layer()
    ox = int((t * 37) % 96)
    oy = int((t * 23) % 96)
    tile = g.crop((ox, oy, ox + W, oy + H))
    frame = Image.alpha_composite(frame.convert("RGBA"), tile).convert("RGB")
    return frame


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
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", args.out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    poster_t = 3.1
    saved = False
    for i in range(total):
        t = i / args.fps
        frame = render_frame(t)
        if args.poster and not saved and t >= poster_t:
            frame.save(args.poster)
            saved = True
        proc.stdin.write(frame.tobytes())
        if i % 240 == 0:
            print(f"frame {i}/{total} ({t:.1f}s)", flush=True)
    proc.stdin.close()
    code = proc.wait()
    if code != 0:
        print(f"ffmpeg exited {code}", file=sys.stderr)
        return code
    print(f"done: {args.out} ({total} frames / {DURATION}s)")
    return 0


bg: Image.Image | None = None

if __name__ == "__main__":
    raise SystemExit(main())
