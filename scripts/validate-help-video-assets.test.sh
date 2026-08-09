#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
validator="$repo_root/scripts/validate-help-video-assets.sh"
fixture_root="$(mktemp -d /tmp/leadshelf-help-video-test-XXXXXX)"
trap 'find "$fixture_root" -depth -delete' EXIT
mkdir -p "$fixture_root/bin" "$fixture_root/assets"

cat > "$fixture_root/bin/ffprobe" <<'FAKE_FFPROBE'
#!/usr/bin/env bash
set -Eeuo pipefail
args="$*"
file="${!#}"
case "$file:$args" in
  *VOICE.mp4:*format=format_name*) printf 'mov,mp4,m4a,3gp,3g2,mj2\n' ;;
  *VOICE.mp4:*stream=codec_type*)
    printf 'video\n'
    [[ "${FFPROBE_NO_AUDIO:-0}" == 1 ]] || printf 'audio\n'
    ;;
  *.poster.jpg:*format=format_name*) printf 'image2\n' ;;
  *.poster.jpg:*stream=width,height*) printf '1280x720\n' ;;
  *) exit 2 ;;
esac
FAKE_FFPROBE
chmod 755 "$fixture_root/bin/ffprobe"

truncate -s 2097152 "$fixture_root/assets/overview.az.VOICE.mp4"
truncate -s 20480 "$fixture_root/assets/overview.az.poster.jpg"

PATH="$fixture_root/bin:$PATH" "$validator" "$fixture_root/assets" >/dev/null
[[ -s "$fixture_root/assets/SHA256SUMS" ]] || { echo "checksum manifest was not created" >&2; exit 1; }
unlink "$fixture_root/assets/SHA256SUMS"

touch "$fixture_root/assets/unexpected.txt"
if PATH="$fixture_root/bin:$PATH" "$validator" "$fixture_root/assets" >/dev/null 2>&1; then
  echo "unexpected release asset was accepted" >&2
  exit 1
fi
unlink "$fixture_root/assets/unexpected.txt"

mv "$fixture_root/assets/overview.az.poster.jpg" "$fixture_root/assets/overview.ru.poster.jpg"
if PATH="$fixture_root/bin:$PATH" "$validator" "$fixture_root/assets" >/dev/null 2>&1; then
  echo "non-AZ or incomplete package was accepted" >&2
  exit 1
fi
mv "$fixture_root/assets/overview.ru.poster.jpg" "$fixture_root/assets/overview.az.poster.jpg"

if PATH="$fixture_root/bin:$PATH" FFPROBE_NO_AUDIO=1 "$validator" "$fixture_root/assets" >/dev/null 2>&1; then
  echo "voice video without an audio stream was accepted" >&2
  exit 1
fi

echo "[help-video-assets-test] PASS"
