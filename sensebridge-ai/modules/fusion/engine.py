"""
FusionEngine — The Central Decision Brain
==========================================
Combines all AI module outputs into a single prioritized action.

Data flow:
    FusionInput
        │
        ├─ PriorityScorer.score_objects()   → list[ScoredSignal]
        ├─ PriorityScorer.score_speech()    → ScoredSignal?
        ├─ PriorityScorer.score_gesture()   → ScoredSignal?
        ├─ PriorityScorer.score_ocr()       → ScoredSignal?
        │
        ├─ ContextBuffer.is_suppressed()    → prune cooled-down signals
        ├─ ContextBuffer.should_escalate()  → boost sustained hazards
        │
        ├─ ModeAdapter.adapt()              → FusionOutput (mode-specific)
        │
        └─ ContextBuffer.record()           → update memory
        
Usage:
    engine = FusionEngine()
    result = engine.process(fusion_input)
    print(result.to_dict())
"""

from __future__ import annotations
import time
import threading
from typing import Optional
from .schema import FusionInput, FusionOutput, AlertPriority
from .priority import PriorityScorer, ScoredSignal
from .context_buffer import ContextBuffer, BufferedAlert
from .mode_adapter import ModeAdapter


class FusionEngine:
    """
    Thread-safe, synchronous fusion engine.

    Design principles:
      - Single call to process() is blocking but fast (target: <5ms overhead)
      - All state managed inside ContextBuffer (thread-safe)
      - Stateless priority scoring (fully testable, no side effects)
      - Extensible: swap PriorityScorer or ModeAdapter without changing engine

    Args:
        cooldown_s:      Per-label alert cooldown (seconds).
        speech_pause_s:  Object-alert suppression during speech (seconds).
        buffer_size:     Rolling alert memory size.
    """

    def __init__(
        self,
        cooldown_s:     float = 5.0,
        speech_pause_s: float = 3.0,
        buffer_size:    int   = 5,
    ):
        self._scorer  = PriorityScorer()
        self._buffer  = ContextBuffer(
            max_size=buffer_size,
            cooldown_s=cooldown_s,
            speech_pause_s=speech_pause_s,
        )
        self._adapter = ModeAdapter()
        self._lock    = threading.Lock()

    # ─── Public API ───────────────────────────────────────────────────────────

    def process(self, fusion_input: FusionInput) -> FusionOutput:
        """
        Main entry point — evaluate all signals and return the winning alert.

        Thread-safe: can be called from multiple threads concurrently
        (each call takes the lock for the buffer writes only).

        Args:
            fusion_input: Populated FusionInput from AI modules.

        Returns:
            FusionOutput — the single actionable alert (may be suppressed).
        """
        t0 = time.perf_counter()

        # ── Step 1: Score every signal ────────────────────────────────────────
        all_signals: list[ScoredSignal] = []

        obj_signals = self._scorer.score_objects(fusion_input.objects)
        all_signals.extend(obj_signals)

        speech_signal  = self._scorer.score_speech(fusion_input.speech_text)
        gesture_signal = self._scorer.score_gesture(fusion_input.gesture_text)
        ocr_signal     = self._scorer.score_ocr(fusion_input.ocr_text)

        for sig in (speech_signal, gesture_signal, ocr_signal):
            if sig:
                all_signals.append(sig)

        # ── Step 2: Notify speech activity (for object suppression window) ────
        if speech_signal:
            self._buffer.notify_speech_activity()

        # ── Step 3: Suppress cooled-down / paused signals ─────────────────────
        active_signals = self._filter_suppressed(all_signals, fusion_input)

        if not active_signals:
            output = FusionOutput.silent("all signals suppressed by cooldown")
            output.latency_ms = (time.perf_counter() - t0) * 1000
            return output

        # ── Step 4: Corroboration boost (multi-source agreement) ──────────────
        active_signals = self._scorer.apply_corroboration(active_signals)

        # ── Step 5: Danger escalation (sustained hazard detection) ────────────
        for sig in active_signals:
            sig.priority = self._buffer.should_escalate(sig.label, sig.priority)

        # ── Step 6: CRITICAL fast-path override ───────────────────────────────
        criticals = [s for s in active_signals if s.priority == AlertPriority.CRITICAL]
        if criticals and self._must_fire_critical(criticals[0], fusion_input):
            # CRITICAL bypasses all cooldowns — fire immediately
            winner = max(criticals, key=lambda s: s.raw_score)
            active_signals = [winner]   # force this signal

        # ── Step 7: Mode adaptation → FusionOutput ────────────────────────────
        sorted_signals = sorted(active_signals, key=lambda s: -s.raw_score)
        dominant_priority = sorted_signals[0].priority

        output = self._adapter.adapt(sorted_signals, fusion_input.user_mode, dominant_priority)
        output.latency_ms = (time.perf_counter() - t0) * 1000

        # ── Step 8: Record the fired alert ────────────────────────────────────
        if not output.suppressed:
            self._buffer.record(BufferedAlert(
                source=output.source,
                label=sorted_signals[0].label,
                message=output.final_alert,
                priority=output.priority,
                frame_id=fusion_input.frame_id,
            ))

        return output

    # ─── Suppression logic ────────────────────────────────────────────────────

    def _filter_suppressed(
        self, signals: list[ScoredSignal], inp: FusionInput
    ) -> list[ScoredSignal]:
        """Remove signals that are cooled-down, except CRITICAL ones."""
        active = []
        for sig in signals:
            if sig.priority == AlertPriority.IGNORE:
                continue
            if sig.priority == AlertPriority.CRITICAL:
                active.append(sig)   # CRITICAL is never suppressed by cooldown
                continue
            if not self._buffer.is_suppressed(sig.label, sig.source):
                active.append(sig)
        return active

    def _must_fire_critical(
        self, signal: ScoredSignal, inp: FusionInput
    ) -> bool:
        """
        Final guard before firing a CRITICAL alert:
        ensure it hasn't fired in the last 1.5s (hard minimum for CRITICAL).
        Prevents a stuck "car CRITICAL" from looping 30 per second.
        """
        last = self._buffer._last_alert.get(signal.label, 0.0)
        return (time.monotonic() - last) >= 1.5

    # ─── Management API ───────────────────────────────────────────────────────

    def dismiss(self, label: str, duration_s: float = 30.0) -> None:
        """Let the user dismiss a label (e.g., 'ignore chairs for 30s')."""
        self._buffer.force_suppress(label, duration_s)

    def recent_alerts(self, n: int = 5) -> list[dict]:
        """Return last n alerts as dicts for logging."""
        return [
            {
                "label":     a.label,
                "message":   a.message,
                "priority":  a.priority.value,
                "source":    a.source,
                "timestamp": a.timestamp,
            }
            for a in self._buffer.recent(n)
        ]

    def reset(self) -> None:
        """Clear all buffer state (e.g., on mode change)."""
        self._buffer.clear()
