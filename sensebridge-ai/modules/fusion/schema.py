"""
Fusion Engine Input / Output Schemas
=====================================
Defines the canonical data contract between AI modules and the FusionEngine.
Uses Python dataclasses (no external deps) for zero-overhead serialization.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum
import time


# ─── Enums ────────────────────────────────────────────────────────────────────

class UserMode(str, Enum):
    BLIND  = "blind"
    DEAF   = "deaf"
    MUTE   = "mute"
    MIXED  = "mixed"    # all modules active


class AlertPriority(str, Enum):
    CRITICAL = "CRITICAL"   # immediate danger, must fire
    HIGH     = "HIGH"       # significant hazard
    MEDIUM   = "MEDIUM"     # informational, useful
    LOW      = "LOW"        # background context
    IGNORE   = "IGNORE"     # suppressed by cooldown / filter


class OutputMode(str, Enum):
    VOICE      = "voice"       # TTS
    CAPTION    = "caption"     # visual text display
    VIBRATION  = "vibration"   # haptic only
    VOICE_VIB  = "voice+vib"   # TTS + haptic combined
    SILENT     = "silent"      # logged only


# ─── Input sub-objects ────────────────────────────────────────────────────────

@dataclass
class DetectedObject:
    """Single object detection result from YOLO."""
    label:      str
    confidence: float            # 0.0 – 1.0
    distance_m: Optional[float]  # None if estimation unavailable
    severity:   Optional[str]    # "close" | "medium" | "far"
    tracker_id: Optional[int] = None
    bbox:       Optional[list] = None


@dataclass
class FusionInput:
    """
    The canonical input contract to the FusionEngine.
    All fields are optional — the engine will only use what is present.

    Example:
        FusionInput(
            objects=[DetectedObject("car", 0.92, 1.2, "close")],
            ocr_text="Hospital Entrance",
            speech_text="Please move left",
            gesture_text="Need water",
            user_mode=UserMode.BLIND,
        )
    """
    objects:      list[DetectedObject] = field(default_factory=list)
    ocr_text:     Optional[str] = None    # from OCR module
    speech_text:  Optional[str] = None   # from Whisper STT
    gesture_text: Optional[str] = None   # from gesture recognizer
    user_mode:    UserMode = UserMode.BLIND
    timestamp:    float = field(default_factory=time.monotonic)
    frame_id:     Optional[int] = None

    @classmethod
    def from_dict(cls, d: dict) -> "FusionInput":
        """Build from a JSON-decoded dict (e.g., from Flask request.json)."""
        objs = [
            DetectedObject(
                label=o["label"],
                confidence=o.get("confidence", 1.0),
                distance_m=o.get("distance_m") or o.get("distance"),
                severity=o.get("severity"),
                tracker_id=o.get("tracker_id"),
                bbox=o.get("bbox"),
            )
            for o in d.get("objects", [])
        ]
        return cls(
            objects=objs,
            ocr_text=d.get("text") or d.get("ocr_text"),
            speech_text=d.get("speech_text"),
            gesture_text=d.get("gesture_text"),
            user_mode=UserMode(d.get("user_mode", "blind")),
            frame_id=d.get("frame_id"),
        )


# ─── Output ───────────────────────────────────────────────────────────────────

@dataclass
class FusionOutput:
    """
    The final, actionable decision from the FusionEngine.

    Consumed by:
      - Flask route → JSON response to frontend
      - AlertManager → TTS + vibration
    """
    final_alert:       str                    # Human-readable alert text
    priority:          AlertPriority
    output_mode:       OutputMode
    vibration_pattern: Optional[str]          # e.g. "short-long-short"
    source:            str                    # "object" | "ocr" | "speech" | "gesture"
    confidence:        float                  # winning signal confidence
    latency_ms:        float = 0.0
    suppressed:        bool  = False          # True if cooldown blocked it
    debug:             dict  = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "final_alert":       self.final_alert,
            "priority":          self.priority.value,
            "output_mode":       self.output_mode.value,
            "vibration_pattern": self.vibration_pattern,
            "source":            self.source,
            "confidence":        round(self.confidence, 3),
            "latency_ms":        round(self.latency_ms, 2),
            "suppressed":        self.suppressed,
        }

    @staticmethod
    def silent(reason: str = "no alert") -> "FusionOutput":
        return FusionOutput(
            final_alert="",
            priority=AlertPriority.IGNORE,
            output_mode=OutputMode.SILENT,
            vibration_pattern=None,
            source="none",
            confidence=0.0,
            suppressed=True,
            debug={"reason": reason},
        )
