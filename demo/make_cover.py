#!/usr/bin/env python3
"""Better Skill 视频封面（含 DeepSeek 小鲸鱼/大肥鱼形象）。

复用 render_keynote.py 的字体、背景、渐变与渲染工具，输出 1920x1080 PNG。

用法:
  python3 demo/make_cover.py --out /Users/ypz/Downloads/better-skill-cover.png
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rk", HERE / "render_keynote.py")
rk = importlib.util.module_from_spec(spec)
sys.modules["rk"] = rk
spec.loader.exec_module(rk)

WHALE = Path(
    "/Users/ypz/.dsh/profiles/desktop/node_modules/dsh-whale-widget/assets/DSniang1.png"
)

ACCENT = (64, 140, 255)
TITLE_TOP = (243, 243, 247)
TITLE_BOTTOM = (150, 150, 159)


def radial_glow(frame: Image.Image, cx: float, cy: float, rx: float, ry: float,
                color: tuple[int, int, int], alpha: float = 0.5, softness: float = 2.4):
    yy = np.linspace(0, rk.H, rk.H)[:, None]
    xx = np.linspace(0, rk.W, rk.W)[None, :]
    dist = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    field = np.exp(-(dist ** softness) * 2.2) * alpha
    overlay = np.zeros((rk.H, rk.W, 4), dtype=np.uint8)
    overlay[..., 0] = color[0]
    overlay[..., 1] = color[1]
    overlay[..., 2] = color[2]
    overlay[..., 3] = np.clip(field * 255, 0, 255).astype(np.uint8)
    im = Image.fromarray(overlay, "RGBA")
    frame.paste(im, (0, 0), im)


def soft_shadow(frame: Image.Image, image: Image.Image, cx: float, cy: float,
                blur: float = 42, alpha: float = 130, offset: tuple[int, int] = (0, 30)):
    mask = image.split()[3].point(lambda v: int(v * alpha / 255))
    sh = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sh.putalpha(mask)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    frame.paste(sh, (int(cx - image.width / 2 + offset[0]), int(cy - image.height / 2 + offset[1])), sh)


def rim_glow(frame: Image.Image, image: Image.Image, cx: float, cy: float,
             color=ACCENT, alpha: float = 0.55, blur: float = 26):
    mask = image.split()[3].point(lambda v: int(v * alpha))
    layer = Image.new("RGBA", image.size, color + (0,))
    layer.putalpha(mask)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    frame.paste(layer, (int(cx - image.width / 2), int(cy - image.height / 2)), layer)


def chip(frame: Image.Image, x: float, y: float, text: str, font, color=(196, 196, 206),
         dot: tuple[int, int, int] | None = None, h: int = 42) -> float:
    probe = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    tw = probe.textlength(text, font=font)
    pad = 18
    dot_w = 22 if dot else 0
    w = int(tw + pad * 2 + dot_w)
    layer = Image.new("RGBA", (w + 48, h + 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ox, oy = 24, 24
    d.rounded_rectangle((ox, oy, ox + w, oy + h), radius=h // 2,
                        fill=(255, 255, 255, 13), outline=(255, 255, 255, 40), width=1)
    if dot is not None:
        cy = oy + h // 2
        d.ellipse((ox + pad, cy - 4, ox + pad + 8, cy + 4), fill=dot + (255,))
    d.text((ox + pad + dot_w, oy + h // 2), text, font=font, fill=color + (255,), anchor="lm")
    frame.paste(layer, (int(x - 24), int(y - 24)), layer)
    return w


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--whale", default=str(WHALE))
    args = ap.parse_args()

    frame = rk.build_background().copy()

    # --- ambience -------------------------------------------------------
    radial_glow(frame, 1300, 420, 620, 560, (34, 88, 210), alpha=0.32, softness=2.6)
    radial_glow(frame, 1520, 760, 420, 360, (18, 52, 140), alpha=0.22, softness=2.4)
    d = ImageDraw.Draw(frame)
    d.ellipse((950, 150, 1790, 990), outline=(120, 150, 210, 22), width=1)
    d.ellipse((1010, 210, 1730, 930), outline=(120, 150, 210, 12), width=1)

    # --- mascot ---------------------------------------------------------
    whale = Image.open(args.whale).convert("RGBA")
    whale = whale.crop(whale.getchannel("A").getbbox())
    target_h = 858
    scale = target_h / whale.height
    whale = whale.resize((max(1, int(whale.width * scale)), target_h), Image.LANCZOS)
    whale = whale.rotate(-2.4, resample=Image.BICUBIC, expand=True)
    # soften the bottom edge so the bust blends into the background
    wa = np.asarray(whale.split()[3], dtype=np.float32)
    ramp = np.ones((wa.shape[0], 1), dtype=np.float32)
    fade_from = int(wa.shape[0] * 0.78)
    n = wa.shape[0] - fade_from
    ramp[fade_from:] = np.linspace(1.0, 0.0, n)[:, None] ** 1.6
    wa = np.clip(wa * np.broadcast_to(ramp, wa.shape), 0, 255).astype(np.uint8)
    whale.putalpha(Image.fromarray(wa, "L"))
    mx, my = 1358, 496
    radial_glow(frame, mx, my + 40, 470, 430, (70, 130, 255), alpha=0.22, softness=2.2)
    soft_shadow(frame, whale, mx, my, blur=56, alpha=120, offset=(6, 30))
    rim_glow(frame, whale, mx, my, alpha=0.5, blur=30)
    frame.paste(whale, (int(mx - whale.width / 2), int(my - whale.height / 2)), whale)

    # floor glow under the character
    radial_glow(frame, mx, 930, 300, 40, (90, 150, 255), alpha=0.30, softness=1.8)

    # --- left column ----------------------------------------------------
    f_eyebrow = rk.mono(18, "Medium")
    f_title = rk.sf(128, "Semibold")
    f_sub = rk.cjk(42, "W3")
    f_body = rk.cjk(26, "W3")
    f_chip = rk.mono(19, "Regular")
    f_repo = rk.mono(20, "Light")

    x = 160
    lay = rk.text_layer("DEEPSEEK HARNESS", f_eyebrow, color=(146, 146, 158))
    rk.paste(frame, lay, x, 232, anchor="lm")

    title = rk.text_layer("Better Skill", f_title, gradient=(TITLE_TOP, TITLE_BOTTOM))
    title = rk.sweep(title, 0.66, 0.85)
    rk.paste(frame, title, x, 352, anchor="lm")

    rk.hairline(frame, x + 290, 452, 620, alpha=0.85)
    lay = rk.text_layer("技能 · 插件 · 一处管理", f_sub, color=(184, 184, 194))
    rk.paste(frame, lay, x, 528, anchor="lm")

    lay = rk.text_layer("三个功能，一个入口。随时可回滚。", f_body, color=(136, 136, 147))
    rk.paste(frame, lay, x, 604, anchor="lm")

    cx = x
    for text, font, dot in [
        ("MIT License", f_chip, (86, 200, 150)),
        ("v0.6.0", f_chip, ACCENT),
        ("DSH 0.2.1-rc.2", f_chip, (200, 170, 90)),
    ]:
        w = chip(frame, cx, 700, text, rk.mono(19, "Regular"), dot=dot)
        cx += w + 14

    # play badge: 60s demo
    badge = Image.new("RGBA", (520, 96), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.ellipse((24, 18, 84, 78), fill=(255, 255, 255, 16), outline=(255, 255, 255, 60), width=1)
    bd.polygon([(48, 36), (48, 60), (66, 48)], fill=(236, 240, 250, 235))
    bd.text((102, 50), "60 秒演示视频", font=rk.cjk(26, "W4"), fill=(168, 168, 180, 255), anchor="lm")
    frame.paste(badge, (140, 748), badge)

    lay = rk.text_layer("github.com/zzzzyppp/dsh-skill-desc-zh", f_repo, color=(118, 118, 128))
    rk.paste(frame, lay, x, 986, anchor="lm")

    # mascot label chip
    label = "DeepSeek 大肥鱼"
    ch_w = chip(frame, mx, 948, label, rk.cjk(22, "W3"), color=(206, 210, 222), dot=(90, 160, 255), h=46)
    _ = ch_w

    # sparkles
    d = ImageDraw.Draw(frame, "RGBA")
    for sx, sy, r, a in [(1130, 232, 3, 120), (1712, 300, 2, 90), (1640, 806, 3, 100), (1066, 760, 2, 70), (1520, 168, 2, 80)]:
        col = (150, 190, 255, a)
        d.line((sx - r * 2, sy, sx + r * 2, sy), fill=col, width=1)
        d.line((sx, sy - r * 2, sx, sy + r * 2), fill=col, width=1)
        d.ellipse((sx - r // 2, sy - r // 2, sx + r // 2, sy + r // 2), fill=(220, 236, 255, a + 40))

    # --- finishing ------------------------------------------------------
    frame = frame.convert("RGBA")
    g = rk.grain_layer()
    tile = g.crop((48, 48, 48 + rk.W, 48 + rk.H))
    frame = Image.alpha_composite(frame, tile).convert("RGB")

    # gentle vignette
    yy = np.linspace(-1, 1, rk.H)[:, None]
    xx = np.linspace(-1, 1, rk.W)[None, :]
    vig = np.clip(np.sqrt(xx * xx + yy * yy) - 0.62, 0, 1) * 0.55
    arr = np.asarray(frame, dtype=np.float32) * (1 - vig[:, :, None])
    frame = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    frame.save(out)
    print(f"saved {out} {frame.size[0]}x{frame.size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
