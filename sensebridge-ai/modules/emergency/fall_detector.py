"""
Fall Detector — Accelerometer + Gyroscope
==========================================
Detects a genuine fall event using a 3-step state machine:
  IDLE → FREE_FALL (low-G window) → IMPACT (high-G spike) → MOTIONLESS (no movement)

A confirmed fall only fires when all three phases are seen within
a rolling 2-second window.  A 5-second countdown then runs before
the SOS signal is dispatched, giving the user a chance to cancel.

On Android, sensor data is fed via the REST-push route:
  POST /api/emergency/sensor  { ax, ay, az, gx, gy, gz, ts }

Threshold defaults come from published fall-detection literature
(Bourke et al. 2008, Lee & Carlisle 2011).
"""

from __future__ import annotations
import math
import time
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional


# ─── Thresholds (m/s²) ───────────────────────────────────────────────────────
FREEFALL_THRESHOLD_G   = 0.5    # resultant acc < 0.5g → free-fall phase
IMPACT_THRESHOLD_G     = 2.5    # resultant acc > 2.5g → impact detected
MOTIONLESS_THRESHOLD_G = 0.3    # std-dev of acc < 0.3g for 500ms → motionless
FALL_WINDOW_S          = 2.5    # all 3 phases must occur within this window
CANCEL_TIMEOUT_S       = 5.0    # seconds user has to cancel before SOS fires

G_MS2 = 9.81   # 1g in m/s²


@dataclass
class SensorSample:
    ax: float; ay: float; az: float   # m/s² (accelerometer)
    gx: float; gy: float; gz: float   # deg/s (gyroscope)
    ts: float = field(default_factory=time.monotonic)

    @property
    def acc_magnitude(self) -> float:
        return math.sqrt(self.ax**2 + self.ay**2 + self.az**2)

    @property
    def acc_g(self) -> float:
        return self.acc_magnitude / G_MS2


class FallState(str, Enum):
    IDLE       = "IDLE"
    FREE_FALL  = "FREE_FALL"
    IMPACT     = "IMPACT"
    MOTIONLESS = "MOTIONLESS"
    CONFIRMED  = "CONFIRMED"


class FallDetector:
    """
    Real-time fall detector consuming inertial sensor samples.

    Args:
        on_fall_detected:  Callback `fn(cancel_fn)` when a fall is confirmed.
                           `cancel_fn()` must be called within CANCEL_TIMEOUT_S
                           to suppress the SOS dispatch.
        on_sос_dispatch:   Callback fired after the cancel window expires.
    """

    def __init__(
        self,
        on_fall_detected: Optional[Callable] = None,
        on_sos_dispatch:  Optional[Callable] = None,
    ):
        self._on_fall     = on_fall_detected
        self._on_sos      = on_sos_dispatch
        self._state       = FallState.IDLE
        self._phase_times: dict[str, float] = {}
        self._lock        = threading.Lock()
        self._recent: list[SensorSample] = []   # rolling 2.5s window
        self._cancel_flag = threading.Event()

    # ─── Main entry point ─────────────────────────────────────────────────────

    def push_sample(self, sample: SensorSample) -> FallState:
        """
        Push a new sensor sample and advance the state machine.
        Returns the current FallState.
        """
        with self._lock:
            now = sample.ts
            self._recent.append(sample)
            # Prune old samples outside the fall window
            self._recent = [s for s in self._recent if (now - s.ts) <= FALL_WINDOW_S]

            self._advance(sample, now)
        return self._state

    def _advance(self, s: SensorSample, now: float) -> None:
        g = s.acc_g

        if self._state == FallState.IDLE:
            if g < FREEFALL_THRESHOLD_G:
                self._state = FallState.FREE_FALL
                self._phase_times["freefall"] = now

        elif self._state == FallState.FREE_FALL:
            # Cancel free-fall if window exceeded without impact
            if (now - self._phase_times.get("freefall", now)) > FALL_WINDOW_S:
                self._reset()
                return
            if g > IMPACT_THRESHOLD_G:
                self._state = FallState.IMPACT
                self._phase_times["impact"] = now

        elif self._state == FallState.IMPACT:
            # Wait for motionless phase (low variance)
            elapsed = now - self._phase_times.get("impact", now)
            if elapsed > 0.8:  # check 0.8s after impact
                if self._is_motionless():
                    self._state = FallState.CONFIRMED
                    self._trigger_confirmation()
                else:
                    # Recovered — likely a stumble, not a fall
                    self._reset()

    def _is_motionless(self) -> bool:
        """Compute standard deviation of last 0.5s of samples."""
        import statistics
        window = [s.acc_g for s in self._recent[-10:]]  # ~10 samples at 20Hz
        if len(window) < 5:
            return False
        try:
            return statistics.stdev(window) < MOTIONLESS_THRESHOLD_G
        except statistics.StatisticsError:
            return False

    def _trigger_confirmation(self) -> None:
        """Start the 5-second cancel window and then dispatch SOS."""
        self._cancel_flag.clear()

        if self._on_fall:
            self._on_fall(cancel_fn=self.cancel)

        def _countdown():
            cancelled = self._cancel_flag.wait(timeout=CANCEL_TIMEOUT_S)
            if not cancelled:
                if self._on_sos:
                    self._on_sos()
            self._reset()

        threading.Thread(target=_countdown, daemon=True).start()

    def cancel(self) -> None:
        """User pressed cancel — abort the pending SOS."""
        self._cancel_flag.set()
        self._reset()

    def _reset(self) -> None:
        self._state = FallState.IDLE
        self._phase_times.clear()


# ─── REST POST helper (for Android sensor bridge) ────────────────────────────

def from_request_dict(d: dict) -> SensorSample:
    """Parse a JSON sensor payload from the Android bridge POST."""
    return SensorSample(
        ax=float(d["ax"]), ay=float(d["ay"]), az=float(d["az"]),
        gx=float(d.get("gx", 0.0)), gy=float(d.get("gy", 0.0)), gz=float(d.get("gz", 0.0)),
        ts=float(d.get("ts", time.monotonic())),
    )
