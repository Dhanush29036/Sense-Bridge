# SenseBridge — Testing & Validation Strategy

## 1. Testing Pyramid

```
         ┌──────────────┐
         │  Field Tests  │  ← Real users, real environments
         ├──────────────┤
         │ Integration  │  ← Module-to-module data flow
         ├──────────────┤
         │  Unit Tests  │  ← Individual functions / classes
         └──────────────┘
```

---

## 2. Unit Test Coverage

Run all unit tests:
```bash
python -m pytest tests/ -v --tb=short
```

| Module | Test File | Key Assertions |
|--------|-----------|---------------|
| FusionEngine | `test_fusion_engine.py` | Priority bucketing, cooldown, mode adaptation |
| FallDetector | `test_integration.py` | State machine transitions, false-alarm prevention |
| SOSEngine | `test_integration.py` | Shake detection threshold, voice keyword match |
| AdaptiveWeights | `test_integration.py` | EMA decay (W_MIN floor), EMA boost (W_MAX ceiling) |
| EnvironmentClassifier | `test_integration.py` | Outdoor/indoor label split, crowd density, TTS volume |
| DistanceEstimator | *(add manually)* | Focal length calibration accuracy ± 10% |
| PriorityScorer | *(add manually)* | Score for each label at each distance bracket |

### Edge Cases to Cover
- Detection list is **empty** → engine must return SILENT output
- All signals below confidence threshold → no alert
- Cooldown = 0s (stress mode) → no crash
- Malformed JSON from API → 422 response, no server error
- Speech transcript is empty string → no SOS arm

---

## 3. Integration Test Suite (`tests/test_integration.py`)

10 tests covering all major inter-module flows. Run with:
```bash
python -m pytest tests/test_integration.py -v
```

**Scenarios covered:**
1. Full BLIND mode E2E (YOLO → Fusion → TTS+Vib)
2. Full DEAF mode E2E (Whisper → Fusion → Caption)
3. Full MUTE mode E2E (Gesture → Fusion → Sentence)
4. Adaptive weight decay after 5 dismissals
5. Adaptive weight boost after 5 reactions
6. Fall detector full sequence (FREE_FALL → IMPACT → MOTIONLESS → CONFIRMED)
7. Fall detector stumble recovery (no free-fall phase → IDLE)
8. SOS shake trigger (3 shakes → armed)
9. SOS voice command trigger
10. Environment classifier: outdoor, crowd, noise → TTS volume

---

## 4. Real-Time Latency Testing

**Target**: P95 latency < 300ms for the full inference pipeline.

### Measurement method:
```python
# In detect.py, already implemented — results visible in benchmark:
python -m utils.benchmark --all
```

| Module | Target P95 | Measurement |
|--------|-----------|-------------|
| YOLO (ONNX, frame-skipped) | < 200ms | `benchmark.py --yolo` |
| OCR (EasyOCR) | < 800ms | `benchmark.py --ocr` |
| Gesture LSTM (ONNX) | < 30ms | `benchmark.py --gesture` |
| Whisper Tiny (5s chunk) | < 2000ms | Manual — Whisper chunk processing |
| Fusion Engine | < 5ms | `test_fusion_engine_stress_100_frames` |

### Android-specific:
Use **Android Studio CPU Profiler** + the TFLite Benchmark Tool:
```bash
adb shell /data/local/tmp/benchmark_model \
  --graph=/data/local/tmp/yolov8n_int8.tflite \
  --use_gpu=true --num_runs=100
```

---

## 5. Battery Consumption Testing

### Protocol:
1. **Baseline**: Charge device to 100%. Record current drain with screen on but app idle for 30 min.
2. **App running**: Enable all 3 AI modules (Vision, Speech, Gesture). Run continuously for 30 min.
3. **Compute**: `Drain% = (start_battery - end_battery) / 0.5 hours`

**Target**: < 8% per hour (vs. ~12% for competing apps like Be My Eyes).

Use `adb shell dumpsys battery` to read battery level programmatically.

### Optimization knobs:
- Frame skip (every Nth frame) — biggest lever
- GPU delegate vs CPU — varies by device
- OCR on-demand only vs continuous — major saving

---

## 6. Field Trial Plan

### Trial Scenarios

| Scenario | Location | Participants | Duration | AI Modules |
|----------|----------|-------------|---------|------------|
| Campus Navigation | University corridor | 5 visually impaired users | 20 min | YOLO, Distance, TTS |
| Road Crossing | Zebra crossing | Researcher-supervised | 10 min | YOLO (car/crosswalk), SOS |
| Indoor Obstacle | Room with chairs, stairs | 3 users | 15 min | YOLO, Fusion |
| Speech Transcription | Cafeteria (noisy) | 3 hearing-impaired users | 20 min | Whisper, Caption |
| Gesture Communication | Quiet room | 3 speech-impaired users | 20 min | MediaPipe, LSTM |

### Safety Protocol
- Researcher walks alongside ALL participants at all times.
- Outdoor trials: safety vest worn by participant.
- Emergency stop: Researcher holds a physical override button.
- No trial near active traffic; use closed road / carpark.

### Data Recording Format
```json
{
  "trial_id": "T001",
  "scenario":  "campus_navigation",
  "participant_id": "P003",
  "duration_s": 1200,
  "alerts_fired": 48,
  "false_positives": 3,
  "missed_detections": 1,
  "user_rating": 4,
  "latency_samples_ms": [180, 210, 195, ...]
}
```

### Ethics Checklist
- [ ] Written informed consent from all participants
- [ ] No personally identifiable video stored (raw frames deleted immediately)
- [ ] Participants can stop trial at any time without penalty
- [ ] IRB / Ethics committee approval obtained before field trials
- [ ] Data stored encrypted, accessible only to research team

---

## 7. Performance Evaluation Framework

| Metric | Module | How to Measure | Target |
|--------|--------|---------------|--------|
| **mAP@50** | Object Detection | `ultralytics val` on test set | > 0.75 |
| **F1 Score** | Gesture Recognition | `sklearn.metrics.f1_score` | > 0.90 |
| **Accuracy** | Gesture Recognition | `classification_report` | > 92% |
| **WER** | Speech-to-Text | `jiwer.wer(reference, hypothesis)` | < 15% |
| **Char Accuracy** | OCR | `1 - CER` (character error rate) | > 85% |
| **P95 Latency** | Full pipeline | `utils/benchmark.py` | < 300ms |
| **Battery drain** | Whole app | `adb dumpsys battery` | < 8%/hr |
| **SUS Score** | User Experience | System Usability Scale (10 questions) | ≥ 68 |

### SUS Score Collection:
Use the 10-question Likert scale after each field trial session.
Score ≥ 68 = "Good usability", ≥ 85 = "Excellent".
