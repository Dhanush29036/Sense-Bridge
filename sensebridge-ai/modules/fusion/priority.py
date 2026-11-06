"""
Priority Scoring & Conflict Resolution Engine
==============================================
Confidence-aware severity scoring with Bayesian weighting and context-aware
conflict resolution across sensory streams.

Supports:
  1. Real model inference confidence ingestion (from ModalityOutput)
  2. Modality reliability weighting (vision > speech > gesture > ocr)
  3. Multi-source corroboration boosting
  4. Cross-modal conflict detection & safety-first resolution
"""

from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Optional, List, Tuple
from .schema import DetectedObject, AlertPriority


# ─── Danger thresholds (meters) ───────────────────────────────────────────────

DANGER_THRESHOLDS: dict[str, dict[str, float]] = {
    # label → { critical_m, high_m, medium_m }
    "car":           {"critical": 2.5, "high": 5.0, "medium": 10.0},
    "motorcycle":    {"critical": 2.5, "high": 5.0, "medium": 10.0},
    "bus":           {"critical": 3.0, "high": 6.0, "medium": 12.0},
    "truck":         {"critical": 3.0, "high": 6.0, "medium": 12.0},
    "bicycle":       {"critical": 1.5, "high": 3.0, "medium":  6.0},
    "person":        {"critical": 1.0, "high": 2.0, "medium":  4.0},
    "stairs":        {"critical": 1.0, "high": 2.0, "medium":  4.0},
    "obstacle":      {"critical": 0.8, "high": 1.5, "medium":  3.0},
    "door":          {"critical": 0.5, "high": 1.0, "medium":  2.0},
    "chair":         {"critical": 0.5, "high": 1.2, "medium":  3.0},
    "couch":         {"critical": 0.5, "high": 1.2, "medium":  3.0},
    "table":         {"critical": 0.5, "high": 1.2, "medium":  3.0},
    "desk":          {"critical": 0.5, "high": 1.2, "medium":  3.0},
    "crosswalk":     {"critical": 0.0, "high": 1.5, "medium":  5.0},  # always warn
    "signboard":     {"critical": 0.0, "high": 0.0, "medium":  3.0},
    "currency_note": {"critical": 0.0, "high": 0.0, "medium":  0.5},
}

DEFAULT_THRESHOLD = {"critical": 1.5, "high": 2.5, "medium": 5.0}

# Base empirical reliability weights per sensory modality
SIGNAL_WEIGHTS = {
    "object":  1.00,
    "speech":  0.85,
    "gesture": 0.80,
    "ocr":     0.65,
}

# Multi-modal agreement boost
CORROBORATION_BOOST = 0.15


@dataclass
class ScoredSignal:
    """Intermediate representation before final decision."""
    source:     str             # "object" | "speech" | "gesture" | "ocr"
    label:      str             # representative label string
    message:    str             # human-readable alert text
    priority:   AlertPriority
    raw_score:  float           # numeric severity 0.0 – 1.0 (higher = more urgent)
    confidence: float


