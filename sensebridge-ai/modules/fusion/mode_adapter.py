"""
Mode Adapter
=============
Translates a winning ScoredSignal into a user-mode–specific FusionOutput.

Rules:
  blind  → priority: objects > OCR > speech > gesture
           output: TTS + vibration for HIGH/CRITICAL
  deaf   → priority: speech > OCR > gesture > objects
           output: caption (visual text), no TTS
  mute   → priority: gesture > objects > OCR > speech
           output: sentence construction from gesture label
  mixed  → all signals active, TTS + caption
"""

from __future__ import annotations
from .schema import (
    FusionOutput, FusionInput, UserMode, AlertPriority,
    OutputMode, ScoredSignal  # ScoredSignal imported from priority
)
from .priority import ScoredSignal   # re-export for clarity


# ─── Vibration pattern library ────────────────────────────────────────────────
VIBRATION_PATTERNS: dict[str, str] = {
    AlertPriority.CRITICAL: "long-long-long",
    AlertPriority.HIGH:     "short-long-short",
    AlertPriority.MEDIUM:   "short-short",
    AlertPriority.LOW:      "short",
    AlertPriority.IGNORE:   "none",
}

# Source priority ordering per user mode (lower index = higher priority)
MODE_SOURCE_ORDER: dict[UserMode, list[str]] = {
    UserMode.BLIND:  ["object", "ocr",     "speech",  "gesture"],
    UserMode.DEAF:   ["speech", "ocr",     "gesture", "object"],
    UserMode.MUTE:   ["gesture","object",  "ocr",     "speech"],
    UserMode.MIXED:  ["object", "speech",  "gesture", "ocr"],
}

# Verbose gesture → sentence mapping
GESTURE_SENTENCES: dict[str, str] = {
    "thumbs_up":   "Yes, I agree.",
    "thumbs_down": "No, I disagree.",
    "open_palm":   "Please stop.",
    "pointing":    "Over there.",
    "fist":        "Cancel that.",
    "peace":       "Two of those, please.",
    "call_me":     "Please call me.",
    "sos":         "Emergency! I need help!",
}


class ModeAdapter:
    """
    Selects the winning signal based on user mode priority ordering
    and constructs the final FusionOutput.
    """

    def adapt(
        self,
        signals: list[ScoredSignal],
        user_mode: UserMode,
        dominant_priority: AlertPriority,
    ) -> FusionOutput:
        """
        Select the highest-ranked signal for this user mode and build FusionOutput.

        Args:
            signals:           All scored signals (sorted by raw_score desc).
            user_mode:         Blind / deaf / mute / mixed.
            dominant_priority: Pre-computed max priority across all signals.

        Returns:
            FusionOutput ready for dispatch.
        """
        winning = self._select_winner(signals, user_mode)
        if winning is None:
            return FusionOutput.silent("no scoreable signals")

        # Humanize message per mode
        message = self._humanize(winning, user_mode)

        # Output mode selection
        output_mode = self._output_mode(user_mode, winning.priority)

        # Vibration
        vibration = VIBRATION_PATTERNS.get(winning.priority.value, "none")
        if vibration == "none":
            vibration = None

        return FusionOutput(
            final_alert=message,
            priority=winning.priority,
            output_mode=output_mode,
            vibration_pattern=vibration,
            source=winning.source,
            confidence=winning.confidence,
            debug={
                "raw_score": winning.raw_score,
                "mode_order": MODE_SOURCE_ORDER[user_mode],
                "total_signals": len(signals),
            },
        )

    def _select_winner(
        self,
        signals: list[ScoredSignal],
        user_mode: UserMode,
    ) -> ScoredSignal | None:
        """
        Pick the best signal respecting the mode's source priority order.

        Strategy:
          1. If any CRITICAL signal exists → always pick the highest-scoring CRITICAL
          2. Else → pick highest raw_score signal whose source is earliest in the mode order
          3. IGNORE signals are excluded.
        """
        non_ignored = [s for s in signals if s.priority != AlertPriority.IGNORE]
        if not non_ignored:
            return None

        # Rule 1: CRITICAL always wins regardless of mode
        criticals = [s for s in non_ignored if s.priority == AlertPriority.CRITICAL]
        if criticals:
            return max(criticals, key=lambda s: s.raw_score)

        # Rule 2: Sort by mode preference, then by raw_score as tiebreaker
        order = MODE_SOURCE_ORDER.get(user_mode, MODE_SOURCE_ORDER[UserMode.MIXED])
        source_rank = {src: i for i, src in enumerate(order)}

        return min(
            non_ignored,
            key=lambda s: (source_rank.get(s.source, 99), -s.raw_score)
        )

    @staticmethod
    def _humanize(signal: ScoredSignal, user_mode: UserMode) -> str:
        """Refine the message for the target user mode."""
        if signal.source == "gesture":
            return GESTURE_SENTENCES.get(
                signal.label.lower().replace(" ", "_"),
                signal.message,
            )
        if user_mode == UserMode.DEAF and signal.source == "speech":
            # Clean up for caption display
            return signal.message.removeprefix('Heard: "').removesuffix('"')
        return signal.message

    @staticmethod
    def _output_mode(user_mode: UserMode, priority: AlertPriority) -> OutputMode:
        """Map user mode + priority → output channel."""
        if user_mode == UserMode.BLIND:
            if priority in (AlertPriority.CRITICAL, AlertPriority.HIGH):
                return OutputMode.VOICE_VIB
            return OutputMode.VOICE

        if user_mode == UserMode.DEAF:
            return OutputMode.CAPTION

        if user_mode == UserMode.MUTE:
            if priority == AlertPriority.CRITICAL:
                return OutputMode.VOICE_VIB   # emergency override even for mute users
            return OutputMode.CAPTION

        # MIXED: all channels active
        if priority in (AlertPriority.CRITICAL, AlertPriority.HIGH):
            return OutputMode.VOICE_VIB
        return OutputMode.VOICE
