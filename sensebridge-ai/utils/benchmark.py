"""
Module 6 — Performance Benchmark
===================================
Measures latency, memory, and accuracy metrics for each AI module.

Usage:
    python -m utils.benchmark [--all] [--yolo] [--ocr] [--stt] [--gesture]
"""

import argparse
import time
import sys
import os
import numpy as np

try:
    import psutil
    _PSUTIL = True
except ImportError:
    _PSUTIL = False


def measure_memory_mb() -> float:
    if not _PSUTIL:
        return -1.0
    proc = psutil.Process(os.getpid())
    return proc.memory_info().rss / 1e6


def benchmark_yolo(n_runs: int = 50) -> dict:
    """Measure YOLO inference latency over N frames."""
    print("\n─── Benchmarking Object Detection (YOLO ONNX) ───")
    try:
        import cv2
        from modules.object_detection.detect import ObjectDetector

        detector = ObjectDetector()
        # Synthetic frame: random noise
        frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)

        latencies = []
        mem_before = measure_memory_mb()

        for i in range(n_runs):
            _, ms = detector.detect(frame)
            latencies.append(ms)
            if (i + 1) % 10 == 0:
                print(f"  Run {i+1}/{n_runs} — {ms:.1f}ms")

        mem_after = measure_memory_mb()
        return _stats("YOLO", latencies, mem_before, mem_after)

    except Exception as e:
        print(f"  [SKIP] YOLO benchmark failed: {e}")
        return {}


def benchmark_ocr(n_runs: int = 20) -> dict:
    """Measure OCR inference latency."""
    print("\n─── Benchmarking OCR (EasyOCR) ───")
    try:
        import cv2
        from modules.ocr.ocr_engine import OCREngine

        engine = OCREngine(backend="easyocr")
        frame  = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)

        # Add some text for OCR to find
        cv2.putText(frame, "STOP", (100, 200), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 5)

        latencies = []
        mem_before = measure_memory_mb()

        for i in range(n_runs):
            _, ms = engine.read(frame)
            latencies.append(ms)

        mem_after = measure_memory_mb()
        return _stats("OCR", latencies, mem_before, mem_after)

    except Exception as e:
        print(f"  [SKIP] OCR benchmark failed: {e}")
        return {}


def benchmark_gesture(n_runs: int = 100) -> dict:
    """Measure gesture LSTM inference latency."""
    print("\n─── Benchmarking Gesture Recognition (ONNX) ───")
    try:
        from modules.gesture.gesture_recognizer import GestureRecognizer

        recognizer = GestureRecognizer()
        seq_len    = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))
        fake_seq   = np.random.rand(seq_len, 63).astype(np.float32)

        latencies = []
        mem_before = measure_memory_mb()

        for i in range(n_runs):
            t0 = time.perf_counter()
            recognizer.predict_sequence(fake_seq)
            latencies.append((time.perf_counter() - t0) * 1000)

        mem_after = measure_memory_mb()
        return _stats("Gesture", latencies, mem_before, mem_after)

    except Exception as e:
        print(f"  [SKIP] Gesture benchmark failed: {e}")
        return {}


def benchmark_wer(references: list[str], hypotheses: list[str]) -> dict:
    """Compute Word Error Rate for transcription pairs."""
    from modules.stt.whisper_engine import WhisperEngine
    wer_scores = [WhisperEngine.compute_wer(r, h) for r, h in zip(references, hypotheses)]
    avg_wer = float(np.mean(wer_scores))
    print(f"\n─── STT WER Results ───")
    print(f"  Pairs evaluated : {len(wer_scores)}")
    print(f"  Average WER     : {avg_wer:.4f} ({avg_wer*100:.1f}%)")
    print(f"  Min WER         : {min(wer_scores):.4f}")
    print(f"  Max WER         : {max(wer_scores):.4f}")
    return {"avg_wer": avg_wer, "samples": len(wer_scores)}


def _stats(name: str, latencies: list[float], mem_before: float, mem_after: float) -> dict:
    arr = np.array(latencies)
    target_met = float(np.percentile(arr, 95)) < 300         # P95 < 300ms target
    result = {
        "module":     name,
        "runs":       len(arr),
        "mean_ms":    round(float(arr.mean()), 2),
        "p50_ms":     round(float(np.percentile(arr, 50)), 2),
        "p95_ms":     round(float(np.percentile(arr, 95)), 2),
        "p99_ms":     round(float(np.percentile(arr, 99)), 2),
        "min_ms":     round(float(arr.min()), 2),
        "max_ms":     round(float(arr.max()), 2),
        "mem_delta_mb": round(mem_after - mem_before, 1),
        "target_met": target_met,
    }
    print(f"\n  ── {name} Benchmark Results ──")
    for k, v in result.items():
        print(f"    {k:<20}: {v}")
    status = "✅ PASS" if target_met else "❌ FAIL (> 300ms P95)"
    print(f"  Latency target (P95 < 300ms): {status}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SenseBridge AI Benchmark")
    parser.add_argument("--all",     action="store_true")
    parser.add_argument("--yolo",    action="store_true")
    parser.add_argument("--ocr",     action="store_true")
    parser.add_argument("--gesture", action="store_true")
    args = parser.parse_args()

    results = {}
    print(f"\n{'━'*50}")
    print("  SenseBridge AI Performance Benchmark")
    print(f"{'━'*50}")

    if args.all or args.yolo:
        results["yolo"]    = benchmark_yolo()
    if args.all or args.ocr:
        results["ocr"]     = benchmark_ocr()
    if args.all or args.gesture:
        results["gesture"] = benchmark_gesture()

    print(f"\n{'━'*50}")
    print("  Summary")
    print(f"{'━'*50}")
    for module, data in results.items():
        if data:
            status = "✅" if data.get("target_met") else "❌"
            print(f"  {status} {module:<12} P95={data.get('p95_ms')}ms  Δmem={data.get('mem_delta_mb')}MB")
