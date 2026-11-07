#!/usr/bin/env python3
"""
Better Skill · Keynote 版配乐 v3 —— 重鼓组 + 画面音效（原创合成，无版权素材）。

在 v2（100 BPM 电子律动）基础上：
1) 鼓组加重：更低的 kick 基频 + 长衰减 sub 层 + tanh 饱和，snare/clap 双层，
   hi-hat 更硬、open hat、桶鼓 fill、每个章节入点的 crash。
2) 按画面对齐添加音效：whoosh 转场、卡片 tick、合并 swoosh、胶囊 chime、
   章节 impact、版本行 tick、技能词 pop、删除 thud + 纸篓 crumple、结尾 chime。

时间轴（60s）：
  0–7     片头：pad + 钢琴 + 八分低频脉冲 + air swell
  7–16    律动进入（三卡片合并段）：四拍 kick / snare / 16 分琶音 + SFX
 16–26.5  01 描述汉化：钢琴动机 + 高八度琶音
 26.5–36  02 插件管理：16 分贝斯推进 + 桶鼓 fill
 36–46    03 技能管理：全编制，shaker 16 分 + 拍手
 46–53    breakdown：抽掉鼓组，钢琴 + pad 呼吸
 53–60    resolve：Cmaj9 长和弦 + 收尾 chime

输出 48kHz / 16bit / 立体声 WAV。
"""
from __future__ import annotations

import argparse
import math
import wave

import numpy as np

SR = 48000
BPM = 100.0
BEAT = 60.0 / BPM            # 0.6 s
BAR = 4 * BEAT               # 2.4 s
DURATION = 60.0
N = int(SR * DURATION)
T = np.arange(N) / SR
rng = np.random.default_rng(20261025)


def hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def clip01(x):
    return np.clip(x, 0.0, 1.0)


def env(n: int, a: float, d: float, s: float, r: float, sus: float = 0.7) -> np.ndarray:
    out = np.zeros(n)
    i = 0
    for ln, v0, v1 in ((a, 0.0, 1.0), (d, 1.0, sus), (s, sus, sus), (r, sus, 0.0)):
        j = min(int(ln * SR), n - i)
        if j > 0:
            out[i:i + j] = np.linspace(v0, v1, j, endpoint=False)
            i += j
    return out


def lp_fft(x: np.ndarray, cutoff: float, order: float = 2.0) -> np.ndarray:
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1.0 / SR)
    h = 1.0 / np.sqrt(1.0 + (f / cutoff) ** (2 * order))
    return np.fft.irfft(spec * h, n=len(x))


def hp_fft(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lp_fft(x, cutoff, order=2.0)


def band(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return lp_fft(hp_fft(x, lo), hi)


def add(buf: np.ndarray, start: float, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0):
    i0 = int(start * SR)
    if i0 >= N or i0 < 0:
        return
    seg = sig[: N - i0]
    l = math.sqrt((1.0 - pan) / 2.0)
    r = math.sqrt((1.0 + pan) / 2.0)
    buf[i0:i0 + len(seg), 0] += seg * gain * l
    buf[i0:i0 + len(seg), 1] += seg * gain * r


# ---------------- drums (heavier) ----------------
def kick(amp: float = 1.0) -> np.ndarray:
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    f = 150 * np.exp(-t * 30) + 38
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.8)
    sub = np.sin(2 * np.pi * (38 + 8 * np.exp(-t * 18)) * t) * np.exp(-t * 4.2)
    click = hp_fft(rng.normal(0, 1, n) * np.exp(-t * 320), 1800) * 0.30
    sig = body * 0.95 + sub * 0.55 + click
    return np.tanh(sig * 1.35) * amp


def snare(amp: float = 1.0) -> np.ndarray:
    n = int(0.24 * SR)
    t = np.arange(n) / SR
    noise = hp_fft(rng.normal(0, 1, n), 1200) * np.exp(-t * 19)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.55
    return np.tanh((noise * 0.9 + body) * 1.2) * amp


def hat(amp: float = 1.0, decay: float = 60.0) -> np.ndarray:
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return hp_fft(rng.normal(0, 1, n), 7600) * np.exp(-t * decay) * amp


def open_hat(amp: float = 1.0) -> np.ndarray:
    n = int(0.34 * SR)
    t = np.arange(n) / SR
    return hp_fft(rng.normal(0, 1, n), 6200) * np.exp(-t * 9.5) * amp


def shaker(amp: float = 1.0) -> np.ndarray:
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return hp_fft(rng.normal(0, 1, n), 5200) * np.exp(-t * 70) * amp


def clap(amp: float = 1.0) -> np.ndarray:
    n = int(0.26 * SR)
    sig = np.zeros(n)
    for d in (0.0, 0.012, 0.026):
        i = int(d * SR)
        m = n - i
        sig[i:] += hp_fft(rng.normal(0, 1, m), 1200) * np.exp(-np.arange(m) / SR * 34)
    return sig * amp


def tom(midi: float, amp: float = 1.0) -> np.ndarray:
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = hz(midi) * (1.0 + 0.7 * np.exp(-t * 28))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9.5) * amp


