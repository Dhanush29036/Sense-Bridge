"""
MetricsCollector — Real-time Performance Metrics
=================================================
Computes classification metrics from actual experiment records.

Metrics computed from real data (never fabricated):
  - Accuracy
  - Precision (per-class and macro)
  - Recall    (per-class and macro)
  - F1 Score  (per-class and macro)
  - Confusion Matrix
  - Average Latency
  - P95 Latency
  - Average Confidence

All metrics are computed ONLY when expected_label is present in records.
Latency/confidence stats are always available regardless.

Usage:
    collector = MetricsCollector(session)
    metrics = collector.compute()
"""

from __future__ import annotations
import math
from collections import defaultdict
from typing import Optional, List, Dict, Any


class MetricsCollector:
    """
    Computes evaluation metrics from an experiment session's records.

    Methods:
        compute_classification() → dict with accuracy, precision, recall, F1, confusion
        compute_latency()        → dict with avg, p95, min, max latency
        compute_confidence()     → dict with avg, min, max confidence
        compute()                → full metrics dict (all of the above)
    """

    def __init__(self, records: List[dict]):
        """
        Args:
            records: List of inference record dicts from ExperimentLogger.
        """
        self._records = records

    # ─── Classification Metrics ───────────────────────────────────────────────

    def compute_classification(self) -> dict:
        """
        Compute accuracy, per-class precision/recall/F1, and confusion matrix
        from records that have both expected_label and predicted_label.

        Returns:
            Dict with keys: accuracy, macro_precision, macro_recall, macro_f1,
                            per_class, confusion_matrix, evaluated_samples.
        """
        # Only use records with ground truth
        labeled = [r for r in self._records if r.get("expected_label") is not None]
        if not labeled:
            return {
                "evaluated_samples": 0,
                "note": "No ground-truth labels available. Provide expected_label to compute metrics.",
            }

        # Build per-class counts: {true_label: {pred_label: count}}
        confusion: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        classes = set()

        for r in labeled:
            true  = str(r["expected_label"]).strip().lower()
            pred  = str(r["predicted_label"]).strip().lower()
            confusion[true][pred] += 1
            classes.add(true)
            classes.add(pred)

        classes = sorted(classes)
        n = len(labeled)

        # Accuracy
        correct = sum(1 for r in labeled if r.get("is_correct") is True)
        accuracy = correct / n if n > 0 else 0.0

        # Per-class precision, recall, F1
        per_class = {}
        for cls in classes:
            tp = confusion[cls].get(cls, 0)
            fp = sum(confusion[other].get(cls, 0) for other in classes if other != cls)
            fn = sum(confusion[cls].get(other, 0) for other in classes if other != cls)

            prec   = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1     = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
            per_class[cls] = {
                "precision": round(prec, 4),
                "recall":    round(rec,  4),
                "f1":        round(f1,   4),
                "support":   sum(confusion[cls].values()),
            }

        # Macro averages
        macro_p  = sum(v["precision"] for v in per_class.values()) / len(per_class) if per_class else 0.0
        macro_r  = sum(v["recall"]    for v in per_class.values()) / len(per_class) if per_class else 0.0
        macro_f1 = sum(v["f1"]        for v in per_class.values()) / len(per_class) if per_class else 0.0

        # Confusion matrix as nested dict
        conf_matrix = {
            cls: {other: confusion[cls].get(other, 0) for other in classes}
            for cls in classes
        }

        return {
            "evaluated_samples": n,
            "correct":           correct,
            "accuracy":          round(accuracy, 4),
            "macro_precision":   round(macro_p,  4),
            "macro_recall":      round(macro_r,  4),
            "macro_f1":          round(macro_f1, 4),
            "per_class":         per_class,
            "confusion_matrix":  conf_matrix,
            "classes":           classes,
        }

    # ─── Latency Stats ────────────────────────────────────────────────────────

    def compute_latency(self) -> dict:
        """
        Compute latency statistics from all records (regardless of ground truth).

        Returns:
            Dict with avg_ms, p95_ms, min_ms, max_ms, total_samples.
        """
        latencies = [r["latency_ms"] for r in self._records if r.get("latency_ms") is not None]
        if not latencies:
            return {"total_samples": 0, "note": "No latency data available."}

        latencies_sorted = sorted(latencies)
        n = len(latencies_sorted)
        avg = sum(latencies_sorted) / n
        p95_idx = max(0, int(math.ceil(0.95 * n)) - 1)
        p95 = latencies_sorted[p95_idx]

        return {
            "total_samples": n,
            "avg_ms":        round(avg, 2),
            "p95_ms":        round(p95, 2),
            "min_ms":        round(latencies_sorted[0], 2),
            "max_ms":        round(latencies_sorted[-1], 2),
        }

    # ─── Confidence Stats ─────────────────────────────────────────────────────

    def compute_confidence(self) -> dict:
        """
        Compute confidence statistics from records that expose confidence.

        Returns:
            Dict with avg, min, max confidence and sample count.
        """
        confs = [r["confidence"] for r in self._records
                 if r.get("confidence") is not None]
        if not confs:
            return {
                "samples_with_confidence": 0,
                "note": "Model did not expose confidence for any records.",
            }
        avg = sum(confs) / len(confs)
        return {
            "samples_with_confidence": len(confs),
            "avg_confidence":          round(avg, 4),
            "min_confidence":          round(min(confs), 4),
            "max_confidence":          round(max(confs), 4),
        }

    # ─── Per-Modality Breakdown ───────────────────────────────────────────────

    def compute_per_modality(self) -> dict:
        """
        Compute latency and confidence stats broken down by modality.

        Returns:
            Dict keyed by modality name.
        """
        by_modality: Dict[str, List[dict]] = defaultdict(list)
        for r in self._records:
            by_modality[r.get("modality", "unknown")].append(r)

        result = {}
        for modality, records in by_modality.items():
            sub = MetricsCollector(records)
            result[modality] = {
                "sample_count": len(records),
                "latency":      sub.compute_latency(),
                "confidence":   sub.compute_confidence(),
                "classification": sub.compute_classification(),
            }
        return result

    # ─── Full Metrics ─────────────────────────────────────────────────────────

    def compute(self) -> dict:
        """
        Compute all metrics and return as a unified dict.
        """
        return {
            "total_records":    len(self._records),
            "classification":   self.compute_classification(),
            "latency":          self.compute_latency(),
            "confidence":       self.compute_confidence(),
            "per_modality":     self.compute_per_modality(),
        }
