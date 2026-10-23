"""把人声和伴奏合成立体声成品。

用法：
    mix.cmd vocals.wav instrumental.wav [-o out.wav] [--vocal-db 0] [--loudness -14]
"""
import argparse
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

import projectlib as pl

FFMPEG = pl.FFMPEG


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vocals")
    ap.add_argument("instrumental")
    ap.add_argument("-o", "--out", default=None, help="默认写到 projects\\<项目>\\work\\cover.wav")
    ap.add_argument("--project", default=None, help="项目名，默认从伴奏路径推断")
    ap.add_argument("--vocal-db", type=float, default=0.0, help="人声相对伴奏的增益")
    ap.add_argument("--peak", type=float, default=0.89, help="最终峰值（0.89 ≈ -1 dBFS）")
    ap.add_argument("--allow-mismatch", action="store_true", help="人声与伴奏时长差很多时也强行合成")
    a = ap.parse_args()

    v, sr = sf.read(a.vocals, always_2d=True)
    i, sr2 = sf.read(a.instrumental, always_2d=True)
    if sr != sr2:
        sys.exit(f"采样率不一致: {sr} vs {sr2}")
    dv, di = len(v) / sr, len(i) / sr2
    if abs(dv - di) > 2.0 and not a.allow_mismatch:
        sys.exit(
            f"人声 {dv:.1f}s 与伴奏 {di:.1f}s 时长差 {abs(dv - di):.1f}s，可能拿错了人声文件"
            f"（确认后加 --allow-mismatch 强制合成）"
        )
    n = min(len(v), len(i))
    v, i = v[:n], i[:n]
    if v.shape[1] == 1:
        v = np.repeat(v, i.shape[1] if i.shape[1] > 1 else 2, axis=1)
    if i.shape[1] == 1:
        i = np.repeat(i, v.shape[1], axis=1)
    v = v * (10 ** (a.vocal_db / 20))
    mix = v[:n, :v.shape[1]] + i[:, :v.shape[1]]
    peak = float(np.abs(mix).max())
    if peak > a.peak:
        mix *= a.peak / peak
    out = a.out
    if not out:
        pid = pl.resolve(a.instrumental, a.project)
        proj = pl.ensure(pid, title=pid)
        out = os.path.join(proj["work"], "cover.wav")
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sf.write(out, mix.astype(np.float32), sr, subtype="PCM_16")
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", out,
                    "-af", "loudnorm=I=-14:TP=-1.0:LRA=11",
                    "-c:a", "libmp3lame", "-b:a", "320k", os.path.splitext(out)[0] + ".mp3"], check=True)
    pl.mark_step(pl.resolve(a.instrumental, a.project), "mix", os.path.basename(out))
    print("mix ->", out)
    print("mp3 ->", os.path.splitext(out)[0] + ".mp3")


if __name__ == "__main__":
    main()
