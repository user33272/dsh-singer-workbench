"""按音高曲线修音准（WORLD 声码器）。

原理：WORLD 把声音拆成 f0 / 频谱包络 / 非周期成分，只改 f0 再合成，
所以音色和共振峰不变，只是把偏掉的音拉回目标音高。

用法：
    tune.cmd <人声.wav> [-o 输出.wav] [-s 0.6] [-m scale|semitone] [-k "G# major"]

参数：
    -s / --strength  修多少，0=不动，1=完全拉准（默认 0.6，留点自然抖动）
    -m / --mode      scale=只吸到调内音（默认，听感最自然）；semitone=吸到十二平均律
    -k / --key       调性，如 "G# major"；给 scale 模式用，缺省则按 semitone
"""
import argparse
import os
import sys

import numpy as np
import soundfile as sf

import projectlib as pl

ROOT = pl.ROOT

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]


def key_to_pcs(key):
    """'G# major' / 'F minor' -> 允许的音级集合"""
    if not key:
        return None
    parts = str(key).split()
    if not parts:
        return None
    note = parts[0].upper()
    if note not in NOTE_NAMES:
        return None
    root = NOTE_NAMES.index(note)
    steps = MINOR_STEPS if len(parts) > 1 and parts[1].lower().startswith("min") else MAJOR_STEPS
    return {(root + s) % 12 for s in steps}


def nearest_allowed_midi(midi, pcs):
    """把每个半音位置吸到最近的调内音（可能上下 1 个半音以内）。"""
    if pcs is None:
        return np.round(midi)
    out = np.round(midi).copy()
    for i, m in enumerate(midi):
        base = int(round(m))
        if base % 12 in pcs:
            out[i] = base
            continue
        best = None
        for delta in (-2, -1, 1, 2):
            cand = base + delta
            if cand % 12 in pcs:
                if best is None or abs(m - cand) < abs(m - best):
                    best = cand
        out[i] = best if best is not None else base
    return out


def tune_file(src, dst, strength=0.6, mode="scale", key=None, frame_period=5.0):
    import pyworld as pw

    x, sr = sf.read(src, dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    strength = float(min(1.0, max(0.0, strength)))
    if strength <= 0.001:
        sf.write(dst, x, sr, subtype="PCM_16")
        return {"sr": sr, "strength": 0.0, "changed_frames": 0, "median_cents": 0.0}

    f0, t = pw.harvest(x, sr, f0_floor=60.0, f0_ceil=1100.0, frame_period=frame_period)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)

    voiced = f0 > 0
    midi = 69.0 + 12.0 * np.log2(np.maximum(f0, 1e-9) / 440.0)
    pcs = key_to_pcs(key) if mode == "scale" else None
    target_midi = nearest_allowed_midi(midi, pcs)
    target_f0 = 440.0 * np.power(2.0, (target_midi - 69.0) / 12.0)

    # strength 越小越保留原来的偏差
    new_f0 = np.where(
        voiced,
        np.exp((1.0 - strength) * np.log(np.maximum(f0, 1e-9)) + strength * np.log(target_f0)),
        0.0,
    )
    y = pw.synthesize(new_f0, sp, ap, sr)
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0.99:
        y = y * (0.99 / peak)
    sf.write(dst, y.astype(np.float32), sr, subtype="PCM_16")

    cents = np.abs(1200.0 * np.log2(np.maximum(new_f0, 1e-9) / np.maximum(f0, 1e-9)))[voiced]
    return {
        "sr": sr,
        "strength": strength,
        "mode": mode,
        "key": key,
        "changed_frames": int(voiced.sum()),
        "median_cents": float(np.median(cents)) if cents.size else 0.0,
        "max_cents": float(np.max(cents)) if cents.size else 0.0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("-s", "--strength", type=float, default=0.6)
    ap.add_argument("-m", "--mode", choices=["scale", "semitone"], default="scale")
    ap.add_argument("-k", "--key", default=None)
    a = ap.parse_args()

    src = os.path.abspath(a.input)
    if not os.path.isfile(src):
        sys.exit(f"找不到文件: {src}")
    out = os.path.abspath(a.out) if a.out else os.path.splitext(src)[0] + "_tuned.wav"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    info = tune_file(src, out, strength=a.strength, mode=a.mode, key=a.key)
    print(
        "修音准 -> %s (强度 %.2f, %s, 中位修正 %.0f 音分, 最大 %.0f 音分)"
        % (out, info["strength"], info.get("mode", "semitone"), info["median_cents"], info["max_cents"])
    )


if __name__ == "__main__":
    main()
