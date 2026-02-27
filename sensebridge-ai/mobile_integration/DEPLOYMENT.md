# SenseBridge AI: Edge Deployment Strategy
=========================================

To achieve < 300ms latency and low power consumption on Android, we use a hybrid **Edge AI architecture** heavily relying on hardware acceleration and concurrency.

## 1. Optimal Mobile Architecture

**Option B (TFLite + MediaPipe + ONNX Runtime Mobile)** is the recommended architecture for offline-first production. 

*   **YOLOv8 & Distance**: TensorFlow Lite (INT8 Quantized). Runs on the **GPU Delegate** or Hexagon DSP (NNAPI).
*   **Gesture**: MediaPipe Hands (built-in Android SDK) + ONNX Runtime Mobile (CPU).
*   **Speech (Whisper)**: **whisper.cpp (GGML)** via JNI. Highly optimized for ARM NEON instructions. Standard PyTorch/TFLite Whisper is too slow and heavy for Android CPU.
*   **OCR**: Standard ML Kit Text Recognition (built into Android). Faster, lighter, and more accurate on-device than packaging EasyOCR/PaddleOCR into the APK.
*   **Fusion Engine**: Ported to Kotlin, running on its own lightweight coroutine dispatcher.

*(Option C - Flask Server - is only for prototyping and testing, as it drains battery fast via continuous network usage and breaks offline mode).*

## 2. Real-Time Pipeline Design

To prevent UI freezing, inference must run off the main thread.

```kotlin
Main UI Thread
     │
     ├─ CameraX Analyzer (ImageProxy)
     │       ↓
     │  [ Memory Buffer Pool ] (Prevents Garbage Collection drops)
     │       ↓
Inference Thread (HandlerThread / Coroutine)
     │
     ├─ Frame Skip (Process 1 out of every 3 frames = 10 FPS)
     ├─ YOLO TFLite (GPU Delegate)  ─>  Objects
     ├─ MediaPipe Hands             ─>  Landmarks ─> LSTM ONNX  ─> Gesture
     │       ↓
Fusion Engine Thread
     │
     ├─ Context Buffer & Priority Scoring -> Final Alert
     │       ↓
TTS / Audio Thread
     │
     └─ Android TextToSpeech (TTS) / Haptic Feedback
```

## 3. Fallback Mechanisms (Thermal & Battery Saving)

When the device gets hot or battery is low (< 20%):

1.  **Increase Frame Skip**: Process every 5th or 10th frame (6-3 FPS).
2.  **Disable High-Cost Modules**: Turn off OCR and Gesture unless explicitly requested. Rely only on YOLO + Distance.
3.  **CPU Fallback**: If GPU delegate throws an OOM or unsupported operation exception, fallback to `Interpreter.Options().setUseXNNPACK(true)` (4 threads).
4.  **Suspend TTS**: Fallback to pure haptic vibration patterns to save audio processing power.

## 4. Performance Profiling

*   **Android Studio Profiler**: Use the **Memory** tab to look for sawtooth patterns (indicates GC thrashing from allocating new FloatArrays every frame. *Solution: Pre-allocate a global buffer and reuse it*).
*   **Systrace / Perfetto**: Measure exact time spent in the TFLite `run()` method vs preprocessing.
*   **Latency Metric**: Insert `val startTime = System.currentTimeMillis()` at buffer grab and `Log.d("Latency", "${System.currentTimeMillis() - startTime}")` after Fusion Engine output.
*   **Model Benchmarking**: Use the official TFLite Benchmark Tool binary on physical devices to test operations:
    ```bash
    adb push benchmark_model /data/local/tmp
    adb shell /data/local/tmp/benchmark_model --graph=/data/local/tmp/yolov8n_int8.tflite --use_gpu=true
    ```

## 5. Production Checklist

- [ ] **Permissions**: `CAMERA`, `RECORD_AUDIO`, `VIBRATE`, `ACCESS_FINE_LOCATION` (Optional, if emergency feature needs it).
- [ ] **Model Packaging**: Do not compress `.tflite` or `.onnx` models in the APK. Add `android { aaptOptions { noCompress "tflite", "onnx" } }` to `build.gradle`. Otherwise, they must be copied to cache memory before reading, breaking direct memory mapping.
- [ ] **ProGuard/R8**: Ensure TFLite and ONNX Runtime classes are kept via `proguard-rules.pro`.
- [ ] **Device Testing**: Test explicitly on low-end devices >3 years old with MediaTek or low-tier Exynos chips.
- [ ] **Thermal Testing**: Run the app continuously for 15 minutes. Ensure the device doesn't thermal throttle leading to a sudden frame rate drop.
- [ ] **Offline Verification**: Turn on Airplane mode. Ensure all AI modules (including TTS) function correctly.
