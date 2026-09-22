---
name: video-remove-bg
description: "Removes the background from a video clip — cut out characters/objects onto transparent (or black), keeping the soundtrack. Local and free (rembg + BirefNet). Trigger: remove/cut out background from a video, transparent video, alpha video, green-screen-less matting."
---

# video-remove-bg

Frame-by-frame matting with `rembg -m birefnet-general`, re-encoded into formats that
really keep alpha. Everything local, $0.

```bash
S="${CLAUDE_PLUGIN_ROOT}/skills/video-remove-bg/scripts"
"$S/rmbg-video.sh" -i in.mp4 -s 0.8 -c auto -o out/minions         # first pass: picks the crop
"$S/rmbg-video.sh" -i in.mp4 -s 0.8 -c auto -k 3 -o out/minions    # keep object 3 only
#  -s/-t segment · -c W:H:X:Y or auto (+ -k bands) · -a song.mp3 -A 24 external soundtrack
```

Outputs: `out.mov` (ProRes 4444, alpha — the reference), `out_hevc.mov` (HEVC+alpha,
~15× smaller), `out_black.mp4`, `out_checker.png`. The last step decodes a frame of each
file and prints ✓/✗ for real alpha. First run creates a venv in `~/.cache/video-remove-bg`
(needs `uv`, `ffmpeg`); model downloads to `~/.u2net` once (~1 GB).
Rerunning with the same `-o` resumes — matted frames are skipped.

## Workflow

1. **Pin down the timeline.** "From second 24 to the end" may refer to a *different*
   track than the video (a song, a longer cut). If the numbers don't fit the clip, run
   `align_audio.py clip.mp4 track.mp3` → offset; `clip_time = asked_time − offset`.
   Corr > 0.3 on music ⇒ same recording.
2. **Crop = what survives.** BirefNet keeps *everything* salient — a logo's title is as
   foreground as the characters under it. `-c auto` mattes 6 full frames, lists the
   horizontal bands it found and writes `boxes.png`; with several bands it stops (exit 3).
   Show `boxes.png` to the user, rerun with `-k`. The box is the union over the whole
   segment, so a character that falls or jumps later stays in frame.
3. **Show one matted frame before the long run** (`out_checker.png`-style: source /
   checkerboard / black stacked). ~15–20 s per frame on CPU: 170 frames ≈ 50 min — run it
   in the background, and let the user veto the framing while it is cheap.
4. **Tell the user the final length** up front: frames/fps vs. soundtrack length. With a
   longer soundtrack the `.mp4` holds the last frame; the `.mov`s just run the sound on.
5. **Deliver**: open `out_checker.png` so they see what's transparent, and say that
   QuickTime shows transparency as black — drop the `.mov` onto a Keynote slide to see it.

## Pitfalls (each cost real time)

- **Model choice.** Human-matting models (RobustVideoMatting, most SaaS removers) are
  trained on people only — useless on cartoons/objects. `isnet-anime` is for flat 2D art,
  wrong for glossy 3D CGI. `birefnet-general` (salient object, no human prior) works.
- **Input is fixed 1024×1024.** Every frame is resized to 1024² and the mask comes back
  1024². A tight crop gives the model more pixels on the subject; 4K instead of 1080p does
  *not* give a 4× sharper mask — only a cleaner (less compressed) source helps.
- **ffprobe lies about alpha.** HEVC+alpha and VP9+alpha both report `pix_fmt=yuv420p`
  with the alpha intact (separate layer / Matroska BlockAdditional). Verify by decoding to
  RGBA (`verify_alpha.py`); for WebM force `-c:v libvpx-vp9`, the native decoder drops alpha.
- **WebM alpha** needs `-auto-alt-ref 0` (otherwise libvpx silently drops it), and some
  Homebrew/static ffmpeg builds on macOS write `yuv420p` anyway. Use ProRes 4444 / HEVC.
- **Seek into the video stream, not the file.** With a soundtrack longer than the frames,
  `format=duration` points past the last frame and the extraction returns nothing.
- **ffmpeg ≥ 9 removed `-vsync`** → `-fps_mode passthrough`, or `select` duplicates/skips
  frames and the numbering stops matching.
- **Fades.** Intros fade in/out: black frames give empty masks. Spot them by PNG size
  (a black 1080p frame is <1 KB) or mean luma before matting.
- **`rembg p` processes files out of order** — don't read progress from the first name.
- **Jittery mask? Measure before blaming the model.** `mean|Δalpha| / mean|Δsource|` < 1
  means the mask follows real motion (a cut, a fall). If one window flickers, pick the
  calmest window (`mean + max` of source motion) instead of switching models.
- **"HD" uploads lie.** Check `yt-dlp -F` for real resolution; a crisp 1080p copy may be a
  fan re-creation (read the description) — cleaner, but not the original.
- macOS `/bin/bash` is 3.2: `set -u` + an empty `"${arr[@]}"` aborts the script.
