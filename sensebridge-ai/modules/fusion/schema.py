"""
Fusion Engine Input / Output Schemas
=====================================
Defines the canonical data contract between AI modules and the FusionEngine.
Uses Python dataclasses (no external deps) for zero-overhead serialization.
Now supports standardized ModalityOutput representations across all sensory streams.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
from enum import Enum
import time

from modules.modality_output import ModalityOutput


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
    """Single object detection result from YOLO or vision model."""
    label:      str
    confidence: float = 1.0            # 0.0 – 1.0
    distance_m: Optional[float] = None # None if estimation unavailable
    severity:   Optional[str] = None   # "close" | "medium" | "far"
    tracker_id: Optional[int] = None
    bbox:       Optional[list] = None

    def __post_init__(self):
        # Auto-derive severity if distance is provided and severity is unset
        if self.severity is None and self.distance_m is not None:
            if self.distance_m <= 1.5:
                self.severity = "close"
            elif self.distance_m <= 3.0:
                self.severity = "medium"
            else:
                self.severity = "far"


@dataclass
class FusionInput:
    """
    The canonical input contract to the FusionEngine.
    Accepts both legacy fields and standardized ModalityOutput objects.

    Example:
        FusionInput(
            objects=[DetectedObject("car", 0.92, 1.2, "close")],
            ocr_text="Hospital Entrance",
            speech_text="Please move left",
            gesture_text="thumbs_up",
            user_mode=UserMode.BLIND,
        )
    """
    objects:          list[DetectedObject] = field(default_factory=list)
    ocr_text:         Optional[str] = None    # from OCR module
    speech_text:      Optional[str] = None    # from Whisper STT
    gesture_text:     Optional[str] = None    # from gesture recognizer
    modality_outputs: list[ModalityOutput] = field(default_factory=list)
    user_mode:        UserMode = UserMode.BLIND
    timestamp:        float = field(default_factory=time.monotonic)
    frame_id:         Optional[int] = None

    def __post_init__(self):
        # Synchronize modality_outputs <-> legacy attributes for complete interop
        if self.modality_outputs and not self.objects and not self.ocr_text and not self.speech_text and not self.gesture_text:
            for mo in self.modality_outputs:
                if mo.modality == "vision":
                    dist = mo.metadata.get("distance_m") or mo.metadata.get("distance")
                    sev = mo.metadata.get("severity")
                    self.objects.append(DetectedObject(
                        label=mo.prediction,
                        confidence=mo.confidence if mo.confidence is not None else 1.0,
                        distance_m=dist,
                        severity=sev,
                        bbox=mo.metadata.get("bbox")
                    ))
                elif mo.modality == "ocr":
                    self.ocr_text = mo.prediction
                elif mo.modality == "speech":
                    self.speech_text = mo.prediction
                elif mo.modality == "gesture":
                    self.gesture_text = mo.prediction
        elif (self.objects or self.ocr_text or self.speech_text or self.gesture_text) and not self.modality_outputs:
            for obj in self.objects:
                self.modality_outputs.append(ModalityOutput.from_vision(
                    label=obj.label,
                    confidence=obj.confidence,
                    latency_ms=0.0,
                    metadata={"distance_m": obj.distance_m, "severity": obj.severity, "bbox": obj.bbox}
                ))
            if self.ocr_text:
                self.modality_outputs.append(ModalityOutput.from_ocr(
                    text=self.ocr_text,
                    confidence=None,
                    latency_ms=0.0
                ))
            if self.speech_text:
                self.modality_outputs.append(ModalityOutput.from_speech(
                    text=self.speech_text,
                    confidence=None,
                    latency_ms=0.0
                ))
            if self.gesture_text:
                self.modality_outputs.append(ModalityOutput.from_gesture(
                    gesture=self.gesture_text,
                    confidence=None,
                    latency_ms=0.0
                ))

    @classmethod
    def from_dict(cls, d: dict) -> "FusionInput":
        """Build from a JSON-decoded dict (e.g., from Flask request.json)."""
        raw_outputs = d.get("modality_outputs") or d.get("outputs") or []
        parsed_outputs = [
            ModalityOutput.from_dict(o) if isinstance(o, dict) else o
            for o in raw_outputs
        ]

        objs = [
            DetectedObject(
                label=o["label"],
                confidence=o.get("confidence", 1.0),
                distance_m=o.get("distance_m") if o.get("distance_m") is not None else o.get("distance"),
                severity=o.get("severity"),
                tracker_id=o.get("tracker_id"),
                bbox=o.get("bbox"),
            )
            for o in d.get("objects", [])
        ]

        # Handle frontend nested format { vision, speech, gesture }
        raw_vision = d.get("vision")
        if raw_vision and not objs:
            vision_dets = raw_vision if isinstance(raw_vision, list) else raw_vision.get("detections", [])
            for o in vision_dets:
                lbl = o.get("label") if isinstance(o, dict) else str(o)
                conf = o.get("confidence", 1.0) if isinstance(o, dict) else 1.0
                dist = o.get("distance_m") if isinstance(o, dict) else None
                sev = (o.get("severity") or o.get("distance")) if isinstance(o, dict) else None
                objs.append(DetectedObject(
                    label=lbl,
                    confidence=conf,
                    distance_m=dist,
                    severity=sev if isinstance(sev, str) else None,
                    bbox=o.get("bbox") if isinstance(o, dict) else None,
                ))
            if isinstance(raw_vision, dict) and raw_vision.get("hazard"):
                hz = raw_vision["hazard"]
                if isinstance(hz, dict):
                    if hz.get("stair"):
                        objs.append(DetectedObject("stairs", 0.95, 1.0, "close"))
                    if hz.get("drop"):
                        objs.append(DetectedObject("drop edge", 0.95, 0.5, "close"))

        speech_text = d.get("speech_text")
        if not speech_text and d.get("speech"):
            sp = d.get("speech")
            speech_text = sp.get("text") if isinstance(sp, dict) else str(sp)

        gesture_text = d.get("gesture_text")
        if not gesture_text and d.get("gesture"):
            gt = d.get("gesture")
            if isinstance(gt, dict):
                gesture_text = gt.get("sentence") or " ".join(gt.get("words", [])) or gt.get("gesture")
            elif isinstance(gt, list):
                gesture_text = " ".join(gt)
            else:
                gesture_text = str(gt)

        user_mode_val = d.get("user_mode", "blind")
        try:
            mode = UserMode(user_mode_val)
        except ValueError:
            mode = UserMode.BLIND

        return cls(
            objects=objs,
            ocr_text=d.get("text") or d.get("ocr_text"),
            speech_text=speech_text,
            gesture_text=gesture_text,
            modality_outputs=parsed_outputs,
            user_mode=mode,
            frame_id=d.get("frame_id"),
        )


# ─── Output ───────────────────────────────────────────────────────────────────

@dataclass
class FusionOutput:
    """
    The final, actionable decision from the FusionEngine.
    Rich telemetry and conflict resolution data included for research.
    """
    final_alert:         str                    # Human-readable alert text
    priority:            AlertPriority
    output_mode:         OutputMode
    vibration_pattern:   Optional[str]          # e.g. "short-long-short"
    source:              str                    # "object" | "ocr" | "speech" | "gesture"
    confidence:          float                  # winning signal confidence
    latency_ms:          float = 0.0
    suppressed:          bool  = False          # True if cooldown blocked it
    conflict_detected:   bool  = False
    conflict_resolution: Optional[str] = None
    modality_breakdown:  dict  = field(default_factory=dict)
    debug:               dict  = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "final_alert":         self.final_alert,
            "awareness":           self.final_alert or "Surroundings monitored",
            "intent":              "hazard" if self.priority in (AlertPriority.CRITICAL, AlertPriority.HIGH) else "general",
            "priority":            self.priority.value,
            "suggestions":         ["Safety override: Proceed with caution"] if self.priority == AlertPriority.CRITICAL else [],
            "output_mode":         self.output_mode.value,
            "vibration_pattern":   self.vibration_pattern,
            "source":              self.source,
            "confidence":          round(self.confidence, 3),
            "latency_ms":          round(self.latency_ms, 2),
            "suppressed":          self.suppressed,
            "conflict_detected":   self.conflict_detected,
            "conflict_resolution": self.conflict_resolution,
            "modality_breakdown":  self.modality_breakdown,
            "debug":               self.debug,
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
