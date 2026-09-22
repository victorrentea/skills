"""Prove each output really carries alpha, by DECODING a frame — never trust ffprobe's pix_fmt.

ffprobe reports `yuv420p` for HEVC-with-alpha and VP9-with-alpha even when the alpha
layer is there (it lives in a separate layer / BlockAdditional). The only honest test
is: decode to RGBA and look at the alpha values.

  python verify_alpha.py file.mov [more files...] [--checker out.png]
"""
import argparse, io, os, subprocess, sys
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("files", nargs="+")
ap.add_argument("--checker")
a = ap.parse_args()

def frame(path):
    # the VIDEO stream's length: with a longer soundtrack, format=duration overshoots the frames
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=duration:format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.split()
    dur = next((float(x) for x in out if x not in ("", "N/A")), 0.0)
    dec = ["-c:v", "libvpx-vp9"] if path.endswith(".webm") else []   # native vp9 decoder drops alpha
    raw = subprocess.run(["ffmpeg", "-v", "error", *dec, "-ss", f"{dur / 2:.3f}", "-i", path, "-map", "0:v:0",
                          "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-pix_fmt", "rgba", "-"],
                         capture_output=True).stdout
    return Image.open(io.BytesIO(raw)).convert("RGBA")

ok = True
first = None
for f in a.files:
    if not os.path.exists(f):
        continue
    im = frame(f); al = np.asarray(im)[..., 3]
    first = first or im
    real = al.min() == 0 and al.max() == 255
    ok &= real
    print(f"{'✓' if real else '✗'} {f}: alpha {al.min()}-{al.max()}, "
          f"{100 * (al == 0).mean():.1f}% transparent, {os.path.getsize(f) / 1e6:.1f} MB")

if a.checker and first:
    w, h = first.size
    yy, xx = np.mgrid[0:h, 0:w]
    chk = np.where(((xx // 20 + yy // 20) % 2)[..., None] == 0, 200, 120).astype(np.uint8)
    bg = Image.fromarray(np.repeat(chk, 3, axis=2)).convert("RGBA")
    Image.alpha_composite(bg, first).convert("RGB").save(a.checker)
    print(f"checkerboard preview: {a.checker}")
sys.exit(0 if ok else 1)
