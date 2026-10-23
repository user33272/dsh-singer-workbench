"""音高曲线 + 调性分析 + 变调（通用）

用法：
    pitch.cmd vocals.wav
    pitch.cmd vocals.wav -i instrumental.wav -k 2
    pitch.cmd vocals.wav -i instrumental.wav -k auto --target-range C3:C5
    pitch.cmd vocals.wav --shift-vocals -k -2     # 人声也一起变调

输出（默认写到 -o 目录，缺省是输入文件同目录）：
    f0.csv                  时间 / 频率 / MIDI / 平滑 MIDI / 置信度
    pitch_curve.png         音高曲线图
    pitch_report.json       中位音高、音域、调性、建议变调量
    instrumental_shift±N.wav 变调伴奏（ffmpeg rubberband，保时长保共鸣）
    vocals_shift±N.wav      变调人声（加 --shift-vocals 时才有）
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import librosa
import torch
import torchcrepe

import projectlib as pl

ROOT = pl.ROOT
FFMPEG = pl.FFMPEG

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def hz_to_midi(h):
    return 12 * np.log2(np.maximum(np.asarray(h, dtype=np.float64), 1e-6) / 440.0) + 69


def midi_name(m):
    m = int(round(m))
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def parse_note(s):
    """'C3' / 'C#3' / 'A#4' -> MIDI 号"""
    import re
    m = re.fullmatch(r"([A-G]#?)(-?\d+)", s.strip().upper())
    if not m:
        raise ValueError(f"音名格式不对: {s}（示例 C3 / A#4）")
    return 12 * (int(m.group(2)) + 1) + NOTE_NAMES.index(m.group(1))


def smooth_midi(midi, hop_s, max_gap_s=0.12, win_s=0.06):
    """补短缺口 + 中值滤波，只用于显示和统计，原始数据保留在 f0.csv"""
    m = midi.copy()
    n = len(m)
    ok = ~np.isnan(m)
    if ok.sum() < 3:
        return m
    # 线性插值填补短缺口
    idx = np.arange(n)
    filled = np.interp(idx, idx[ok], m[ok])
    gaps = np.diff(idx[ok])
    limit = int(max_gap_s / hop_s)
    out = filled.copy()
    prev = idx[ok][0]
    for cur in idx[ok][1:]:
        if cur - prev > limit:
            out[prev + 1:cur] = np.nan
        prev = cur
    # 中值滤波
    k = max(3, int(win_s / hop_s) | 1)
    idx2 = np.arange(n)
    valid = ~np.isnan(out)
    out_f = np.interp(idx2, idx2[valid], out[valid])
    pad = k // 2
    padded = np.pad(out_f, pad, mode="edge")
    sm = np.median(np.lib.stride_tricks.sliding_window_view(padded, k), axis=1)
    sm[~valid] = np.nan
    return sm


def detect_key(y, sr):
    yh = librosa.effects.harmonic(y)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=512).mean(axis=1)
    best_maj = best_min = (-1.0, 0)
    for i in range(12):
        for prof, kind in ((MAJOR, "maj"), (MINOR, "min")):
            score = float(np.corrcoef(chroma, np.roll(prof, i))[0, 1])
            if kind == "maj" and score > best_maj[0]:
                best_maj = (score, i)
            if kind == "min" and score > best_min[0]:
                best_min = (score, i)
    return best_maj, best_min


def plot_curve(t, midi, out_png, key_label=""):
    from PIL import Image, ImageDraw
    W, pad = 1400, 46
    top_h, bot_h, gap = 300, 300, 34
    H = top_h + bot_h + gap
    img = Image.new("RGB", (W, H), (18, 18, 22))
    d = ImageDraw.Draw(img)

    def panel(y0, h, t_lo, t_hi, title):
        lo, hi = np.floor(np.nanmin(midi)) - 1, np.ceil(np.nanmax(midi)) + 1
        d.rectangle([pad, y0, W - pad, y0 + h], outline=(60, 60, 70))
        d.text((pad + 6, y0 + 4), title, fill=(200, 200, 210))
        ypx = lambda m: y0 + h - (m - lo) / (hi - lo) * (h - 2)
        for m in np.arange(lo, hi + 1):
            y = ypx(m)
            d.line([pad, y, W - pad, y], fill=(38, 38, 46))
            if int(m) % 12 == 0:
                d.text((6, y - 5), midi_name(m), fill=(140, 140, 150))
        x = (pad + (t - t_lo) / (t_hi - t_lo) * (W - 2 * pad)).astype(int)
        ok = ~np.isnan(midi)
        for col in range(pad, W - pad):
            sel = (x == col) & ok
            vals = midi[sel]
            if vals.size == 0:
                continue
            d.line([col, ypx(vals.min()), col, ypx(vals.max())], fill=(90, 200, 255), width=1)

    span = t[-1]
    # 找有声音帧最密的一段 15 秒做放大图
    z = 15.0
    best_s, best_c = 0.0, -1
    for s in np.arange(0, max(0.1, span - z), 2.0):
        m = (~np.isnan(midi)) & (t >= s) & (t < s + z)
        c = int(m.sum())
        if c > best_c:
            best_c, best_s = c, float(s)
    panel(pad, top_h, 0, span, f"{key_label}  |  full")
    panel(pad + top_h + gap, bot_h, best_s, min(span, best_s + z), f"zoom {best_s:.0f}-{min(span, best_s + z):.0f}s")
    img.save(out_png)
    if key_label:
        d.text((pad + 6, 6), key_label, fill=(200, 200, 210))
    img.save(out_png)


def shift_audio(src, dst, semitones):
    ratio = 2 ** (semitones / 12)   # rubberband 的 pitch 是倍率，不是半音数
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                    "-af", f"rubberband=pitch={ratio:.6f}:formant=preserved:tempo=1",
                    "-c:a", "pcm_s16le", dst], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vocals")
    ap.add_argument("-i", "--instrumental", default=None, help="伴奏（用于调性分析和变调输出）")
    ap.add_argument("-k", "--semitones", default="0", help="变调半音数，或 auto")
    ap.add_argument("--target-range", default="C3:C5", help="auto 时的目标音域，如 C3:E5")
    ap.add_argument("--shift-vocals", action="store_true", help="人声也一起变调")
    ap.add_argument("-o", "--out", default=None, help="默认写到 projects\\<项目>\\analysis")
    ap.add_argument("-p", "--project", default=None, help="项目名，默认从人声路径推断")
    ap.add_argument("--fmin", type=float, default=50)
    ap.add_argument("--fmax", type=float, default=1100)
    a = ap.parse_args()

    src = os.path.abspath(a.vocals)
    if not os.path.isfile(src):
        sys.exit(f"找不到文件: {src}")
    pid = pl.resolve(src, a.project)
    proj = pl.ensure(pid, title=pid)
    out = os.path.abspath(a.out) if a.out else proj["analysis"]
    os.makedirs(out, exist_ok=True)

    hop_s = 0.01
    y, sr = librosa.load(src, sr=16000, mono=True)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    audio = torch.tensor(y, device=dev).unsqueeze(0)
    f0, conf = torchcrepe.predict(
        audio, sr, hop_length=160, fmin=a.fmin, fmax=a.fmax,
        model="full", batch_size=1024, device=dev, return_periodicity=True,
    )
    f0 = f0[0].cpu().numpy()
    conf = conf[0].cpu().numpy()
    midi = hz_to_midi(f0)
    midi = np.where((f0 < a.fmin) | (f0 > a.fmax) | (conf < 0.3), np.nan, midi)
    t = np.arange(len(f0)) * hop_s
    ms = smooth_midi(midi, hop_s)

    voiced = ms[~np.isnan(ms)]
    if len(voiced) < 10:
        sys.exit("没有检测到有效人声音高")

    p2, p50, p98 = np.percentile(voiced, [2, 50, 98])
    key_src = os.path.abspath(a.instrumental) if a.instrumental else src
    yk, srk = librosa.load(key_src, sr=22050, mono=True)
    (maj_score, maj_i), (min_score, min_i) = detect_key(yk, srk)
    if maj_score >= min_score:
        key, key_score = f"{NOTE_NAMES[maj_i]} major", maj_score
        key_note, relative = NOTE_NAMES[maj_i], f"{NOTE_NAMES[(maj_i + 9) % 12]} minor"
    else:
        key, key_score = f"{NOTE_NAMES[min_i]} minor", min_score
        key_note, relative = NOTE_NAMES[min_i], f"{NOTE_NAMES[(min_i + 3) % 12]} major"

    target_lo, target_hi = (parse_note(s) for s in a.target_range.split(":"))
    if p98 - p2 <= target_hi - target_lo:
        auto_shift = int(round((target_lo + target_hi) / 2 - (p2 + p98) / 2))
    else:
        auto_shift = int(round(target_hi - p98))
    shift = auto_shift if a.semitones == "auto" else float(a.semitones)

    report = {
        "file": src,
        "duration_s": round(float(len(y) / sr), 2),
        "voiced_ratio": round(float(len(voiced) / len(ms)), 3),
        "median_pitch": midi_name(p50),
        "median_freq_hz": round(float(2 ** ((p50 - 69) / 12) * 440), 1),
        "range_p2_p98": [midi_name(p2), midi_name(p98)],
        "range_semitones": round(float(p98 - p2), 1),
        "key": key,
        "key_score": round(key_score, 3),
        "relative_key": relative,
        "target_range": a.target_range,
        "auto_shift_semitones": auto_shift,
        "applied_shift_semitones": shift,
        "key_after_shift": f"{NOTE_NAMES[(NOTE_NAMES.index(key_note) + int(round(shift))) % 12]} {'major' if key.endswith('major') else 'minor'}",
    }

    with open(os.path.join(out, "f0.csv"), "w", encoding="utf-8") as f:
        f.write("time_s,freq_hz,midi,midi_smooth,confidence\n")
        for i in range(len(t)):
            m = "" if np.isnan(midi[i]) else f"{midi[i]:.2f}"
            s = "" if np.isnan(ms[i]) else f"{ms[i]:.2f}"
            f.write(f"{t[i]:.3f},{f0[i]:.2f},{m},{s},{conf[i]:.3f}")
            f.write("\n")
    plot_curve(t, ms, os.path.join(out, "pitch_curve.png"),
               key_label=f"{key} (≈{relative})  |  median {midi_name(p50)}  |  {midi_name(p2)}-{midi_name(p98)}  |  shift {shift:+g}")
    with open(os.path.join(out, "pitch_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    pl.mark_step(pid, "pitch", f"{key} / {midi_name(p50)} / shift {shift:+g}")

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if shift:
        if a.instrumental:
            dst = os.path.join(out, f"instrumental_shift{shift:+g}.wav")
            shift_audio(os.path.abspath(a.instrumental), dst, shift)
            print("变调伴奏:", dst)
        if a.shift_vocals:
            dst = os.path.join(out, f"vocals_shift{shift:+g}.wav")
            shift_audio(src, dst, shift)
            print("变调人声:", dst)


if __name__ == "__main__":
    main()
