"""从任意音频里剪一段参考人声：单声道 44.1k，响度统一到 -18 LUFS。

用法：
    makeref.cmd <音频> <起点秒> <时长秒> [-o 输出.wav]
    makeref.cmd <音频> --auto [-d 20] [-o 输出.wav]     # 自动挑最响的一段

例：
    makeref.cmd source\\朧月.mp3 95 20 -o source\\ref_20s.wav
    makeref.cmd projects\\朧月\\audio\\vocals.wav --auto -o projects\\朧月\\work\\ref.wav
"""
import argparse
import os
import subprocess
import sys

import projectlib as pl

ROOT = pl.ROOT
FFMPEG = pl.FFMPEG


def loudest_start(src, duration):
    """按 2 秒步长扫一遍，找响度最高的那一段。"""
    try:
        import numpy as np
        import soundfile as sf
    except ImportError:
        return 0.0
    y, sr = sf.read(src, always_2d=True)
    mono = y.mean(axis=1)
    win = int(sr * duration)
    step = int(sr * 2)
    if len(mono) <= win:
        return 0.0
    best, best_at = -1.0, 0
    for start in range(0, len(mono) - win, step):
        rms = float(np.sqrt(np.mean(mono[start:start + win] ** 2)))
        if rms > best:
            best, best_at = rms, start
    return round(best_at / sr, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("start", nargs="?", type=float, default=None)
    ap.add_argument("duration", nargs="?", type=float, default=None)
    ap.add_argument("-d", "--duration-seconds", type=float, default=20)
    ap.add_argument("--auto", action="store_true", help="自动选最响的一段")
    ap.add_argument("-o", "--out", default=None)
    a = ap.parse_args()

    src = os.path.abspath(a.audio)
    if not os.path.isfile(src):
        sys.exit(f"找不到文件: {src}")

    duration = a.duration if a.duration is not None else a.duration_seconds
    if not 5 <= duration <= 40:
        sys.exit("参考时长建议 10-30 秒（这里允许 5-40）")

    start = a.start
    if a.auto or start is None:
        start = loudest_start(src, duration)

    out = os.path.abspath(a.out) if a.out else os.path.join(
        os.path.dirname(src), f"ref_{int(start)}s_{int(duration)}s.wav")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    cmd = [
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(start), "-t", str(duration), "-i", src,
        "-ac", "1", "-ar", "44100",
        "-af", "loudnorm=I=-18:TP=-2:LRA=9",
        "-c:a", "pcm_s16le", out,
    ]
    subprocess.run(cmd, check=True)
    size = os.path.getsize(out) / 1024 / 1024
    print(f"参考人声: {out}  ({size:.1f} MB, 从 {start:g}s 起 {duration:g}s)")


if __name__ == "__main__":
    main()
