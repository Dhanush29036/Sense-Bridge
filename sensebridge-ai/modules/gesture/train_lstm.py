"""
Module 4B — Gesture LSTM Training Pipeline
===========================================
Trains a bidirectional LSTM on MediaPipe landmark sequences.
Model: Input(30, 63) → BiLSTM(128) → BiLSTM(64) → Dense(64) → Softmax(N_classes)

Target accuracy: > 92% on validation set.

Usage:
    python -m modules.gesture.train_lstm
    python -m modules.gesture.train_lstm --eval
"""

import os
import argparse
import numpy as np
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DATA_DIR        = Path("data/gesture/sequences")
CLASSES_FILE    = Path("data/gesture/classes.txt")
MODEL_SAVE_PATH = Path("models/gesture/lstm_gesture.keras")
SEQUENCE_LENGTH = int(os.getenv("GESTURE_SEQUENCE_LEN", "30"))
LANDMARKS_DIM   = 63
BATCH_SIZE      = 32
EPOCHS          = 80
LEARNING_RATE   = 1e-3
DROPOUT         = 0.4


def load_dataset(data_dir: Path, classes: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """
    Load all .npy sequence files and build (X, y) arrays.

    Returns:
        X: shape (N, SEQUENCE_LENGTH, LANDMARKS_DIM)
        y: shape (N,) integer class indices
    """
    X, y = [], []
    for cls_idx, cls in enumerate(classes):
        cls_dir  = data_dir / cls
        npy_files = sorted(cls_dir.glob("*.npy"))
        if not npy_files:
            print(f"[WARN] No data found for class '{cls}'. Skipping.")
            continue
        for npy_path in npy_files:
            seq = np.load(str(npy_path))               # (30, 63)
            if seq.shape == (SEQUENCE_LENGTH, LANDMARKS_DIM):
                X.append(seq)
                y.append(cls_idx)
    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)
    print(f"[INFO] Dataset loaded: {X.shape} sequences, {len(classes)} classes")
    return X, y


def build_model(n_classes: int, seq_len: int = SEQUENCE_LENGTH, feat_dim: int = LANDMARKS_DIM):
    """
    Bidirectional LSTM model for dynamic gesture sequence classification.

    Architecture:
        Input: (seq_len, feat_dim)
        → Masking (handles zero-padded frames)
        → BiLSTM(128, return_sequences=True)
        → Dropout(0.4)
        → BiLSTM(64)
        → BatchNorm
        → Dense(64, relu)
        → Dropout(0.3)
        → Dense(n_classes, softmax)
    """
    try:
        import tensorflow as tf
        from tensorflow.keras import layers, models, regularizers
    except ImportError:
        raise RuntimeError("TensorFlow is required. pip install tensorflow")

    inp = tf.keras.Input(shape=(seq_len, feat_dim))
    x   = layers.Masking(mask_value=0.0)(inp)

    x   = layers.Bidirectional(
        layers.LSTM(128, return_sequences=True, dropout=DROPOUT,
                    kernel_regularizer=regularizers.l2(1e-4))
    )(x)
    x   = layers.Dropout(DROPOUT)(x)

    x   = layers.Bidirectional(
        layers.LSTM(64, dropout=DROPOUT)
    )(x)
    x   = layers.BatchNormalization()(x)

    x   = layers.Dense(64, activation="relu")(x)
    x   = layers.Dropout(0.3)(x)
    out = layers.Dense(n_classes, activation="softmax")(x)

    model = models.Model(inp, out)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.summary()
    return model


def train() -> None:
    classes = CLASSES_FILE.read_text().strip().splitlines()
    n_classes = len(classes)
    print(f"[INFO] Classes: {classes}")

    X, y = load_dataset(DATA_DIR, classes)
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    print(f"[INFO] Train: {len(X_train)}, Val: {len(X_val)}")

    model = build_model(n_classes)

    import tensorflow as tf

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=15, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=7, min_lr=1e-6
        ),
        tf.keras.callbacks.ModelCheckpoint(
            str(MODEL_SAVE_PATH), save_best_only=True, monitor="val_accuracy"
        ),
    ]

    MODEL_SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )

    _plot_history(history)
    _evaluate(model, X_val, y_val, classes)


def _evaluate(model, X_val, y_val, classes) -> None:
    y_pred = model.predict(X_val).argmax(axis=1)
    print("\n──── Classification Report ────")
    print(classification_report(y_val, y_pred, target_names=classes))

    cm = confusion_matrix(y_val, y_pred)
    print("Confusion Matrix:")
    print(cm)

    acc = (y_pred == y_val).mean()
    print(f"\n✅ Validation Accuracy: {acc * 100:.2f}%")


def _plot_history(history) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    axes[0].plot(history.history["accuracy"],     label="Train Acc")
    axes[0].plot(history.history["val_accuracy"], label="Val Acc")
    axes[0].set_title("Accuracy"); axes[0].legend()
    axes[1].plot(history.history["loss"],     label="Train Loss")
    axes[1].plot(history.history["val_loss"], label="Val Loss")
    axes[1].set_title("Loss"); axes[1].legend()
    plt.savefig("models/gesture/training_history.png", dpi=150)
    print("[INFO] Training history saved to models/gesture/training_history.png")
    plt.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval", action="store_true", help="Evaluate saved model")
    args = parser.parse_args()
    train()
