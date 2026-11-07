#!/usr/bin/env python3
"""
为 Better Skill 展示视频生成一段原创背景音乐（纯程序化合成，无版权风险）。

风格：温暖氛围电子 / lo-fi ambient —— 铺底 pad、轻拨琶音、柔和底鼓、稀疏钟琴。
结构对齐视频时间轴（55s，96 BPM，每小节 2.5s）：
  00:00–00:07  片头：pad 渐入 + 钟琴点缀 + 5.5–7.0s 上扬噪声
  00:07–00:14  进入 App：pad + 轻底鼓；09.0s 琶音与贝斯进入
  00:14–00:26  描述汉化 Tab：完整律动
  00:26–00:40  插件/技能管理：完整律动 + 高八度 pad 提亮
  00:40–00:41.5  转场：律动收束 + 下潜
  00:41.5–00:55  片尾：pad 与钟琴收束，52–55s 淡出
输出：48kHz / 16bit / 立体声 WAV（默认 55s）。
"""
from __future__ import annotations

import argparse
import math
import wave

import numpy as np

SR = 48000
BPM = 96.0
BEAT = 60.0 / BPM          # 0.625s
BAR = 4 * BEAT             # 2.5s
DURATION = 55.0
N = int(SR * DURATION)
T = np.arange(N) / SR

A4 = 440.0


def hz(midi: float) -> float:
    return A4 * 2 ** ((midi - 69) / 12.0)


