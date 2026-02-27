"""Flask Route — POST /api/fuse"""

import time
from flask import Blueprint, request, jsonify
from modules.fusion.schema import FusionInput, UserMode
from modules.fusion.engine import FusionEngine

fusion_bp = Blueprint("fusion", __name__)

# Singleton engine (shared across requests — thread-safe)
_engine: FusionEngine | None = None


def _get_engine() -> FusionEngine:
    global _engine
    if _engine is None:
        _engine = FusionEngine(cooldown_s=5.0, speech_pause_s=3.0)
    return _engine


@fusion_bp.post("/fuse")
def fuse():
    """
    Multimodal Fusion endpoint.

    Request JSON:
    {
        "objects": [
            {"label": "car", "distance_m": 1.2, "confidence": 0.92, "severity": "close"}
        ],
        "text": "Hospital Entrance",
        "speech_text": "Please move left",
        "gesture_text": "thumbs_up",
        "user_mode": "blind"
    }

    Response:
    {
        "success": true,
        "final_alert": "Warning! Car at 1.2 meters",
        "priority": "CRITICAL",
        "output_mode": "voice+vib",
        "vibration_pattern": "long-long-long",
        "source": "object",
        "confidence": 0.92,
        "latency_ms": 1.4,
        "suppressed": false
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "JSON body required"}), 400

    try:
        fusion_input = FusionInput.from_dict(data)
    except Exception as e:
        return jsonify({"success": False, "message": f"Invalid input: {e}"}), 422

    engine = _get_engine()
    output = engine.process(fusion_input)

    return jsonify({"success": True, **output.to_dict()})


@fusion_bp.get("/fuse/history")
def history():
    """Return last 5 fired alerts from engine memory."""
    engine = _get_engine()
    return jsonify({"success": True, "alerts": engine.recent_alerts(n=5)})


@fusion_bp.post("/fuse/dismiss")
def dismiss():
    """
    Dismiss / suppress a label for N seconds.

    Body: { "label": "chair", "duration_s": 30 }
    """
    data = request.get_json(silent=True) or {}
    label    = data.get("label")
    duration = float(data.get("duration_s", 30))
    if not label:
        return jsonify({"success": False, "message": "'label' required"}), 400
    _get_engine().dismiss(label, duration)
    return jsonify({"success": True, "message": f"'{label}' suppressed for {duration}s"})


@fusion_bp.post("/fuse/reset")
def reset():
    """Reset all engine state (e.g., on user mode change)."""
    _get_engine().reset()
    return jsonify({"success": True, "message": "Fusion engine state reset"})
