"""
Flask Routes — Experiment Management API
=========================================
Provides REST endpoints for the Research/Experiment Mode.

Endpoints:
    POST   /api/experiments/sessions          → start a new session
    GET    /api/experiments/sessions          → list all sessions
    GET    /api/experiments/sessions/<id>     → get session details
    POST   /api/experiments/sessions/<id>/end → end a session
    POST   /api/experiments/log               → log an inference record
    GET    /api/experiments/sessions/<id>/metrics → compute metrics
    GET    /api/experiments/sessions/<id>/export/json → export JSON
    GET    /api/experiments/sessions/<id>/export/csv  → export CSV
    GET    /api/experiments/dashboard         → global performance stats
    POST   /api/experiments/dashboard/reset   → reset monitor counters

All experiment data is researcher-session-scoped.
Privacy: session IDs are anonymized UUIDs. No PII is stored.
"""

import time
import io
from flask import Blueprint, request, jsonify, Response
from modules.experiments.logger import ExperimentLogger
from modules.experiments.session import AblationConfig, EnvironmentMeta
from modules.experiments.metrics import MetricsCollector
from modules.experiments.exporter import Exporter
from modules.performance_monitor import get_monitor

experiments_bp = Blueprint("experiments", __name__)

# ─── Module-level singletons ──────────────────────────────────────────────────
# These persist for the lifetime of the Flask process.
_logger   = ExperimentLogger()
_exporter = Exporter()


# ─── Session Management ───────────────────────────────────────────────────────

@experiments_bp.post("/experiments/sessions")
def start_session():
    """
    Start a new experiment session.

    Body:
    {
        "name": "Gesture Evaluation",
        "ablation": {
            "vision": false, "ocr": false, "speech": false,
            "gesture": true, "fusion": false
        },
        "environment": {
            "lighting": "low", "noise": "quiet", "camera": "medium",
            "motion": "static", "text": "clear", "gesture": "simple",
            "notes": "Indoor lab test"
        },
        "device_info": { "platform": "Android", "model": "Pixel 7" }
    }
    """
    data = request.get_json(silent=True) or {}

    ablation_data = data.get("ablation", {})
    env_data      = data.get("environment", {})
    device_info   = data.get("device_info", {})

    try:
        ablation    = AblationConfig.from_dict(ablation_data) if ablation_data else AblationConfig()
        environment = EnvironmentMeta.from_dict(env_data) if env_data else EnvironmentMeta()
    except Exception as e:
        return jsonify({"success": False, "message": f"Invalid config: {e}"}), 422

    session = _logger.start_session(
        name=data.get("name", f"Session_{int(time.time())}"),
        ablation=ablation,
        environment=environment,
        device_info=device_info,
    )

    s = session.to_dict()
    s.pop("records", None)  # don't send records in start response
    return jsonify({"success": True, "session": s}), 201


@experiments_bp.get("/experiments/sessions")
def list_sessions():
    """Return summary list of all sessions."""
    return jsonify({"success": True, "sessions": _logger.list_sessions()})


@experiments_bp.get("/experiments/sessions/<session_id>")
def get_session(session_id: str):
    """Return full session data including all records."""
    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404
    return jsonify({"success": True, "session": session.to_dict()})


@experiments_bp.post("/experiments/sessions/<session_id>/end")
def end_session(session_id: str):
    """Mark a session as ended."""
    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404
    _logger.end_session(session)
    return jsonify({
        "success": True,
        "session_id":   session.session_id,
        "sample_count": session.sample_count,
        "duration_s":   session.duration_s,
    })


# ─── Record Logging ───────────────────────────────────────────────────────────

@experiments_bp.post("/experiments/log")
def log_record():
    """
    Log a single inference result to an active session.

    Body:
    {
        "session_id":      "abc12345...",
        "modality":        "gesture",
        "predicted_label": "thumbs_up",
        "confidence":      0.92,
        "latency_ms":      184.3,
        "expected_label":  "thumbs_up",   ← optional (ground truth)
        "metadata":        {}              ← optional
    }

    Returns:
    {
        "success": true,
        "record": { ...the logged record... }
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "JSON body required"}), 400

    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"success": False, "message": "'session_id' required"}), 400

    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404

    modality        = data.get("modality", "unknown")
    predicted_label = data.get("predicted_label", "")
    confidence      = data.get("confidence")   # None is valid
    latency_ms      = float(data.get("latency_ms", 0.0))
    expected_label  = data.get("expected_label")   # None = no ground truth
    metadata        = data.get("metadata", {})

    if not predicted_label:
        return jsonify({"success": False, "message": "'predicted_label' required"}), 400

    record = _logger.log(
        session=session,
        modality=modality,
        predicted_label=predicted_label,
        confidence=float(confidence) if confidence is not None else None,
        latency_ms=latency_ms,
        expected_label=expected_label,
        metadata=metadata,
    )

    # Also record in performance monitor
    get_monitor().record_inference(
        modality=modality,
        prediction=predicted_label,
        confidence=float(confidence) if confidence is not None else None,
        latency_ms=latency_ms,
        success=True,
    )

    return jsonify({"success": True, "record": record})


# ─── Metrics ──────────────────────────────────────────────────────────────────

@experiments_bp.get("/experiments/sessions/<session_id>/metrics")
def session_metrics(session_id: str):
    """Compute and return metrics for a session."""
    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404

    modality_filter = request.args.get("modality")
    records = session.records
    if modality_filter:
        records = [r for r in records if r.get("modality") == modality_filter]

    collector = MetricsCollector(records)
    metrics   = collector.compute()
    return jsonify({"success": True, "session_id": session_id, "metrics": metrics})


# ─── Export ───────────────────────────────────────────────────────────────────

@experiments_bp.get("/experiments/sessions/<session_id>/export/json")
def export_json(session_id: str):
    """Export session as JSON download."""
    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404

    json_str = _exporter.to_json(session.to_dict())
    filename = f"sensebridge_session_{session_id[:8]}.json"
    return Response(
        json_str,
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@experiments_bp.get("/experiments/sessions/<session_id>/export/csv")
def export_csv(session_id: str):
    """Export session records as CSV download."""
    session = _logger.get_session(session_id)
    if not session:
        return jsonify({"success": False, "message": "Session not found"}), 404

    csv_str  = _exporter.to_csv(session.to_dict())
    filename = f"sensebridge_session_{session_id[:8]}.csv"
    return Response(
        csv_str,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── Research Dashboard ───────────────────────────────────────────────────────

@experiments_bp.get("/experiments/dashboard")
def dashboard():
    """
    Return global performance statistics (from PerformanceMonitor).

    All values are computed from actual recorded inferences.
    """
    monitor = get_monitor()
    return jsonify({"success": True, "dashboard": monitor.get_summary()})


@experiments_bp.post("/experiments/dashboard/reset")
def reset_dashboard():
    """Reset the performance monitor counters."""
    get_monitor().reset()
    return jsonify({"success": True, "message": "Performance monitor reset"})
