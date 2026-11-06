"""
Modality Output Schema — Common Internal Representation
=======================================================
Every AI module (vision, ocr, speech, gesture) returns a
ModalityOutput that follows this standard contract.

This enables:
  1. Unified fusion engine input format
  2. Consistent UI display (confidence, latency, modality badge)
  3. Experiment logging with common field names
  4. Ablation comparisons across modalities

Format:
    {
        "modality": "vision" | "ocr" | "speech" | "gesture",
        "prediction": "person",
        "confidence": 0.91,        # null if model doesn't expose it
        "timestamp": "...",
        "processingTimeMs": 184,
        "metadata": {}
    }

IMPORTANT:
  - confidence is the ACTUAL model confidence, never invented.
  - If the model doesn't expose confidence, set confidence=None.
  - processingTimeMs must be measured, never estimated.
"""

from __future__ import annotations
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Literal


ModalityType = Literal["vision", "ocr", "speech", "gesture"]


@dataclass
class ModalityOutput:
    """
    Standard output format for all SenseBridge AI modalities.

    Attributes:
        modality:         Which AI module produced this output.
        prediction:       Primary predicted label or text.
        confidence:       Model confidence [0.0, 1.0] or None if unavailable.
        timestamp:        ISO timestamp string when inference was run.
        processingTimeMs: Actual measured inference latency in milliseconds.
        metadata:         Modality-specific extra data (bboxes, positions, etc.)
    """
    modality:         ModalityType
    prediction:       str
    confidence:       Optional[float]  # None = model doesn't expose this
    processingTimeMs: float
    timestamp:        str              = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%S"))
    metadata:         dict             = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "modality":         self.modality,
            "prediction":       self.prediction,
            "confidence":       round(self.confidence, 4) if self.confidence is not None else None,
            "timestamp":        self.timestamp,
            "processingTimeMs": round(self.processingTimeMs, 2),
            "metadata":         self.metadata,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ModalityOutput":
        return cls(
            modality=d["modality"],
            prediction=d.get("prediction", ""),
            confidence=d.get("confidence"),
            processingTimeMs=d.get("processingTimeMs", 0.0),
            timestamp=d.get("timestamp", time.strftime("%Y-%m-%dT%H:%M:%S")),
            metadata=d.get("metadata", {}),
        )

    # ─── Factory constructors for each modality ───────────────────────────────

    @staticmethod
    def from_vision(label: str, confidence: Optional[float], latency_ms: float, metadata: Optional[dict] = None) -> "ModalityOutput":
        """
        Create a ModalityOutput from object detection.
        confidence: actual YOLO/COCO-SSD score or None.
        """
        return ModalityOutput(
            modality="vision",
            prediction=label,
            confidence=round(confidence, 4) if confidence is not None else None,
            processingTimeMs=latency_ms,
            metadata=metadata or {},
        )

    @staticmethod
    def from_ocr(text: str, confidence: Optional[float], latency_ms: float, metadata: Optional[dict] = None) -> "ModalityOutput":
        """
        Create a ModalityOutput from OCR.
        confidence: actual OCR engine confidence, or None if not available.

        NOTE: EasyOCR provides confidence. PaddleOCR provides confidence.
              If using Tesseract.js (frontend), confidence is available via hocr.
        """
        return ModalityOutput(
            modality="ocr",
            prediction=text,
            confidence=round(confidence, 4) if confidence is not None else None,
            processingTimeMs=latency_ms,
            metadata=metadata or {},
        )

    @staticmethod
    def from_speech(text: str, confidence: Optional[float], latency_ms: float, metadata: Optional[dict] = None) -> "ModalityOutput":
        """
        Create a ModalityOutput from speech recognition.
        confidence: Whisper's avg_logprob-based estimate, or Web Speech API confidence,
                    or None. This is a rough approximation — documented in whisper_engine.py.
        """
        return ModalityOutput(
            modality="speech",
            prediction=text,
            confidence=round(confidence, 4) if confidence is not None else None,
            processingTimeMs=latency_ms,
            metadata=metadata or {},
        )

    @staticmethod
    def from_gesture(gesture: str, confidence: Optional[float], latency_ms: float, metadata: Optional[dict] = None) -> "ModalityOutput":
        """
        Create a ModalityOutput from gesture recognition.
        confidence: actual softmax probability from LSTM/ONNX model, or None.
        """
        return ModalityOutput(
            modality="gesture",
            prediction=gesture,
            confidence=round(confidence, 4) if confidence is not None else None,
            processingTimeMs=latency_ms,
            metadata=metadata or {},
        )
