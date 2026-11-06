"""
Exporter — CSV and JSON Export for Experiment Sessions
=======================================================
Exports experiment session data (records + metrics) to:
  - JSON: full structured dump
  - CSV:  flat record list suitable for Excel/pandas

Privacy notes:
  - Session IDs are anonymized UUIDs (no PII).
  - Camera frames are NOT stored (only inference results).
  - Audio is NOT stored (only transcription text).

Usage:
    exporter = Exporter()
    # Export to JSON
    json_str = exporter.to_json(session)
    exporter.save_json(session, "/path/to/output.json")
    # Export records to CSV
    csv_str = exporter.to_csv(session)
    exporter.save_csv(session, "/path/to/output.csv")
    # Export metrics
    exporter.save_metrics_json(metrics, "/path/to/metrics.json")
"""

from __future__ import annotations
import csv
import json
import time
import io
from pathlib import Path
from typing import Optional


class Exporter:
    """
    Exports experiment session data.

    All export operations are read-only: they do not modify sessions.
    """

    # ─── JSON export ──────────────────────────────────────────────────────────

    def to_json(self, session_dict: dict, indent: int = 2) -> str:
        """
        Serialize a session dict (from ExperimentSession.to_dict()) to JSON.

        Args:
            session_dict: Dict returned by session.to_dict()
            indent:       JSON indentation level.

        Returns:
            JSON string.
        """
        return json.dumps(session_dict, indent=indent, default=str)

    def save_json(self, session_dict: dict, path: str) -> str:
        """
        Save session JSON to a file.

        Args:
            session_dict: Dict returned by session.to_dict()
            path:         Output file path.

        Returns:
            Absolute path of saved file.
        """
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.to_json(session_dict), encoding="utf-8")
        print(f"[Exporter] Saved JSON to {p.resolve()}")
        return str(p.resolve())

    # ─── CSV export ───────────────────────────────────────────────────────────

    def to_csv(self, session_dict: dict) -> str:
        """
        Convert session records to CSV format.

        Each row is one inference record. Session-level metadata
        (session_id, ablation_label, etc.) is repeated per row.

        Returns:
            CSV string.
        """
        records = session_dict.get("records", [])
        if not records:
            return ""

        # Flatten records: expand environment dict into columns
        flat_records = []
        for r in records:
            row = {
                "session_id":      session_dict.get("session_id", ""),
                "session_name":    session_dict.get("name", ""),
                "ablation_label":  session_dict.get("ablation_label", ""),
                "input_id":        r.get("input_id", ""),
                "timestamp":       r.get("timestamp", ""),
                "modality":        r.get("modality", ""),
                "expected_label":  r.get("expected_label", ""),
                "predicted_label": r.get("predicted_label", ""),
                "confidence":      r.get("confidence", ""),
                "latency_ms":      r.get("latency_ms", ""),
                "is_correct":      r.get("is_correct", ""),
            }
            # Flatten environment metadata
            env = r.get("environment", {})
            for k, v in env.items():
                row[f"env_{k}"] = v
            # Flatten ablation config from session
            ablation = session_dict.get("ablation", {})
            for k, v in ablation.items():
                row[f"ablation_{k}"] = v
            flat_records.append(row)

        # Determine fieldnames (union of all keys)
        fieldnames = list(flat_records[0].keys()) if flat_records else []

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat_records)
        return buf.getvalue()

    def save_csv(self, session_dict: dict, path: str) -> str:
        """
        Save session records to a CSV file.

        Args:
            session_dict: Dict returned by session.to_dict()
            path:         Output file path.

        Returns:
            Absolute path of saved file.
        """
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        csv_content = self.to_csv(session_dict)
        if not csv_content:
            print(f"[Exporter] WARNING: Session has no records. CSV will be empty.")
        p.write_text(csv_content, encoding="utf-8")
        print(f"[Exporter] Saved CSV to {p.resolve()}")
        return str(p.resolve())

    def save_metrics_json(self, metrics: dict, path: str) -> str:
        """
        Save computed metrics to a JSON file.

        Args:
            metrics: Dict from MetricsCollector.compute()
            path:    Output file path.

        Returns:
            Absolute path of saved file.
        """
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
        print(f"[Exporter] Saved metrics JSON to {p.resolve()}")
        return str(p.resolve())

    # ─── Auto-naming ─────────────────────────────────────────────────────────

    @staticmethod
    def auto_path(session_dict: dict, base_dir: str, ext: str) -> str:
        """
        Generate an automatic output filename based on session metadata.

        Format: <base_dir>/<name>_<session_id>_<timestamp>.<ext>
        """
        name    = session_dict.get("name", "experiment").replace(" ", "_").lower()
        sid     = session_dict.get("session_id", "unknown")[:8]
        ts      = int(time.time())
        return str(Path(base_dir) / f"{name}_{sid}_{ts}.{ext}")
