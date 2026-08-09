#!/usr/bin/env python3
"""Compose the recorded Android flow and AZ narration into a 1280x720 guide.

The timeline is reviewed after the real emulator run. Each source chapter is
retimed to its matching narration instead of letting actions run ahead of the
voice. A subtle progress rail keeps long mobile screens visually alive.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SCENARIO_PATH = ROOT / "video/scenarios/mobile-execution.az.json"
AUDIO_DIR = ROOT / "video/.tmp-guides/mobile-execution.az"
WORK_DIR = ROOT / "video/.tmp-guides/mobile-execution-compose"
DEFAULT_OUTPUT = ROOT / "video/player/mobile-execution.az.VOICE.mp4"


def duration(path: Path) -> float:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nk=1:nw=1", str(path),
    ], check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def escape_drawtext(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(":", "\\:")
            .replace("'", "\\'").replace("%", "\\%"))


def compose_scene(
    raw: Path,
    audio: Path,
    target: Path,
    source_start: float,
    source_end: float,
    number: int,
    title: str,
    replacement_image: Path | None = None,
    end_image: Path | None = None,
) -> None:
    source_duration = source_end - source_start
    audio_duration = duration(audio)
    if source_duration <= 0.2:
        raise ValueError(f"scene {number}: source interval is too short")
    ratio = audio_duration / source_duration
    title_text = escape_drawtext(title)
    if replacement_image is None:
        phone_filter = (
            f"[0:v]trim=start={source_start:.3f}:end={source_end:.3f},"
            f"setpts=(PTS-STARTPTS)*{ratio:.9f},"
            "scale=-2:680:force_original_aspect_ratio=decrease,format=yuv420p[phone];"
        )
    else:
        phone_filter = (
            "[2:v]scale=384:680:force_original_aspect_ratio=decrease,"
            "pad=384:680:(ow-iw)/2:(oh-ih)/2:color=0x071426,"
            "zoompan=z='1.025+0.012*sin(on/95)':"
            "x='iw/2-(iw/zoom/2)+4*sin(on/77)':"
            "y='ih/2-(ih/zoom/2)+4*cos(on/83)':"
            "d=1:s=384x680:fps=30,"
            "format=yuv420p[phone];"
        )
    filter_graph = phone_filter + (
        f"color=c=0x071426:s=1280x720:d={audio_duration:.3f}[base];"
        "[base]drawbox=x=18:y=18:w=1244:h=684:color=0x13243b:t=2,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        "text='LeadShelf':x=58:y=72:fontsize=34:fontcolor=white,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        "text='MOBİL İCRA BƏLƏDÇİSİ':x=58:y=118:fontsize=15:fontcolor=0x7dd3fc,"
        f"drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        f"text='{number:02d}':x=58:y=270:fontsize=76:fontcolor=0x2563eb,"
        f"drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        f"text='{title_text}':x=58:y=365:fontsize=24:fontcolor=white,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        "text='DEMO  •  M-001':x=1010:y=105:fontsize=18:fontcolor=0x93c5fd,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        "text='REAL MARŞRUT':x=1010:y=140:fontsize=14:fontcolor=0x94a3b8,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        "text='GPS CHECK-IN':x=1010:y=170:fontsize=14:fontcolor=0x94a3b8,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:"
        "text='FOTO SÜBUT':x=1010:y=200:fontsize=14:fontcolor=0x94a3b8[panel];"
        "[panel][phone]overlay=x=(W-w)/2:y=20:shortest=1,"
        "drawbox=x=980:y=630:w=240:h=48:color=0x0b2942:t=fill,"
        "drawbox=x=980:y=630:w=240:h=48:color=0x0ea5e9@0.82:t=fill:"
        "enable='lt(mod(t\\,1.6)\\,0.8)',"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        "text='CANLI İCRA  •  SİNXRON':x=997:y=644:fontsize=13:fontcolor=white[framed];"
        "[framed]"
        "drawbox=x=0:y=710:w=1280:h=10:color=0x1e293b:t=fill,"
        f"drawbox=x=0:y=710:w='1280*min(t/{audio_duration:.6f},1)':h=10:"
        "color=0x38bdf8:t=fill[composed]"
    )
    input_args = ["-i", str(raw), "-i", str(audio)]
    if replacement_image is not None:
        input_args.extend(["-loop", "1", "-i", str(replacement_image)])
    if end_image is not None:
        end_image_index = 3 if replacement_image is not None else 2
        reveal_at = max(audio_duration - 6.0, 0.0)
        input_args.extend(["-loop", "1", "-i", str(end_image)])
        filter_graph += (
            f";[{end_image_index}:v]scale=-2:680:force_original_aspect_ratio=decrease,"
            "format=yuv420p[ending];"
            f"[composed][ending]overlay=x=(W-w)/2:y=20:enable='gte(t\\,{reveal_at:.3f})'[outv]"
        )
    else:
        filter_graph += ";[composed]null[outv]"
    ffmpeg([
        *input_args,
        "-filter_complex", filter_graph,
        "-map", "[outv]", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-t", f"{audio_duration:.3f}", "-movflags", "+faststart", str(target),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw", type=Path, help="raw Maestro emulator recording")
    parser.add_argument("timeline", type=Path, help="reviewed JSON source intervals")
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="additional raw recording referenced by timeline items",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    scenario = json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))
    timeline = json.loads(args.timeline.read_text(encoding="utf-8"))
    scenes = scenario["scenes"]
    if len(timeline) != len(scenes):
        raise SystemExit(f"timeline has {len(timeline)} scenes; expected {len(scenes)}")
    sources = {"default": args.raw}
    for definition in args.source:
        name, separator, path = definition.partition("=")
        if not separator or not name or not path:
            raise SystemExit(f"invalid --source value: {definition!r}; expected NAME=PATH")
        sources[name] = Path(path)
    source_durations = {name: duration(path) for name, path in sources.items()}
    previous_source = "default"
    previous_end = 0.0
    for index, item in enumerate(timeline):
        if item.get("id") != scenes[index]["id"]:
            raise SystemExit(f"timeline scene {index + 1} id does not match scenario")
        source_name = str(item.get("source", "default"))
        if source_name not in sources:
            raise SystemExit(f"unknown timeline source: {source_name}")
        start = float(item["start"])
        end = float(item["end"])
        if source_name != previous_source:
            previous_source = source_name
            previous_end = 0.0
        if start < previous_end - 0.05 or end > source_durations[source_name] + 0.05 or end <= start:
            raise SystemExit(f"invalid timeline interval for {item['id']}: {start}..{end}")
        previous_end = end

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    chapters: list[Path] = []
    for index, (scene, item) in enumerate(zip(scenes, timeline, strict=True), start=1):
        audio = AUDIO_DIR / f"scene-{index:02d}.mp3"
        if not audio.is_file():
            raise SystemExit(f"missing narration: {audio}")
        chapter = WORK_DIR / f"chapter-{index:02d}.mp4"
        source_name = str(item.get("source", "default"))
        replacement_image = Path(item["replacement_image"]) if item.get("replacement_image") else None
        if replacement_image is not None and not replacement_image.is_file():
            raise SystemExit(f"missing replacement image: {replacement_image}")
        end_image = Path(item["end_image"]) if item.get("end_image") else None
        if end_image is not None and not end_image.is_file():
            raise SystemExit(f"missing ending image: {end_image}")
        compose_scene(
            sources[source_name], audio, chapter,
            float(item["start"]), float(item["end"]),
            index, str(item["title"]),
            replacement_image,
            end_image,
        )
        chapters.append(chapter)

    concat_file = WORK_DIR / "chapters.txt"
    concat_file.write_text("".join(f"file '{path}'\n" for path in chapters), encoding="utf-8")
    ffmpeg([
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c", "copy", "-movflags", "+faststart", str(args.output),
    ])
    poster = args.output.with_name("mobile-execution.az.poster.jpg")
    ffmpeg(["-ss", "2", "-i", str(args.output), "-frames:v", "1", "-q:v", "2", str(poster)])
    print(args.output)
    print(poster)


if __name__ == "__main__":
    main()
