import sys, time
from audio_separator.separator import Separator

MODEL = sys.argv[1] if len(sys.argv) > 1 else "vocals_mel_band_roformer.ckpt"
SRC = sys.argv[2] if len(sys.argv) > 2 else r"D:\singer\work\audio\source.wav"
OUT = sys.argv[3] if len(sys.argv) > 3 else r"D:\singer\out\aurora"

sep = Separator(
    model_file_dir=r"D:\singer\work\models",
    output_dir=OUT,
    output_format="WAV",
    use_autocast=True,
)
t0 = time.time()
sep.load_model(MODEL)
print("model loaded", round(time.time() - t0, 1), "s", flush=True)
t1 = time.time()
files = sep.separate(SRC)
print("separated in", round(time.time() - t1, 1), "s", flush=True)
for f in files:
    print("OUT", f, flush=True)
