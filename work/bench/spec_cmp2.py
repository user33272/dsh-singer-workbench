import numpy as np, soundfile as sf
from PIL import Image

SR = 44100
T0, DUR = 160, 12

def spec(path, rows=300, cols=900):
    x, sr = sf.read(path, always_2d=True, start=T0*SR, frames=DUR*SR)
    mono = x.mean(1)
    n_fft, hop = 2048, 256
    win = np.hanning(n_fft)
    frames = 1 + (len(mono) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(frames)[:, None]
    S = np.abs(np.fft.rfft(mono[idx] * win, axis=1))
    f = np.fft.rfftfreq(n_fft, 1 / SR)
    fy = np.geomspace(70, 9000, rows)
    fr = S[:, [np.argmin(np.abs(f - v)) for v in fy]].T  # rows x frames
    db = 20 * np.log10(fr + 1e-6)
    db = np.clip((db - (db.max() - 70)) / 70, 0, 1)
    img = Image.fromarray((db[::-1] * 255).astype(np.uint8))
    return img.resize((cols, rows), Image.BILINEAR)

pairs = [
    r"D:\singer\out\aurora\source_(vocals)_vocals_mel_band_roformer.wav",
    r"D:\singer\out\kara_old\source_(Vocals)_UVR_MDXNET_KARA_2.wav",
]
imgs = [spec(p) for p in pairs]
w, h = imgs[0].size
gap = 8
canvas = Image.new("L", (w, h*2 + gap), 40)
canvas.paste(imgs[0], (0, 0))
canvas.paste(imgs[1], (0, h + gap))
canvas.save(r"D:\singer\out\compare\vocals_spec_cmp.png")
print("saved", canvas.size)
