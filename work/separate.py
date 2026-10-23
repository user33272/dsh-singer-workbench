"""一键分离：给一个音频文件，输出 vocals/instrumental 的 wav + mp3。

用法：
    separate.cmd "D:\\singer\\source\\朧月.mp3"
    separate.cmd input.mp3 -o D:\\singer\\out\\mydir -m mel_band_roformer_kim_ft3_unwa.ckpt
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys

import projectlib as pl

ROOT = pl.ROOT
FFMPEG = pl.FFMPEG
SEP = os.path.join(ROOT, "work", "sep.py")
DEFAULT_MODEL = "vocals_mel_band_roformer.ckpt"


def run(cmd):
    subprocess.run(cmd, check=True)


def put(src, dst, park_dir):
    """把新生成的分轨放到目标名。

    Windows 沙箱的 ACL 禁止「覆盖式改名」，所以目标已存在时退化成
    「读出来写进去」，旧文件挪去 park_dir 留底。
    """
    try:
        os.replace(src, dst)
        return
    except PermissionError:
        with open(src, "rb") as fin, open(dst, "wb") as fout:
            shutil.copyfileobj(fin, fout)
    os.makedirs(park_dir, exist_ok=True)
    try:
        os.replace(src, os.path.join(park_dir, os.path.basename(src)))
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--out", default=None, help="默认写到 projects\\<项目>\\audio")
    ap.add_argument("-p", "--project", default=None, help="项目名，默认从输入文件名推断")
    ap.add_argument("-m", "--model", default=DEFAULT_MODEL)
    a = ap.parse_args()

    src = os.path.abspath(a.input)
    if not os.path.isfile(src):
        sys.exit(f"找不到输入文件: {src}")
    pid = a.project or pl.find_by_source(src) or pl.resolve(src)
    pid = pl.sanitize(pid)
    p = pl.ensure(pid, title=pid, source=src)
    out = os.path.abspath(a.out) if a.out else p["audio"]
    os.makedirs(out, exist_ok=True)

    wav = os.path.join(out, "source.wav")
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", wav])

    env = dict(os.environ)
    env["PATH"] = os.path.join(ROOT, "work", "bin") + os.pathsep + env.get("PATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    r = subprocess.run([sys.executable, SEP, a.model, wav, out], env=env)
    if r.returncode != 0:
        sys.exit("分离失败，看 work\\sep.log")

    wavs = [p for p in glob.glob(os.path.join(out, "*.wav"))
            if os.path.basename(p) != "source.wav"]
    voc = [p for p in wavs if "(vocals)" in os.path.basename(p)]
    inst = [p for p in wavs if "(other)" in os.path.basename(p) or "(instrumental)" in os.path.basename(p)]
    if not voc:
        sys.exit("没找到人声输出")
    park = os.path.join(p["work"], "_stems")
    put(voc[0], os.path.join(out, "vocals.wav"), park)
    if inst:
        put(inst[0], os.path.join(out, "instrumental.wav"), park)
        run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i",
             os.path.join(out, "instrumental.wav"), "-c:a", "libmp3lame", "-b:a", "320k",
             os.path.join(out, "instrumental.mp3")])
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i",
         os.path.join(out, "vocals.wav"), "-c:a", "libmp3lame", "-b:a", "320k",
         os.path.join(out, "vocals.mp3")])
    pl.mark_step(pid, "separate", a.model)

    print("=" * 50)
    print("项目:", pid, "->", out)
    print("模型:", a.model)
    for f in sorted(os.listdir(out)):
        if f.endswith((".wav", ".mp3")):
            size = os.path.getsize(os.path.join(out, f)) / 1024 / 1024
            print(f"  {f:<20} {size:6.1f} MB")


if __name__ == "__main__":
    main()
