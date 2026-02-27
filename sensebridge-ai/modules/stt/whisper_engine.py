"""
Module 3A — Whisper Streaming Speech-to-Text Engine
=====================================================
Uses OpenAI Whisper Tiny (or Tiny.int8) for low-latency transcription.

Architecture:
  MicStream → VAD → ChunkBuffer → Whisper → Transcript
  
Latency target: < 1.5s end-to-end for 5s audio chunks on CPU.

Usage:
    engine = WhisperEngine()
    engine.start(callback=lambda r: print(r.text))
    # ... press Ctrl+C to stop ...
    engine.stop()
"""

import os
import time
import queue
import threading
import tempfile
import numpy as np
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

WHISPER_MODEL    = os.getenv("WHISPER_MODEL",    "tiny")
WHISPER_DEVICE   = os.getenv("WHISPER_DEVICE",   "cpu")
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", None) or None   # None = auto-detect
SAMPLE_RATE      = int(os.getenv("SAMPLE_RATE",  "16000"))
CHUNK_DURATION_S = float(os.getenv("CHUNK_DURATION_S", "5"))
VAD_AGGRESSIVENESS = 2      # webrtcvad: 0–3 (3 = most aggressive)


@dataclass
class TranscriptResult:
    text:        str
    language:    str
    confidence:  float     # avg log-prob mapped to [0,1]
    latency_ms:  float
    no_speech:   float     # no_speech_prob from Whisper
    is_final:    bool = True


class WhisperEngine:
    """
    Streaming Whisper transcription using a chunk-based pipeline.

    Memory optimizations applied:
      - Whisper Tiny: ~37 MB model
      - FP16 disabled on CPU (fp16=False)
      - Chunks processed sequentially (no batching)
      - Audio queue with maxsize prevents memory leak
    """

    def __init__(self):
        self._model  = None
        self._thread: threading.Thread | None = None
        self._running = False
        self._audio_q: queue.Queue[np.ndarray] = queue.Queue(maxsize=20)
        self._callback = None
        self._load_model()

    def _load_model(self) -> None:
        import whisper
        print(f"[INFO] Loading Whisper {WHISPER_MODEL} on {WHISPER_DEVICE}...")
        t0 = time.perf_counter()
        self._model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)
        print(f"[INFO] Whisper loaded in {(time.perf_counter()-t0)*1000:.0f}ms")

    # ─── Streaming pipeline ───────────────────────────────────────────────────

    def start(self, callback=None) -> None:
        """
        Start background mic capture + transcription threads.

        Args:
            callback: fn(TranscriptResult) → called for each chunk.
        """
        self._running  = True
        self._callback = callback

        # Thread 1: Mic capture
        t_mic = threading.Thread(target=self._mic_capture_loop, daemon=True)
        t_mic.start()

        # Thread 2: Transcription worker
        t_stt = threading.Thread(target=self._transcribe_loop, daemon=True)
        t_stt.start()

        self._thread = t_mic
        print("[INFO] Whisper streaming started.")

    def stop(self) -> None:
        self._running = False
        print("[INFO] Whisper streaming stopped.")

    # ─── Mic capture (Thread 1) ───────────────────────────────────────────────

    def _mic_capture_loop(self) -> None:
        """
        Capture audio from default microphone using sounddevice.
        Accumulate into CHUNK_DURATION_S sized chunks and enqueue.
        """
        try:
            import sounddevice as sd
        except ImportError:
            print("[ERROR] sounddevice not installed. pip install sounddevice")
            return

        chunk_samples = int(SAMPLE_RATE * CHUNK_DURATION_S)
        buffer = np.zeros(chunk_samples, dtype=np.float32)
        pos = 0

        def audio_callback(indata, frames, time_info, status):
            nonlocal pos, buffer
            flat = indata[:, 0]   # take first channel
            n = len(flat)
            if pos + n >= chunk_samples:
                # Fill remainder of buffer and enqueue
                rem = chunk_samples - pos
                buffer[pos:] = flat[:rem]
                try:
                    self._audio_q.put_nowait(buffer.copy())
                except queue.Full:
                    pass   # drop chunk if queue is full
                buffer[:] = 0
                buffer[:n - rem] = flat[rem:]
                pos = n - rem
            else:
                buffer[pos:pos + n] = flat
                pos += n

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            callback=audio_callback,
            blocksize=1024,
        ):
            while self._running:
                time.sleep(0.1)

    # ─── Transcription (Thread 2) ─────────────────────────────────────────────

    def _transcribe_loop(self) -> None:
        while self._running:
            try:
                audio_chunk = self._audio_q.get(timeout=1.0)
            except queue.Empty:
                continue

            result = self._transcribe_chunk(audio_chunk)
            if result and self._callback:
                self._callback(result)

    def _transcribe_chunk(self, audio: np.ndarray) -> TranscriptResult | None:
        """
        Transcribe a single audio chunk.

        Skips chunk if noise level is too low (silence detection).
        """
        # Quick silence check
        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms < 0.002:
            return None

        t0 = time.perf_counter()
        try:
            out = self._model.transcribe(
                audio,
                language=WHISPER_LANGUAGE,
                task="transcribe",
                fp16=False,                   # CPU requires fp16=False
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
                logprob_threshold=-1.5,
                compression_ratio_threshold=2.4,
            )
        except Exception as e:
            print(f"[ERROR] Whisper transcription failed: {e}")
            return None

        latency_ms = (time.perf_counter() - t0) * 1000
        text = out.get("text", "").strip()
        if not text:
            return None

        # Aggregate segment confidence
        segs = out.get("segments", [])
        avg_logprob  = float(np.mean([s.get("avg_logprob", -1) for s in segs])) if segs else -1.0
        no_speech    = float(np.mean([s.get("no_speech_prob", 0) for s in segs])) if segs else 0.0
        confidence   = max(0.0, min(1.0, (avg_logprob + 1.0)))   # rough mapping: [-2,0] → [0,1]

        return TranscriptResult(
            text=text,
            language=out.get("language", "unknown"),
            confidence=round(confidence, 3),
            latency_ms=round(latency_ms, 1),
            no_speech=round(no_speech, 3),
        )

    # ─── WER Evaluation ───────────────────────────────────────────────────────

    @staticmethod
    def compute_wer(reference: str, hypothesis: str) -> float:
        """
        Compute Word Error Rate using jiwer.

        Args:
            reference:  Ground truth text.
            hypothesis: Whisper output text.

        Returns:
            WER as float 0–1.
        """
        try:
            from jiwer import wer
            return round(wer(reference, hypothesis), 4)
        except ImportError:
            print("[WARN] jiwer not installed. pip install jiwer")
            return -1.0

    def transcribe_file(self, audio_path: str) -> TranscriptResult | None:
        """Transcribe an audio file (WAV / MP3 / FLAC) directly."""
        import whisper
        audio = whisper.load_audio(audio_path)
        audio = whisper.pad_or_trim(audio)
        return self._transcribe_chunk(audio)
