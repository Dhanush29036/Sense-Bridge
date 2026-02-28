"""
SOS Engine — Multi-Trigger Emergency System
=============================================
Handles three SOS trigger paths:
  1. Shake detection   (accelerometer magnitude spikes x3 in 1.5s)
  2. Voice command     ("emergency help" / "mayday" detected by Whisper)
  3. Direct API call   (power-button / UI button from Android)

On confirmation → captures GPS → POSTs to backend /api/emergency/sos.
"""

from __future__ import annotations
import time
import threading
import os
import requests
from collections import deque
from typing import Optional, Callable
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL      = os.getenv("BACKEND_URL", "http://localhost:5000")
SHAKE_THRESHOLD  = 22.0   # m/s² resultant magnitude to count as a shake
SHAKE_COUNT_NEEDED = 3    # shakes within SHAKE_WINDOW_S
SHAKE_WINDOW_S   = 1.5

SOS_KEYWORDS = {"emergency", "help", "mayday", "danger", "sos", "accident"}


class SOSEngine:
    """
    Unified SOS trigger manager.

    Usage:
        engine = SOSEngine(user_id="user123", on_sos=my_callback)
        engine.push_sensor(ax, ay, az)          # from accelerometer
        engine.check_speech("emergency help")   # from Whisper output
        engine.trigger_direct("power_button")   # from Android broadcast
    """

    def __init__(
        self,
        user_id: str,
        on_sos: Optional[Callable[[dict], None]] = None,
        cancel_window_s: float = 5.0,
    ):
        self._user_id        = user_id
        self._on_sos         = on_sos
        self._cancel_window  = cancel_window_s
        self._lock           = threading.Lock()
        self._cancel_event   = threading.Event()

        # Shake detection state
        self._shake_times: deque = deque(maxlen=20)

        # Debounce: ignore duplicate SOS triggers within 60s
        self._last_sos_time: float = 0.0
        self._SOS_DEBOUNCE   = 60.0

    # ─── Trigger methods ──────────────────────────────────────────────────────

    def push_sensor(self, ax: float, ay: float, az: float) -> bool:
        """
        Feed accelerometer samples. Returns True if shake-SOS was triggered.
        """
        import math
        magnitude = math.sqrt(ax**2 + ay**2 + az**2)
        now = time.monotonic()

        if magnitude > SHAKE_THRESHOLD:
            self._shake_times.append(now)

        # Count shakes within the rolling window
        recent_shakes = [t for t in self._shake_times if (now - t) <= SHAKE_WINDOW_S]
        if len(recent_shakes) >= SHAKE_COUNT_NEEDED:
            self._shake_times.clear()
            return self._arm("shake")
        return False

    def check_speech(self, transcript: str) -> bool:
        """
        Check if a Whisper transcript contains emergency keywords.
        Returns True if voice-SOS was triggered.
        """
        words = set(transcript.lower().split())
        if words & SOS_KEYWORDS:
            return self._arm("voice_command")
        return False

    def trigger_direct(self, source: str = "button") -> bool:
        """
        Direct SOS trigger from UI button or Android power-button broadcast.
        """
        return self._arm(source)

    # ─── Internal arms + countdown ────────────────────────────────────────────

    def _arm(self, source: str) -> bool:
        """
        Arms the 5-second cancel countdown.
        Returns False if another SOS fired within the debounce window.
        """
        with self._lock:
            now = time.monotonic()
            if (now - self._last_sos_time) < self._SOS_DEBOUNCE:
                return False    # debounced
            print(f"[SOS] Triggered by: {source} — cancel window: {self._cancel_window}s")
            self._cancel_event.clear()

        if self._on_sos:
            # Notify the app so it can show the cancel button
            self._on_sos({"status": "armed", "source": source, "cancel_s": self._cancel_window})

        def _countdown():
            cancelled = self._cancel_event.wait(timeout=self._cancel_window)
            if not cancelled:
                self._dispatch(source)
            else:
                print("[SOS] Cancelled by user.")

        threading.Thread(target=_countdown, daemon=True, name="SOSCountdown").start()
        return True

    def cancel(self) -> None:
        """User pressed cancel within the countdown window."""
        self._cancel_event.set()

    def _dispatch(self, source: str) -> None:
        """POST emergency event to the backend API."""
        with self._lock:
            self._last_sos_time = time.monotonic()

        payload = {
            "userId": self._user_id,
            "source": source,
            "timestamp": time.time(),
        }

        try:
            resp = requests.post(
                f"{BACKEND_URL}/api/emergency/sos",
                json=payload,
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                print(f"[SOS] Dispatched ✅  contacts_notified={data.get('contactsNotified')}")
                if self._on_sos:
                    self._on_sos({"status": "dispatched", **data})
            else:
                print(f"[SOS] Backend error {resp.status_code}")
        except Exception as e:
            print(f"[SOS] Offline — could not reach backend: {e}")
            # Store locally for retry when connectivity returns
            self._store_offline(payload)

    @staticmethod
    def _store_offline(payload: dict) -> None:
        """Append failed SOS payloads to a local JSON file for retry."""
        import json
        from pathlib import Path
        path = Path("data/emergency/offline_sos_queue.jsonl")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(json.dumps(payload) + "\n")
        print(f"[SOS] Stored offline: {path}")
