"""
Module 5 — Alert Manager + TTS Output System
=============================================
Manages alert priority, cooldown, and text-to-speech output.

Priority levels (higher = more urgent):
    CRITICAL (3): person in path, stairs, road crossing
    HIGH     (2): car, obstacle
    MEDIUM   (1): door, signboard, gesture recognized
    LOW      (0): general OCR text

Cooldown prevents same-label alert from firing more than once per N seconds.
"""

import os
import time
import queue
import threading
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

TTS_ENGINE_TYPE = os.getenv("TTS_ENGINE", "pyttsx3")
TTS_RATE        = int(os.getenv("TTS_RATE", "175"))
TTS_VOLUME      = float(os.getenv("TTS_VOLUME", "1.0"))
ALERT_COOLDOWN  = float(os.getenv("ALERT_COOLDOWN_S", "5"))


# ─── Priority map ─────────────────────────────────────────────────────────────
LABEL_PRIORITY: dict[str, int] = {
    "stairs":       3,
    "crosswalk":    3,
    "person":       2,
    "car":          3,
    "motorcycle":   3,
    "bus":          3,
    "truck":        2,
    "obstacle":     2,
    "door":         1,
    "signboard":    1,
    "currency_note": 1,
    "gesture":      1,
    "ocr":          0,
}


@dataclass(order=True)
class Alert:
    priority:  int     = field(compare=True)
    label:     str     = field(compare=False)
    message:   str     = field(compare=False)
    timestamp: float   = field(default_factory=time.monotonic, compare=False)

    def __post_init__(self):
        # PriorityQueue is min-heap, so negate for max-priority first
        object.__setattr__(self, "priority", -self.priority)


class AlertManager:
    """
    Thread-safe alert queue with:
      - Priority ordering (critical alerts first)
      - Per-label cooldown (prevents spam)
      - Background TTS worker thread
    """

    def __init__(self, cooldown_s: float = ALERT_COOLDOWN):
        self._tts          = self._init_tts()
        self._queue        = queue.PriorityQueue(maxsize=30)
        self._cooldowns:   dict[str, float] = {}
        self._cooldown_s   = cooldown_s
        self._running      = True
        self._worker       = threading.Thread(target=self._tts_worker, daemon=True)
        self._worker.start()
        print(f"[INFO] AlertManager started (TTS: {TTS_ENGINE_TYPE}, cooldown: {cooldown_s}s)")

    def _init_tts(self):
        if TTS_ENGINE_TYPE == "pyttsx3":
            try:
                import pyttsx3
                engine = pyttsx3.init()
                engine.setProperty("rate",   TTS_RATE)
                engine.setProperty("volume", TTS_VOLUME)
                return engine
            except Exception as e:
                print(f"[WARN] pyttsx3 failed: {e}. Using print fallback.")
                return None
        return None   # gTTS handled inline in worker

    def push(self, label: str, message: str, priority: Optional[int] = None) -> bool:
        """
        Push an alert to the queue.

        Args:
            label:    Object/event label (used for cooldown keying).
            message:  Text to speak.
            priority: Override priority (default: from LABEL_PRIORITY map).

        Returns:
            True if alert was enqueued, False if cooled-down or queue full.
        """
        if not self._check_cooldown(label):
            return False

        prio = priority if priority is not None else LABEL_PRIORITY.get(label, 1)
        alert = Alert(priority=prio, label=label, message=message)

        try:
            self._queue.put_nowait(alert)
            self._cooldowns[label] = time.monotonic()
            return True
        except queue.Full:
            return False

    def push_detection(
        self, label: str, distance_m: Optional[float] = None, severity: Optional[str] = None
    ) -> bool:
        """Convenience method for object detection alerts."""
        if distance_m:
            if severity == "close":
                msg = f"Warning! {label} very close, {distance_m:.1f} meters"
            elif severity == "medium":
                msg = f"{label} ahead, {distance_m:.1f} meters"
            else:
                msg = f"{label} detected"
        else:
            msg = f"{label} detected"
        return self.push(label, msg)

    def push_gesture(self, gesture: str) -> bool:
        msg = {"thumbs_up": "Yes", "thumbs_down": "No", "open_palm": "Stop",
               "call_me": "Help me", "sos": "Emergency!"}.get(gesture, gesture.replace("_", " "))
        return self.push("gesture", f"Gesture: {msg}", priority=1)

    def push_ocr(self, text: str, category: str = "general") -> bool:
        if len(text) < 2:
            return False
        prio = 2 if category == "signboard" else 0
        return self.push("ocr", f"Text reads: {text}", priority=prio)

    def _check_cooldown(self, label: str) -> bool:
        last = self._cooldowns.get(label, 0.0)
        return (time.monotonic() - last) >= self._cooldown_s

    def _tts_worker(self) -> None:
        """Background thread: dequeue and speak alerts."""
        while self._running:
            try:
                alert = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue

            self._speak(alert.message)

    def _speak(self, text: str) -> None:
        try:
            if self._tts:
                self._tts.say(text)
                self._tts.runAndWait()
            elif TTS_ENGINE_TYPE == "gtts":
                self._speak_gtts(text)
            else:
                print(f"[TTS] {text}")
        except Exception as e:
            print(f"[TTS ERROR] {e}: {text}")

    @staticmethod
    def _speak_gtts(text: str) -> None:
        """Fallback: Google TTS (requires internet)."""
        import tempfile, os
        from gtts import gTTS
        import subprocess
        tts = gTTS(text=text, lang="en", slow=False)
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tts.save(tmp.name)
        # Play using system player
        subprocess.Popen(["ffplay", "-nodisp", "-autoexit", tmp.name],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).wait()
        os.unlink(tmp.name)

    def stop(self) -> None:
        self._running = False
        if self._tts:
            try:
                self._tts.stop()
            except Exception:
                pass
