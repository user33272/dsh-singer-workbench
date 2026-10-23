"""把 out/ 里混在一起的产物按项目整理到 projects/ 下。跑一次即可，重复跑是安全的。"""
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import projectlib as pl

ROOT = pl.ROOT
OUT = os.path.join(ROOT, "out")
ARCHIVE = os.path.join(ROOT, "archive", "old-out-20261023")
STATE = os.path.join(ROOT, "state")
FFMPEG = os.path.join(ROOT, "work", "bin", "ffmpeg.exe")

moved = []
skipped = []


def take(src, dst):
    """移动文件到目标；目标已存在就跳过。"""
    if not os.path.exists(src):
        skipped.append(f"{src} (不存在)")
        return
    if os.path.exists(dst):
        skipped.append(f"{dst} (已存在)")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    moved.append((src, dst))


def move_dir(src, dst):
    if not os.path.isdir(src):
        skipped.append(f"{src} (不存在)")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    moved.append((src, dst))


def main():
    # ---------- 项目 1：朧月 ----------
    p = pl.ensure("朧月", title="朧月", source=os.path.join(ROOT, "source", "朧月.mp3"))
    take(os.path.join(ROOT, "work", "audio", "source.wav"), os.path.join(p["audio"], "source.wav"))
    take(os.path.join(OUT, "aurora", "source_(vocals)_vocals_mel_band_roformer.wav"), os.path.join(p["audio"], "vocals.wav"))
    take(os.path.join(OUT, "aurora", "source_(other)_vocals_mel_band_roformer.wav"), os.path.join(p["audio"], "instrumental.wav"))
    take(os.path.join(OUT, "aurora", "vocals.mp3"), os.path.join(p["audio"], "vocals.mp3"))
    take(os.path.join(OUT, "aurora", "instrumental.mp3"), os.path.join(p["audio"], "instrumental.mp3"))

    for name in ("f0.csv", "pitch_curve.png", "pitch_report.json", "instrumental_shift-8.wav", "zoom_20_32s.png"):
        take(os.path.join(OUT, "pitch_aurora", name), os.path.join(p["analysis"], name))

    take(os.path.join(OUT, "cover", "cover.wav"), os.path.join(p["work"], "cover.wav"))
    take(os.path.join(OUT, "cover", "cover.mp3"), os.path.join(p["work"], "cover.mp3"))
    take(os.path.join(OUT, "cover", "vc_source_vocals_ref_target_1.0_30_0.7.wav"),
         os.path.join(p["work"], "vc_source_vocals_ref_target_1.0_30_0.7.wav"))
    take(os.path.join(OUT, "cover", "vc_vocals_朧月_1.0_30_0.7.wav"),
         os.path.join(p["work"], "vc_vocals_朧月_1.0_30_0.7.wav"))
    take(os.path.join(ROOT, "work", "audio", "ref_target.wav"), os.path.join(p["work"], "ref.wav"))

    move_dir(os.path.join(OUT, "kara_old"), os.path.join(p["baselines"], "mdx_kara2"))
    move_dir(os.path.join(OUT, "compare"), os.path.join(p["baselines"], "ab_30s"))

    pl.mark_step("朧月", "separate", "Mel-Band RoFormer")
    pl.mark_step("朧月", "pitch", "auto -8 半音 -> C major")
    pl.mark_step("朧月", "voice", "Seed-VC 30 步，参考=原曲人声")
    pl.mark_step("朧月", "mix", "-13.3 LUFS")

    # ---------- 项目 2：誰かの心臓になれたなら ----------
    second_src = os.path.join(ROOT, "source", "初音未来,モシ - 誰かの心臓になれたなら【カバー】.mp3")
    second_out = os.path.join(OUT, "初音未来,モシ - 誰かの心臓になれたなら【カバー】")
    if os.path.isdir(second_out):
        q = pl.ensure("誰かの心臓になれたなら", title="誰かの心臓になれたなら（カバー）",
                      source=second_src if os.path.isfile(second_src) else None)
        for name in ("vocals.wav", "instrumental.wav", "vocals.mp3", "instrumental.mp3"):
            take(os.path.join(second_out, name), os.path.join(q["audio"], name))
        src_wav = os.path.join(q["audio"], "source.wav")
        if os.path.isfile(second_src) and not os.path.exists(src_wav):
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", second_src,
                            "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", src_wav], check=True)
        pl.mark_step("誰かの心臓になれたなら", "separate", "Mel-Band RoFormer")

    # ---------- 插件状态 ----------
    hist_src = os.path.join(OUT, "workbench", "history.json")
    if os.path.isfile(hist_src):
        take(hist_src, os.path.join(STATE, "history.json"))

    # ---------- 其余旧目录归档 ----------
    for name in os.listdir(OUT):
        path = os.path.join(OUT, name)
        if not os.path.isdir(path):
            continue
        if not os.listdir(path):
            os.rmdir(path)
            skipped.append(f"{path} (空目录，已删)")
            continue
        move_dir(path, os.path.join(ARCHIVE, name))

    print(f"移动 {len(moved)} 项：")
    for s, d in moved:
        print(f"  {os.path.relpath(s, ROOT)}  ->  {os.path.relpath(d, ROOT)}")
    if skipped:
        print(f"\n跳过 {len(skipped)} 项：")
        for s in skipped:
            print("  " + s)
    print("\n项目清单：")
    for proj in pl.list_projects():
        counts = {k: len(v) for k, v in proj["files"].items()}
        print(f"  {proj['id']}: {counts}")


if __name__ == "__main__":
    main()
