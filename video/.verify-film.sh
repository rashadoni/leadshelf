#!/bin/bash
# video/.verify-film.sh <video.mp4> <frames-out-dir>
# 1) silencedetect: any silence ≥2.5s at -40dB is a pacing bug (scene overran
#    its narration) — the accepted quality bar is ZERO such gaps.
# 2) dumps one frame every 25s for eyeball verification of cursor/screen sync.
set -euo pipefail
V="$1"; OUT="${2:-/tmp/film-frames}"
mkdir -p "$OUT"

echo "── duration/props ──"
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact "$V"

echo "── silencedetect (-40dB, ≥2.5s) ──"
SIL=$(ffmpeg -hide_banner -nostats -i "$V" -af silencedetect=noise=-40dB:d=2.5 -f null - 2>&1 | grep -c "silence_start" || true)
ffmpeg -hide_banner -nostats -i "$V" -af silencedetect=noise=-40dB:d=2.5 -f null - 2>&1 | grep "silence_" | head -20 || true
echo "silence gaps: $SIL"

echo "── frames every 25s → $OUT ──"
rm -f "$OUT"/frame-*.jpg
ffmpeg -hide_banner -loglevel error -i "$V" -vf "fps=1/25,scale=960:-1" -q:v 3 "$OUT/frame-%03d.jpg"
ls "$OUT" | wc -l
