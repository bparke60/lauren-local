"""Lauren local voice service.

Small HTTP server that turns text into speech with the Kokoro-82M model,
entirely on this Mac. The Node server proxies to it. If it is unavailable,
Lauren shows text without switching to a different voice.

Run: .venv/bin/python service.py   (the Node server starts it automatically)
"""

import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 4318
SAMPLE_RATE = 24000
MAX_TEXT_LENGTH = 2400

# Curated American-English female voices shipped with Kokoro, friendliest first.
VOICES = {
    "af_heart": "Heart — warm, natural default",
    "af_bella": "Bella — bright, energetic",
    "af_nova": "Nova — smooth, laid-back",
    "af_aoede": "Aoede — soft, easy",
    "af_kore": "Kore — clear, upbeat",
    "af_jessica": "Jessica — casual",
    "af_river": "River — mellow",
    "af_sarah": "Sarah — friendly",
    "af_sky": "Sky — light",
    "af_alloy": "Alloy — steady",
    "af_nicole": "Nicole — hushed, ASMR-like",
}
DEFAULT_VOICE = "af_heart"

_pipeline = None
_pipeline_lock = threading.Lock()
_load_error = None


def get_pipeline():
    global _pipeline, _load_error
    with _pipeline_lock:
        if _pipeline is None and _load_error is None:
            try:
                from kokoro import KPipeline

                _pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
            except Exception as error:  # noqa: BLE001
                _load_error = str(error)
        return _pipeline


def synthesize(text, voice, speed):
    import numpy as np
    import soundfile as sf

    pipeline = get_pipeline()
    if pipeline is None:
        raise RuntimeError(_load_error or "Voice model failed to load.")

    chunks = []
    for _, _, audio in pipeline(text, voice=voice, speed=speed):
        chunks.append(audio.numpy() if hasattr(audio, "numpy") else audio)
    if not chunks:
        raise RuntimeError("No audio generated.")

    buffer = io.BytesIO()
    sf.write(buffer, np.concatenate(chunks), SAMPLE_RATE, format="WAV")
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep stdout quiet
        pass

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {
                "ok": True,
                "modelLoaded": _pipeline is not None,
                "loadError": _load_error,
                "defaultVoice": DEFAULT_VOICE,
                "voices": [{"id": vid, "label": label} for vid, label in VOICES.items()],
            })
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        if self.path != "/speak":
            self.send_json(404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            text = str(body.get("text") or "").strip()[:MAX_TEXT_LENGTH]
            voice = body.get("voice") if body.get("voice") in VOICES else DEFAULT_VOICE
            speed = min(1.4, max(0.7, float(body.get("speed") or 1.0)))
            if not text:
                self.send_json(400, {"error": "Speech text is required."})
                return
            audio = synthesize(text, voice, speed)
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(audio)))
            self.send_header("x-voice", voice)
            self.end_headers()
            self.wfile.write(audio)
        except Exception as error:  # noqa: BLE001
            self.send_json(500, {"error": str(error)})


if __name__ == "__main__":
    # Warm the model in the background so the first real request is fast.
    threading.Thread(target=get_pipeline, daemon=True).start()
    print(f"Lauren voice service on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
