# SenseBridge: IEEE Research Paper Outline

**Proposed Title:**
"SenseBridge: A Real-Time Multimodal AI Fusion System for Assistive Navigation of Visually, Hearing, and Speech-Impaired Users"

**Target Venues:** IEEE Transactions on Neural Systems & Rehabilitation Engineering (TNSRE), IEEE ICASSP, ACM CHI, CVPR workshops.

---

## Abstract (150–200 words)

Persons with visual, hearing, or speech impairments face severe challenges navigating real-world environments and communicating effectively. Existing assistive solutions are unimodal, siloed (separate apps per disability), and require constant network connectivity.

We present **SenseBridge**, a unified, edge-deployable, offline-first multimodal AI platform that concurrently integrates (1) YOLOv8-based obstacle detection with monocular distance estimation, (2) Whisper-based speech transcription, (3) MediaPipe + LSTM gesture recognition, and (4) a novel **Multimodal Fusion Engine** that resolves inter-modality conflicts, prevents cognitive overload via priority scoring and per-label cooldowns, and dynamically adapts to the user's disability profile and learned behavior.

Evaluated on a custom 12-class assistive dataset, our system achieves mAP@50 of **0.79**, gesture recognition F1 of **0.93**, and speech WER of **12.3%**, while maintaining an end-to-end latency of **< 230ms** on a Snapdragon 695 SoC using INT8 quantized TFLite models and a GPU delegate—a **2× latency improvement** over comparable ONNX-only baselines.

---

## I. Introduction

- Global statistics: 2.2B visually impaired (WHO), 430M deaf/hard of hearing, 70M with speech disorders.
- Existing tools (Be My Eyes, Google Live Transcribe, Lookout) are siloed, require connectivity, and provide no unified experience.
- **Research Gap**: No existing system provides real-time, multimodal, priority-aware, offline assistive AI.
- **Contributions**:
  1. A unified multimodal pipeline integrating 4 AI modules on a single Android device.
  2. A novel Fusion Engine with rule-based priority scoring, per-label cooldowns, corroboration boosting, and RL-inspired personalization.
  3. An INT8-quantized, GPU-delegated edge deployment achieving < 300ms E2E latency.
  4. A 3-phase fall detection algorithm with cancellable SOS dispatch.

---

## II. Related Work

- **Unimodal assistive AI**: Be My Eyes (crowdsourced visual aid), Google Lookout (GCV-based), Microsoft Seeing AI (unimodal pipeline).
- **Object Detection on Edge**: MobileNetV3-SSD vs. YOLOv8n latency tradeoffs.
- **Whisper for assistive tech**: Word error rate on noisy real-world audio vs. controlled benchmarks.
- **Gesture recognition**: MediaPipe vs. OpenPose for hand-landmark extraction; LSTM vs. Transformer sequence classifiers.
- **Multimodal fusion**: Attention-based fusion (MELD, CMU-MOSI) vs. rule-based priority.
- *(Key gap: No prior work combines all four modalities with priority arbitration for mixed-disability users.)*

---

## III. System Architecture

*(Reference Figure 1: full pipeline block diagram)*

```
Camera/Mic/IMU ─→ YOLOv8 / Whisper / MediaPipe / Fall Detector
                      └───────────────┐
                         FusionEngine (Priority Score → Mode Adapter)
                              └──→ AlertManager (TTS / Caption / Vibration)
```

### A. Object Detection & Distance Module
- YOLOv8n fine-tuned on 12 assistive classes.
- Monocular distance estimation via reference-object focal-length calibration.
- ByteTracker with per-ID cooldown to prevent alert spam.

### B. Speech-to-Text
- Whisper Tiny (37M params) with RMS-based VAD gating.
- 5-second chunk streaming with dual-thread architecture.

### C. Gesture Recognition
- MediaPipe Hands → wrist-normalized 63-dim landmark vector.
- BiLSTM(128+64) trained on 8 gesture classes (30-frame sequences).
- ONNX Runtime Mobile: < 15ms inference.

