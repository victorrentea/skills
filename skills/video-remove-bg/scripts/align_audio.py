"""Find where a clip's soundtrack sits inside a longer audio track (normalized cross-correlation).

Use it when the user gives times on ANOTHER timeline ("from second 24 to the end" of the
song, while the video itself is 8 s long): clip_time = requested_time - offset.

  python align_audio.py clip.mp4 long_track.mp3
"""
import subprocess, sys
import numpy as np
from scipy.signal import fftconvolve

SR = 8000
def pcm(p):
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR),
                                         "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
clip, track = pcm(sys.argv[1]), pcm(sys.argv[2])
if len(clip) > len(track):
    sys.exit("the clip is longer than the track — swap the arguments")
num = fftconvolve(track, clip[::-1], mode="valid")
den = np.linalg.norm(clip) * np.sqrt(np.convolve(track ** 2, np.ones(len(clip)), "valid")) + 1e-9
r = num / den; k = int(r.argmax())
print(f"offset {k / SR:.3f} s   corr {r[k]:.2f}   (clip {len(clip) / SR:.2f} s, track {len(track) / SR:.2f} s)")
print("corr > 0.3 on music = same recording; < 0.15 = probably not the same audio")
