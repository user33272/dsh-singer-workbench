"""项目的目录规则：所有产物按「一首歌 = 一个项目」落在 projects\\<id>\\ 下。

    projects\\<id>\\
        project.json    元数据：标题、源文件、每一步的时间戳
        audio\\           source.wav / vocals.wav / instrumental.wav（+ mp3 预览）
        analysis\\        f0.csv / pitch_curve.png / pitch_report.json / instrumental_shift±N.wav
        work\\            ref.wav / vc_*.wav / cover.wav / cover.mp3
        baselines\\       旧模型、A/B 片段的对照产物

四个脚本和插件共用这里的规则，路径不会再散落在 out/ 根目录。
"""
import json
import os
import re
import time
from datetime import datetime

ROOT = r"D:\singer"
PROJECTS = os.path.join(ROOT, "projects")
# 翻唱与生成分开管理：projects\cover\ 与 projects\gen\
COVER = os.path.join(PROJECTS, "cover")
GEN = os.path.join(PROJECTS, "gen")

# 公共工具链位置：各脚本统一从这里取，避免每个脚本各写一遍
WORK = os.path.join(ROOT, "work")
BIN = os.path.join(WORK, "bin")
FFMPEG = os.path.join(BIN, "ffmpeg.exe")
VENV = os.path.join(WORK, "venv")
VENV_PY = os.path.join(VENV, "Scripts", "python.exe")
VENV_VC = os.path.join(WORK, "venv_vc")
VENV_VC_PY = os.path.join(VENV_VC, "Scripts", "python.exe")
SEEDVC = os.path.join(WORK, "seedvc")
SOUNDFONT = os.path.join(WORK, "soundfonts")
FLUIDSYNTH = os.path.join(WORK, "tools", "fluidsynth")

ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize(name):
    """把任意名字变成安全的目录名，保留中文，去掉非法字符。"""
    text = ILLEGAL.sub("_", str(name or "").strip())
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = "project"
    return text[:60]


def project_dir(pid):
    return os.path.join(COVER, sanitize(pid))


def paths(pid):
    base = project_dir(pid)
    return {
        "base": base,
        "audio": os.path.join(base, "audio"),
        "analysis": os.path.join(base, "analysis"),
        "work": os.path.join(base, "work"),
        "baselines": os.path.join(base, "baselines"),
        "meta": os.path.join(base, "project.json"),
    }


def _load_meta(pid):
    p = paths(pid)["meta"]
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    return {}


def _save_meta(pid, meta):
    p = paths(pid)["meta"]
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def ensure(pid, title=None, source=None):
    """建目录并更新 project.json，返回路径表。"""
    p = paths(pid)
    for key in ("audio", "analysis", "work", "baselines"):
        os.makedirs(p[key], exist_ok=True)
    meta = _load_meta(pid)
    now = datetime.now().isoformat(timespec="seconds")
    meta.setdefault("id", sanitize(pid))
    meta.setdefault("title", title or sanitize(pid))
    meta.setdefault("createdAt", now)
    if source:
        meta["source"] = source
    if title:
        meta["title"] = title
    meta["updatedAt"] = now
    meta.setdefault("steps", {})
    _save_meta(pid, meta)
    return p


def mark_step(pid, step, detail=None):
    meta = _load_meta(pid)
    meta.setdefault("steps", {})[step] = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "detail": detail or "",
    }
    meta["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    _save_meta(pid, meta)


def resolve(path, explicit=None):
    """推断文件属于哪个项目。

    1) 显式 --project 优先
    2) 文件已经在 projects/<id>/ 里 -> 用那个 id
    3) 否则用父目录名（例如 out/朧月/vocals.wav -> 朧月）
    4) 兜底用文件名去扩展名
    """
    if explicit:
        return sanitize(explicit)
    full = os.path.abspath(path)
    cover_root = os.path.abspath(COVER)
    if full.startswith(cover_root + os.sep):
        rel = os.path.relpath(full, cover_root)
        first = rel.split(os.sep)[0]
        if first and first not in (".", ".."):
            return sanitize(first)
    parent = os.path.basename(os.path.dirname(full))
    if parent and parent.lower() not in ("out", "source", "audio", "work", "analysis", "tmp", "cover", "gen"):
        return sanitize(parent)
    return sanitize(os.path.splitext(os.path.basename(full))[0])


def find_by_source(src):
    """已经在某个项目里登记过这个源文件时，复用那个项目 id。"""
    if not src or not os.path.isdir(COVER):
        return None
    target = os.path.abspath(src).lower()
    for name in os.listdir(COVER):
        meta_path = os.path.join(COVER, name, "project.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        source = meta.get("source")
        if source and os.path.abspath(source).lower() == target:
            return sanitize(name)
    return None


def list_projects():
    out = []
    if not os.path.isdir(COVER):
        return out
    for name in sorted(os.listdir(COVER)):
        base = os.path.join(COVER, name)
        if not os.path.isdir(base):
            continue
        meta = _load_meta(name)
        files = {}
        for key in ("audio", "analysis", "work", "baselines"):
            folder = os.path.join(base, key)
            if not os.path.isdir(folder):
                continue
            entries = []
            for f in sorted(os.listdir(folder)):
                fp = os.path.join(folder, f)
                if os.path.isfile(fp):
                    st = os.stat(fp)
                    entries.append({"name": f, "path": fp, "bytes": st.st_size,
                                    "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")})
            files[key] = entries
        out.append({
            "id": name,
            "dir": base,
            "title": meta.get("title") or name,
            "source": meta.get("source"),
            "createdAt": meta.get("createdAt"),
            "updatedAt": meta.get("updatedAt"),
            "steps": meta.get("steps") or {},
            "files": files,
        })
    return out


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        print(json.dumps(ensure(sys.argv[1]), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(list_projects(), ensure_ascii=False, indent=2))
