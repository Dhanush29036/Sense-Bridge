"""
Environment Classifier — Smart Context Detection
=================================================
Classifies the user's surroundings using signals already available
from the AI modules — no additional sensors required.

Detects:
  1. Indoor  vs Outdoor  (based on object distribution heuristics)
  2. Crowd density (low / medium / high) from person count
  3. Noise level category (quiet / normal / loud) from mic RMS
  4. Dynamic TTS volume adjustment
"""

from __future__ import annotations
import math
import statistics
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class EnvironmentType(str, Enum):
    INDOOR   = "indoor"
    OUTDOOR  = "outdoor"
    UNKNOWN  = "unknown"


class CrowdDensity(str, Enum):
    EMPTY    = "empty"      # 0 persons
    SPARSE   = "sparse"     # 1–3
    MODERATE = "moderate"   # 4–8
    DENSE    = "dense"      # 9+


class NoiseLevel(str, Enum):
    QUIET  = "quiet"    # RMS < 0.02
    NORMAL = "normal"   # 0.02–0.10
    LOUD   = "loud"     # > 0.10


# Objects that strongly indicate INDOORS
INDOOR_OBJECTS  = {"chair", "desk", "sofa", "bed", "laptop", "refrigerator",
                   "door", "staircase", "microwave", "toilet", "sink"}

# Objects that strongly indicate OUTDOORS
OUTDOOR_OBJECTS = {"car", "truck", "bus", "motorcycle", "bicycle", "crosswalk",
                   "person", "traffic light", "fire hydrant"}


@dataclass
class EnvironmentContext:
    env_type:     EnvironmentType
    crowd:        CrowdDensity
    noise:        NoiseLevel
    person_count: int
    tts_volume:   float     # 0.0–1.0 adjusted for noise
    indoor_score: float     # 0–1
    outdoor_score: float    # 0–1

    def to_dict(self) -> dict:
        return {
            "env_type":     self.env_type.value,
            "crowd":        self.crowd.value,
            "noise":        self.noise.value,
            "person_count": self.person_count,
            "tts_volume":   round(self.tts_volume, 2),
        }


class EnvironmentClassifier:
    """
    Real-time classifier consuming YOLO objects and mic RMS.

    Usage:
        clf = EnvironmentClassifier()

        # Each fusion cycle:
        labels  = ["car", "person", "person", "traffic light"]
        mic_rms = 0.05
        ctx = clf.classify(labels, mic_rms)

        print(ctx.env_type)    # "outdoor"
        print(ctx.crowd)       # "sparse"
        print(ctx.tts_volume)  # 0.85
    """

    def __init__(self, ema_alpha: float = 0.3):
        """EMA smoothing over consecutive frames to avoid flickering."""
        self._alpha = ema_alpha
        self._indoor_ema  = 0.5
        self._outdoor_ema = 0.5

    def classify(
        self,
        detected_labels: list[str],
        mic_rms: Optional[float] = None,
    ) -> EnvironmentContext:
        """
        Classify the current environment from object detections and mic level.

        Args:
            detected_labels: List of label strings from YOLO (may include duplicates).
            mic_rms:         RMS amplitude from mic (0.0–1.0). None = unknown.

        Returns:
            EnvironmentContext with all derived signals.
        """
        label_set = set(l.lower() for l in detected_labels)

        # ── Indoor / Outdoor scoring ──────────────────────────────────────────
        n_indoor  = len(label_set & INDOOR_OBJECTS)
        n_outdoor = len(label_set & OUTDOOR_OBJECTS)
        total     = max(n_indoor + n_outdoor, 1)

        raw_indoor  = n_indoor  / total
        raw_outdoor = n_outdoor / total

        # Apply EMA for temporal smoothing
        self._indoor_ema  = (1 - self._alpha) * self._indoor_ema  + self._alpha * raw_indoor
        self._outdoor_ema = (1 - self._alpha) * self._outdoor_ema + self._alpha * raw_outdoor

        if self._indoor_ema > 0.6:
            env_type = EnvironmentType.INDOOR
        elif self._outdoor_ema > 0.6:
            env_type = EnvironmentType.OUTDOOR
        else:
            env_type = EnvironmentType.UNKNOWN

        # ── Crowd density ─────────────────────────────────────────────────────
        person_count = sum(1 for l in detected_labels if l.lower() == "person")
        crowd = self._crowd_level(person_count)

        # ── Noise level + TTS volume ──────────────────────────────────────────
        noise    = self._noise_level(mic_rms)
        tts_vol  = self._adjust_tts_volume(noise)

        return EnvironmentContext(
            env_type=env_type,
            crowd=crowd,
            noise=noise,
            person_count=person_count,
            tts_volume=tts_vol,
            indoor_score=round(self._indoor_ema, 3),
            outdoor_score=round(self._outdoor_ema, 3),
        )

    @staticmethod
    def _crowd_level(n: int) -> CrowdDensity:
        if n == 0:   return CrowdDensity.EMPTY
        if n <= 3:   return CrowdDensity.SPARSE
        if n <= 8:   return CrowdDensity.MODERATE
        return CrowdDensity.DENSE

    @staticmethod
    def _noise_level(rms: Optional[float]) -> NoiseLevel:
        if rms is None or rms < 0:
            return NoiseLevel.NORMAL
        if rms < 0.02:  return NoiseLevel.QUIET
        if rms < 0.10:  return NoiseLevel.NORMAL
        return NoiseLevel.LOUD

    @staticmethod
    def _adjust_tts_volume(noise: NoiseLevel) -> float:
        """Raise TTS volume in noisy environments so alerts remain audible."""
        return {
            NoiseLevel.QUIET:  0.70,
            NoiseLevel.NORMAL: 0.85,
            NoiseLevel.LOUD:   1.00,
        }[noise]
