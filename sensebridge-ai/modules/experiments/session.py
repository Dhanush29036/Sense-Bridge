"""
ExperimentSession — Research Session Management
================================================
Encapsulates a single experiment session with:
  - Auto-generated session ID
  - Ablation configuration (which modalities are active)
  - Environmental metadata (lighting, noise, etc.)
  - Per-sample record list (actual inference results)

Usage:
    session = ExperimentSession(
        name="Gesture Evaluation",
        ablation=AblationConfig(vision=False, gesture=True),
        environment=EnvironmentMeta(lighting="low", noise="moderate"),
    )
    session.start()
    session.add_record(record)
    session.end()
"""

from __future__ import annotations
import uuid
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any


# ─── Ablation Configuration ───────────────────────────────────────────────────

@dataclass
class AblationConfig:
    """
    Defines which modalities are active in this experiment.
    Used to support ablation study comparisons.

    E.g.:
        vision=True, ocr=True, speech=False, gesture=False, fusion=False
        → "Vision + OCR without fusion"
    """
    vision:  bool = True
    ocr:     bool = True
    speech:  bool = True
    gesture: bool = True
    fusion:  bool = True

    def label(self) -> str:
        """Returns a short descriptive label for the current config."""
        active = [k for k, v in asdict(self).items() if v and k != "fusion"]
        suffix = "+fusion" if self.fusion else "-fusion"
        return "+".join(active) + suffix

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AblationConfig":
        return cls(**{k: bool(v) for k, v in d.items() if k in cls.__dataclass_fields__})


# ─── Environmental Metadata ───────────────────────────────────────────────────

@dataclass
class EnvironmentMeta:
    """
    Researcher-entered environmental conditions for this session.
    All values are entered manually — NOT auto-detected or faked.

    Lighting:  normal | low | high
    Noise:     quiet | moderate | high
    Camera:    near | medium | far
    Motion:    static | moderate | high
    Text:      clear | low_contrast | rotated   (for OCR experiments)
    Gesture:   simple | complex | fast           (for gesture experiments)
    """
    lighting: str = "normal"     # normal | low | high
    noise:    str = "quiet"      # quiet | moderate | high
    camera:   str = "medium"     # near | medium | far
    motion:   str = "static"     # static | moderate | high
    text:     str = "clear"      # clear | low_contrast | rotated
    gesture:  str = "simple"     # simple | complex | fast
    notes:    str = ""           # free-form researcher notes

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "EnvironmentMeta":
        valid = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**valid)


# ─── ExperimentSession ────────────────────────────────────────────────────────

@dataclass
class ExperimentSession:
    """
    Represents a single research experiment session.

    Attributes:
        name:        Human-readable experiment name.
        session_id:  Auto-generated UUID (anonymized).
        ablation:    Which modalities were active.
        environment: Researcher-entered environmental metadata.
        records:     List of per-sample InferenceRecord dicts.
        start_ts:    Unix timestamp when session started.
        end_ts:      Unix timestamp when session ended (or None).
        device_info: Optional platform/device metadata.
    """
    name:        str
    ablation:    AblationConfig     = field(default_factory=AblationConfig)
    environment: EnvironmentMeta    = field(default_factory=EnvironmentMeta)
    session_id:  str                = field(default_factory=lambda: str(uuid.uuid4())[:16])
    records:     List[Dict]         = field(default_factory=list)
    start_ts:    Optional[float]    = None
    end_ts:      Optional[float]    = None
    device_info: Dict[str, Any]     = field(default_factory=dict)

    def start(self) -> None:
        """Mark the session as started."""
        self.start_ts = time.time()

    def end(self) -> None:
        """Mark the session as ended."""
        self.end_ts = time.time()

    def add_record(self, record: dict) -> None:
        """Append an inference record (from ExperimentLogger) to this session."""
        self.records.append(record)

    @property
    def duration_s(self) -> Optional[float]:
        if self.start_ts and self.end_ts:
            return round(self.end_ts - self.start_ts, 2)
        return None

    @property
    def sample_count(self) -> int:
        return len(self.records)

    def to_dict(self) -> dict:
        return {
            "session_id":  self.session_id,
            "name":        self.name,
            "start_ts":    self.start_ts,
            "end_ts":      self.end_ts,
            "duration_s":  self.duration_s,
            "sample_count": self.sample_count,
            "ablation":    self.ablation.to_dict(),
            "ablation_label": self.ablation.label(),
            "environment": self.environment.to_dict(),
            "device_info": self.device_info,
            "records":     self.records,
        }
