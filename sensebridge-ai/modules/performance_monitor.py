"""
Performance Monitor — Runtime Metrics Collection
================================================
Records actual measured performance data for each inference call:
  - Inference latency (measured, not estimated)
  - Per-modality statistics
  - CPU/memory usage (via psutil, if available)
  - FPS (computed from inference timestamps)
  - Success/failure counts

IMPORTANT:
  - No values are fabricated.
  - If psutil is unavailable, CPU/memory fields will be None.
  - FPS is computed from actual timestamps, not guessed.

Usage:
    monitor = PerformanceMonitor()
    monitor.record_inference(
        modality="vision",
        prediction="person",
        confidence=0.91,
        latency_ms=184,
        success=True,
    )
    stats = monitor.get_stats()
    summary = monitor.get_summary()
"""

from __future__ import annotations
import time
import threading
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Deque


# ─── Single inference record ──────────────────────────────────────────────────

@dataclass
class InferenceRecord:
    """A single performance measurement for one inference call."""
    modality:   str
    prediction: str
    confidence: Optional[float]
    latency_ms: float
    timestamp:  float           = field(default_factory=time.time)
    success:    bool            = True
    cpu_pct:    Optional[float] = None   # None if psutil unavailable
    mem_mb:     Optional[float] = None   # None if psutil unavailable

    def to_dict(self) -> dict:
        return {
            "modality":   self.modality,
            "prediction": self.prediction,
            "confidence": round(self.confidence, 4) if self.confidence is not None else None,
            "latency_ms": round(self.latency_ms, 2),
            "timestamp":  round(self.timestamp, 3),
            "success":    self.success,
            "cpu_pct":    round(self.cpu_pct, 1) if self.cpu_pct is not None else None,
            "mem_mb":     round(self.mem_mb, 1) if self.mem_mb is not None else None,
        }


# ─── PerformanceMonitor ───────────────────────────────────────────────────────

class PerformanceMonitor:
    """
    Thread-safe performance monitor.

    Maintains a rolling window of InferenceRecords per modality
    and computes live statistics.

    Args:
        window_size: Number of recent records to keep per modality (default 200).
    """

    MODALITIES = ["vision", "ocr", "speech", "gesture", "fusion"]

    def __init__(self, window_size: int = 200):
        self._window_size = window_size
        # Rolling deque per modality
        self._records: Dict[str, Deque[InferenceRecord]] = {
            m: deque(maxlen=window_size) for m in self.MODALITIES
        }
        self._lock = threading.Lock()
        self._psutil_available = self._check_psutil()

    @staticmethod
    def _check_psutil() -> bool:
        try:
            import psutil
            return True
        except ImportError:
            return False

    # ─── Record an inference ──────────────────────────────────────────────────

    def record_inference(
        self,
        modality:   str,
        prediction: str,
        confidence: Optional[float],
        latency_ms: float,
        success:    bool = True,
    ) -> InferenceRecord:
        """
        Record a single inference result.

        Args:
            modality:   "vision" | "ocr" | "speech" | "gesture" | "fusion"
            prediction: Primary model prediction string.
            confidence: Actual model confidence (or None).
            latency_ms: Actual measured inference latency.
            success:    Whether inference succeeded.

        Returns:
            The recorded InferenceRecord.
        """
        # Optionally collect system metrics
        cpu_pct = mem_mb = None
        if self._psutil_available:
            try:
                import psutil
                cpu_pct = psutil.cpu_percent(interval=None)
                mem_mb  = psutil.Process().memory_info().rss / (1024 * 1024)
            except Exception:
                pass

        record = InferenceRecord(
            modality=modality,
            prediction=prediction,
            confidence=confidence,
            latency_ms=latency_ms,
            success=success,
            cpu_pct=cpu_pct,
            mem_mb=mem_mb,
        )

        with self._lock:
            key = modality if modality in self._records else "vision"
            self._records[key].append(record)

        return record

    # ─── Statistics ───────────────────────────────────────────────────────────

    def _compute_stats(self, records: List[InferenceRecord]) -> dict:
        """Compute latency/confidence/success stats for a list of records."""
        if not records:
            return {"samples": 0}

        latencies   = [r.latency_ms for r in records]
        confidences = [r.confidence for r in records if r.confidence is not None]
        successes   = [r for r in records if r.success]

        latencies_sorted = sorted(latencies)
        n = len(latencies_sorted)
        avg_lat = sum(latencies_sorted) / n
        p95_idx = max(0, int(math.ceil(0.95 * n)) - 1)
        p95_lat = latencies_sorted[p95_idx]

        # FPS: compute from timestamps if we have enough records
        fps = None
        if len(records) >= 2:
            ts_list = [r.timestamp for r in records]
            ts_span = ts_list[-1] - ts_list[0]
            if ts_span > 0:
                fps = round((len(records) - 1) / ts_span, 2)

        stats: dict = {
            "samples":          n,
            "successful":       len(successes),
            "failed":           n - len(successes),
            "avg_latency_ms":   round(avg_lat, 2),
            "p95_latency_ms":   round(p95_lat, 2),
            "min_latency_ms":   round(latencies_sorted[0], 2),
            "max_latency_ms":   round(latencies_sorted[-1], 2),
            "fps":              fps,
        }

        if confidences:
            stats["avg_confidence"] = round(sum(confidences) / len(confidences), 4)
            stats["min_confidence"] = round(min(confidences), 4)
            stats["max_confidence"] = round(max(confidences), 4)
        else:
            stats["avg_confidence"] = None
            stats["note"] = "No confidence data (model does not expose it)"

        # CPU/memory if available
        cpu_vals = [r.cpu_pct for r in records if r.cpu_pct is not None]
        mem_vals = [r.mem_mb  for r in records if r.mem_mb  is not None]
        stats["avg_cpu_pct"] = round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else None
        stats["avg_mem_mb"]  = round(sum(mem_vals) / len(mem_vals), 1) if mem_vals else None

        return stats

    def get_stats(self) -> dict:
        """Return per-modality statistics from all recorded data."""
        with self._lock:
            return {
                modality: self._compute_stats(list(q))
                for modality, q in self._records.items()
            }

    def get_summary(self) -> dict:
        """Return a concise summary for the research dashboard."""
        stats = self.get_stats()
        total = sum(s.get("samples", 0) for s in stats.values())
        successful = sum(s.get("successful", 0) for s in stats.values())
        failed = sum(s.get("failed", 0) for s in stats.values())

        # Global latency (all modalities together)
        all_lats = []
        with self._lock:
            for q in self._records.values():
                all_lats.extend(r.latency_ms for r in q)

        global_lat = {}
        if all_lats:
            all_lats_s = sorted(all_lats)
            n = len(all_lats_s)
            p95i = max(0, int(math.ceil(0.95 * n)) - 1)
            global_lat = {
                "avg_ms": round(sum(all_lats_s) / n, 2),
                "p95_ms": round(all_lats_s[p95i], 2),
            }

        return {
            "total_inferences": total,
            "successful":       successful,
            "failed":           failed,
            "global_latency":   global_lat,
            "per_modality":     stats,
            "psutil_available": self._psutil_available,
        }

    def reset(self) -> None:
        """Clear all recorded data."""
        with self._lock:
            for q in self._records.values():
                q.clear()


# ─── Module-level singleton ───────────────────────────────────────────────────
# Shared monitor used by all API routes
_global_monitor: Optional[PerformanceMonitor] = None


def get_monitor() -> PerformanceMonitor:
    global _global_monitor
    if _global_monitor is None:
        _global_monitor = PerformanceMonitor()
    return _global_monitor
