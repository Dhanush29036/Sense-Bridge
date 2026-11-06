"""API Route — Gesture Recognition
Upgraded to include ModalityOutput format and performance monitoring.
"""

import os
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

    Response includes both existing fields AND 'modality_output' following
    the common ModalityOutput contract.
    confidence is the ACTUAL softmax probability from the LSTM model.
    """
    data = request.get_json(silent=True)
    if not data or "sequence" not in data:
        return jsonify({"success": False, "message": "'sequence' field required (shape [30,63])"}), 400

    try:
        seq = np.array(data["sequence"], dtype=np.float32)
    except Exception:
        return jsonify({"success": False, "message": "Invalid sequence format"}), 400

    seq_len = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))
    if seq.shape != (seq_len, 63):
        return jsonify({
            "success": False,
            "message": f"Expected shape ({seq_len}, 63), got {list(seq.shape)}"
        }), 422

    try:
        recognizer = _get_recognizer()
        result = recognizer.predict_sequence(seq)
    except Exception as e:
        return jsonify({"success": False, "message": f"Gesture inference failed: {e}"}), 500

    if result is None:
        # Below confidence threshold — no gesture recognized
        from modules.performance_monitor import get_monitor
        get_monitor().record_inference(
            modality="gesture",
            prediction="none",
            confidence=None,
            latency_ms=0.0,
            success=False,
        )
        return jsonify({
            "success":         True,
            "gesture":         None,
            "confidence":      None,
            "latency_ms":      None,
            "modality_output": None,
            "message":         "No gesture recognized (confidence below threshold)",
        })

    # ─── ModalityOutput ───────────────────────────────────────────────────
    # confidence = ACTUAL softmax probability from LSTM/ONNX model
    from modules.modality_output import ModalityOutput
    modality_out = ModalityOutput.from_gesture(
        gesture=result.gesture,
        confidence=result.confidence,   # actual LSTM softmax output
        latency_ms=result.latency_ms,
        metadata={"gesture_label": result.gesture},
    ).to_dict()

    # ─── Record in performance monitor ────────────────────────────────────
    from modules.performance_monitor import get_monitor
    get_monitor().record_inference(
        modality="gesture",
        prediction=result.gesture,
        confidence=result.confidence,
        latency_ms=result.latency_ms,
        success=True,
    )

    return jsonify({
        "success":         True,
        "gesture":         result.gesture,
        "confidence":      result.confidence,
        "latency_ms":      result.latency_ms,
        "modality_output": modality_out,
    })
