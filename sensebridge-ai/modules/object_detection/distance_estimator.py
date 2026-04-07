"""
Module 1B — Distance Estimator
================================
Estimates object distance from bounding box apparent size.
Uses a reference calibration table per class.

Formula: distance = (real_height * focal_length) / pixel_height
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Optional


# ─── Known average real-world heights (meters) ────────────────────────────────
#     Adjust these for your specific camera / use case.
REFERENCE_HEIGHTS_M = {
    # ─── Original SenseBridge classes ─────────────────────────────
    "person":        1.70,
    "car":           1.50,
    "motorcycle":    1.10,
    "bicycle":       1.10,
    "bus":           3.50,
    "truck":         3.00,
    "door":          2.10,
    "stairs":        0.20,
    "crosswalk":     0.10,
    "obstacle":      0.50,
    "signboard":     0.60,
    "currency_note": 0.066,
    # ─── COCO classes (common obstacles for blind users) ──────────
    "train":         4.00,
    "fire hydrant":  0.75,
    "stop sign":     0.75,
    "bench":         0.85,
    "dog":           0.50,
    "cat":           0.30,
    "horse":         1.60,
    "cow":           1.40,
    "elephant":      3.00,
    "bear":          1.50,
    "chair":         0.90,
    "couch":         0.85,
    "bed":           0.60,
    "dining table":  0.75,
    "toilet":        0.70,
    "bottle":        0.25,
    "cup":           0.12,
    "bowl":          0.10,
    "cell phone":    0.15,
    "laptop":        0.30,
    "tv":            0.60,
    "refrigerator":  1.80,
    "oven":          0.85,
    "microwave":     0.35,
    "sink":          0.40,
    "book":          0.25,
    "clock":         0.30,
    "backpack":      0.50,
    "umbrella":      1.00,
    "suitcase":      0.60,
    "traffic light": 1.00,
    "parking meter": 1.20,
}

# Focal length in pixels (calibrate with checkerboard or known object at known distance)
# Formula: focal_px = (pixel_height * known_distance) / real_height
# For a 640×480 frame with 70° FoV: focal_px ≈ 500
DEFAULT_FOCAL_PX = 500.0


@dataclass
class DistanceResult:
    label:    str
    distance_m: float
    severity: str   # "close" | "medium" | "far"
    bbox:     tuple


class DistanceEstimator:
    """
    Mono-camera distance estimation using reference object heights.

    Args:
        focal_px:    Camera focal length in pixels (calibrate first).
        frame_height: Camera frame height in pixels.
    """

    def __init__(self, focal_px: float = DEFAULT_FOCAL_PX, frame_height: int = 480):
        self.focal_px    = focal_px
        self.frame_height = frame_height

    def calibrate(self, label: str, known_distance_m: float, pixel_height: int) -> float:
        """
        Compute focal length from a known object at a known distance.
        Run once during setup. Returns focal_px to store.

        Example:
            estimator.calibrate("person", known_distance_m=2.0, pixel_height=350)
        """
        real_h = REFERENCE_HEIGHTS_M.get(label, 1.0)
        self.focal_px = (pixel_height * known_distance_m) / real_h
        return self.focal_px

    def estimate(self, label: str, bbox: tuple) -> Optional[DistanceResult]:
        """
        Estimate distance for a single detection.

        Args:
            label: Class name string.
            bbox:  Bounding box as (x1, y1, x2, y2) in pixels.

        Returns:
            DistanceResult with distance_m and severity, or None if unknown class.
        """
        real_h = REFERENCE_HEIGHTS_M.get(label)
        if real_h is None:
            return None

        x1, y1, x2, y2 = bbox
        pixel_h = max(y2 - y1, 1)  # avoid division by zero

        distance_m = (real_h * self.focal_px) / pixel_h
        distance_m = round(distance_m, 2)

        severity = self._severity(distance_m, label)
        return DistanceResult(label=label, distance_m=distance_m, severity=severity, bbox=bbox)

    @staticmethod
    def _severity(distance_m: float, label: str) -> str:
        """
        Classify distance into alert severity bands.
        Thresholds are tighter for fast-moving objects.
        """
        fast_moving = {"car", "motorcycle", "bus", "truck"}
        if label in fast_moving:
            if distance_m < 3:   return "close"
            if distance_m < 8:   return "medium"
            return "far"
        else:
            if distance_m < 1.5: return "close"
            if distance_m < 4:   return "medium"
            return "far"

    def bulk_estimate(self, detections: list[dict]) -> list[DistanceResult]:
        """
        Process a list of detection dicts from the detector.

        Args:
            detections: [{"label": str, "bbox": (x1,y1,x2,y2), ...}, ...]

        Returns:
            List of DistanceResult sorted closest-first.
        """
        results = []
        for det in detections:
            r = self.estimate(det["label"], tuple(det["bbox"]))
            if r:
                results.append(r)
        return sorted(results, key=lambda r: r.distance_m)
