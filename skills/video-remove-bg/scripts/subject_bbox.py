"""Measure a tight crop around the subject across the whole segment.

Mattes K evenly spaced full frames and ORs their alpha masks, so a subject that moves
(falls, jumps) stays inside the box in every frame, not just the first one.

The model keeps EVERYTHING salient — a logo's text is as "foreground" as the characters
under it. So the crop is what decides what survives. This script therefore also lists
each separate horizontal band of objects it found (numbered, with its box) and draws them on --preview:
pick the ones you want with --keep 2,3, or pass the union if there is only one subject.

  python subject_bbox.py frames_dir [--samples 6] [--pad 0.06] [--keep 1,2]
                         [--preview boxes.png] [--model birefnet-general]
stdout: W:H:X:Y (even dims) — stderr: the object list
"""
import argparse, glob, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from rembg import new_session, remove
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--samples", type=int, default=6)
ap.add_argument("--pad", type=float, default=0.06)
ap.add_argument("--keep", help="comma-separated object numbers from the list (default: all)")
ap.add_argument("--preview")
ap.add_argument("--model", default="birefnet-general")
a = ap.parse_args()

fs = sorted(glob.glob(a.dir + "/*.png"))
pick = list(dict.fromkeys(fs[round(i * (len(fs) - 1) / max(1, a.samples - 1))] for i in range(a.samples)))
sess = new_session(a.model)
W, H = Image.open(fs[0]).size
union = np.zeros((H, W), bool)
for f in pick:
    m = np.asarray(remove(Image.open(f), session=sess))[..., 3] > 16
    print(f"  sample {f.rsplit('/', 1)[-1]}: {100 * m.mean():.1f}% foreground"
          + ("  (empty: fade/black frame?)" if not m.any() else ""), file=sys.stderr)
    union |= m
if not union.any():
    sys.exit("no subject found in any sample")

# separate objects as horizontal bands (title / subtitle / characters): splitting per
# connected component shatters text into letters; bands match how intros are composed
rows = ndimage.binary_dilation(union.any(axis=1), iterations=2)
lab, n = ndimage.label(rows)
objs = []
for i in range(1, n + 1):
    ys = np.where((lab == i) & union.any(axis=1))[0]
    band = union[ys.min():ys.max() + 1]
    xs = np.where(band.any(axis=0))[0]
    if band.sum() >= union.size * 0.002:
        objs.append((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, band.sum()))
objs.sort(key=lambda o: (o[1], o[0]))
for k, (x0, y0, x1, y1, ar) in enumerate(objs, 1):
    print(f"  object {k}: x {x0}-{x1}  y {y0}-{y1}  ({100 * ar / union.size:.1f}% of frame)", file=sys.stderr)

keep = [int(k) for k in a.keep.split(",")] if a.keep else range(1, len(objs) + 1)
if any(not 1 <= k <= len(objs) for k in keep):
    sys.exit(f"--keep {a.keep}: only objects 1..{len(objs)} exist")
sel = [objs[k - 1] for k in keep]
X0, Y0 = min(o[0] for o in sel), min(o[1] for o in sel)
X1, Y1 = max(o[2] for o in sel), max(o[3] for o in sel)
px, py = int((X1 - X0) * a.pad), int((Y1 - Y0) * a.pad)
x0, y0 = max(0, X0 - px), max(0, Y0 - py)
x1, y1 = min(W, X1 + px), min(H, Y1 + py)
# padding must not reach into a band we dropped, or a sliver of it gets matted back in
for k, o in enumerate(objs, 1):
    if k in keep: continue
    if o[3] <= Y0: y0 = max(y0, o[3])
    if o[1] >= Y1: y1 = min(y1, o[1])
w, h = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2   # even dims for yuv420 encoders

if a.preview:
    im = Image.open(pick[len(pick) // 2]).convert("RGB")
    d = ImageDraw.Draw(im)
    try: font = ImageFont.load_default(size=max(16, W // 40))
    except TypeError: font = None   # Pillow < 10.1
    for k, (ox0, oy0, ox1, oy1, _) in enumerate(objs, 1):
        d.rectangle((ox0, oy0, ox1, oy1), outline=(255, 60, 60), width=3)
        d.text((ox0 + 6, oy0 + 4), str(k), fill=(255, 60, 60), font=font)
    d.rectangle((x0, y0, x0 + w, y0 + h), outline=(60, 255, 60), width=4)
    im.save(a.preview)
    print(f"  preview (red = objects, green = crop): {a.preview}", file=sys.stderr)
print(f"{w}:{h}:{x0}:{y0}")
if len(objs) > 1 and not a.keep:
    sys.exit(3)   # several objects: the caller must choose (--keep), not silently take them all
