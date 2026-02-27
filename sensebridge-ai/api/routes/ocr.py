"""API Route — OCR"""

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

    Response:
    {
        "success": true,
        "latency_ms": 210.4,
        "texts": [
            { "text": "STOP", "confidence": 0.98, "category": "signboard" }
        ]
    }
    """
    frame = _decode_frame(request)
    if frame is None:
        return jsonify({"success": False, "message": "No frame provided"}), 400

    task = (request.get_json(silent=True) or request.form).get("task", "general")
    engine = _get_ocr()
    results, latency_ms = engine.read(frame, task=task)

    return jsonify({
        "success":    True,
        "latency_ms": round(latency_ms, 2),
        "texts": [
            {
                "text":       r.text,
                "confidence": round(r.confidence, 3),
                "category":   r.category,
            }
            for r in results
        ],
    })
