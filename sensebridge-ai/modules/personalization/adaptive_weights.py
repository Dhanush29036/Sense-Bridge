"""
Adaptive Weights Engine — RL-Style Personalization
====================================================
Adjusts per-label priority multipliers based on user feedback:

  If user frequently DISMISSES "chair" alerts:
      weight("chair") → decays toward 0.5 (fewer alerts)

  If user REACTS to "car" alerts consistently:
      weight("car") → grows toward 2.0 (higher sensitivity)

Algorithm: Exponential Moving Average (EMA) of normalised feedback ratio.

Also applies geo-zone risk amplification from the profile store:
  zone_risk_multiplier × base_score → adjusted score

Integration:
    At FusionEngine step 3 (filter/scoring), call:
        adjusted = adapter.adjust_score(user_id, label, base_score, lat, lon)
"""

from __future__ import annotations
import math
from typing import Optional
from .profile_store import ProfileStore

# EMA smoothing factor for weight updates (higher = faster adaptation)
ALPHA = 0.3
W_MIN = 0.4    # Floor: label is never completely silenced
W_MAX = 2.0    # Ceiling: label never fires more than 2× its base weight


class AdaptiveWeightsEngine:
    """
    Thin layer over ProfileStore that provides:
      1. Score adjustment based on learned per-label weights.
      2. Feedback ingestion (dismiss / reaction) that updates weights in real-time.
      3. Zone-based risk amplification.
    """

    def __init__(self, store: Optional[ProfileStore] = None):
        self._store = store or ProfileStore()

    # ─── Score adjustment (called during fusion) ──────────────────────────────

    def adjust_score(
        self,
        user_id: str,
        label:   str,
        base_score: float,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
    ) -> float:
        """
        Returns base_score adjusted by personalised weight and zone risk.

        Args:
            user_id:    User ID.
            label:      Object/event label (e.g. "car", "stairs").
            base_score: Raw score from PriorityScorer (0.0–1.0).
            lat/lon:    Current GPS coordinates (optional zone-risk boost).

        Returns:
            Adjusted score clamped to [0.0, 1.0].
        """
        profile = self._store.get(user_id)

        # 1. Per-label weight
        w = profile.label_weights.get(label, 1.0)

        # 2. Zone-risk multiplier
        zone_mult = 1.0
        if lat is not None and lon is not None:
            bucket = f"{round(lat, 3)}_{round(lon, 3)}"
            zone_mult = profile.zone_risk.get(bucket, 1.0)

        adjusted = min(1.0, base_score * w * zone_mult)
        return round(adjusted, 4)

    # ─── Feedback ingestion ───────────────────────────────────────────────────

    def on_dismiss(self, user_id: str, label: str) -> float:
        """
        User dismissed an alert for this label.
        Decays the weight toward W_MIN using EMA.

        Returns new weight.
        """
        profile = self._store.get(user_id)
        self._store.record_dismissal(user_id, label)

        w_old = profile.label_weights.get(label, 1.0)
        # Decay: target = W_MIN
        w_new = (1 - ALPHA) * w_old + ALPHA * W_MIN
        w_new = max(W_MIN, w_new)
        profile.label_weights[label] = round(w_new, 4)
        self._store.save(profile)

        print(f"[Personalisation] DISMISS {label}: weight {w_old:.3f} → {w_new:.3f}")
        return w_new

    def on_reaction(self, user_id: str, label: str) -> float:
        """
        User explicitly reacted to an alert (<3s response).
        Increases weight toward W_MAX using EMA.

        Returns new weight.
        """
        profile = self._store.get(user_id)
        self._store.record_reaction(user_id, label)

        w_old = profile.label_weights.get(label, 1.0)
        # Boost: target = W_MAX
        w_new = (1 - ALPHA) * w_old + ALPHA * W_MAX
        w_new = min(W_MAX, w_new)
        profile.label_weights[label] = round(w_new, 4)
        self._store.save(profile)

        print(f"[Personalisation] REACTION {label}: weight {w_old:.3f} → {w_new:.3f}")
        return w_new

    # ─── Zone risk management ─────────────────────────────────────────────────

    def on_danger_zone_entered(self, user_id: str, lat: float, lon: float) -> None:
        """Increase risk multiplier for this geo-bucket when a hazard occurs."""
        profile = self._store.get(user_id)
        bucket = f"{round(lat, 3)}_{round(lon, 3)}"
        old_risk = profile.zone_risk.get(bucket, 1.0)
        new_risk = min(W_MAX, old_risk + 0.15)
        self._store.update_zone_risk(user_id, lat, lon, new_risk)
        print(f"[Zone] Risk {bucket}: {old_risk:.2f} → {new_risk:.2f}")

    # ─── Insight helpers ──────────────────────────────────────────────────────

    def get_top_dismissed(self, user_id: str, top_n: int = 5) -> list[tuple[str, int]]:
        """Return labels with highest dismissal counts."""
        profile = self._store.get(user_id)
        sorted_labels = sorted(profile.dismiss_counts.items(), key=lambda x: -x[1])
        return sorted_labels[:top_n]

    def get_sensitivity_summary(self, user_id: str) -> dict:
        """Return current weights for all tracked labels."""
        return dict(self._store.get(user_id).label_weights)
