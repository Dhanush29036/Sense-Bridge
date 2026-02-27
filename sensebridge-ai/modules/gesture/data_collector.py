"""
Module 4A — Gesture Dataset Collector
=======================================
Records hand landmark sequences from webcam using MediaPipe.
Saves sequences as .npy files for LSTM training.

Usage:
    python -m modules.gesture.data_collector
    # Follow on-screen prompts to record gesture sequences
"""

import os
import time
import numpy as np
import cv2
from pathlib import Path

try:
    import mediapipe as mp
    _HAS_MP = True
except ImportError:
    _HAS_MP = False
    print("[WARN] MediaPipe not installed. pip install mediapipe")


# ─── Configuration ────────────────────────────────────────────────────────────

DATA_DIR        = Path("data/gesture/sequences")
CLASSES_FILE    = Path("data/gesture/classes.txt")
SEQUENCE_LENGTH = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))   # frames per sequence
N_SEQUENCES     = 30    # sequences per class to record
LANDMARKS_DIM   = 63    # 21 hand landmarks × 3 (x, y, z)


# ─── Predefined gesture vocabulary ───────────────────────────────────────────
GESTURE_CLASSES = [
    "thumbs_up",     # yes / approve
    "thumbs_down",   # no / reject
    "open_palm",     # stop / hello
    "pointing",      # select / navigate
    "fist",          # cancel
    "peace",         # two / ok
    "call_me",       # call for help
    "sos",           # emergency (wave)
]


def setup_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for cls in GESTURE_CLASSES:
        (DATA_DIR / cls).mkdir(exist_ok=True)
    CLASSES_FILE.write_text("\n".join(GESTURE_CLASSES))
    print(f"[INFO] Directories created. Classes: {GESTURE_CLASSES}")


def extract_landmarks(hand_landmarks) -> np.ndarray:
    """
    Flatten 21 MediaPipe hand landmarks (x, y, z) → (63,) array.
    Normalizes by subtracting wrist position (landmark 0).
    """
    if hand_landmarks is None:
        return np.zeros(LANDMARKS_DIM, dtype=np.float32)

    wrist = np.array([
        hand_landmarks.landmark[0].x,
        hand_landmarks.landmark[0].y,
        hand_landmarks.landmark[0].z,
    ])
    lm = np.array([
        [lm.x, lm.y, lm.z] for lm in hand_landmarks.landmark
    ], dtype=np.float32).flatten()

    # Normalize relative to wrist
    wrist_rep = np.tile(wrist, 21)
    return lm - wrist_rep


def collect(gesture_class: str, existing_count: int = 0) -> None:
    """
    Collect N_SEQUENCES sequences of SEQUENCE_LENGTH frames for one gesture class.
    
    Args:
        gesture_class:  Name of the gesture to record.
        existing_count: Number of already-recorded sequences (avoids overwrite).
    """
    if not _HAS_MP:
        print("[ERROR] MediaPipe required for data collection.")
        return

    mp_hands  = mp.solutions.hands
    mp_draw   = mp.solutions.drawing_utils
    hands_sol = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.6,
    )

    cap = cv2.VideoCapture(0)
    out_dir = DATA_DIR / gesture_class

    for seq_idx in range(existing_count, existing_count + N_SEQUENCES):
        sequence: list[np.ndarray] = []

        print(f"\n[COLLECT] '{gesture_class}' — sequence {seq_idx + 1}/{existing_count + N_SEQUENCES}")
        print("  → Press SPACE to start recording, Q to quit")

        # Wait for SPACE
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            cv2.putText(frame, f"GET READY: {gesture_class}", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            cv2.putText(frame, "Press SPACE to record", (10, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 1)
            cv2.imshow("SenseBridge — Data Collector", frame)
            key = cv2.waitKey(1)
            if key == ord(" "):
                break
            if key == ord("q"):
                cap.release()
                cv2.destroyAllWindows()
                return

        # Record SEQUENCE_LENGTH frames
        for frame_idx in range(SEQUENCE_LENGTH):
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands_sol.process(rgb)

            lm = None
            if result.multi_hand_landmarks:
                lm = result.multi_hand_landmarks[0]
                mp_draw.draw_landmarks(frame, lm, mp_hands.HAND_CONNECTIONS)

            landmarks = extract_landmarks(lm)
            sequence.append(landmarks)

            # Progress bar
            progress = int((frame_idx / SEQUENCE_LENGTH) * 200)
            cv2.rectangle(frame, (10, 430), (10 + progress, 450), (0, 255, 136), -1)
            cv2.putText(frame, f"RECORDING {frame_idx + 1}/{SEQUENCE_LENGTH}", (10, 425),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
            cv2.imshow("SenseBridge — Data Collector", frame)
            cv2.waitKey(1)

        # Save sequence
        seq_array = np.array(sequence, dtype=np.float32)   # (30, 63)
        np.save(str(out_dir / f"{seq_idx}.npy"), seq_array)
        print(f"  [SAVED] {out_dir / f'{seq_idx}.npy'} — shape: {seq_array.shape}")

    cap.release()
    cv2.destroyAllWindows()
    hands_sol.close()


if __name__ == "__main__":
    setup_directories()
    for cls in GESTURE_CLASSES:
        existing = len(list((DATA_DIR / cls).glob("*.npy")))
        print(f"\n{'─'*40}")
        print(f"Class: {cls} | Existing sequences: {existing}")
        print(f"{'─'*40}")
        collect(cls, existing_count=existing)
    print("\n✅ Data collection complete.")