def crash(amp: float = 1.0) -> np.ndarray:
    n = int(1.1 * SR)
    t = np.arange(n) / SR
    return hp_fft(rng.normal(0, 1, n), 3000) * np.exp(-t * 3.2) * amp


# ---------------- tonal instruments ----------------
def bass(midi: float, dur: float, amp: float = 1.0) -> np.ndarray:
    f = hz(midi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    saw = 2.0 * ((f * t) % 1.0) - 1.0
    sub = np.sin(2 * np.pi * f * t)
    sig = lp_fft(saw * 0.7 + sub * 0.85, 460)
    sig = np.tanh(sig * 1.3)
    sig *= env(n, 0.005, 0.08, max(0.05, dur - 0.2), 0.08, sus=0.8)
    return sig * amp


def pluck(midi: float, amp: float = 1.0, dur: float = 0.4) -> np.ndarray:
    f = hz(midi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for mult, a, dec in [(1, 1.0, 8.0), (2, 0.34, 12.0), (3, 0.15, 17.0), (4.01, 0.06, 24.0)]:
        sig += a * np.sin(2 * np.pi * f * mult * t) * np.exp(-t * dec)
    return lp_fft(sig, 6800) * amp


def piano(midi: float, dur: float, vel: float = 0.8) -> np.ndarray:
    f = hz(midi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    parts = []
    for mult, amp, dec in [(1.0, 1.0, 1.9), (2.002, 0.40, 2.6), (3.001, 0.17, 3.4),
                           (4.03, 0.08, 4.2), (5.02, 0.05, 5.0)]:
        parts.append(amp * np.sin(2 * np.pi * f * mult * t) * np.exp(-dec * t))
    body = np.sum(parts, axis=0) * env(n, 0.004, 0.2, 0.5, min(2.0, dur * 0.7), sus=0.3)
    hammer = hp_fft(rng.normal(0, 1, n) * np.exp(-t * 90), 1800) * 0.05
    return (body + hammer) * vel


def strings(midis: list[float], dur: float, amp: float = 1.0, bright: float = 2400.0) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in midis:
        f = hz(m)
        for det in (-0.004, 0.0, 0.004):
            vib = 1.0 + 0.0015 * np.sin(2 * np.pi * 4.6 * t + rng.random() * 6.28)
            for k in range(1, 9):
                out += np.sin(2 * np.pi * f * (1 + det) * k * t * vib) / (k ** 1.6)
    out /= max(1, len(midis) * 3)
    out = lp_fft(out, bright)
    out *= env(n, 0.7, 0.3, max(0.2, dur - 1.4), 0.9, sus=0.85)
    return out * amp


# ---------------- SFX ----------------
def whoosh(dur: float, amp: float = 1.0, pan0: float = -0.4, pan1: float = 0.4) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    sweep = np.zeros(n)
    chunks = 24
    for i in range(chunks):
        a, b = int(i / chunks * n), int((i + 1) / chunks * n)
        if b <= a:
            break
        cutoff = 400 + (i / chunks) ** 2 * 5200
        sweep[a:b] = lp_fft(noise[a:b], cutoff)
    return sweep * (t / max(dur, 1e-6)) ** 1.6 * amp


def impact(amp: float = 1.0) -> np.ndarray:
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    f = 110 * np.exp(-t * 10) + 30
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.0)
    boom = np.sin(2 * np.pi * 34 * t) * np.exp(-t * 3.0) * 0.8
    hit = hp_fft(rng.normal(0, 1, n), 700) * np.exp(-t * 45) * 0.5
    return np.tanh((body + boom + hit) * 1.4) * amp


def tick(freq: float = 2200.0, amp: float = 1.0) -> np.ndarray:
    n = int(0.055 * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) * np.exp(-t * 120)
    noise = hp_fft(rng.normal(0, 1, n), 6000) * np.exp(-t * 260) * 0.4
    return (sig + noise) * amp


def chime(midis: list[float], amp: float = 1.0, dur: float = 2.2) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for m in midis:
        f = hz(m)
        for mult, a, dec in [(1, 1.0, 1.8), (2.01, 0.5, 2.6), (3.02, 0.25, 3.6), (4.5, 0.12, 5.0)]:
            sig += a * np.sin(2 * np.pi * f * mult * t) * np.exp(-dec * t)
    return sig / max(1, len(midis)) * amp


def crumple(amp: float = 1.0) -> np.ndarray:
    n = int(0.5 * SR)
    sig = np.zeros(n)
    for d in (0.0, 0.07, 0.14, 0.22, 0.31):
        i = int(d * SR)
        m = min(int(0.09 * SR), n - i)
        if m <= 0:
            continue
        sig[i:i + m] += hp_fft(rng.normal(0, 1, m), 2500) * np.exp(-np.arange(m) / SR * 60)
    return sig * amp


# ---------------- arrangement ----------------
CHORDS = {
    "Cmaj9": [48, 55, 59, 62, 64, 67],
    "Amin9": [45, 52, 55, 59, 60, 64],
    "Fmaj9": [41, 48, 52, 55, 57, 60],
    "G6":    [43, 50, 54, 57, 59, 62],
}
PROG = (["Cmaj9"] * 3 + ["Amin9"] * 3 + ["Fmaj9"] * 2 + ["G6"] * 2 +
        ["Cmaj9"] * 3 + ["Amin9"] * 3 + ["Fmaj9"] * 2 + ["G6"] * 2 +
        ["Fmaj9"] * 2 + ["Cmaj9"] * 3)


def chord_at(t0: float) -> str:
    return PROG[min(len(PROG) - 1, max(0, int(t0 // BAR)))]


def kick_times() -> list[float]:
    times = []
    t = 3.6
    while t < 52.6:
        times.append(t)
        t += BEAT
    return times


def section_curve(points) -> np.ndarray:
    xs = np.array([p[0] for p in points], float)
    ys = np.array([p[1] for p in points], float)
    return np.interp(T, xs, ys)


def compose() -> np.ndarray:
    drums = np.zeros((N, 2))
    bass_bus = np.zeros((N, 2))
    arp_bus = np.zeros((N, 2))
    music = np.zeros((N, 2))
    sfx = np.zeros((N, 2))

    # ---- pads / strings ----
    for bar, name in enumerate(PROG):
        t0 = bar * BAR
        notes = CHORDS[name]
        if t0 < 7.0:
            g = 0.105
        elif t0 < 16.0:
            g = 0.11
        elif t0 < 36.0:
            g = 0.115
        elif t0 < 46.0:
            g = 0.13
        elif t0 < 53.0:
            g = 0.095
        else:
            g = 0.115
        add(music, t0, strings([m - 12 for m in notes[:4]], BAR * 1.02, amp=g, bright=1500), 1.0, -0.15)
        if bar >= 5:
            add(music, t0 + 0.04, strings(notes[2:], BAR * 0.98, amp=g * 0.6, bright=2600), 1.0, 0.22)
    add(music, 52.8, strings([m - 12 for m in CHORDS["Cmaj9"][:4]], 7.0, amp=0.12, bright=1400), 1.0, -0.1)
    add(music, 52.8, strings(CHORDS["Cmaj9"][2:], 6.6, amp=0.085, bright=2600), 1.0, 0.2)

    # ---- drums ----
    for t0 in kick_times():
        pre = t0 < 7.0
        add(drums, t0, kick(0.60 if pre else 1.05), 1.0, 0.0)
    t = 26.5
    while t < 52.0:
        add(drums, t + BAR - BEAT / 2, kick(0.55), 1.0, 0.0)
        t += BAR * 2
    for bar_start in np.arange(0.0, 52.0, BAR):
        for b in (1, 3):
            t0 = bar_start + b * BEAT
            if 11.0 <= t0 < 46.0:
                hard = 1.15 if t0 >= 36.0 else 0.9
                add(drums, t0, snare(0.55 * hard), 1.0, 0.0)
                add(drums, t0, clap(0.30 * hard), 1.0, 0.18)
    t = 5.0 + BEAT / 2
    while t < 46.0:
        pre = t < 7.0
        add(drums, t, hat(0.26 if pre else 0.42, decay=62), 1.0, 0.3)
        t += BEAT
    t = 16.0
    k = 0
    while t < 46.0:
        if k % 4 != 0:
            add(drums, t, hat(0.18 if k % 2 else 0.10, decay=90), 1.0, -0.32)
        t += BEAT / 4
        k += 1
    for bar_start in np.arange(20.0, 46.0, BAR):
        add(drums, bar_start + BAR - BEAT / 2, open_hat(0.16), 1.0, 0.1)
    t = 16.0
    while t < 46.0:
        add(drums, t, shaker(0.13), 1.0, -0.35)
        t += BEAT / 4
    for bar_start in np.arange(20.0, 46.0, BAR * 2):
        for i, m in enumerate([45, 47, 50, 52]):
            add(drums, bar_start + BAR - 0.55 + i * 0.11, tom(m, 0.42), 1.0, -0.3 + i * 0.2)
    for t0 in (7.0, 16.15, 26.55, 36.05, 46.35, 53.1, 56.1):
        add(drums, t0, crash(0.50 if t0 == 7.0 else 0.30), 1.0, -0.1)

    # ---- bass ----
    t = 7.0
    idx = 0
    while t < 52.6:
        name = chord_at(t)
        root = CHORDS[name][0] - 12
        if t < 16.0:
            add(bass_bus, t, bass(root, BEAT * 0.92, 0.5), 1.0, 0.0)
            t += BEAT
        elif t < 46.0:
            pattern = [root, root + 12, root, root + 7 if name != "G6" else root + 9]
            for j in range(2):
                m = pattern[(idx + j) % len(pattern)]
                add(bass_bus, t + j * BEAT / 2, bass(m, BEAT * 0.44, 0.52), 1.0, 0.0)
            if 26.5 <= t < 46.0:
                add(bass_bus, t + BEAT * 0.75, bass(root + 12, BEAT * 0.2, 0.34), 1.0, 0.0)
            t += BEAT
        else:
            add(bass_bus, t, bass(root, BEAT * 0.9, 0.36), 1.0, 0.0)
            t += BEAT * 2
        idx += 1
    add(bass_bus, 52.8, bass(CHORDS["Cmaj9"][0] - 12, 6.0, 0.4), 1.0, 0.0)

    # ---- arpeggio 16ths ----
    t = 7.0
    step = 0
    while t < 52.6:
        name = chord_at(t)
        tones = CHORDS[name][1:]
        if 36.0 <= t < 46.0:
            tones = [m + 12 for m in tones]
        note = tones[step % len(tones)] + (12 if (step // len(tones)) % 2 else 0)
        g = 0.07 if t < 16.0 else (0.09 if t < 46.0 else 0.055)
        add(arp_bus, t, pluck(note, g, dur=0.32), 1.0, -0.35 if step % 2 else 0.35)
        t += BEAT / 4
        step += 1

    # ---- piano ----
    for t0, m, v in [(1.0, 72, 0.50), (2.4, 76, 0.44), (3.9, 79, 0.40), (5.2, 76, 0.34), (6.2, 79, 0.30)]:
        add(music, t0, piano(m, 3.5, v), 0.9, -0.1)
    add(music, 0.0, piano(48, 6.5, 0.5), 0.85, 0.0)
    motif = {
        "Cmaj9": [60, 64, 67, 71, 67, 64],
        "Amin9": [57, 60, 64, 67, 64, 60],
        "Fmaj9": [53, 57, 60, 64, 60, 57],
        "G6":    [55, 59, 62, 64, 62, 59],
    }
    for bar in range(3, 22):
        t0 = bar * BAR
        name = PROG[bar]
        for i, m in enumerate(motif[name]):
            if bar >= 20 and i % 2 == 1:
                continue
            vel = 0.27 + 0.10 * math.sin(bar * 1.3 + i * 0.8)
            add(music, t0 + i * BEAT * 0.5, piano(m, 2.2, vel), 0.85, -0.25 + 0.1 * i)
    for t0, m, v in [(53.4, 72, 0.46), (54.2, 76, 0.40), (55.0, 79, 0.36), (56.4, 84, 0.28)]:
        add(music, t0, piano(m, 5.0, v), 1.0, 0.05)
    add(music, 53.3, piano(48, 6.5, 0.52), 0.9, 0.0)

    # ---- SFX (aligned with visuals) ----
    add(sfx, 3.0, whoosh(0.9, 0.10), 1.0, 0.3)
    add(sfx, 6.35, whoosh(1.1, 0.24), 1.0, -0.2)
    for i, (t0, freq) in enumerate([(7.25, 2100), (7.49, 2450), (7.73, 2850)]):
        add(sfx, t0, tick(freq, 0.11), 1.0, -0.3 + i * 0.3)
    add(sfx, 9.85, whoosh(0.95, 0.18), 1.0, 0.0)
    add(sfx, 10.78, chime([84, 88, 91], 0.10), 1.0, 0.0)
    add(sfx, 12.25, tick(1700, 0.07), 1.0, 0.0)
    add(sfx, 16.10, impact(0.55), 1.0, 0.0)
    add(sfx, 19.0, whoosh(0.6, 0.10), 1.0, -0.2)
    add(sfx, 20.9, chime([86], 0.07, 1.6), 1.0, 0.15)
    add(sfx, 22.95, tick(2500, 0.08), 1.0, 0.2)
    add(sfx, 26.45, impact(0.50), 1.0, 0.0)
    for i, (t0, freq) in enumerate([(29.3, 2000), (29.75, 2300), (30.2, 2600)]):
        add(sfx, t0, tick(freq, 0.08), 1.0, -0.25 + i * 0.25)
    add(sfx, 30.0, whoosh(0.4, 0.09), 1.0, 0.3)
    add(sfx, 35.95, impact(0.50), 1.0, 0.0)
    for i, t0 in enumerate([38.9, 39.18, 39.46, 39.74]):
        add(sfx, t0, tick(1800 + i * 220, 0.09), 1.0, -0.35 + i * 0.23)
    add(sfx, 42.22, impact(0.58), 1.0, 0.0)
    add(sfx, 42.26, tick(900, 0.30), 1.0, -0.15)
    add(sfx, 42.34, whoosh(0.42, 0.17), 1.0, 0.0)
    add(sfx, 42.38, crumple(0.52), 1.0, 0.25)
    add(sfx, 46.25, impact(0.42), 1.0, 0.0)
    for i, t0 in enumerate([48.4, 48.75, 49.1]):
        add(sfx, t0, tick(2100 + i * 250, 0.07), 1.0, -0.3 + i * 0.3)
    add(sfx, 52.9, whoosh(1.0, 0.16), 1.0, -0.3)
    add(sfx, 53.12, impact(0.48), 1.0, 0.0)
    add(sfx, 53.95, chime([79, 84, 88], 0.08), 1.0, 0.1)
    for i, t0 in enumerate([54.8, 55.0, 55.2]):
        add(sfx, t0, tick(2400 + i * 300, 0.05), 1.0, -0.2 + i * 0.2)
    add(sfx, 56.1, chime([88, 91, 96], 0.09, 2.6), 1.0, 0.0)

    # ---------------- sidechain ----------------
    duck = np.ones(N)
    for t0 in kick_times():
        i0 = int(t0 * SR)
        ln = min(int(0.36 * SR), N - i0)
        curve = 1.0 - 0.62 * np.exp(-(np.arange(ln) / SR) / 0.085)
        duck[i0:i0 + ln] = np.minimum(duck[i0:i0 + ln], curve)
    duck[int(46.2 * SR):int(52.8 * SR)] = 1.0

    mix = music * duck[:, None]
    mix += bass_bus * np.where(T < 52.8, duck, 1.0)[:, None]
    mix += arp_bus * (0.55 + 0.45 * duck)[:, None]
    mix += drums
    # brief music drop-out so the trash SFX lands cleanly
    i0, i1 = int(42.10 * SR), int(42.78 * SR)
    ramp = np.linspace(0.32, 1.0, max(1, i1 - i0)) ** 2
    mix[i0:i1] = mix[i0:i1] * ramp[:, None]
    mix += sfx

    for t0, dur, amp in [(6.2, 0.9, 0.06), (15.4, 0.55, 0.030), (26.0, 0.5, 0.040),
                         (35.5, 0.5, 0.040), (45.6, 0.8, 0.050), (52.0, 0.7, 0.050)]:
        n = int(dur * SR)
        tt = np.arange(n) / SR
        noise = rng.normal(0, 1, n) * (tt / dur) ** 2
        add(mix, t0, hp_fft(noise, 900) * amp, 1.0, 0.0)

    # ---------------- reverb & master ----------------
    mix = reverb(mix)
    mix = np.tanh(mix * 1.45) / 1.45
    level = section_curve([
        (0.0, 0.0), (0.7, 0.96), (6.6, 0.98), (7.0, 1.0), (16.0, 0.98),
        (26.5, 1.0), (36.0, 1.02), (46.0, 1.0), (46.4, 0.74), (52.6, 0.82),
        (53.0, 0.97), (58.3, 0.92), (60.0, 0.0),
    ])
    mix *= level[:, None]
    fade = np.minimum(1.0, np.minimum(T / 0.3, (DURATION - T) / 1.4))
    mix *= np.clip(fade, 0, 1)[:, None]
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = mix / peak * (10 ** (-1.2 / 20)) * 0.67
    return mix


def reverb(stereo: np.ndarray, decay: float = 2.0, mix: float = 0.22) -> np.ndarray:
    n = int(SR * decay)
    t = np.arange(n) / SR
    out = np.zeros_like(stereo)
    for ch in range(2):
        ir = rng.normal(0, 1, n) * np.exp(-t * 3.8)
        ir = lp_fft(ir, 3600)
        ir[0] = 1.0
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        spec = np.fft.rfft(stereo[:, ch], n=2 * N)
        ir_spec = np.fft.rfft(ir, n=2 * N)
        wet = np.fft.irfft(spec * ir_spec, n=2 * N)[:N]
        out[:, ch] = stereo[:, ch] * (1 - mix) + wet * mix * 1.45
    return out


def write_wav(path: str, stereo: np.ndarray):
    data = np.clip(stereo, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/Users/ypz/Downloads/better-skill-keynote-bgm.wav")
    args = ap.parse_args()
    print("composing v3 (heavy drums + sfx)...", flush=True)
    audio = compose()
    write_wav(args.out, audio)
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio ** 2)))
    print(f"wrote {args.out}")
    print(f"peak {20 * math.log10(peak + 1e-9):.2f} dBFS / rms {20 * math.log10(rms + 1e-9):.2f} dBFS / {DURATION}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
