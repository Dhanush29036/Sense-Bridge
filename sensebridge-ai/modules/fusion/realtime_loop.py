"""
Real-time Fusion Processing Loop
==================================
Non-blocking, multi-thread-safe loop that continuously reads from
AI module queues and pushes results to the FusionEngine.

Designed for on-device use (Termux / Raspberry Pi) where all AI modules
run as background threads and post their results to a shared input queue.

Architecture:
    [DetectorThread] ──┐
    [WhisperThread]  ──┼──> input_queue ──> FusionLoop ──> output_queue ──> [AlertManager]
    [GestureThread]  ──┘                               └──> WebSocket broadcast

Usage:
    loop = RealtimeFusionLoop(user_mode=UserMode.BLIND)
    loop.start()
    # ... push data from AI modules:
    loop.push_objects([DetectedObject("car", 0.92, 1.2, "close")])
    loop.push_speech("Please move left")
    # ... retrieve latest alert:
    alert = loop.latest_output()
    loop.stop()
"""

from __future__ import annotations
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Optional, Callable

from .schema import FusionInput, FusionOutput, UserMode, DetectedObject
from .engine import FusionEngine


@dataclass
class AIModuleUpdate:
    """
    Lightweight message posted to the fusion input queue by any AI module.
    Only set the field(s) you have new data for; rest stay None.
    """
    objects:      Optional[list[DetectedObject]] = None
    ocr_text:     Optional[str]                  = None
    speech_text:  Optional[str]                  = None
    gesture_text: Optional[str]                  = None
    frame_id:     Optional[int]                  = None
    timestamp:    float = field(default_factory=time.monotonic)


class RealtimeFusionLoop:
    """
    Non-blocking fusion loop that merges the latest state from all AI modules
    and calls FusionEngine.process() at a target frame rate.

    Design:
      - Maintains a "current state" dict that is updated by each AI module patch
      - FusionEngine runs in its own thread at `fps` Hz
      - Output callbacks called on the processing thread (keep fast!)
      - Thread-safe via RLock on current_state

    Args:
        user_mode:   Initial user mode.
        fps:         Fusion engine processing rate (default 10 Hz).
        on_alert:    Callback fn(FusionOutput) fired for every non-suppressed alert.
        cooldown_s:  Per-label alert cooldown.
    """

    def __init__(
        self,
        user_mode:  UserMode = UserMode.BLIND,
        fps:        int      = 10,
        on_alert:   Optional[Callable[[FusionOutput], None]] = None,
        cooldown_s: float    = 5.0,
    ):
        self._engine     = FusionEngine(cooldown_s=cooldown_s)
        self._user_mode  = user_mode
        self._fps        = fps
        self._on_alert   = on_alert
        self._running    = False

        # Shared mutable state (latest snapshot from each module)
        self._state_lock  = threading.RLock()
        self._current: dict = {
            "objects":      [],
            "ocr_text":     None,
            "speech_text":  None,
            "gesture_text": None,
            "frame_id":     0,
        }

        # Latest output for polling
        self._latest_output: Optional[FusionOutput] = None
        self._output_lock = threading.Lock()
        self._frame_counter = 0

        # Threaded processing
        self._thread: Optional[threading.Thread] = None

    # ─── Thread start/stop ────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background fusion processing thread."""
        self._running = True
        self._thread  = threading.Thread(target=self._run, daemon=True, name="FusionLoop")
        self._thread.start()
        print(f"[INFO] FusionLoop started at {self._fps} Hz — mode: {self._user_mode.value}")

    def stop(self) -> None:
        """Stop the loop and wait for thread to finish."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        print("[INFO] FusionLoop stopped.")

    # ─── AI module push API ──────────────────────────────────────────────────

    def push_objects(self, objects: list[DetectedObject]) -> None:
        """Called by ObjectDetector thread with new detections."""
        with self._state_lock:
            self._current["objects"] = objects

    def push_speech(self, text: str) -> None:
        """Called by WhisperEngine callback with new transcript."""
        with self._state_lock:
            self._current["speech_text"] = text.strip() if text else None

    def push_gesture(self, gesture_label: str) -> None:
        """Called by GestureRecognizer callback."""
        with self._state_lock:
            self._current["gesture_text"] = gesture_label

    def push_ocr(self, text: str) -> None:
        """Called by OCREngine with recognized text."""
        with self._state_lock:
            self._current["ocr_text"] = text.strip() if text else None

    def set_mode(self, mode: UserMode) -> None:
        """Hot-swap user mode without restarting the loop."""
        self._user_mode = mode
        self._engine.reset()
        print(f"[INFO] FusionLoop mode changed to: {mode.value}")

    # ─── Output access ────────────────────────────────────────────────────────

    def latest_output(self) -> Optional[FusionOutput]:
        """Latest FusionOutput (poll from any thread)."""
        with self._output_lock:
            return self._latest_output

    # ─── Processing loop ──────────────────────────────────────────────────────

    def _run(self) -> None:
        """Main fusion loop — runs at self._fps Hz."""
        interval = 1.0 / self._fps
        while self._running:
            loop_start = time.perf_counter()

            # Snapshot current state (fast copy under lock)
            with self._state_lock:
                state = dict(self._current)
                self._frame_counter += 1

            # Build FusionInput from snapshot
            fusion_input = FusionInput(
                objects=state["objects"],
                ocr_text=state["ocr_text"],
                speech_text=state["speech_text"],
                gesture_text=state["gesture_text"],
                user_mode=self._user_mode,
                frame_id=self._frame_counter,
            )

            # Process through fusion engine
            output = self._engine.process(fusion_input)

            # Store latest output
            with self._output_lock:
                self._latest_output = output

            # Fire callback for non-suppressed alerts
            if not output.suppressed and self._on_alert:
                try:
                    self._on_alert(output)
                except Exception as e:
                    print(f"[WARN] on_alert callback raised: {e}")

            # Rate limiting
            elapsed = time.perf_counter() - loop_start
            sleep_for = interval - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)

    def latency_stats(self) -> dict:
        """Return recent fusion latency stats for monitoring."""
        output = self.latest_output()
        return {
            "last_latency_ms": output.latency_ms if output else None,
            "frame_count":     self._frame_counter,
            "user_mode":       self._user_mode.value,
            "is_running":      self._running,
        }


# ─── Integration example ──────────────────────────────────────────────────────

def demo() -> None:
    """
    Quick integration demo: simulate YOLO + Whisper pushing data to FusionLoop.
    """
    from .schema import DetectedObject

    def on_alert(result: FusionOutput) -> None:
        print(f"[ALERT] [{result.priority.value}] {result.final_alert}"
              f" | mode={result.output_mode.value} | vib={result.vibration_pattern}"
              f" | {result.latency_ms:.1f}ms")

    loop = RealtimeFusionLoop(user_mode=UserMode.BLIND, fps=5, on_alert=on_alert)
    loop.start()

    # Simulate detections arriving from YOLO at 10 FPS
    import random
    for i in range(20):
        time.sleep(0.2)
        if i % 3 == 0:
            # Simulate a close car
            loop.push_objects([
                DetectedObject("car", confidence=0.91, distance_m=1.5, severity="close", tracker_id=1)
            ])
        elif i % 3 == 1:
            loop.push_speech("Please move to the left")
        else:
            loop.push_objects([
                DetectedObject("obstacle", confidence=0.85, distance_m=0.7, severity="close")
            ])

    loop.stop()
    print("Demo complete.")


if __name__ == "__main__":
    demo()
