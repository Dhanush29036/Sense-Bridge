"""
Module 1A — YOLOv8 Training Pipeline
=====================================
Usage:
    python -m modules.object_detection.train
    python -m modules.object_detection.train --resume runs/detect/train/weights/last.pt
"""

import argparse
import os
from pathlib import Path
from ultralytics import YOLO
import yaml


# ─── Hyper-parameters ────────────────────────────────────────────────────────

DATASET_YAML    = "data/object_detection/dataset.yaml"
BASE_MODEL      = "yolov8n.pt"    # nano — best for edge. Use yolov8s for higher accuracy.
EPOCHS          = 100
IMGSZ           = 640
BATCH           = 16              # reduce to 8 if GPU VRAM < 4 GB
WORKERS         = 4
DEVICE          = "0"             # "0" for first GPU, "cpu" for CPU
PROJECT         = "runs/detect"
NAME            = "sensebridge_v1"
PATIENCE        = 20              # early stopping patience


def train(resume: str | None = None) -> None:
    """
    Fine-tune YOLOv8n on the SenseBridge obstacle dataset.

    Steps:
        1. Load pretrained COCO weights (yolov8n.pt)
        2. Replace head for nc=12 classes automatically
        3. Apply Ultralytics augmentation (mosaic, HSV, copy-paste)
        4. Train with cosine LR schedule
        5. Save best weights to runs/detect/sensebridge_v1/weights/best.pt
    """
    model_path = resume if resume else BASE_MODEL
    model = YOLO(model_path)

    results = model.train(
        data=DATASET_YAML,
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,
        workers=WORKERS,
        device=DEVICE,
        project=PROJECT,
        name=NAME,
        patience=PATIENCE,
        # ── Augmentation ──────────────────────────────────────────────
        mosaic=1.0,           # mosaic augmentation probability
        mixup=0.15,           # mixup alpha
        copy_paste=0.3,       # copy-paste probability (good for obstacles)
        fliplr=0.5,
        degrees=10.0,
        translate=0.1,
        scale=0.5,
        hsv_h=0.015,          # hue shift
        hsv_s=0.7,            # saturation
        hsv_v=0.4,            # brightness (critical for low-light)
        # ── Optimizer ─────────────────────────────────────────────────
        optimizer="AdamW",
        lr0=1e-3,
        lrf=0.01,
        warmup_epochs=3,
        cos_lr=True,
        # ── Logging ───────────────────────────────────────────────────
        plots=True,           # save confusion matrix, PR curve
        val=True,
        save_period=10,       # checkpoint every 10 epochs
        verbose=True,
    )

    print(f"\n✅ Training complete.")
    print(f"   Best weights: {results.save_dir}/weights/best.pt")
    _print_metrics(results)


def _print_metrics(results) -> None:
    """Print final mAP and per-class AP50 after training."""
    metrics = results.results_dict
    print(f"\n──── Final Validation Metrics ────")
    print(f"  mAP@0.5    : {metrics.get('metrics/mAP50(B)', 0):.4f}")
    print(f"  mAP@0.5:0.95: {metrics.get('metrics/mAP50-95(B)', 0):.4f}")
    print(f"  Precision   : {metrics.get('metrics/precision(B)', 0):.4f}")
    print(f"  Recall      : {metrics.get('metrics/recall(B)', 0):.4f}")


def evaluate(weights: str = f"{PROJECT}/{NAME}/weights/best.pt") -> None:
    """
    Run standalone mAP evaluation on val split.

    Args:
        weights: Path to trained .pt weights file.
    """
    model = YOLO(weights)
    metrics = model.val(
        data=DATASET_YAML,
        imgsz=IMGSZ,
        conf=0.001,           # low threshold → full PR curve
        iou=0.6,
        plots=True,
        verbose=True,
    )
    print(f"\n── Evaluation Results ──")
    print(f"  mAP@50     : {metrics.box.map50:.4f}")
    print(f"  mAP@50-95  : {metrics.box.map:.4f}")
    for i, cls_ap in enumerate(metrics.box.ap_class_index):
        print(f"  Class {cls_ap:2d}   : AP50 = {metrics.box.ap50[i]:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train SenseBridge YOLO model")
    parser.add_argument("--resume", type=str, default=None, help="Resume from checkpoint .pt")
    parser.add_argument("--eval",   action="store_true", help="Run evaluation only")
    parser.add_argument("--weights", type=str, default=f"{PROJECT}/{NAME}/weights/best.pt")
    args = parser.parse_args()

    if args.eval:
        evaluate(args.weights)
    else:
        train(resume=args.resume)
