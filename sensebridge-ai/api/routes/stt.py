"""API Route — Speech-to-Text (file transcription endpoint)
Upgraded to include ModalityOutput format and performance monitoring.
"""

import os
import tempfile
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
    Optional form field: 'reference' (ground truth text for WER calculation)

    Response includes both existing fields AND 'modality_output' following
    the common ModalityOutput contract.

    NOTE: confidence is Whisper's avg_logprob mapped to [0,1].
    This is a rough approximation documented in whisper_engine.py.
    It is NOT a true calibrated probability.
    """
    if "audio" not in request.files:
        return jsonify({"success": False, "message": "No 'audio' file provided"}), 400

    audio_bytes = request.files["audio"].read()
    ext = request.files["audio"].filename.rsplit(".", 1)[-1].lower()
    allowed = {"wav", "mp3", "flac", "m4a", "ogg"}
    if ext not in allowed:
        return jsonify({"success": False, "message": f"Unsupported format: {ext}. Use {allowed}"}), 415

    # Save to temp file (Whisper requires file path or numpy array)
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    result = None
    try:
        engine = _get_whisper()
        result = engine.transcribe_file(tmp_path)
    except Exception as e:
        return jsonify({"success": False, "message": f"Transcription failed: {e}"}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if result is None:
        return jsonify({"success": False, "message": "Silence detected or transcription failed"}), 200

    # Optional WER if reference provided (uses actual jiwer computation)
    ref = request.form.get("reference", None)
    wer = None
    if ref:
        from modules.stt.whisper_engine import WhisperEngine
        wer = WhisperEngine.compute_wer(ref, result.text)

    # ─── ModalityOutput ───────────────────────────────────────────────────
    # confidence = Whisper avg_logprob → [0,1] mapping (approximation, documented)
    from modules.modality_output import ModalityOutput
    modality_out = ModalityOutput.from_speech(
        text=result.text,
        confidence=result.confidence,   # approximation; see whisper_engine.py
        latency_ms=result.latency_ms,
        metadata={
            "language":  result.language,
            "no_speech": result.no_speech,
            "wer":       wer,
            "confidence_note": "Whisper avg_logprob mapped to [0,1]; rough approximation",
        },
    ).to_dict()

    # ─── Record in performance monitor ────────────────────────────────────
    from modules.performance_monitor import get_monitor
    get_monitor().record_inference(
        modality="speech",
        prediction=result.text,
        confidence=result.confidence,
        latency_ms=result.latency_ms,
        success=True,
    )

    return jsonify({
        "success":         True,
        "text":            result.text,
        "language":        result.language,
        "confidence":      result.confidence,
        "latency_ms":      result.latency_ms,
        "no_speech":       result.no_speech,
        "wer":             wer,
        "modality_output": modality_out,
    })
