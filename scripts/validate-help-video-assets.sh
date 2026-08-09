#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "[help-video-assets] $*" >&2; exit 1; }

(( $# == 1 )) || fail "usage: $0 ASSET_DIRECTORY"
asset_dir="$1"
[[ -d "$asset_dir" && ! -L "$asset_dir" ]] || fail "asset directory is missing or unsafe"

for command_name in ffprobe find grep sha256sum sort stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

mapfile -t media_files < <(
  find "$asset_dir" -maxdepth 1 -type f ! -name '.*' ! -name SHA256SUMS -printf '%f\n' | sort
)
((${#media_files[@]} > 0)) || fail "no Azerbaijani help-video assets found"

declare -A video_by_slug=()
declare -A poster_by_slug=()
for file in "${media_files[@]}"; do
  if [[ "$file" =~ ^([a-z0-9-]+)\.az\.VOICE\.mp4$ ]]; then
    video_by_slug["${BASH_REMATCH[1]}"]="$file"
  elif [[ "$file" =~ ^([a-z0-9-]+)\.az\.poster\.jpg$ ]]; then
    poster_by_slug["${BASH_REMATCH[1]}"]="$file"
  else
    fail "unsupported asset (Azerbaijani-only package): $file"
  fi
done

mapfile -t slugs < <(printf '%s\n' "${!video_by_slug[@]}" "${!poster_by_slug[@]}" | sort -u)
for slug in "${slugs[@]}"; do
  video_name="${video_by_slug[$slug]:-}"
  poster_name="${poster_by_slug[$slug]:-}"
  [[ -n "$video_name" && -n "$poster_name" ]] || fail "incomplete media pair for $slug.az"

  video="$asset_dir/$video_name"
  poster="$asset_dir/$poster_name"
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
  sha256sum "${media_files[@]}" | sort
) > "$asset_dir/SHA256SUMS"

echo "[help-video-assets] PASS (${#slugs[@]} AZ guide(s))"
