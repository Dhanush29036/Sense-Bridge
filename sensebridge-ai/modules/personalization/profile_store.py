"""
Personalization Profile Store
===============================
Collects and persists per-user preference signals that the
AdaptiveWeights engine uses to tune alert thresholds over time.

Storage: single-file JSON (suitable for on-device).  In cloud mode,
the same schema maps 1:1 to the MongoDB User Preferences collection.
"""

from __future__ import annotations
import json
import time
import threading
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

PROFILE_DIR = Path("data/personalization")


@dataclass
class UserProfile:
    """
    Persistent user-preference snapshot.

    Automatically updated by:
      - Explicit settings (voice_speed, preferred_mode, language)
      - Inferred behaviour (dismissal counts, reaction latency)
    """
    user_id:          str
    preferred_mode:   str  = "voice"       # "voice" | "vibration" | "caption"
    voice_speed:      int  = 175           # TTS words-per-minute
    language:         str  = "en"
    high_contrast:    bool = False
    large_text:       bool = False
    font_scale:       float = 1.0

    # Learned sensitivity weights per label (0.5–2.0, default 1.0)
    label_weights:    dict = field(default_factory=dict)
    # Dismissal counts per label
    dismiss_counts:   dict = field(default_factory=dict)
    # Reaction confirmed counts per label (user responded in <3s)
    reaction_counts:  dict = field(default_factory=dict)
    # Last 20 encountered object labels (for frequency tracking)
    recent_labels:    list = field(default_factory=list)
    # Zone weights: key = "lat_lon_bucket", value = risk_multiplier
    zone_risk:        dict = field(default_factory=dict)

    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "UserProfile":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class ProfileStore:
    """
    Thread-safe loader/saver for user profiles using JSON files.
    In production, swap `_load` / `_save` with MongoDB calls.
    """

    def __init__(self):
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        self._lock  = threading.Lock()
        self._cache: dict[str, UserProfile] = {}

    def get(self, user_id: str) -> UserProfile:
        """Load profile from cache or disk, creating a new one if absent."""
        with self._lock:
            if user_id in self._cache:
                return self._cache[user_id]
            path = PROFILE_DIR / f"{user_id}.json"
            if path.exists():
                profile = UserProfile.from_dict(json.loads(path.read_text()))
            else:
                profile = UserProfile(user_id=user_id)
                self._save_unlocked(profile)
            self._cache[user_id] = profile
            return profile

    def save(self, profile: UserProfile) -> None:
        with self._lock:
            profile.updated_at = time.time()
            self._save_unlocked(profile)
            self._cache[profile.user_id] = profile

    def _save_unlocked(self, profile: UserProfile) -> None:
        path = PROFILE_DIR / f"{profile.user_id}.json"
        path.write_text(json.dumps(profile.to_dict(), indent=2))

    def record_encounter(self, user_id: str, label: str) -> None:
        """Track the last 20 object labels the user has encountered."""
        profile = self.get(user_id)
        profile.recent_labels.append(label)
        if len(profile.recent_labels) > 20:
            profile.recent_labels.pop(0)
        self.save(profile)

    def record_dismissal(self, user_id: str, label: str) -> None:
        profile = self.get(user_id)
        profile.dismiss_counts[label] = profile.dismiss_counts.get(label, 0) + 1
        self.save(profile)

    def record_reaction(self, user_id: str, label: str) -> None:
        profile = self.get(user_id)
        profile.reaction_counts[label] = profile.reaction_counts.get(label, 0) + 1
        self.save(profile)

    def update_zone_risk(self, user_id: str, lat: float, lon: float, risk: float) -> None:
        """Store risk multiplier for a geo-bucket (100m grid)."""
        profile = self.get(user_id)
        bucket = f"{round(lat, 3)}_{round(lon, 3)}"
        profile.zone_risk[bucket] = min(2.0, max(0.5, risk))
        self.save(profile)
