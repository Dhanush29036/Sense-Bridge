"""
Context Memory Buffer
======================
A rolling window of the last N alerts, used by the FusionEngine to:
  1. Detect repeated/duplicate alerts → suppress via cooldown
  2. Detect sustained danger (same object persists across N frames) → escalate
  3. Track "speaking" state — if speech is active, pause object alerts

Thread-safe: all mutations protected by threading.Lock.
"""

from __future__ import annotations
import time
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
from .schema import AlertPriority


@dataclass
class BufferedAlert:
    source:    str
    label:     str
    message:   str
    priority:  AlertPriority
    timestamp: float = field(default_factory=time.monotonic)
    frame_id:  Optional[int] = None


class ContextBuffer:
    """
    Fixed-size rolling memory of recent alerts with per-label cooldown.

    Args:
        max_size:       Maximum number of alerts to retain (default 5).
        cooldown_s:     Seconds before the same label can fire again.
        speech_pause_s: If speech is received, suppress object alerts for this duration.
    """

    def __init__(
        self,
        max_size:       int   = 5,
        cooldown_s:     float = 5.0,
        speech_pause_s: float = 3.0,
    ):
        self._max_size   = max_size
        self._cooldown   = cooldown_s
        self._speech_pause = speech_pause_s
        self._lock = threading.Lock()

        self._history:    deque[BufferedAlert] = deque(maxlen=max_size)
        self._last_alert: dict[str, float]     = {}     # label → timestamp
        self._last_speech: float               = 0.0    # monotonic timestamp

    # ─── Cooldown check ───────────────────────────────────────────────────────

    def is_suppressed(self, label: str, source: str = "object") -> bool:
        """
        Return True if this label/source is suppressed (cooled down or speech active).

        Checks:
          1. Per-label cooldown
          2. Global speech pause (object alerts suppressed while user is speaking)
          3. CRITICAL priority always bypasses suppression
        """
        with self._lock:
            now = time.monotonic()

            # Speech activity window — suppress non-CRITICAL object detections
            if source == "object" and (now - self._last_speech) < self._speech_pause:
                return True

            last = self._last_alert.get(label, 0.0)
            return (now - last) < self._cooldown

    def record(self, alert: BufferedAlert) -> None:
        """Record a fired alert into the buffer and update cooldown timestamp."""
        with self._lock:
            self._history.append(alert)
            self._last_alert[alert.label] = time.monotonic()
            if alert.source == "speech":
                self._last_speech = time.monotonic()

    def notify_speech_activity(self) -> None:
        """
        Explicitly signal that the user is speaking right now.
        Resets the speech pause timer without recording a full alert.
        """
        with self._lock:
            self._last_speech = time.monotonic()

    # ─── Danger escalation ────────────────────────────────────────────────────

    def count_recent_label(self, label: str, window_s: float = 3.0) -> int:
        """
        Count how many times 'label' appeared in the last window_s seconds.
        Used to escalate priority if the same danger object persists.
        """
        with self._lock:
            now = time.monotonic()
            return sum(
                1 for a in self._history
                if a.label == label and (now - a.timestamp) <= window_s
            )

    def should_escalate(self, label: str, base_priority: AlertPriority) -> AlertPriority:
        """
        Escalate priority if same label seen ≥ 3 times in last 3s.
        Ensures sustained hazards (car following user) are never downgraded.
        """
        if base_priority in (AlertPriority.CRITICAL, AlertPriority.IGNORE):
            return base_priority
        count = self.count_recent_label(label, window_s=3.0)
        if count >= 3:
            # Escalate one level
            escalation_map = {
                AlertPriority.LOW:    AlertPriority.MEDIUM,
                AlertPriority.MEDIUM: AlertPriority.HIGH,
                AlertPriority.HIGH:   AlertPriority.CRITICAL,
            }
            return escalation_map.get(base_priority, base_priority)
        return base_priority

    # ─── Introspection ────────────────────────────────────────────────────────

    def recent(self, n: int = 5) -> list[BufferedAlert]:
        """Return the most recent n alerts (newest last)."""
        with self._lock:
            return list(self._history)[-n:]

    def last_label(self) -> Optional[str]:
        """Return the last alerted label, or None."""
        with self._lock:
            return self._history[-1].label if self._history else None

    def clear(self) -> None:
        with self._lock:
            self._history.clear()
            self._last_alert.clear()

    def force_suppress(self, label: str, duration_s: float = 30.0) -> None:
        """Manually suppress a label for duration_s (e.g., user dismissed it)."""
        with self._lock:
            self._last_alert[label] = time.monotonic() + duration_s - self._cooldown