def midi_name(m: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{names[m % 12]}{m // 12 - 1}"


def env(n: int, a: float, d: float, s: float, r: float, sus: float = 0.7) -> np.ndarray:
    """ADSR envelope over n samples (seconds)."""
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    e = np.zeros(n)
    na = min(na, n)
    if na > 0:
        e[:na] = np.linspace(0, 1, na, endpoint=False) ** 1.4
    nd_end = min(na + nd, n)
    if nd_end > na:
        e[na:nd_end] = np.linspace(1, sus, nd_end - na)
    hold_end = max(nd_end, n - nr)
    if hold_end > nd_end:
        e[nd_end:hold_end] = sus
    if nr > 0 and n - nr < n:
        start = max(hold_end, n - nr)
        k = n - start
        e[start:] = np.linspace(e[start - 1] if start > 0 else sus, 0, k) ** 1.2
    return e


def add(buf: np.ndarray, start: float, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0):
    """Mix mono signal into stereo buffer at time `start` seconds, constant-power pan."""
    i0 = int(start * SR)
    if i0 >= N:
        return
    seg = sig[: N - i0]
    if len(seg) == 0:
        return
    gl = math.cos((pan + 1) * math.pi / 4) * gain
    gr = math.sin((pan + 1) * math.pi / 4) * gain
    buf[i0:i0 + len(seg), 0] += seg * gl
    buf[i0:i0 + len(seg), 1] += seg * gr


def attack(wave: np.ndarray, ms: float = 4.0) -> np.ndarray:
    k = min(len(wave), max(1, int(ms / 1000 * SR)))
    wave[:k] *= np.linspace(0, 1, k) ** 1.5
    return wave


def pad_note(freq: float, dur: float, amp: float, detune: float = 0.0016) -> np.ndarray:
    n = int(dur * SR)
    tt = np.arange(n) / SR
    out = np.zeros(n)
    # additively band-limited soft organ/saw hybrid
    for k in range(1, 9):
        f = freq * k
        if f > SR * 0.45:
            break
        a = amp / (k ** 1.75)
        for dt in (-detune, detune):
            out += a / 2 * np.sin(2 * np.pi * f * (1 + dt) * tt + k * 0.7)
    e = env(n, 0.9, 0.6, 0.0, 1.4, sus=0.85)
    return out * e


def pluck(freq: float, dur: float = 0.5, amp: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    tt = np.arange(n) / SR
    out = (
        np.sin(2 * np.pi * freq * tt)
        + 0.32 * np.sin(2 * np.pi * freq * 2 * tt + 0.4)
        + 0.10 * np.sin(2 * np.pi * freq * 3 * tt + 1.1)
    )
    e = np.exp(-tt / 0.16) * (1 - np.exp(-tt / 0.004))
    return attack(out * e * amp, 3)


def bell(freq: float, dur: float = 2.4, amp: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    tt = np.arange(n) / SR
    out = (
        np.sin(2 * np.pi * freq * tt)
        + 0.28 * np.sin(2 * np.pi * freq * 2.01 * tt)
        + 0.12 * np.sin(2 * np.pi * freq * 3.98 * tt)
        + 0.06 * np.sin(2 * np.pi * freq * 5.4 * tt)
    )
    e = np.exp(-tt / 0.55) * (1 - np.exp(-tt / 0.006))
    return out * e * amp


def bass(freq: float, dur: float, amp: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    tt = np.arange(n) / SR
    out = np.sin(2 * np.pi * freq * tt) + 0.18 * np.sin(2 * np.pi * freq * 2 * tt)
    e = env(n, 0.006, 0.12, 0.0, 0.18, sus=0.62)
    return np.tanh(out * e * 1.1) * amp


def kick(amp: float = 1.0) -> np.ndarray:
    n = int(0.36 * SR)
    tt = np.arange(n) / SR
    f = 120 * np.exp(-tt / 0.045) + 44
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(phase) * np.exp(-tt / 0.11)
    return out * amp


def shaker(amp: float = 1.0) -> np.ndarray:
    n = int(0.09 * SR)
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0)  # cheap high-pass
    e = np.exp(-np.arange(n) / SR / 0.02)
    return noise * e * amp


def riser(dur: float, amp: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    rng = np.random.default_rng(11)
    noise = rng.standard_normal(n)
    # moving-average lowpass with rising cutoff
    out = np.zeros(n)
    lp = 0.0
    for i in range(n):
        cutoff = 0.02 + 0.22 * (i / n) ** 2
        lp += cutoff * (noise[i] - lp)
        out[i] = noise[i] - lp
    env_curve = np.linspace(0, 1, n) ** 2
    return out * env_curve * amp


def reverb(sig: np.ndarray, decay: float = 1.7, mix: float = 0.28) -> np.ndarray:
    """Cheap FFT convolution reverb using a exponential-decay noise IR."""
    n = len(sig)
    ir_n = int(decay * SR)
    rng = np.random.default_rng(3)
    ir = rng.standard_normal((ir_n, 2)) * np.exp(-np.arange(ir_n) / SR / (decay / 3.5))[:, None]
    # soften IR with a small box filter
    k = np.ones(24) / 24
    for ch in range(2):
        ir[:, ch] = np.convolve(ir[:, ch], k, mode="same")
    ir /= np.max(np.abs(ir)) + 1e-9
    size = 1 << (n + ir_n).bit_length()
    wet = np.zeros_like(sig)
    for ch in range(2):
        S = np.fft.rfft(sig[:, ch], size)
        H = np.fft.rfft(ir[:, ch], size)
        wet[:, ch] = np.fft.irfft(S * H, size)[:n]
    wet /= np.max(np.abs(wet)) + 1e-9
    wet *= np.max(np.abs(sig)) + 1e-9
    return sig * (1 - mix) + wet * mix


def section_gain(points: list[tuple[float, float]]) -> np.ndarray:
    """Piecewise-linear gain curve over the whole timeline."""
    xs = np.array([p[0] for p in points], dtype=float)
    ys = np.array([p[1] for p in points], dtype=float)
    return np.interp(T, xs, ys)


# ---------------- composition ----------------
CHORDS = [
    # (bass midi, pad midi notes, arp midi notes)
    (45, [57, 60, 64, 67], [69, 72, 76, 79]),   # Am9
    (41, [53, 57, 60, 64], [65, 69, 72, 76]),   # Fmaj7
    (48, [55, 60, 64, 67], [67, 72, 76, 79]),   # Cmaj9
    (43, [55, 59, 62, 67], [67, 71, 74, 79]),   # G6
]


def compose() -> np.ndarray:
    # buses
    pad_bus = np.zeros((N, 2))
    arp_bus = np.zeros((N, 2))
    bell_bus = np.zeros((N, 2))
    bass_bus = np.zeros((N, 2))
    drum_bus = np.zeros((N, 2))
    fx_bus = np.zeros((N, 2))

    n_bars = int(math.ceil(DURATION / BAR))
    for bar in range(n_bars):
        t0 = bar * BAR
        bass_m, pad_notes, arp_notes = CHORDS[bar % len(CHORDS)]
        # --- pad: whole bar, slight overlap
        for i, m in enumerate(pad_notes):
            sig = pad_note(hz(m), BAR + 0.6, amp=0.115)
            pan = (-0.35, -0.12, 0.12, 0.35)[i % 4]
            add(pad_bus, t0, sig, 1.0, pan)
        # high octave pad layer during second half of the video
        for i, m in enumerate(pad_notes[::2]):
            sig = pad_note(hz(m + 12), BAR + 0.5, amp=0.045)
            add(pad_bus, t0, sig, 1.0, (-0.5, 0.5)[i % 2])

        # --- bass: root, eighth-note pulse
        for e in range(4):
            st = t0 + e * BEAT
            if st >= DURATION:
                continue
            g = bass_gain_at(st)
            if g <= 0.001:
                continue
            dur = BEAT * 0.9
            add(bass_bus, st, bass(hz(bass_m), dur, amp=0.30), g, 0.0)

        # --- arp: 8 eighth notes per bar
        for step in range(8):
            st = t0 + step * BEAT / 2
            if st >= DURATION:
                continue
            g = arp_gain_at(st)
            if g <= 0.001:
                continue
            m = arp_notes[step % len(arp_notes)] + (12 if step >= 4 else 0)
            sig = pluck(hz(m), 0.6, amp=0.16)
            pan = -0.45 if step % 2 == 0 else 0.45
            add(arp_bus, st, sig, g, pan)

        # --- drums
        for b in range(4):
            st = t0 + b * BEAT
            if st >= DURATION:
                continue
            g = drum_gain_at(st)
            if g <= 0.001:
                continue
            accent = 1.0 if b in (0, 2) else 0.75
            add(drum_bus, st, kick(amp=1.0), g * accent * 0.34, 0.0)
        for step in range(8):
            st = t0 + step * BEAT / 2 + BEAT / 4
            if st >= DURATION:
                continue
            g = hat_gain_at(st)
            if g <= 0.001:
                continue
            add(drum_bus, st, shaker(amp=1.0), g * 0.075, 0.25 if step % 2 else -0.25)

    # --- bells (intro & outro melody)
    bell_notes = [
        (1.2, 72, 0.16), (2.6, 76, 0.13), (4.2, 79, 0.11), (6.0, 76, 0.10),
        (41.6, 72, 0.16), (43.0, 76, 0.14), (44.6, 79, 0.12), (46.2, 84, 0.10),
        (48.0, 79, 0.09), (49.6, 76, 0.08), (51.2, 72, 0.07),
    ]
    for st, m, amp in bell_notes:
        add(bell_bus, st, bell(hz(m), amp=amp * 1.6), 1.0, (-0.3 if m % 2 else 0.3))

    # --- transitions
    add(fx_bus, 5.5, riser(1.5, amp=0.20), 1.0, -0.2)
    add(fx_bus, 38.6, riser(1.5, amp=0.18), 1.0, 0.2)
    add(fx_bus, 40.2, kick(amp=1.0), 0.30, 0.0)

    # --- bus automation
    pad_env = section_gain([(0, 0.0), (1.2, 1.0), (7.0, 1.0), (40.2, 1.0), (41.6, 0.75), (52.0, 0.55), (55.0, 0.0)])
    arp_env = section_gain([(0, 0.0), (9.0, 0.0), (10.2, 1.0), (39.4, 1.0), (40.2, 0.0), (55.0, 0.0)])
    drum_env = section_gain([(0, 0.0), (7.0, 0.0), (8.2, 1.0), (39.2, 1.0), (40.1, 0.0), (55.0, 0.0)])
    hat_env = section_gain([(0, 0.0), (13.0, 0.0), (14.4, 1.0), (39.2, 0.9), (40.1, 0.0), (55.0, 0.0)])
    bell_env = section_gain([(0, 1.0), (7.0, 0.5), (40.2, 0.0), (41.4, 1.0), (55.0, 0.0)])
    bass_env = section_gain([(0, 0.0), (9.0, 0.0), (10.0, 1.0), (39.4, 1.0), (40.2, 0.0), (55.0, 0.0)])

    pad_bus *= pad_env[:, None]
    arp_bus *= arp_env[:, None]
    drum_bus *= drum_env[:, None]
    bass_bus *= bass_env[:, None]
    bell_bus *= bell_env[:, None]

    # hats already gated per-hit via hat_gain_at, but apply gentle master
    mix = pad_bus + arp_bus + bell_bus + bass_bus + drum_bus + fx_bus
    # separate reverb bus: arp + bell + pad tail
    wet_send = arp_bus * 0.5 + bell_bus * 0.7 + pad_bus * 0.35
    wet = reverb(wet_send, decay=1.8, mix=1.0)
    mix = mix + wet * 0.45

    # gentle master EQ-ish tilt: add a little air
    mix = mix + 0.02 * np.diff(mix, axis=0, prepend=mix[:1])

    # final fade in/out
    fade = np.ones(N)
    fi = int(0.8 * SR)
    fade[:fi] = np.linspace(0, 1, fi) ** 1.5
    fo = int(2.2 * SR)
    fade[-fo:] = np.linspace(1, 0, fo) ** 1.6
    mix *= fade[:, None]

    # normalize to -1.5 dBFS peak with soft limiter
    peak = np.max(np.abs(mix))
    mix = mix / (peak + 1e-9) * 0.84
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    peak = np.max(np.abs(mix))
    mix = mix / (peak + 1e-9) * 0.84
    return mix


def arp_gain_at(t: float) -> float:
    if t < 9.0 or t > 40.2:
        return 0.0
    if t < 10.2:
        return (t - 9.0) / 1.2
    if t < 39.4:
        return 1.0
    return max(0.0, 1 - (t - 39.4) / 0.8)


def drum_gain_at(t: float) -> float:
    if t < 7.0 or t > 40.1:
        return 0.0
    if t < 8.2:
        return (t - 7.0) / 1.2
    if t < 39.2:
        return 1.0
    return max(0.0, 1 - (t - 39.2) / 0.9)


def hat_gain_at(t: float) -> float:
    if t < 13.0 or t > 40.1:
        return 0.0
    if t < 14.4:
        return (t - 13.0) / 1.4
    if t < 39.2:
        return 1.0
    return max(0.0, 1 - (t - 39.2) / 0.9)


def bass_gain_at(t: float) -> float:
    if t < 9.0 or t > 40.2:
        return 0.0
    if t < 10.0:
        return (t - 9.0) / 1.0
    if t < 39.4:
        return 1.0
    return max(0.0, 1 - (t - 39.4) / 0.8)


def write_wav(path: str, stereo: np.ndarray):
    data = np.clip(stereo, -1.0, 1.0)
    pcm = (data * 32767).astype(np.int16)
    with wave.open(path, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/Users/ypz/Downloads/better-skill-demo-bgm.wav")
    args = ap.parse_args()
    print("composing…", flush=True)
    mix = compose()
    write_wav(args.out, mix)
    peak = float(np.max(np.abs(mix)))
    rms = float(np.sqrt(np.mean(mix ** 2)))
    print(f"done: {args.out}")
    print(f"duration={len(mix)/SR:.2f}s peak={20*math.log10(peak+1e-12):.2f} dBFS rms={20*math.log10(rms+1e-12):.2f} dBFS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
