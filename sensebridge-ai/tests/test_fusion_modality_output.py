"""
Tests for Standard ModalityOutput & Cross-Modal Conflict Resolution in FusionEngine
==================================================================================
Verifies:
  1. FusionInput populated directly from ModalityOutput objects
  2. Confidence-weighted fusion prioritizing higher confidence predictions
  3. Safety-first conflict resolution: hazard overrides permissive gesture/speech
  4. Directional conflict resolution (Stop vs Go)
  5. Telemetry recording to PerformanceMonitor
"""

import pytest
from modules.modality_output import ModalityOutput
from modules.fusion.schema import FusionInput, UserMode, AlertPriority, OutputMode
from modules.fusion.engine import FusionEngine
from modules.performance_monitor import get_monitor


@pytest.fixture
def engine():
    return FusionEngine(cooldown_s=0.5, speech_pause_s=0.5, buffer_size=10)


def test_fusion_with_modality_outputs(engine):
    """Engine processes ModalityOutput objects correctly."""
    vision_out = ModalityOutput.from_vision(
        label="car",
        confidence=0.95,
        latency_ms=45.2,
        metadata={"distance_m": 1.2, "severity": "close"}
    )
    speech_out = ModalityOutput.from_speech(
        text="Hello ahead",
        confidence=0.88,
        latency_ms=120.0
    )

    inp = FusionInput(
        user_mode=UserMode.BLIND,
        modality_outputs=[vision_out, speech_out]
    )

    out = engine.process(inp)
    assert out.priority == AlertPriority.CRITICAL
    assert out.source == "object"
    assert "car" in out.final_alert.lower()
    assert out.confidence >= 0.90
    assert not out.suppressed


def test_hazard_overrides_permissive_gesture(engine):
    """A high-danger vision hazard must override a contradictory permissive gesture."""
    hazard_vision = ModalityOutput.from_vision(
        label="stairs",
        confidence=0.92,
        latency_ms=30.0,
        metadata={"distance_m": 0.8, "severity": "close"}
    )
    agree_gesture = ModalityOutput.from_gesture(
        gesture="thumbs_up",
        confidence=0.85,
        latency_ms=15.0
    )

    inp = FusionInput(
        user_mode=UserMode.MIXED,
        modality_outputs=[hazard_vision, agree_gesture]
    )

    out = engine.process(inp)
    assert out.conflict_detected is True
    assert "overrides" in out.conflict_resolution.lower()
    assert out.source == "object"
    assert "stairs" in out.final_alert.lower()


def test_opposing_commands_conflict_resolution(engine):
    """Opposing movement commands (Stop vs Go) resolved in favor of safety / higher confidence."""
    stop_gesture = ModalityOutput.from_gesture(
        gesture="open_palm",
        confidence=0.90,
        latency_ms=20.0
    )
    go_speech = ModalityOutput.from_speech(
        text="go forward now",
        confidence=0.75,
        latency_ms=100.0
    )

    inp = FusionInput(
        user_mode=UserMode.MIXED,
        modality_outputs=[stop_gesture, go_speech]
    )

    out = engine.process(inp)
    assert out.conflict_detected is True
    assert "stop" in out.conflict_resolution.lower()
    assert out.source == "gesture"


def test_telemetry_recorded(engine):
    """Fusion execution records latency and confidence to PerformanceMonitor."""
    monitor = get_monitor()
    initial_count = len(monitor._records["fusion"])

    inp = FusionInput(
        user_mode=UserMode.BLIND,
        modality_outputs=[
            ModalityOutput.from_vision("person", 0.85, 25.0, {"distance_m": 2.0})
        ]
    )
    out = engine.process(inp)

    assert len(monitor._records["fusion"]) == initial_count + 1
    stats = monitor.get_stats()["fusion"]
    assert stats["samples"] >= 1
    assert stats["avg_latency_ms"] >= 0
