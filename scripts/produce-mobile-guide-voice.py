#!/usr/bin/env python3
"""Generate Azerbaijani scene narration for the mobile execution guide.

This is the mobile-recording adapter for the existing help-video pipeline:
Gemini 2.5 Flash Preview TTS, Kore voice, 24 kHz mono PCM converted to MP3.
It never prints API keys and it has no local TTS fallback.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
SCENARIO = ROOT / "video/scenarios/mobile-execution.az.json"
OUTPUT_DIR = ROOT / "video/.tmp-guides/mobile-execution.az"
ENV_FILES = (ROOT / "apps/web/.env.local", Path("/tmp/leadshelf-gemini.env"))
MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
VOICE = os.environ.get("GEMINI_TTS_VOICE", "Kore")


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        values.setdefault(name.strip(), value)
    return values


def gemini_keys() -> list[str]:
    env: dict[str, str] = dict(os.environ)
    for path in ENV_FILES:
        for name, value in read_env_file(path).items():
            env.setdefault(name, value)
    raw: list[str] = []
    for base in ("GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENAI_API_KEY"):
        for suffix in ("", "2", "3", "4", "5", "_2", "_3", "_4", "_5"):
            value = env.get(base + suffix, "")
            raw.extend(part.strip() for part in value.split(",") if part.strip())
    return list(dict.fromkeys(raw))


def request_audio(text: str, keys: list[str], start_index: int) -> tuple[bytes, int]:
    body = json.dumps({
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}
            },
        },
    }).encode("utf-8")
    last_error = "unknown error"
    for attempt in range(max(6, len(keys) * 6)):
        index = (start_index + attempt) % len(keys)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={keys[index]}"
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            last_error = f"HTTP {error.code}: {detail[:240]}"
            if error.code == 429:
                time.sleep(2 if len(keys) > 1 else 30)
                continue
            if error.code >= 500:
                time.sleep(3)
                continue
            raise RuntimeError(last_error) from error
        except urllib.error.URLError as error:
            last_error = str(error.reason)
            time.sleep(3)
            continue

        for candidate in payload.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                encoded = part.get("inlineData", {}).get("data")
                if encoded:
                    return base64.b64decode(encoded), index
        last_error = "Gemini returned no audio data"
        time.sleep(2)
    raise RuntimeError(f"Gemini TTS failed after retries: {last_error}")


def convert_pcm(pcm: bytes, target: Path) -> None:
    pcm_path = target.with_suffix(target.suffix + ".pcm")
    pcm_path.write_bytes(pcm)
    try:
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", str(pcm_path),
            "-af", "apad=pad_dur=0.8", "-codec:a", "libmp3lame", "-q:a", "3",
            str(target),
        ], check=True)
    finally:
        pcm_path.unlink(missing_ok=True)


def main() -> None:
    keys = gemini_keys()
    if not keys:
        raise SystemExit("GEMINI_API_KEY is required; no local TTS fallback is allowed")
    scenario = json.loads(SCENARIO.read_text(encoding="utf-8"))
    if scenario.get("language") != "az" or scenario.get("voice") != "Kore":
        raise SystemExit("mobile scenario must be Azerbaijani with the Kore voice")
    scenes = scenario.get("scenes", [])
    if not scenes:
        raise SystemExit("mobile scenario has no scenes")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    force = os.environ.get("FORCE") == "1"
    key_index = 0
    print(f"Generating {len(scenes)} AZ scenes with {MODEL}, voice={VOICE}, keys={len(keys)}")
    for number, scene in enumerate(scenes, start=1):
        target = OUTPUT_DIR / f"scene-{number:02d}.mp3"
        if target.is_file() and target.stat().st_size > 1024 and not force:
            print(f"  reuse {target.name}")
            continue
        print(f"  synthesize {number}/{len(scenes)} {scene['id']}")
        pcm, key_index = request_audio(scene["voice"], keys, key_index)
        convert_pcm(pcm, target)
        time.sleep(1)
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
