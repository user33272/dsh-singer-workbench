"""通用 MIDI 试听渲染器（无第三方依赖，numpy + soundfile）。

和 FluidSynth 渲染的区别：这个只用正弦叠加模拟钢琴，听着能判断旋律与和声，
不代表成品音色；它的用途是「没有音源时也能出声」。

用法：
    gen_preview.cmd <midi> [-o 输出.wav] [--mp3]

    python work\\gen_preview.py "projects\\gen\\某歌\\midi\\某歌.mid" -o out.wav
"""
import argparse
import os
import struct
import subprocess
import sys

import numpy as np
import soundfile as sf

ROOT = r"D:\singer"
FFMPEG = os.path.join(ROOT, "work", "bin", "ffmpeg.exe")
SR = 44100


def read_midi(path):
    from pathlib import Path

    path = Path(path)
    b = path.read_bytes()
    fmt, ntrk, tpq = struct.unpack(">HHH", b[8:14])
    pos, notes, tempo = 14, [], None

    def vlq(data, i):
        v = 0
        while True:
            c = data[i]
            i += 1
            v = (v << 7) | (c & 0x7F)
            if not c & 0x80:
                return v, i

    for _ in range(ntrk):
        ln = struct.unpack(">I", b[pos + 4:pos + 8])[0]
        data = b[pos + 8:pos + 8 + ln]
        pos += 8 + ln
        i = tick = 0
        active = {}
        while i < len(data):
            dt, i = vlq(data, i)
            tick += dt
            status = data[i]
            if status == 0xFF:
                kind, l = data[i + 1], data[i + 2]
                if kind == 0x51:
                    tempo = int.from_bytes(data[i + 3:i + 6], "big")
                i += 3 + l
                continue
            if status & 0xF0 == 0x90:
                ch, pitch, vel = status & 0x0F, data[i + 1], data[i + 2]
                if vel > 0:
                    active[(ch, pitch)] = (tick, vel)
                else:
                    start, vel0 = active.pop((ch, pitch), (tick, 80))
                    notes.append((start, tick - start, pitch, vel0, ch))
                i += 3
            elif status & 0xF0 == 0x80:
                ch, pitch = status & 0x0F, data[i + 1]
                start, vel = active.pop((ch, pitch), (tick, 80))
                notes.append((start, tick - start, pitch, vel, ch))
                i += 3
            else:
                raise SystemExit(f"unexpected status {status:02x}")
        for (ch, pitch), (start, vel) in active.items():
            notes.append((start, tick - start, pitch, vel, ch))
    return tpq, tempo or 833333, notes


def tone(freq, dur, vel, sr=SR):
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr
    sig = np.zeros(n)
    for k, amp in ((1, 1.0), (2, 0.35), (3, 0.16), (4, 0.08)):
        sig += amp * np.sin(2 * np.pi * freq * k * t)
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 220))
    rel = int(min(n, 0.05 * sr))
    if rel:
        env[-rel:] *= np.linspace(1, 0, rel)
    return sig * env * (vel / 127.0)


def render(midi_path, wav_path):
    tpq, tempo, notes = read_midi(midi_path)
    if not notes:
        raise SystemExit("MIDI 里没有音符")
    sec_per_tick = (tempo / 1_000_000) / tpq
    end = max(s + d for s, d, *_ in notes) * sec_per_tick + 3.0
    mono = np.zeros(int(end * SR) + SR)
    for start, dur, pitch, vel, ch in notes:
        f = 440.0 * 2 ** ((pitch - 69) / 12)
        s0 = int(start * sec_per_tick * SR)
        sig = tone(f, dur * sec_per_tick, vel)
        gain = 0.9 if ch == 0 else (0.55 if ch == 1 else 0.7)
        e = min(len(mono), s0 + len(sig))
        mono[s0:e] += sig[: e - s0] * gain
    peak = float(np.max(np.abs(mono))) or 1.0
    data = (mono / peak * 0.89).astype(np.float32)
    sf.write(wav_path, np.stack([data, data], axis=1), SR, subtype="PCM_16")
    return {"seconds": round(end, 1), "notes": len(notes), "peak": round(peak, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("midi")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--mp3", action="store_true", help="顺便转一个 192k mp3")
    a = ap.parse_args()

    midi = os.path.abspath(a.midi)
    if not os.path.isfile(midi):
        sys.exit(f"找不到 MIDI: {midi}")
    out = os.path.abspath(a.out) if a.out else os.path.splitext(midi)[0] + "_preview.wav"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    info = render(midi, out)
    print(f"wrote {out} {info['seconds']}s notes={info['notes']} peak={info['peak']}")
    if a.mp3 and os.path.isfile(FFMPEG):
        mp3 = os.path.splitext(out)[0] + ".mp3"
        subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", out, "-b:a", "192k", mp3], check=True)
        print("mp3:", mp3)


if __name__ == "__main__":
    main()
