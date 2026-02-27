"""API Route — Gesture Recognition"""

import numpy as np
from flask import Blueprint, request, jsonify

gesture_bp = Blueprint("gesture", __name__)
_recognizer = None


def _get_recognizer():
    global _recognizer
    if _recognizer is None:
        from modules.gesture.gesture_recognizer import GestureRecognizer
        _recognizer = GestureRecognizer()
    return _recognizer


@gesture_bp.post("/gesture/predict")
def predict_gesture():
    """
    Classify a pre-extracted landmark sequence.
    The mobile app extracts MediaPipe landmarks on-device and sends the sequence.

    Request JSON:
    {
        "sequence": [[x,y,z, ...] × 63, ...] (30 frames × 63 values = shape [30,63])
    }

    Response:
    {
        "success": true,
        "gesture": "thumbs_up",
        "confidence": 0.94,
        "latency_ms": 12.3
    }
    """
    data = request.get_json(silent=True)
    if not data or "sequence" not in data:
        return jsonify({"success": False, "message": "'sequence' field required (shape [30,63])"}), 400

    try:
        seq = np.array(data["sequence"], dtype=np.float32)
    except Exception:
        return jsonify({"success": False, "message": "Invalid sequence format"}), 400

    import os
    seq_len = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))
    if seq.shape != (seq_len, 63):
        return jsonify({
            "success": False,
            "message": f"Expected shape ({seq_len}, 63), got {list(seq.shape)}"
        }), 422

    recognizer = _get_recognizer()
    result = recognizer.predict_sequence(seq)

    if result is None:
        return jsonify({
            "success":    True,
            "gesture":    None,
            "confidence": None,
            "latency_ms": None,
            "message":    "No gesture recognized (confidence below threshold)",
        })

    return jsonify({
        "success":    True,
        "gesture":    result.gesture,
        "confidence": result.confidence,
        "latency_ms": result.latency_ms,
    })
