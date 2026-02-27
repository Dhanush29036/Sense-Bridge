"""
Priority Scoring Engine
========================
Rule-based severity scoring with weighted confidence fusion.
Assigns AlertPriority to each candidate signal before the engine
picks the dominant one.

Design Goals:
  - Deterministic (fully testable)
  - No ML required — works without any trained model
  - Extensible: add new rules without touching the engine
"""

from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Optional
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
    "crosswalk":     {"critical": 0.0, "high": 1.5, "medium":  5.0},  # always warn
    "signboard":     {"critical": 0.0, "high": 0.0, "medium":  3.0},
    "currency_note": {"critical": 0.0, "high": 0.0, "medium":  0.5},
}

DEFAULT_THRESHOLD = {"critical": 1.5, "high": 3.0, "medium": 6.0}

# Base weights for Bayesian-style confidence fusion
SIGNAL_WEIGHTS = {
    "object":  1.0,
    "speech":  0.85,
    "gesture": 0.80,
    "ocr":     0.60,
}

# Boost factor when multiple signals agree on the same context
CORROBORATION_BOOST = 0.15


@dataclass
class ScoredSignal:
    """Intermediate representation before final decision."""
    source:    str             # "object" | "speech" | "gesture" | "ocr"
    label:     str             # representative label string
    message:   str             # human-readable alert text
    priority:  AlertPriority
    raw_score: float           # numeric severity 0.0 – 1.0 (higher = more urgent)
    confidence: float


class PriorityScorer:
    """
    Scores each incoming signal and returns a ranked list of ScoredSignals.

    Scoring formula:
        raw_score = distance_danger_score × confidence × signal_weight × corroboration_boost

    distance_danger_score:
        1.0 = CRITICAL distance or no distance available for high-risk class
        0.7 = HIGH distance
        0.4 = MEDIUM distance
        0.15 = FAR / low-risk

    Final priority bucketing:
        raw_score >= 0.80  → CRITICAL
        raw_score >= 0.55  → HIGH
        raw_score >= 0.30  → MEDIUM
        raw_score >= 0.10  → LOW
        else               → IGNORE
    """

    def score_objects(self, objects: list[DetectedObject]) -> list[ScoredSignal]:
        signals: list[ScoredSignal] = []
        for obj in objects:
            danger_score = self._distance_danger_score(obj)
            raw_score    = danger_score * obj.confidence * SIGNAL_WEIGHTS["object"]
            priority     = self._bucket(raw_score)
            message      = self._object_message(obj, priority)

            signals.append(ScoredSignal(
                source="object",
                label=obj.label,
                message=message,
                priority=priority,
                raw_score=round(raw_score, 4),
                confidence=obj.confidence,
            ))
        return sorted(signals, key=lambda s: -s.raw_score)

    def score_speech(self, text: Optional[str]) -> Optional[ScoredSignal]:
        if not text or len(text.strip()) < 2:
            return None
        urgency = self._text_urgency(text)
        raw_score = urgency * SIGNAL_WEIGHTS["speech"]
        return ScoredSignal(
            source="speech",
            label="speech",
            message=f'Heard: "{text.strip()}"',
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=0.90,
        )

    def score_gesture(self, text: Optional[str]) -> Optional[ScoredSignal]:
        if not text:
            return None
        urgency = self._gesture_urgency(text)
        raw_score = urgency * SIGNAL_WEIGHTS["gesture"]
        return ScoredSignal(
            source="gesture",
            label="gesture",
            message=f"Gesture: {text.replace('_', ' ')}",
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=0.85,
        )

    def score_ocr(self, text: Optional[str]) -> Optional[ScoredSignal]:
        if not text or len(text.strip()) < 2:
            return None
        urgency = self._text_urgency(text) * 0.7   # OCR is lower weight
        raw_score = urgency * SIGNAL_WEIGHTS["ocr"]
        return ScoredSignal(
            source="ocr",
            label="ocr",
            message=f'Sign reads: "{text.strip()}"',
            priority=self._bucket(raw_score),
            raw_score=round(raw_score, 4),
            confidence=0.75,
        )

    def apply_corroboration(self, signals: list[ScoredSignal]) -> list[ScoredSignal]:
        """
        Boost signals whose label appears in multiple independent sources.
        E.g., if OCR says "STOP" and gesture says "stop", boost both.
        """
        label_counts: dict[str, int] = {}
        for s in signals:
            label_counts[s.label] = label_counts.get(s.label, 0) + 1
        for s in signals:
            if label_counts[s.label] > 1:
                s.raw_score = min(1.0, s.raw_score + CORROBORATION_BOOST)
                s.priority  = self._bucket(s.raw_score)
        return signals

    # ─── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _distance_danger_score(obj: DetectedObject) -> float:
        thresholds = DANGER_THRESHOLDS.get(obj.label, DEFAULT_THRESHOLD)
        d = obj.distance_m

        if d is None:
            # No distance info — use severity hint
            if obj.severity == "close":   return 0.80
            if obj.severity == "medium":  return 0.45
            if obj.severity == "far":     return 0.15
            return 0.40   # unknown → assume moderate

        if thresholds["critical"] > 0 and d <= thresholds["critical"]:  return 1.00
        if thresholds["high"]     > 0 and d <= thresholds["high"]:      return 0.70
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

    # Keyword lists for urgency scoring
    _URGENT_WORDS  = {"stop", "danger", "warning", "emergency", "help", "exit", "fire", "sos"}
    _MEDIUM_WORDS  = {"left", "right", "ahead", "back", "wait", "attention", "caution"}

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
