"""
ExperimentLogger — Per-Sample Inference Record Logger
======================================================
Records every inference call with:
  - input_id (auto-incremented)
  - modality (vision | ocr | speech | gesture)
  - expected_label (researcher-entered ground truth)
  - predicted_label (actual model output)
  - confidence (actual model confidence, or null)
  - latency_ms (actual measured latency)
  - is_correct (computed from expected vs predicted)
  - timestamp (unix)
  - session_id
  - ablation_label
  - environment metadata

IMPORTANT:
  - No fake values are ever inserted.
  - Confidence is null if the model doesn't expose it.
  - is_correct is only computed when expected_label is provided.

Usage:
    logger = ExperimentLogger()
    session = logger.start_session(
        name="OCR Ablation",
        ablation=AblationConfig(ocr=True, ...),
        environment=EnvironmentMeta(lighting="low"),
    )
    record = logger.log(
        session=session,
        modality="ocr",
        predicted_label="EXIT",
        confidence=0.87,
        latency_ms=920,
        expected_label="EXIT",
    )
    logger.end_session(session)
"""

from __future__ import annotations
import time
import threading
from typing import Optional, List
from .session import ExperimentSession, AblationConfig, EnvironmentMeta


# ─── InferenceRecord ─────────────────────────────────────────────────────────

def _make_record(
    *,
    input_id:        int,
    session_id:      str,
    modality:        str,
    predicted_label: str,
    confidence:      Optional[float],
    latency_ms:      float,
    expected_label:  Optional[str],
    ablation_label:  str,
    environment:     dict,
    metadata:        dict,
    timestamp:       float,
) -> dict:
    """
    Build a single inference record dict.
    is_correct is only set (True/False) when expected_label is provided.
    """
    is_correct: Optional[bool] = None
    if expected_label is not None:
        # Case-insensitive comparison, strip whitespace
        is_correct = predicted_label.strip().lower() == expected_label.strip().lower()

    return {
        "input_id":       input_id,
        "session_id":     session_id,
        "timestamp":      round(timestamp, 3),
        "modality":       modality,
        "expected_label": expected_label,
        "predicted_label": predicted_label,
        "confidence":     round(confidence, 4) if confidence is not None else None,
        "latency_ms":     round(latency_ms, 2),
        "is_correct":     is_correct,
        "ablation_label": ablation_label,
        "environment":    environment,
        "metadata":       metadata,
    }


# ─── ExperimentLogger ─────────────────────────────────────────────────────────

class ExperimentLogger:
    """
    Thread-safe experiment logger.

    Maintains a list of active sessions and a global running list of records.
    Each session also holds its own copy for easy per-session export.

    Attributes:
        _sessions:   All created sessions (keyed by session_id).
        _counter:    Global input_id counter (auto-incremented, thread-safe).
        _lock:       Thread safety lock.
    """

    def __init__(self):
        self._sessions: dict[str, ExperimentSession] = {}
        self._counter = 0
        self._lock = threading.Lock()

    # ─── Session lifecycle ────────────────────────────────────────────────────

    def start_session(
        self,
        name: str,
        ablation: Optional[AblationConfig] = None,
        environment: Optional[EnvironmentMeta] = None,
        device_info: Optional[dict] = None,
    ) -> ExperimentSession:
        """
        Create and start a new experiment session.

        Args:
            name:        Human-readable session name.
            ablation:    Which modalities are active (defaults to all active).
            environment: Environmental metadata (defaults to normal conditions).
            device_info: Optional platform info dict.

        Returns:
            A started ExperimentSession.
        """
        session = ExperimentSession(
            name=name,
            ablation=ablation or AblationConfig(),
            environment=environment or EnvironmentMeta(),
            device_info=device_info or {},
        )
        session.start()
        with self._lock:
            self._sessions[session.session_id] = session
        return session

    def end_session(self, session: ExperimentSession) -> None:
        """Mark a session as ended."""
        session.end()

    def get_session(self, session_id: str) -> Optional[ExperimentSession]:
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[dict]:
        """Return summary dicts for all sessions (without records)."""
        with self._lock:
            result = []
            for s in self._sessions.values():
                d = s.to_dict()
                d.pop("records", None)  # exclude records from summary
                result.append(d)
        return result

    # ─── Record logging ───────────────────────────────────────────────────────

    def log(
        self,
        session: ExperimentSession,
        modality: str,
        predicted_label: str,
        confidence: Optional[float],
        latency_ms: float,
        expected_label: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Log a single inference result to the session.

        Args:
            session:         Active ExperimentSession.
            modality:        "vision" | "ocr" | "speech" | "gesture"
            predicted_label: Actual model prediction (required).
            confidence:      Actual model confidence (or None if unavailable).
            latency_ms:      Actual measured inference latency in ms.
            expected_label:  Ground truth label (researcher-entered, optional).
            metadata:        Any additional data to store with this record.

        Returns:
            The record dict that was logged.
        """
        with self._lock:
            self._counter += 1
            input_id = self._counter

        record = _make_record(
            input_id=input_id,
            session_id=session.session_id,
            modality=modality,
            predicted_label=predicted_label,
            confidence=confidence,
            latency_ms=latency_ms,
            expected_label=expected_label,
            ablation_label=session.ablation.label(),
            environment=session.environment.to_dict(),
            metadata=metadata or {},
            timestamp=time.time(),
        )

        session.add_record(record)
        return record

    # ─── Convenience: log from modality output dict ───────────────────────────

    def log_modality_output(
        self,
        session: ExperimentSession,
        output: dict,
        expected_label: Optional[str] = None,
    ) -> dict:
        """
        Convenience method: log from a standard ModalityOutput dict.

        Expected output format:
        {
            "modality": "vision",
            "prediction": "person",
            "confidence": 0.91,
            "processingTimeMs": 184,
            ...
        }
        """
        return self.log(
            session=session,
            modality=output.get("modality", "unknown"),
            predicted_label=output.get("prediction", ""),
            confidence=output.get("confidence"),
            latency_ms=output.get("processingTimeMs", 0.0),
            expected_label=expected_label,
            metadata=output.get("metadata", {}),
        )
