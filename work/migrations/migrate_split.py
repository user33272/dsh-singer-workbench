"""把 projects\\ 下的项目拆到 cover\\（翻唱）与 gen\\（生成）。跑一次即可，可重复执行。"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import projectlib as pl

COVER_KEYS = ["audio", "analysis", "work", "baselines", "project.json"]
GEN_KEYS = ["song-sheet.md", "midi", "renders", "tools", "products.json"]


def move(name, base, target_dir, keys, moved):
    if not any(os.path.exists(os.path.join(base, k)) for k in keys):
        return
    os.makedirs(target_dir, exist_ok=True)
    for key in keys:
        src = os.path.join(base, key)
        if not os.path.exists(src):
            continue
        dst = os.path.join(target_dir, key)
        if os.path.exists(dst):
            moved.append((os.path.join(name, key), "跳过（目标已存在）"))
            continue
        shutil.move(src, dst)
        moved.append((os.path.join(name, key), os.path.relpath(dst, pl.PROJECTS)))


def main():
    if not os.path.isdir(pl.PROJECTS):
        print("没有 projects 目录")
        return
    moved = []
    for name in sorted(os.listdir(pl.PROJECTS)):
        base = os.path.join(pl.PROJECTS, name)
        if not os.path.isdir(base) or name in ("cover", "gen"):
            continue
        has_cover = any(os.path.exists(os.path.join(base, k)) for k in COVER_KEYS)
        has_gen = any(os.path.exists(os.path.join(base, k)) for k in GEN_KEYS)
        if not has_cover and not has_gen:
            continue
        if has_cover:
            move(name, base, os.path.join(pl.COVER, name), COVER_KEYS, moved)
        if has_gen:
            move(name, base, os.path.join(pl.GEN, name), GEN_KEYS, moved)
        try:
            if not os.listdir(base):
                os.rmdir(base)
                moved.append((name, "空目录已删除"))
        except OSError:
            pass

    for src, dst in moved:
        print(f"{src}  ->  {dst}")
    print("\n翻唱项目：", [p["id"] for p in pl.list_projects()])
    gen = []
    if os.path.isdir(pl.GEN):
        gen = sorted(d for d in os.listdir(pl.GEN) if os.path.isdir(os.path.join(pl.GEN, d)))
    print("生成项目：", gen)


if __name__ == "__main__":
    main()
