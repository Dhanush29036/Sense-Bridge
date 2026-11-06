"""
API Route — Object Detection
Upgraded to include ModalityOutput format and performance monitoring.
"""

import base64
import numpy as np
import cv2
from flask import Blueprint, request, jsonify

detection_bp = Blueprint("detection", __name__)

# ─── Lazy-load (only instantiated on first request) ────────────────────────

_detector           = None
_distance_estimator = None
_tracker            = None


def _get_detector():
    global _detector, _distance_estimator, _tracker
    if _detector is None:
        from modules.object_detection.detect            import ObjectDetector
        from modules.object_detection.distance_estimator import DistanceEstimator
        from modules.object_detection.tracker           import ObjectTracker
        _detector           = ObjectDetector()
        _distance_estimator = DistanceEstimator()
        _tracker            = ObjectTracker(alert_cooldown_s=5.0)
    return _detector, _distance_estimator, _tracker


def _decode_frame(req) -> np.ndarray | None:
    """
    Accept frame from:
      1. multipart/form-data file upload (file='frame', 'file', or 'image')
      2. JSON body with base64 image (field: 'image', 'frame', or 'image_data')
         Supports standard base64 and data URLs (data:image/...;base64,...).
    """
    for file_key in ("frame", "file", "image"):
        if file_key in req.files:
            arr = np.frombuffer(req.files[file_key].read(), np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)

    data = req.get_json(silent=True) or {}
    b64 = data.get("image") or data.get("frame") or data.get("image_data") or ""
    if b64:
        if "," in b64 and "base64" in b64:
            b64 = b64.split(",", 1)[1]
        try:
            arr = np.frombuffer(base64.b64decode(b64), np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            return None
    return None


@detection_bp.post("/detect")
def detect():
    """
    Object detection endpoint.

    Request (multipart OR JSON):
        file: frame  OR  body: { image: "<base64>" }

    Response includes both the existing 'detections' array AND the new
    'modality_output' dict following the common ModalityOutput contract.
    confidence in modality_output is the ACTUAL YOLO/COCO-SSD score.
    """
    frame = _decode_frame(request)
    if frame is None:
        return jsonify({"success": False, "message": "No frame provided (multipart 'frame' or JSON 'image')"}), 400

    try:
        detector, dist_est, tracker = _get_detector()
    except Exception as e:
        return jsonify({"success": False, "message": f"Model loading failed: {e}"}), 503

    try:
        raw_dets, latency_ms = detector.detect(frame)
    except Exception as e:
        return jsonify({"success": False, "message": f"Inference failed: {e}"}), 500

    # Distance estimation (best-effort)
    try:
        dets_with_dist = dist_est.bulk_estimate([
            {"label": d.label, "bbox": d.bbox} for d in raw_dets
        ])
        dist_map = {(r.label, r.bbox): r for r in dets_with_dist}
    except Exception:
        dist_map = {}

    # Tracking + cooldown (best-effort)
    try:
        tracked = tracker.update(raw_dets, frame)
    except Exception:
        tracked = raw_dets

    # Build response
    output = []
    for td in tracked:
        dist_r = dist_map.get((td.label, td.bbox))
        output.append({
            "label":        td.label,
            "confidence":   round(td.confidence, 3),
            "bbox":         list(td.bbox),
            "distance_m":   dist_r.distance_m if dist_r else None,
            "severity":     dist_r.severity   if dist_r else None,
            "tracker_id":   getattr(td, "tracker_id", None),
            "is_new_alert": getattr(td, "is_new_alert", False),
        })

    # ─── ModalityOutput: top detection as primary prediction ─────────────
    # confidence = ACTUAL model score from YOLO/COCO-SSD (never fabricated)
    top = max(output, key=lambda d: d["confidence"]) if output else None
    modality_out = None
    if top:
        from modules.modality_output import ModalityOutput
        modality_out = ModalityOutput.from_vision(
            label=top["label"],
            confidence=top["confidence"],
            latency_ms=latency_ms,
            metadata={"detections": output, "count": len(output)},
        ).to_dict()

    # ─── Record in performance monitor (actual measured values) ──────────
    from modules.performance_monitor import get_monitor
    get_monitor().record_inference(
        modality="vision",
        prediction=top["label"] if top else "none",
        confidence=top["confidence"] if top else None,
        latency_ms=latency_ms,
        success=True,
    )

    return jsonify({
        "success":         True,
        "latency_ms":      round(latency_ms, 2),
        "detections":      output,
        "modality_output": modality_out,
    })
