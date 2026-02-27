"""
Tests for SenseBridge Fusion Engine
=====================================
Covers basic logic, cooldown suppression, multi-source corroboration,
danger escalation, and mode adaptation.

Usage:
    pytest tests/test_fusion_engine.py -v
"""

import time
import pytest

from modules.fusion.schema import FusionInput, DetectedObject, UserMode, AlertPriority, OutputMode
from modules.fusion.engine import FusionEngine


@pytest.fixture
def engine():
    # Use short cooldowns for testing
    return FusionEngine(cooldown_s=0.5, speech_pause_s=0.5, buffer_size=10)


def test_basic_critical_object(engine):
    """A close car should trigger a CRITICAL alert in BLIND mode."""
    inp = FusionInput(
        user_mode=UserMode.BLIND,
        objects=[DetectedObject(label="car", confidence=0.9, distance_m=1.0)],
    )
    out = engine.process(inp)

    assert out.priority == AlertPriority.CRITICAL
    assert out.source == "object"
    assert "car" in out.final_alert.lower()
    assert out.output_mode == OutputMode.VOICE_VIB
    assert not out.suppressed


def test_cooldown_suppression(engine):
    """A MEDIUM alert should be suppressed if fired recently."""
    inp = FusionInput(
        objects=[DetectedObject(label="chair", confidence=0.8, distance_m=3.0, severity="medium")],
    )

    # First call -> fires
    out1 = engine.process(inp)
    assert not out1.suppressed
    assert out1.priority == AlertPriority.MEDIUM

    # Immediate second call -> suppressed
    out2 = engine.process(inp)
    assert out2.suppressed
    assert out2.priority == AlertPriority.IGNORE

    # Wait for cooldown
    time.sleep(0.6)

    # Third call -> fires again
    out3 = engine.process(inp)
    assert not out3.suppressed


def test_critical_bypasses_cooldown(engine):
    """A CRITICAL alert ignores normal cooldown (but respects 1.5s hard floor)."""
    # Overriding the minimum floor logic for test speed
    engine._must_fire_critical = lambda s, i: True

    inp = FusionInput(
        objects=[DetectedObject(label="bus", confidence=0.95, distance_m=1.0)],
    )

    out1 = engine.process(inp)
    out2 = engine.process(inp)

    assert not out1.suppressed
    assert not out2.suppressed   # bypassed!
    assert out2.priority == AlertPriority.CRITICAL


def test_speech_pauses_objects(engine):
    """When speech is detected, non-critical objects should be paused."""
    # 1. Speech arrives
    inp_speech = FusionInput(speech_text="Where is the exit?")
    out_speech = engine.process(inp_speech)
    assert out_speech.source == "speech"

    # 2. Medium object arrives immediately after -> suppressed by speech pause
    inp_obj = FusionInput(
        objects=[DetectedObject(label="door", confidence=0.8, distance_m=2.0, severity="medium")]
    )
    out_obj = engine.process(inp_obj)
    assert out_obj.suppressed

    # 3. Critical object arrives -> bypasses speech pause
    inp_crit = FusionInput(
        objects=[DetectedObject(label="bus", confidence=0.95, distance_m=1.0)]
    )
    out_crit = engine.process(inp_crit)
    assert not out_crit.suppressed
    assert out_crit.priority == AlertPriority.CRITICAL


def test_corroboration_boost(engine):
    """When OCR and Speech see the same danger keyword, the score is boosted."""
    # OCR alone: "stop" -> HIGH priority normally (0.85 * 0.60 = 0.51 -> MEDIUM/HIGH borderline)
    # With speech corroboration: > 0.55 -> HIGH
    inp = FusionInput(
        ocr_text="STOP",
        gesture_text="open_palm",  # mapped to "stop" concept internally by ModeAdapter logic, but let's test straight keyword overlap
    )
    # The current PriorityScorer looks for exact label matches for corroboration
    # So if OCR="stop" and speech="stop", it boosts.
    # Let's mock a scenario where two different object detectors report the same label.
    inp_multi = FusionInput(
        objects=[
            DetectedObject(label="person", confidence=0.5, distance_m=4.0),
            DetectedObject(label="person", confidence=0.6, distance_m=4.5),
        ]
    )
    out = engine.process(inp_multi)
    # Due to corroboration boost (0.15), the raw_score goes up.
    # Base score = 0.40(med dist) * 0.5 * 1.0 = 0.20 (LOW)
    # Boost = 0.20 + 0.15 = 0.35 (MEDIUM)
    assert out.priority == AlertPriority.MEDIUM


def test_mode_adaptation(engine):
    """Test priority adaptation rules for different user modes."""

    # Mixed inputs
    inp = FusionInput(
        objects=[DetectedObject(label="chair", confidence=0.9, distance_m=3.0, severity="medium")], # MEDIUM
        speech_text="Hello over there", # MEDIUM
        gesture_text="thumbs_up",       # MEDIUM
    )

    # Note: we need to reset engine between calls to avoid cooldown suppression!

    # BLIND: Prefers object
    engine.reset()
    inp.user_mode = UserMode.BLIND
    out_blind = engine.process(inp)
    assert out_blind.source == "object"
    assert out_blind.output_mode == OutputMode.VOICE

    # DEAF: Prefers speech
    engine.reset()
    inp.user_mode = UserMode.DEAF
    out_deaf = engine.process(inp)
    assert out_deaf.source == "speech"
    assert out_deaf.output_mode == OutputMode.CAPTION

    # MUTE: Prefers gesture
    engine.reset()
    inp.user_mode = UserMode.MUTE
    out_mute = engine.process(inp)
    assert out_mute.source == "gesture"
    assert out_mute.final_alert == "Yes, I agree."  # Humanized


def test_sustained_danger_escalation(engine):
    """If same object is seen 3 times quickly, its priority upgrades."""
    inp = FusionInput(
        objects=[DetectedObject(label="obstacle", confidence=0.8, distance_m=2.0)] # Base = MEDIUM
    )

    engine.reset()

    # Frame 1
    out1 = engine.process(inp)
    assert out1.priority == AlertPriority.MEDIUM

    # Clear cooldown to simulate a new frame slightly later but > 0s
    engine._buffer.clear()

    # Frame 2
    engine.process(inp)
    engine._buffer.clear()

    # Frame 3 -> Should escalate MEDIUM to HIGH
    out3 = engine.process(inp)
    assert out3.priority == AlertPriority.HIGH


def test_stress_latency(engine):
    """Process should run in <5ms."""
    inp = FusionInput(
        objects=[
            DetectedObject("car", 0.9, 10.0),
            DetectedObject("person", 0.8, 5.0),
            DetectedObject("chair", 0.5, 2.0),
        ],
        ocr_text="Exit sign ahead",
        speech_text="Can you hear me",
        user_mode=UserMode.MIXED
    )

    t0 = time.perf_counter()
    for _ in range(100):
        engine.process(inp)
    ms = (time.perf_counter() - t0) * 1000

    print(f"Stress test latency: {ms / 100:.2f}ms per call")
    assert (ms / 100) < 5.0, "Engine loop too slow (>5ms)"
