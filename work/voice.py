"""用 Seed-VC 把一段人声换成另一段参考人声的音色。

用法：
    voice.cmd <源人声.wav> <参考.wav> [-o 输出目录] [-s 扩散步数] [-p 半音偏移] [--online]

例：
    voice.cmd projects\\朧月\\audio\\vocals.wav D:\\singer\\source\\ref.wav -o projects\\朧月\\work
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import projectlib as pl

ROOT = pl.ROOT
SEEDVC = pl.SEEDVC
PY = pl.VENV_VC_PY


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("target", help="参考音色，10-30 秒干净人声")
    ap.add_argument("-o", "--out", default=None, help="默认写到 projects\\<项目>\\work")
    ap.add_argument("--project", default=None, help="项目名，默认从源人声路径推断")
    ap.add_argument("-s", "--steps", type=int, default=30, help="扩散步数，30 起步，50 更细但更慢")
    ap.add_argument("-p", "--semitones", type=int, default=0, help="音高偏移（半音），男声唱女调时常用 -8 ~ -12")
    ap.add_argument("--tune", action="store_true", help="换音色前先按音高曲线修音准")
    ap.add_argument("--tune-strength", type=float, default=0.6, help="修音准强度 0-1，默认 0.6")
    ap.add_argument("--tune-mode", choices=["scale", "semitone"], default="scale", help="吸到调内音还是十二平均律")
    ap.add_argument("--tune-key", default=None, help='调性，如 "G# major"；scale 模式用')
    ap.add_argument("--online", action="store_true", help="允许联网（首次下载模型时需要）")
    a = ap.parse_args()

    src = os.path.abspath(a.source)
    ref = os.path.abspath(a.target)
    for path in (src, ref):
        if not os.path.isfile(path):
            sys.exit(f"找不到文件: {path}")
    pid = pl.resolve(src, a.project)
    proj = pl.ensure(pid, title=pid)
    out = os.path.abspath(a.out) if a.out else proj["work"]
    os.makedirs(out, exist_ok=True)

    source_for_svc = src
    if a.tune:
        import tune as tunemod

        tuned = os.path.join(out, "tuned_vocals.wav")
        info = tunemod.tune_file(
            src, tuned, strength=a.tune_strength, mode=a.tune_mode, key=a.tune_key
        )
        print(
            "修音准: 强度 %.2f %s 中位修正 %.0f 音分"
            % (info["strength"], info.get("mode", "semitone"), info["median_cents"])
        )
        source_for_svc = tuned

    env = dict(os.environ)
    env["HF_HOME"] = os.path.join(SEEDVC, "checkpoints", "hf_home")
    env["HF_HUB_CACHE"] = os.path.join(SEEDVC, "checkpoints", "hf_cache")
    env["HF_ENDPOINT"] = env.get("HF_ENDPOINT", "https://hf-mirror.com")
    env["PYTHONIOENCODING"] = "utf-8"
    if not a.online:
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"

    cmd = [
        PY,
        os.path.join(SEEDVC, "run_svc.py"),
        "--source", source_for_svc,
        "--target", ref,
        "--output", out,
        "--diffusion-steps", str(a.steps),
        "--f0-condition", "True",
        "--fp16", "True",
    ]
    if a.semitones:
        cmd += ["--semi-tone-shift", str(a.semitones)]
    print("命令:", " ".join(cmd))
    code = subprocess.run(cmd, env=env).returncode
    if code != 0:
        sys.exit(code)
    pl.mark_step(pid, "voice", f"steps {a.steps}, ref {os.path.basename(ref)}, shift {a.semitones:+g}")
    print("完成，项目:", pid, "输出目录:", out)


if __name__ == "__main__":
    main()
