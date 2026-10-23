import numpy as np, soundfile as sf
from PIL import Image

SR = 44100
T0, DUR = 157, 30

def spec(path):
    x, sr = sf.read(path, always_2d=True, start=T0*SR, frames=DUR*SR)
    mono = x.mean(1)
    n_fft, hop = 2048, 512
    win = np.hanning(n_fft)
    frames = 1 + (len(mono) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(frames)[:, None]
    S = np.abs(np.fft.rfft(mono[idx] * win, axis=1))
    f = np.fft.rfftfreq(n_fft, 1 / SR)
    # log-frequency mapping 60 Hz .. 12 kHz onto 220 rows
    rows = 220
    fy = np.geomspace(60, 12000, rows)
    fr = np.array([S[:, np.argmin(np.abs(f - v))] for v in fy])
    db = 20 * np.log10(fr + 1e-6)
    db = np.clip((db - (db.max() - 80)) / 80, 0, 1)
    return (db * 255).astype(np.uint8)

pairs = [
    (r"D:\singer\out\aurora\source_(vocals)_vocals_mel_band_roformer.wav", "Mel-Band RoFormer (new)"),
    (r"D:\singer\out\kara_old\source_(Vocals)_UVR_MDXNET_KARA_2.wav", "UVR MDX-NET Karaoke 2 (old)"),
    (r"D:\singer\out\aurora\source_(other)_vocals_mel_band_roformer.wav", "RoFormer instrumental"),
    (r"D:\singer\out\kara_old\source_(Instrumental)_UVR_MDXNET_KARA_2.wav", "MDX Karaoke instrumental"),
]
imgs = [spec(p) for p, _ in pairs]
h, w = imgs[0].shape
gap = 6
canvas = np.zeros((h * 2 + gap, w * 2 + gap), dtype=np.uint8)
pos = [(0, 0), (0, w + gap), (h + gap, 0), (h + gap, w + gap)]
for im, (r, c) in zip(imgs, pos):
    canvas[r:r + h, c:c + w] = im
img = Image.fromarray(canvas).resize((canvas.shape[1] // 2, canvas.shape[0] // 2), Image.LANCZOS)
img.save(r"D:\singer\out\compare\spectrograms.png")
print("saved", img.size)
