#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[help-video-assets] $*" >&2; exit 1; }

(( $# == 1 )) || fail "usage: $0 ASSET_DIRECTORY"
asset_dir="$1"
[[ -d "$asset_dir" && ! -L "$asset_dir" ]] || fail "asset directory is missing or unsafe"

for command_name in ffprobe find grep sha256sum sort stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

expected=(
  overview.az.VOICE.mp4
  overview.az.poster.jpg
  overview.ru.VOICE.mp4
  overview.ru.poster.jpg
)

mapfile -t actual < <(find "$asset_dir" -maxdepth 1 -type f -printf '%f\n' | sort)
mapfile -t wanted < <(printf '%s\n' "${expected[@]}" | sort)
[[ "${actual[*]}" == "${wanted[*]}" ]] || {
  printf '[help-video-assets] expected exactly:\n%s\n' "$(printf '  %s\n' "${wanted[@]}")" >&2
  printf '[help-video-assets] found:\n%s\n' "$(printf '  %s\n' "${actual[@]:-<none>}")" >&2
  exit 1
}

for locale in az ru; do
  video="$asset_dir/overview.$locale.VOICE.mp4"
  poster="$asset_dir/overview.$locale.poster.jpg"
  [[ ! -L "$video" && ! -L "$poster" ]] || fail "symlink assets are forbidden"
  (( $(stat -c '%s' -- "$video") >= 1048576 )) || fail "$video is unexpectedly small"
  (( $(stat -c '%s' -- "$poster") >= 10240 )) || fail "$poster is unexpectedly small"

  video_format="$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$video")"
  [[ "$video_format" == *mp4* ]] || fail "$video is not an MP4 container"
  video_streams="$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "$video")"
  grep -qx video <<<"$video_streams" || fail "$video has no video stream"
  grep -qx audio <<<"$video_streams" || fail "$video has no voice/audio stream"

  poster_format="$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$poster")"
  [[ "$poster_format" == *image2* || "$poster_format" == *jpeg* ]] || fail "$poster is not a JPEG image"
  dimensions="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$poster")"
  [[ "$dimensions" =~ ^[1-9][0-9]*x[1-9][0-9]*$ ]] || fail "$poster has invalid dimensions"
done

(
  cd "$asset_dir"
  sha256sum "${expected[@]}" | sort
) > "$asset_dir/SHA256SUMS"

echo "[help-video-assets] PASS"
