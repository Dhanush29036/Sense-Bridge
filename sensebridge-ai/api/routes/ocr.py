"""API Route — OCR
Upgraded to include ModalityOutput format and performance monitoring.
"""

import base64
import numpy as np
import cv2
from flask import Blueprint, request, jsonify

ocr_bp = Blueprint("ocr", __name__)
_ocr_engine = None


def _get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from modules.ocr.ocr_engine import OCREngine
        _ocr_engine = OCREngine()
    return _ocr_engine


def _decode_frame(req) -> np.ndarray | None:
    if "frame" in req.files:
        arr = np.frombuffer(req.files["frame"].read(), np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    data = req.get_json(silent=True) or {}
    b64  = data.get("image", "")
    if b64:
        arr = np.frombuffer(base64.b64decode(b64), np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return None


@ocr_bp.post("/ocr")
def read_text():
    """
    OCR endpoint.

    Request: multipart 'frame' or JSON { image, task }
    task: "signboard" | "currency" | "label" | "general"

    Response includes both the existing 'texts' array AND the new
    'modality_output' dict following the common ModalityOutput contract.
    confidence is the ACTUAL OCR engine confidence (EasyOCR/PaddleOCR).
    """
    frame = _decode_frame(request)
    if frame is None:
        return jsonify({"success": False, "message": "No frame provided"}), 400

    task = (request.get_json(silent=True) or {}).get("task", "general")

    try:
        engine = _get_ocr()
    except Exception as e:
        return jsonify({"success": False, "message": f"OCR engine load failed: {e}"}), 503

    try:
        results, latency_ms = engine.read(frame, task=task)
    except Exception as e:
        return jsonify({"success": False, "message": f"OCR inference failed: {e}"}), 500

    texts = [
        {"text": r.text, "confidence": round(r.confidence, 3), "category": r.category}
        for r in results
    ]

    # ─── ModalityOutput: best OCR result as primary prediction ────────────
    # confidence = ACTUAL EasyOCR/PaddleOCR confidence score
    top = results[0] if results else None
    modality_out = None
    if top:
        from modules.modality_output import ModalityOutput
        modality_out = ModalityOutput.from_ocr(
            text=top.text,
            confidence=top.confidence,    # actual OCR engine confidence
            latency_ms=latency_ms,
            metadata={"texts": texts, "count": len(texts), "category": top.category},
        ).to_dict()

    # ─── Record in performance monitor ────────────────────────────────────
    from modules.performance_monitor import get_monitor
    get_monitor().record_inference(
        modality="ocr",
        prediction=top.text if top else "",
        confidence=top.confidence if top else None,
        latency_ms=latency_ms,
        success=True,
    )

    return jsonify({
        "success":         True,
        "latency_ms":      round(latency_ms, 2),
        "texts":           texts,
        "modality_output": modality_out,
    })
