"""API Route — Speech-to-Text (file transcription endpoint)"""

import io
import numpy as np
from flask import Blueprint, request, jsonify

stt_bp = Blueprint("stt", __name__)
_whisper_engine = None


def _get_whisper():
    global _whisper_engine
    if _whisper_engine is None:
        from modules.stt.whisper_engine import WhisperEngine
        _whisper_engine = WhisperEngine()
    return _whisper_engine


@stt_bp.post("/stt/transcribe")
def transcribe():
    """
    Transcribe an audio file (WAV 16kHz mono, up to 30s).

    Request: multipart 'audio' file (WAV/MP3/FLAC)
    Response:
    {
        "success": true,
        "text": "Hello world",
        "language": "en",
        "confidence": 0.87,
        "latency_ms": 820,
        "wer": null
    }
    """
    if "audio" not in request.files:
        return jsonify({"success": False, "message": "No 'audio' file provided"}), 400

    import tempfile, os
    audio_bytes = request.files["audio"].read()
    ext = request.files["audio"].filename.rsplit(".", 1)[-1].lower()
    allowed = {"wav", "mp3", "flac", "m4a", "ogg"}
    if ext not in allowed:
        return jsonify({"success": False, "message": f"Unsupported format: {ext}. Use {allowed}"}), 415

    # Save to temp file (Whisper requires file path or numpy array)
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        engine = _get_whisper()
        result = engine.transcribe_file(tmp_path)
    finally:
        os.unlink(tmp_path)

    if result is None:
        return jsonify({"success": False, "message": "Silence detected or transcription failed"}), 200

    # Optional WER if reference provided
    ref  = request.form.get("reference", None)
    wer  = None
    if ref:
        from modules.stt.whisper_engine import WhisperEngine
        wer = WhisperEngine.compute_wer(ref, result.text)

    return jsonify({
        "success":    True,
        "text":       result.text,
        "language":   result.language,
        "confidence": result.confidence,
        "latency_ms": result.latency_ms,
        "no_speech":  result.no_speech,
        "wer":        wer,
    })
