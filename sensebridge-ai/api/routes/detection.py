"""
API Route — Object Detection + OCR combined
"""

import base64
import io
import numpy as np
import cv2
from flask import Blueprint, request, jsonify

detection_bp = Blueprint("detection", __name__)

# ─── Lazy-load (only instantiated on first request) ────────────────────────

_detector         = None
_distance_estimator = None
_tracker          = None
_alert_manager    = None


def _get_detector():
    global _detector, _distance_estimator, _tracker
    if _detector is None:
        from modules.object_detection.detect         import ObjectDetector
        from modules.object_detection.distance_estimator import DistanceEstimator
        from modules.object_detection.tracker        import ObjectTracker
        _detector          = ObjectDetector()
        _distance_estimator = DistanceEstimator()
        _tracker           = ObjectTracker(alert_cooldown_s=5.0)
    return _detector, _distance_estimator, _tracker


def _decode_frame(request_data) -> np.ndarray | None:
    """
    Accept frame from:
      1. multipart/form-data file upload (file='frame')
      2. JSON body with base64 image (field: 'image')
    """
    if "frame" in request.files:
        f = request.files["frame"].read()
        arr = np.frombuffer(f, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)

    data = request.get_json(silent=True) or {}
    b64  = data.get("image", "")
    if b64:
        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)

    return None


# ─── POST /api/detect ─────────────────────────────────────────────────────────

@detection_bp.post("/detect")
def detect():
    """
    Object detection endpoint.

    Request (multipart OR JSON):
        file: frame  OR  body: { image: "<base64>" }

    Response:
    {
        "success": true,
        "latency_ms": 42.3,
        "detections": [
            {
                "label": "person",
                "confidence": 0.91,
                "bbox": [120, 80, 300, 400],
                "distance_m": 2.5,
                "severity": "medium",
                "tracker_id": 7
            }
        ]
    }
    """
    frame = _decode_frame(request)
    if frame is None:
        return jsonify({"success": False, "message": "No frame provided (multipart 'frame' or JSON 'image')"}), 400

    detector, dist_est, tracker = _get_detector()

    # Inference
    raw_dets, latency_ms = detector.detect(frame)

    # Distance estimation
    dets_with_dist = dist_est.bulk_estimate([
        {"label": d.label, "bbox": d.bbox} for d in raw_dets
    ])

    # Tracking + cooldown
    tracked = tracker.update(raw_dets, frame)

    # Build response
    dist_map = {(r.label, r.bbox): r for r in dets_with_dist}
    output   = []
    for td in tracked:
        dist_r = dist_map.get((td.label, td.bbox))
        output.append({
            "label":      td.label,
            "confidence": round(td.confidence, 3),
            "bbox":       list(td.bbox),
            "distance_m": dist_r.distance_m if dist_r else None,
            "severity":   dist_r.severity   if dist_r else None,
            "tracker_id": td.tracker_id,
            "is_new_alert": td.is_new_alert,
        })

    return jsonify({
        "success":    True,
        "latency_ms": round(latency_ms, 2),
        "detections": output,
    })