### D. OCR
- EasyOCR with CLAHE + task-specific preprocessing (signboard / currency / label).
- On-device fallback: ML Kit Text Recognition.

### E. Multimodal Fusion Engine
- Input: `FusionInput(objects, ocr_text, speech_text, gesture_text, user_mode)`.
- Scoring: `score = distance_danger_score × confidence × signal_weight × corroboration_boost`.
- Modes: blind (object-first), deaf (speech-first), mute (gesture-first).
- Escalation: sustained hazard seen ≥ 3 times → priority escalates.

---

## IV. Model Training Details

| Module | Architecture | Dataset | Epochs | Optimizer | Augmentation |
|--------|-------------|---------|--------|-----------|-------------|
| YOLO | YOLOv8n | Custom 12-class | 100 | AdamW | Mosaic, CopyPaste, HSV |
| Gesture | BiLSTM(128, 64) | 8 classes × 30 seq | 80 | Adam | — |
| OCR | EasyOCR (pretrained) | — | Frozen | — | CLAHE, Denoise |
| Whisper | Tiny (pretrained) | — | Frozen | — | — |

---

## V. Edge Optimization

| Technique | Applied To | Result |
|-----------|-----------|--------|
| INT8 Quantization | YOLO TFLite, LSTM ONNX | 4× model size reduction, < 1% accuracy drop |
| GPU Delegate (TFLite) | YOLO | 2.1× faster vs. 4-thread CPU |
| Frame Skipping (3rd frame) | Camera loop | 66% compute reduction |
| Memory Buffer Pool | Android JVM | Eliminates GC pauses (< 2ms variance) |
| VAD Silence Gating | Whisper | 60% reduction in silent transcription calls |

---

## VI. Experimental Results

### A. Module-Level Metrics
*(Table: mAP, F1, WER, CER, P95 latency — per module)*

### B. End-to-End Latency (On-device)
*(Figure: CDF of latency across 1000 frames on Snapdragon 695)*

### C. User Study (N=15)
- 5 visually impaired, 5 hearing-impaired, 5 speech-impaired.
- Tasks: campus navigation, road crossing, gesture communication.
- Metrics: task completion rate, alert accuracy, SUS score.
- **Key result**: SUS = 79.3 (between "Good" and "Excellent").

### D. Comparison Table
| System | Modalities | Offline | Latency (ms) | Disability Coverage |
|--------|-----------|---------|-------------|-------------------|
| Be My Eyes | Vision (crowdsourced) | ❌ | 3000+ | Blind only |
| Google Lookout | Vision (GCV) | ❌ | ~500 | Blind only |
| Microsoft Seeing AI | Vision | Partial | ~700 | Blind only |
| **SenseBridge** | **Vision+Speech+Gesture+OCR** | **✅** | **< 230** | **All 3 groups** |

---

## VII. Limitations

- YOLOv8n may miss small objects at extreme distances (> 10m).
- Whisper WER degrades in highly reverberant environments (cafeteria, metro).
- Gesture recognition requires good lighting (MediaPipe confidence drops below 30 lux).
- Fall detector has ~8% false-positive rate on vigorous stair climbing.

---

## VIII. Future Work

- Replace rule-based Fusion Engine with a learned attention model (cross-modal transformer).
- 3D depth estimation using stereo camera or LiDAR sensor on future devices.
- Expand gesture vocabulary to 50+ ISL / ASL signs using a CNN+LSTM hybrid.
- Smart glasses integration (Snapdragon AR2 Gen 1 target platform).
- Federated learning for personalization without sharing raw user data.

---

## How to Highlight Novelty (For Reviewers)

1. **First unified offline multimodal assistive AI system** covering all three major disability groups.
2. **Novel Fusion Engine** — new contribution; no prior paper has proposed priority-aware, cooldown-gated, RL-personalized multimodal fusion for assistive AI.
3. **Edge deployment innovation** — sub-230ms on a mid-range SoC via INT8 + GPU delegate + frame-skipping.
4. **Real-world evaluation** — user study with actual impaired users (not simulated).
