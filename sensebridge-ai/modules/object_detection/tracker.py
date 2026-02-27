"""
Module 1E — Object Tracker (ByteTracker via supervision)
===========================================================
Wraps ByteTracker to assign persistent IDs across frames.
Prevents repeat alerts for the same tracked object.

Usage:
    tracker = ObjectTracker(alert_cooldown_s=5)
    dets, new_alerts = tracker.update(detections, frame_id)
"""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

try:
    import supervision as sv
    _HAS_SUPERVISION = True
except ImportError:
    _HAS_SUPERVISION = False


@dataclass
class TrackedDetection:
    """Detection enriched with a persistent tracker ID."""
    tracker_id: int
    label:      str
    confidence: float
    bbox:       tuple
    distance_m: Optional[float] = None
    severity:   Optional[str]   = None
    is_new_alert: bool = False   # True if this object should trigger a fresh alert


class ObjectTracker:
    """
    Wraps supervision ByteTracker + maintains a cooldown registry
    so the alert manager won't fire the same object repeatedly.

    Args:
        alert_cooldown_s: Minimum seconds before re-alerting the same tracker_id.
        conf_threshold:   Minimum confidence to accept a detection.
    """

    def __init__(self, alert_cooldown_s: float = 5.0, conf_threshold: float = 0.45):
        self.cooldown = alert_cooldown_s
        self.conf_threshold = conf_threshold
        # tracker_id → last alert timestamp
        self._last_alert: dict[int, float] = {}

        if _HAS_SUPERVISION:
            self._tracker = sv.ByteTracker(
                track_activation_threshold=conf_threshold,
                lost_track_buffer=30,
                minimum_matching_threshold=0.8,
                frame_rate=15,
            )
        else:
            self._tracker = None
            print("[WARN] supervision not installed — tracking disabled, IDs will be ephemeral.")

    def update(
        self,
        detections: list,       # list[Detection] from detect.py
        frame: np.ndarray,
    ) -> list[TrackedDetection]:
        """
        Update tracker with new frame detections.

        Returns:
            List of TrackedDetection with tracker IDs and is_new_alert flag.
        """
        if not detections:
            return []

        if self._tracker is None:
            # Fallback: no tracking, every frame is a "new" detection
            return self._no_tracking_fallback(detections)

        # Build supervision Detections format
        boxes = np.array([d.bbox for d in detections], dtype=np.float32)  # xyxy
        confs = np.array([d.confidence for d in detections], dtype=np.float32)
        classes = np.array([d.class_id for d in detections], dtype=int)

        sv_dets = sv.Detections(
            xyxy=boxes,
            confidence=confs,
            class_id=classes,
        )
        tracked = self._tracker.update_with_detections(sv_dets)

        results: list[TrackedDetection] = []
        for i, (xyxy, conf, cls_id, track_id) in enumerate(zip(
            tracked.xyxy, tracked.confidence, tracked.class_id, tracked.tracker_id
        )):
            if track_id is None:
                continue
            label = detections[0].label if i >= len(detections) else detections[i].label
            td = TrackedDetection(
                tracker_id=int(track_id),
                label=label,
                confidence=float(conf),
                bbox=tuple(xyxy.tolist()),
            )
            td.is_new_alert = self._check_and_set_cooldown(int(track_id))
            results.append(td)
        return results

    def _check_and_set_cooldown(self, tracker_id: int) -> bool:
        """Return True and update timestamp if cooldown has expired."""
        now = time.monotonic()
        last = self._last_alert.get(tracker_id, 0.0)
        if now - last >= self.cooldown:
            self._last_alert[tracker_id] = now
            return True
        return False

    def _no_tracking_fallback(self, detections: list) -> list[TrackedDetection]:
        """When supervision is unavailable, assign ephemeral IDs."""
        results = []
        for i, d in enumerate(detections):
            results.append(TrackedDetection(
                tracker_id=i,
                label=d.label,
                confidence=d.confidence,
                bbox=d.bbox,
                is_new_alert=True,  # always alert in fallback mode
            ))
        return results

    def clear_stale(self, max_age_s: float = 60.0) -> None:
        """Prune old entries from the cooldown registry."""
        now = time.monotonic()
        self._last_alert = {
            tid: ts for tid, ts in self._last_alert.items()
            if now - ts < max_age_s
        }
