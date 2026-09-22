#!/bin/bash
# Remove the background from a video segment, frame by frame, locally and for free.
# Output: ProRes 4444 .mov (alpha), HEVC-alpha .mov (alpha, small), .mp4 on black,
# plus a checkerboard preview PNG. Optional soundtrack from another file.
#
#   rmbg-video.sh -i in.mp4 [-s START] [-t DUR] [-c W:H:X:Y | -c auto [-k 1,3]]
#                 [-a audio.mp3] [-A AUDIO_START] [-o out_basename] [-w workdir]
#
# Re-running with the same workdir resumes: frames already matted are skipped.
set -eo pipefail   # no -u: macOS bash 3.2 treats an empty "${arr[@]}" as unbound
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${RMBG_VENV:-${XDG_CACHE_HOME:-$HOME/.cache}/video-remove-bg/.venv}"
MODEL="${RMBG_MODEL:-birefnet-general}"

IN= SS=0 DUR= KEEP= CROP= AUDIO= ASS=0 OUT=out WORK=
while getopts "i:s:t:c:k:a:A:o:w:" o; do case $o in
  i) IN=$OPTARG;; s) SS=$OPTARG;; t) DUR=$OPTARG;; c) CROP=$OPTARG;; k) KEEP=$OPTARG;;
  a) AUDIO=$OPTARG;; A) ASS=$OPTARG;; o) OUT=$OPTARG;; w) WORK=$OPTARG;;
  *) sed -n '2,9p' "$0"; exit 2;; esac; done
[ -n "$IN" ] || { sed -n '2,9p' "$0"; exit 2; }
WORK=${WORK:-$(dirname "$OUT")/$(basename "$OUT").work}
mkdir -p "$WORK/src" "$WORK/cut"

# --- 0. environment ---------------------------------------------------------
if [ ! -x "$VENV/bin/rembg" ]; then
  echo "» creating venv at $VENV"
  uv venv -q --python 3.12 "$VENV"
  uv pip install -q --python "$VENV/bin/python" "rembg[cpu,cli]" scipy pillow numpy
fi
PY="$VENV/bin/python"

FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$IN")
TRIM=(-ss "$SS"); [ -n "$DUR" ] && TRIM+=(-t "$DUR")

# --- 1. frames (full frame first, crop decided afterwards) ------------------
if [ -z "$(ls "$WORK/src" 2>/dev/null)" ]; then
  echo "» extracting frames ($FPS fps)"
  ffmpeg -v error -y "${TRIM[@]}" -i "$IN" -fps_mode passthrough "$WORK/src/f_%04d.png"
fi
N=$(ls "$WORK/src" | wc -l | tr -d ' ')
echo "» $N frames"

# --- 2. crop: tight box around the subject (model input is fixed 1024x1024) -
if [ "$CROP" = auto ]; then
  set +e
  CROP=$("$PY" "$HERE/subject_bbox.py" "$WORK/src" --model "$MODEL" --preview "$WORK/boxes.png" ${KEEP:+--keep "$KEEP"})
  rc=$?; set -e
  if [ $rc -eq 3 ]; then
    echo "✋ several objects found — the model keeps ALL of them. Look at $WORK/boxes.png,"
    echo "   then rerun with -k <numbers> (e.g. -k 2,3) or an explicit -c W:H:X:Y."
    exit 3
  fi
  [ $rc -eq 0 ] || exit $rc
  echo "» auto crop $CROP  (preview: $WORK/boxes.png)"
fi
if [ -n "$CROP" ] && [ ! -f "$WORK/.cropped" ]; then
  "$PY" - "$WORK/src" "$CROP" <<'PY'
import sys, glob
from PIL import Image
d, c = sys.argv[1], sys.argv[2]
w, h, x, y = map(int, c.split(':'))
for f in sorted(glob.glob(d + '/*.png')):
    Image.open(f).crop((x, y, x + w, y + h)).save(f)
PY
  touch "$WORK/.cropped"
fi

# --- 3. matting (skip frames already done: rembg p processes out of order) --
TODO="$WORK/todo"; rm -rf "$TODO"; mkdir -p "$TODO"
for f in "$WORK"/src/*.png; do b=$(basename "$f"); [ -f "$WORK/cut/$b" ] || ln -s "$f" "$TODO/$b"; done
LEFT=$(ls "$TODO" | wc -l | tr -d ' ')
if [ "$LEFT" -gt 0 ]; then
  echo "» matting $LEFT frames with $MODEL (~15-20 s/frame on CPU)"
  "$VENV/bin/rembg" p -m "$MODEL" "$TODO" "$WORK/cut"
fi
rm -rf "$TODO"

# --- 4. audio ---------------------------------------------------------------
AUD=()
if [ -n "$AUDIO" ]; then
  ffmpeg -v error -y -ss "$ASS" -i "$AUDIO" -c:a pcm_s16le "$WORK/audio.wav"
elif ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$IN" | grep -q .; then
  ffmpeg -v error -y "${TRIM[@]}" -i "$IN" -vn -c:a pcm_s16le "$WORK/audio.wav"
fi
[ -f "$WORK/audio.wav" ] && AUD=(-i "$WORK/audio.wav")

# --- 5. encode --------------------------------------------------------------
SEQ="$WORK/cut/f_%04d.png"
WH=$("$PY" -c "from PIL import Image;import glob;print('%dx%d'%Image.open(sorted(glob.glob('$WORK/cut/*.png'))[0]).size)")
A_PCM=(); A_AAC=(); [ ${#AUD[@]} -gt 0 ] && { A_PCM=(-map 1:a -c:a pcm_s16le); A_AAC=(-map 1:a -c:a aac -b:a 192k); }

echo "» ProRes 4444"
ffmpeg -v error -y -framerate "$FPS" -i "$SEQ" "${AUD[@]}" -map 0:v \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "${A_PCM[@]}" "$OUT.mov"
echo "» HEVC with alpha"
ffmpeg -v error -y -framerate "$FPS" -i "$SEQ" "${AUD[@]}" -map 0:v \
  -c:v hevc_videotoolbox -alpha_quality 0.9 -q:v 70 -pix_fmt bgra -tag:v hvc1 "${A_AAC[@]}" "${OUT}_hevc.mov" \
  || echo "  (no hevc_videotoolbox here — skip; ProRes is the reference output)"
echo "» on black"
# audio longer than the frames: hold the last frame until the sound ends
if [ ${#AUD[@]} -gt 0 ]; then BG=2 PAD=",tpad=stop_mode=clone:stop_duration=30" SHORT=-shortest; else BG=1 PAD= SHORT=; fi
ffmpeg -v error -y -framerate "$FPS" -i "$SEQ" "${AUD[@]}" -f lavfi -i "color=black:s=$WH:r=$FPS" \
  -filter_complex "[$BG][0]overlay=shortest=1$PAD,format=yuv420p[v]" \
  -map "[v]" "${A_AAC[@]}" -c:v libx264 -crf 16 $SHORT "${OUT}_black.mp4"

# --- 6. verify ----------------------------------------------------------------
"$PY" "$HERE/verify_alpha.py" "$OUT.mov" "${OUT}_hevc.mov" --checker "${OUT}_checker.png"