class PriorityScorer:
    """
    Scores incoming signals using confidence-weighted heuristics, corroborates
    multi-source agreement, and detects/resolves cross-modal conflicts.
    """

    def score_objects(self, objects: list[DetectedObject]) -> list[ScoredSignal]:
        signals: list[ScoredSignal] = []
        for obj in objects:
            danger_score = self._distance_danger_score(obj)
            conf = obj.confidence if obj.confidence is not None else 0.8
            raw_score    = danger_score * conf * SIGNAL_WEIGHTS["object"]
            priority     = self._bucket(raw_score)
            message      = self._object_message(obj, priority)

            signals.append(ScoredSignal(
                source="object",
                label=obj.label,
                message=message,
                priority=priority,
                raw_score=round(raw_score, 4),
                confidence=round(conf, 4),
            ))
        return sorted(signals, key=lambda s: -s.raw_score)

    def score_speech(self, text: Optional[str], confidence: Optional[float] = None) -> Optional[ScoredSignal]:
        if not text or len(text.strip()) < 2:
            return None
        urgency = self._text_urgency(text)
        conf = confidence if confidence is not None else 0.85
        raw_score = urgency * conf * SIGNAL_WEIGHTS["speech"]
        return ScoredSignal(
            source="speech",
            label="speech",
            message=f'Heard: "{text.strip()}"',
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=round(conf, 4),
        )

    def score_gesture(self, text: Optional[str], confidence: Optional[float] = None) -> Optional[ScoredSignal]:
        if not text:
            return None
        urgency = self._gesture_urgency(text)
        conf = confidence if confidence is not None else 0.80
        raw_score = urgency * conf * SIGNAL_WEIGHTS["gesture"]
        clean_label = text.lower().strip()
        return ScoredSignal(
            source="gesture",
            label=clean_label,
            message=f"Gesture: {text.replace('_', ' ')}",
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=round(conf, 4),
        )

    def score_ocr(self, text: Optional[str], confidence: Optional[float] = None) -> Optional[ScoredSignal]:
        if not text or len(text.strip()) < 2:
            return None
        urgency = self._text_urgency(text) * 0.7   # OCR is lower weight
        conf = confidence if confidence is not None else 0.70
        raw_score = urgency * conf * SIGNAL_WEIGHTS["ocr"]
        return ScoredSignal(
            source="ocr",
            label="ocr",
            message=f'Sign reads: "{text.strip()}"',
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=round(conf, 4),
        )

    def apply_corroboration(self, signals: list[ScoredSignal]) -> list[ScoredSignal]:
        """
        Boost signals whose semantic context is confirmed by multiple independent sensors.
        """
        # Group by normalized semantic labels
        semantic_map: dict[str, list[ScoredSignal]] = {}
        for s in signals:
            norm = self._normalize_concept(s.label, s.message)
            semantic_map.setdefault(norm, []).append(s)

        for norm, group in semantic_map.items():
            if len(group) > 1 and norm != "general":
                # Multiple signals corroborate this concept
                for s in group:
                    s.raw_score = min(1.0, s.raw_score + CORROBORATION_BOOST)
                    s.priority  = self._bucket(s.raw_score)

        return signals

    def resolve_conflicts(self, signals: list[ScoredSignal]) -> tuple[list[ScoredSignal], bool, Optional[str]]:
        """
        Detects contradictions between modalities and applies context-aware resolution.

        Rules:
          1. Safety Override: If vision detects an urgent hazard (CRITICAL or HIGH),
             permissive speech/gesture signals (e.g. "go", "clear", "thumbs_up") are demoted.
          2. Contradictory Movement: Opposing actions (stop vs go, left vs right) are resolved
             in favor of the higher confidence signal, prioritizing safety in ties.
        """
        if len(signals) <= 1:
            return signals, False, None

        has_safety_hazard = any(
            s.priority in (AlertPriority.CRITICAL, AlertPriority.HIGH) and s.source in ("object", "ocr")
            for s in signals
        )
        permissive_signals = [
            s for s in signals
            if s.source in ("speech", "gesture") and any(w in s.message.lower() for w in ["agree", "thumbs up", "clear", "go", "walk", "ok"])
        ]

        if has_safety_hazard and permissive_signals:
            # Conflict detected: Hazard present while user/gesture signals permissive action
            hazard = next(s for s in signals if s.priority in (AlertPriority.CRITICAL, AlertPriority.HIGH))
            resolution = f"Hazard '{hazard.label}' overrides permissive signal '{permissive_signals[0].label}' (Safety First)"
            # Demote permissive signal
            for ps in permissive_signals:
                ps.priority = AlertPriority.IGNORE
            return signals, True, resolution

        # Check for opposing directional / state commands
        stop_signals = [s for s in signals if any(w in s.message.lower() for w in ["stop", "halt", "danger", "warning", "open palm", "fist"])]
        go_signals   = [s for s in signals if any(w in s.message.lower() for w in ["go", "move", "forward", "proceed", "yes"])]

        if stop_signals and go_signals:
            top_stop = max(stop_signals, key=lambda s: s.raw_score)
            top_go   = max(go_signals, key=lambda s: s.raw_score)
            if top_stop.raw_score >= top_go.raw_score:
                resolution = f"Stop signal ({top_stop.source}, conf={top_stop.confidence:.2f}) resolved over Go signal ({top_go.source}, conf={top_go.confidence:.2f})"
                for g in go_signals:
                    g.priority = AlertPriority.IGNORE
            else:
                resolution = f"Go signal ({top_go.source}, conf={top_go.confidence:.2f}) resolved over Stop signal ({top_stop.source}, conf={top_stop.confidence:.2f})"
                for st in stop_signals:
                    st.priority = AlertPriority.IGNORE
            return signals, True, resolution

        return signals, False, None

    # ─── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _distance_danger_score(obj: DetectedObject) -> float:
        thresholds = DANGER_THRESHOLDS.get(obj.label, DEFAULT_THRESHOLD)
        d = obj.distance_m

        if d is None:
            if obj.severity == "close":   return 0.80
            if obj.severity == "medium":  return 0.40
            if obj.severity == "far":     return 0.15
            return 0.35   # unknown → assume moderate

        if thresholds["critical"] > 0 and d <= thresholds["critical"]:  return 1.00
        if thresholds["high"]     > 0 and d < thresholds["high"]:       return 0.70
        if thresholds["medium"]   > 0 and d <= thresholds["medium"]:    return 0.40
        return 0.15

    @staticmethod
    def _bucket(score: float) -> AlertPriority:
        if score >= 0.80: return AlertPriority.CRITICAL
        if score >= 0.55: return AlertPriority.HIGH
        if score >= 0.30: return AlertPriority.MEDIUM
        if score >= 0.10: return AlertPriority.LOW
        return AlertPriority.IGNORE

    @staticmethod
    def _object_message(obj: DetectedObject, priority: AlertPriority) -> str:
        label = obj.label.replace("_", " ")
        if obj.distance_m is not None:
            dist = f"{obj.distance_m:.1f} meters"
            if priority in (AlertPriority.CRITICAL, AlertPriority.HIGH):
                return f"Warning! {label} at {dist}"
            return f"{label.capitalize()} ahead, {dist}"
        return f"{label.capitalize()} detected"

    @staticmethod
    def _normalize_concept(label: str, message: str) -> str:
        text = f"{label} {message}".lower()
        if any(w in text for w in ["stop", "halt", "open_palm", "open palm"]):
            return "stop"
        if any(w in text for w in ["help", "sos", "emergency"]):
            return "emergency"
        if any(w in text for w in ["person", "people"]):
            return "person"
        if any(w in text for w in ["car", "vehicle", "traffic"]):
            return "vehicle"
        if any(w in text for w in ["stairs", "step"]):
            return "stairs"
        return label.lower()

    # Keyword lists for urgency scoring
    _URGENT_WORDS  = {"stop", "danger", "warning", "emergency", "help", "exit", "fire", "sos"}
    _MEDIUM_WORDS  = {"left", "right", "ahead", "back", "wait", "attention", "caution", "hello", "there"}

    def _text_urgency(self, text: str) -> float:
        words = set(text.lower().split())
        if words & self._URGENT_WORDS:  return 0.85
        if words & self._MEDIUM_WORDS:  return 0.50
        return 0.20

    _EMERGENCY_GESTURES = {"sos", "call_me", "thumbs_down"}
    _MEDIUM_GESTURES    = {"thumbs_up", "open_palm", "pointing"}

    def _gesture_urgency(self, text: str) -> float:
        key = text.lower().strip()
        if key in self._EMERGENCY_GESTURES: return 0.90
        if key in self._MEDIUM_GESTURES:    return 0.45
        return 0.25
