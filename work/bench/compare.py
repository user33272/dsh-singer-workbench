import numpy as np, soundfile as sf, subprocess, os

FF = r"D:\singer\work\bin\ffmpeg.exe"
def load(p):
    x, sr = sf.read(p, always_2d=True)
    return x.astype(np.float64), sr

def db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)

src = r"D:\singer\work\audio\source.wav"
new_v = r"D:\singer\out\aurora\source_(vocals)_vocals_mel_band_roformer.wav"
new_i = r"D:\singer\out\aurora\source_(other)_vocals_mel_band_roformer.wav"
old_v = r"D:\singer\out\kara_old\source_(Vocals)_UVR_MDXNET_KARA_2.wav"
old_i = r"D:\singer\out\kara_old\source_(Instrumental)_UVR_MDXNET_KARA_2.wav"

o, sr = load(src)
nv, _ = load(new_v); ni, _ = load(new_i)
ov, _ = load(old_v); oi, _ = load(old_i)
n = min(len(o), len(nv), len(ni), len(ov), len(oi))
o, nv, ni, ov, oi = o[:n], nv[:n], ni[:n], ov[:n], oi[:n]

hop = 1024
win = 4096
def frame_db(x):
    mono = x.mean(1)
    fr = len(mono) // hop
    e = np.array([np.mean(mono[k*hop:k*hop+win] ** 2) for k in range(fr)])
    return 10 * np.log10(e + 1e-12)

ev, ei = frame_db(nv), frame_db(ni)

# vocal-active frames from RoFormer vocals (relative threshold)
thr = np.percentile(ev, 60)
active = ev > thr
quiet = ev < np.percentile(ev, 20)

def leak(v, i):
    # instrumental energy during vocal frames vs during non-vocal frames
    a = ei[active].mean() - ei[~active].mean()
    # vocal energy during vocal-quiet frames (instrument bleed into vocals)
    b = ev[quiet].mean() - np.percentile(ev, 95)
    return a, b

# compute for both models
def stats(v, i):
    rec_err = db(o - (v + i)) - db(o)
    ei_ = frame_db(i)
    ev_ = frame_db(v)
    bleed = ei_[active].mean() - ei_[~active].mean()      # instrumental gain rise when vocals sing
    sep_ = ev_[active].mean() - ev_[quiet].mean()          # vocal contrast
    return dict(vocals_db=db(v), other_db=db(i), rec_err=rec_err, bleed=bleed, contrast=sep_)

s_new = stats(nv, ni)
s_old = stats(ov, oi)

print(f"{'metric':<12}{'MELBAND-ROFORMER':>20}{'UVR-MDXNET-KARA2':>20}")
for k in ['vocals_db', 'other_db', 'rec_err', 'bleed', 'contrast']:
    print(f"{k:<12}{s_new[k]:>20.2f}{s_old[k]:>20.2f}")

# ---- deliverables ----
os.makedirs(r"D:\singer\out\aurora", exist_ok=True)
def mp3(wav, out, start=None, dur=None):
    args = [FF, "-hide_banner", "-loglevel", "error", "-y"]
    if start is not None:
        args += ["-ss", str(start)]
    args += ["-i", wav]
    if dur is not None:
        args += ["-t", str(dur)]
    args += ["-c:a", "libmp3lame", "-b:a", "320k", out]
    subprocess.run(args, check=True)

mp3(new_v, r"D:\singer\out\aurora\vocals.mp3")
mp3(new_i, r"D:\singer\out\aurora\instrumental.mp3")

# pick a 30 s window with strongest vocal energy
sec = ev >= np.percentile(ev, 97)
idx = np.where(sec)[0]
t0 = max(0, int(idx[len(idx)//2] * hop / sr) - 5)
print("chorus window start", t0, "s")
cmp_dir = r"D:\singer\out\compare"
os.makedirs(cmp_dir, exist_ok=True)
for tag, path in [("orig", src), ("roformer_vocals", new_v), ("mdx_vocals", old_v),
                  ("roformer_inst", new_i), ("mdx_inst", old_i)]:
    mp3(path, os.path.join(cmp_dir, f"{tag}_30s.mp3"), start=t0, dur=30)
print("done")
