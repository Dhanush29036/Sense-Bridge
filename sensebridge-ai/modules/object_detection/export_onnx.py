"""
Module 1D — ONNX & TFLite Export Pipeline
===========================================
Converts trained YOLOv8 .pt model → ONNX → TFLite (INT8 quantized)

Steps:
    1. Export .pt → .onnx via Ultralytics
    2. Simplify ONNX graph (onnxsim)
    3. Convert .onnx → .tflite via onnx-tf + tf.lite
    4. Apply INT8 quantization with representative dataset

Usage:
    python -m modules.object_detection.export_onnx
    python -m modules.object_detection.export_onnx --tflite
"""

import argparse
import os
import numpy as np
from pathlib import Path
from ultralytics import YOLO
import onnx


WEIGHTS_PATH = os.getenv("YOLO_MODEL_PATH", "models/yolo/sensebridge_yolov8n.pt")
ONNX_PATH    = os.getenv("YOLO_ONNX_PATH",  "models/yolo/sensebridge_yolov8n.onnx")
TFLITE_PATH  = ONNX_PATH.replace(".onnx", "_int8.tflite")
IMGSZ        = int(os.getenv("YOLO_IMGSZ", "640"))


def export_onnx(weights: str = WEIGHTS_PATH, output: str = ONNX_PATH) -> str:
    """
    Step 1: Export YOLOv8 .pt → ONNX.
    Simplifies the graph and validates the model.

    Returns:
        Path to exported ONNX file.
    """
    Path(output).parent.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] Loading model: {weights}")
    model = YOLO(weights)

    print(f"[INFO] Exporting to ONNX (imgsz={IMGSZ}, opset=17)...")
    export_path = model.export(
        format="onnx",
        imgsz=IMGSZ,
        opset=17,            # ONNX opset 17 = best onnxruntime compatibility
        simplify=True,       # onnxsim graph simplification
        dynamic=False,       # fixed batch=1 for mobile
        half=False,          # FP32 (INT8 handled at TFLite step)
    )

    # Validate exported model
    model_onnx = onnx.load(export_path)
    onnx.checker.check_model(model_onnx)
    print(f"✅ ONNX export validated: {export_path}")
    _print_onnx_info(model_onnx)

    # Move to desired output path
    if str(export_path) != output:
        import shutil
        shutil.move(export_path, output)
        print(f"[INFO] Moved to: {output}")

    return output


def export_tflite_int8(
    onnx_path: str = ONNX_PATH,
    output_path: str = TFLITE_PATH,
    representative_data_dir: str = "data/object_detection/images/val",
) -> str:
    """
    Step 2: Convert ONNX → TFLite INT8.

    Dependencies:
        pip install onnx-tf tensorflow

    Args:
        onnx_path:              Path to the simplified ONNX model.
        output_path:            Destination .tflite file path.
        representative_data_dir: Directory of JPG images for INT8 calibration.

    Returns:
        Path to quantized TFLite model.
    """
    import tensorflow as tf
    import onnx_tf

    print("[INFO] Converting ONNX → TensorFlow SavedModel...")
    tf_rep = onnx_tf.backend.prepare(onnx.load(onnx_path))
    tf_saved_path = onnx_path.replace(".onnx", "_tf_saved")
    tf_rep.export_graph(tf_saved_path)

    print("[INFO] Building TFLite INT8 converter...")
    converter = tf.lite.TFLiteConverter.from_saved_model(tf_saved_path)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type  = tf.uint8
    converter.inference_output_type = tf.uint8

    def representative_dataset():
        """Supply calibration images for INT8 quantization."""
        import cv2
        img_paths = list(Path(representative_data_dir).glob("*.jpg"))[:200]
        for p in img_paths:
            img = cv2.imread(str(p))
            img = cv2.resize(img, (IMGSZ, IMGSZ)).astype(np.float32)
            img = img[np.newaxis, ...] / 255.0
            yield [img]

    converter.representative_dataset = representative_dataset
    tflite_model = converter.convert()

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(tflite_model)

    size_mb = os.path.getsize(output_path) / 1e6
    print(f"✅ TFLite INT8 model saved: {output_path} ({size_mb:.2f} MB)")
    return output_path


def _print_onnx_info(model: onnx.ModelProto) -> None:
    inputs  = [f"{i.name} {[d.dim_value for d in i.type.tensor_type.shape.dim]}" for i in model.graph.input]
    outputs = [f"{o.name} {[d.dim_value for d in o.type.tensor_type.shape.dim]}" for o in model.graph.output]
    size_mb = model.ByteSize() / 1e6
    print(f"  Inputs : {inputs}")
    print(f"  Outputs: {outputs}")
    print(f"  Size   : {size_mb:.2f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default=WEIGHTS_PATH)
    parser.add_argument("--onnx",    default=ONNX_PATH)
    parser.add_argument("--tflite",  action="store_true", help="Also export TFLite INT8")
    parser.add_argument("--cal-dir", default="data/object_detection/images/val")
    args = parser.parse_args()

    onnx_out = export_onnx(args.weights, args.onnx)
    if args.tflite:
        export_tflite_int8(onnx_out, TFLITE_PATH, args.cal_dir)
