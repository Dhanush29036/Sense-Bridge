"""
Module 4C — Real-time Gesture Recognizer (ONNX Runtime)
=========================================================
Loads trained LSTM model (ONNX format) and runs live inference.
Falls back to Keras .keras model if ONNX is absent.

Usage:
    recognizer = GestureRecognizer()
    recognizer.start(callback=lambda r: print(r))
"""

import os
import time
import threading
import queue
import numpy as np
from pathlib import Path
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

GESTURE_ONNX   = os.getenv("GESTURE_MODEL_PATH", "models/gesture/lstm_gesture.onnx")
GESTURE_KERAS  = "models/gesture/lstm_gesture.keras"
CLASSES_FILE   = os.getenv("GESTURE_CLASSES", "data/gesture/classes.txt")
SEQ_LEN        = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))
LANDMARKS_DIM  = 63
CONF_THRESHOLD = 0.75      # min softmax probability to accept a gesture


@dataclass
class GestureResult:
    gesture:    str
    confidence: float
    latency_ms: float


class GestureRecognizer:
    """
    Real-time gesture recognizer using MediaPipe + ONNX LSTM.
    """

    def __init__(self):
        self._classes   = Path(CLASSES_FILE).read_text().strip().splitlines()
        self._session   = None
        self._keras_model = None
        self._sequence: list[np.ndarray] = []
        self._running   = False
        self._callback  = None
        self._load_model()
        self._load_mediapipe()

    def _load_model(self) -> None:
        if Path(GESTURE_ONNX).exists():
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 4
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._session = ort.InferenceSession(GESTURE_ONNX, sess_options=opts,
                                                  providers=["CPUExecutionProvider"])
            print(f"[INFO] Gesture ONNX loaded: {GESTURE_ONNX}")
        elif Path(GESTURE_KERAS).exists():
            import tensorflow as tf
            self._keras_model = tf.keras.models.load_model(GESTURE_KERAS)
            print(f"[INFO] Gesture Keras model loaded: {GESTURE_KERAS}")
        else:
            raise FileNotFoundError("No gesture model found. Train first with train_lstm.py")

    def _load_mediapipe(self) -> None:
        try:
            import mediapipe as mp
            self._mp_hands = mp.solutions.hands
            self._hands    = self._mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                min_detection_confidence=0.7,
                min_tracking_confidence=0.6,
            )
        except ImportError:
            self._hands = None
            print("[WARN] MediaPipe not installed — camera-based recognition disabled.")

    def extract_landmarks(self, frame: np.ndarray) -> np.ndarray | None:
        """Extract flattened landmarks from a BGR frame."""
        if self._hands is None:
            return None
        import cv2
        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)
        if not result.multi_hand_landmarks:
            return np.zeros(LANDMARKS_DIM, dtype=np.float32)

        lm = result.multi_hand_landmarks[0]
        wrist = np.array([lm.landmark[0].x, lm.landmark[0].y, lm.landmark[0].z])
        vec = np.array([[l.x, l.y, l.z] for l in lm.landmark], dtype=np.float32).flatten()
        return vec - np.tile(wrist, 21)

    def predict_sequence(self, sequence: np.ndarray) -> GestureResult | None:
        """
        Classify a single (30, 63) landmark sequence.

        Returns GestureResult if confidence ≥ threshold, else None.
        """
        inp = sequence[np.newaxis, ...].astype(np.float32)   # (1, 30, 63)
        t0  = time.perf_counter()

        if self._session:
            input_name = self._session.get_inputs()[0].name
            probs = self._session.run(None, {input_name: inp})[0][0]
        else:
            probs = self._keras_model.predict(inp, verbose=0)[0]

        latency_ms = (time.perf_counter() - t0) * 1000
        cls_idx    = int(np.argmax(probs))
        confidence = float(probs[cls_idx])

        if confidence < CONF_THRESHOLD:
            return None

        return GestureResult(
            gesture=self._classes[cls_idx],
            confidence=round(confidence, 3),
            latency_ms=round(latency_ms, 1),
        )

    def start(self, callback=None, source: int = 0) -> None:
        """
        Start real-time gesture recognition from webcam.

        Args:
            callback: fn(GestureResult) called on each recognized gesture.
            source:   Camera index.
        """
        import cv2
        self._callback = callback
        self._running  = True

        print("[INFO] Gesture recognizer started. Press Q to quit.")
        cap = cv2.VideoCapture(source)

        while cap.isOpened() and self._running:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)

            lm = self.extract_landmarks(frame)
            if lm is not None:
                self._sequence.append(lm)
                if len(self._sequence) > SEQ_LEN:
                    self._sequence.pop(0)

            # Run prediction once we have a full sequence
            if len(self._sequence) == SEQ_LEN:
                seq_arr = np.array(self._sequence, dtype=np.float32)
                result  = self.predict_sequence(seq_arr)
                if result:
                    if callback:
                        callback(result)
                    else:
                        cv2.putText(frame,
                            f"{result.gesture} ({result.confidence:.2f}) {result.latency_ms:.0f}ms",
                            (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 136), 2)

            cv2.imshow("SenseBridge — Gesture Assist", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        cap.release()
        cv2.destroyAllWindows()
        self._hands.close() if self._hands else None

    def stop(self) -> None:
        self._running = False
