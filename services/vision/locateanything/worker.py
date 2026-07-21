#!/usr/bin/env python3
"""Local, evaluation-only HTTP wrapper around NVIDIA LocateAnything-3B.

Install NVIDIA's official Eagle/Embodied package first. This wrapper does not
vendor or redistribute the model or its weights. The public checkpoint is
non-commercial and must not be used by the LeadShelf production runtime.
"""

from __future__ import annotations

import base64
import hmac
import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_REQUEST_BYTES = 30 * 1024 * 1024
BOX_PATTERN = re.compile(r"<box><(\d+)><(\d+)><(\d+)><(\d+)></box>")
REF_PATTERN = re.compile(r"<ref>(.*?)</ref>", re.DOTALL)


def env_true(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true"}


def parse_boxes(answer: str) -> list[dict[str, object]]:
    boxes: list[dict[str, object]] = []
    for index, match in enumerate(BOX_PATTERN.finditer(answer)):
        x1, y1, x2, y2 = (int(value) for value in match.groups())
        prefix = answer[: match.start()]
        refs = list(REF_PATTERN.finditer(prefix))
        label = refs[-1].group(1).strip() if refs else ""
        boxes.append({
            "id": f"locateanything-{index + 1}",
            "label": label,
            "confidence": None,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
        })
    return boxes


def decode_image(data_url: str):
    from PIL import Image

    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)", data_url)
    if not match:
        raise ValueError("inline_image_required")
    raw = base64.b64decode(match.group(2), validate=True)
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("image_too_large")
    image = Image.open(io.BytesIO(raw))
    image.load()
    return image.convert("RGB")


class LocateAnythingService:
    def __init__(self) -> None:
        from locateanything_worker import LocateAnythingWorker

        self.model = os.environ.get("LOCATEANYTHING_MODEL", "nvidia/LocateAnything-3B")
        self.worker = LocateAnythingWorker(self.model)
        # A single model instance is not assumed to be thread-safe, and
        # concurrent generations can unexpectedly exhaust GPU memory.
        self.inference_lock = threading.Lock()

    def localize(self, payload: dict[str, object]) -> dict[str, object]:
        if payload.get("evaluationOnly") is not True:
            raise ValueError("evaluation_only_ack_required")
        if payload.get("model") != self.model:
            raise ValueError("model_mismatch")
        categories = payload.get("categories")
        if not isinstance(categories, list) or not categories or not all(isinstance(v, str) for v in categories):
            raise ValueError("categories_required")
        mode = payload.get("generationMode", "hybrid")
        if mode not in {"fast", "hybrid", "slow"}:
            raise ValueError("invalid_generation_mode")
        image = decode_image(str(payload.get("imageDataUrl", "")))
        with self.inference_lock:
            result = self.worker.detect(image, categories, generation_mode=mode)
        answer = result.get("answer", "") if isinstance(result, dict) else ""
        return {
            "evaluationOnly": True,
            "model": self.model,
            "boxes": parse_boxes(str(answer)),
        }


SERVICE: LocateAnythingService | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "LeadShelfLocateAnythingEval/1"

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        token = os.environ.get("LOCATEANYTHING_WORKER_TOKEN", "").strip()
        supplied = self.headers.get("Authorization", "")
        return not token or hmac.compare_digest(supplied, f"Bearer {token}")

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {"ok": True, "evaluationOnly": True, "modelLoaded": SERVICE is not None})

    def do_POST(self) -> None:
        if self.path != "/v1/localize":
            self.send_json(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        try:
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise ValueError("application_json_required")
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("invalid_request_size")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("object_required")
            assert SERVICE is not None
            self.send_json(200, SERVICE.localize(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception:
            self.send_json(500, {"error": "inference_failed"})

    def log_message(self, fmt: str, *args: object) -> None:
        print(json.dumps({"event": "locateanything_http", "message": fmt % args}))


def main() -> None:
    global SERVICE
    if not env_true("LOCATEANYTHING_NONCOMMERCIAL_EVALUATION_ONLY"):
        raise SystemExit("LOCATEANYTHING_NONCOMMERCIAL_EVALUATION_ONLY=1 is required")
    host = os.environ.get("LOCATEANYTHING_WORKER_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost", "::1"} and not env_true("LOCATEANYTHING_ALLOW_REMOTE"):
        raise SystemExit("remote bind requires LOCATEANYTHING_ALLOW_REMOTE=1 and network TLS/auth")
    SERVICE = LocateAnythingService()
    port = int(os.environ.get("LOCATEANYTHING_WORKER_PORT", "8091"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
