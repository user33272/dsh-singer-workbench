"""补齐 migrate_split 没收尾的部分：把 projects\\<id> 里剩下的文件挪进 gen\\<id> 或 cover\\<id>。

文件被占用（正在播放）时跳过，等释放后再跑一次即可。
"""
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import projectlib as pl

BUSY = (PermissionError, OSError)


def move_file(src, dst, skipped):
    if os.path.exists(dst):
        try:
            if os.path.getsize(src) == os.path.getsize(dst):
                os.remove(src)
                return "dup-removed"
        except OSError:
            pass
        skipped.append((src, "目标已存在"))
        return "skip"
    for attempt in range(3):
        try:
            os.replace(src, dst)
            return "moved"
        except BUSY:
            time.sleep(0.3)
    try:
        shutil.copy2(src, dst)
        try:
            os.remove(src)
            return "copied"
        except OSError:
            skipped.append((src, "已复制，原文件被占用"))
            return "copied-locked"
    except OSError:
        skipped.append((src, "被占用"))
        return "skip"


def move_tree(src_dir, dst_dir, skipped):
    if not os.path.isdir(src_dir):
        return
    os.makedirs(dst_dir, exist_ok=True)
    for root, _dirs, files in os.walk(src_dir):
        rel = os.path.relpath(root, src_dir)
        target_root = os.path.join(dst_dir, rel) if rel != "." else dst_dir
        os.makedirs(target_root, exist_ok=True)
        for f in files:
            move_file(os.path.join(root, f), os.path.join(target_root, f), skipped)


def prune_empty(path):
    for root, dirs, files in os.walk(path, topdown=False):
        if not dirs and not files:
            try:
                os.rmdir(root)
            except OSError:
                pass


def main():
    skipped = []
    for name in sorted(os.listdir(pl.PROJECTS)):
        base = os.path.join(pl.PROJECTS, name)
        if not os.path.isdir(base) or name in ("cover", "gen"):
            continue
        for key in ("renders", "tools", "midi"):
            move_tree(os.path.join(base, key), os.path.join(pl.GEN, name, key), skipped)
        for key in ("song-sheet.md", "products.json"):
            src = os.path.join(base, key)
            if os.path.isfile(src):
                move_file(src, os.path.join(pl.GEN, name, key), skipped)
        for key in ("audio", "analysis", "work", "baselines"):
            move_tree(os.path.join(base, key), os.path.join(pl.COVER, name, key), skipped)
        src = os.path.join(base, "project.json")
        if os.path.isfile(src):
            move_file(src, os.path.join(pl.COVER, name, "project.json"), skipped)
        prune_empty(base)
        if os.path.isdir(base) and not os.listdir(base):
            os.rmdir(base)

    if skipped:
        print("被跳过：")
        for src, why in skipped:
            print(f"  {src}  ({why})")
    else:
        print("没有跳过项")
    print("\nprojects 根目录：", sorted(os.listdir(pl.PROJECTS)))
    print("cover：", sorted(os.listdir(pl.COVER)) if os.path.isdir(pl.COVER) else [])
    print("gen：", sorted(os.listdir(pl.GEN)) if os.path.isdir(pl.GEN) else [])


if __name__ == "__main__":
    main()
