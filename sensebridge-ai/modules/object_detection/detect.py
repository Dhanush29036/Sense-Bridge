"""
Module 1C — Real-time Object Detector (ONNX Runtime)
======================================================
Runs YOLOv8 inference via ONNX Runtime for CPU-only mobile deployment.
Falls back to Ultralytics PyTorch if ONNX model is absent.

Supports:
  - Custom SenseBridge model (12 classes) when available
  - Standard COCO pretrained model (80 classes) as fallback
  - Positional awareness (left / center / right)
  - Voice-alert sentence generation for blind assistance

Usage:
    detector = ObjectDetector()
    frame = cv2.imread("sample.jpg")
    detections, ms = detector.detect(frame)
"""

import os
import time
import numpy as np
import cv2
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

YOLO_ONNX_PATH   = os.getenv("YOLO_ONNX_PATH",   "models/yolo/sensebridge_yolov8n.onnx")
YOLO_PT_PATH     = os.getenv("YOLO_MODEL_PATH",   "models/yolo/sensebridge_yolov8n.pt")
CONF_THRESHOLD   = float(os.getenv("YOLO_CONF_THRESHOLD", "0.30"))   # lowered from 0.45 to detect more objects
IOU_THRESHOLD    = float(os.getenv("YOLO_IOU_THRESHOLD",  "0.50"))
IMGSZ            = int(os.getenv("YOLO_IMGSZ", "640"))

# ─── Custom SenseBridge classes (12) — used when custom model is loaded ───────
SENSEBRIDGE_CLASSES = [
    "person", "car", "motorcycle", "bicycle",
    "bus", "truck", "door", "stairs",
    "crosswalk", "obstacle", "signboard", "currency_note",
]

# ─── Full COCO 80 classes — used when pretrained yolov8n.pt is loaded ─────────
COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
]

# ─── Important classes for blind assistance (filtered for voice alerts) ───────
IMPORTANT_CLASSES = {
    # Obstacles & hazards (CRITICAL)
    "person", "car", "motorcycle", "bicycle", "bus", "truck", "train",
    "fire hydrant", "stop sign", "bench", "stairs", "crosswalk", "obstacle",
    # Animals
    "dog", "cat", "horse", "cow", "elephant", "bear",
    # Indoor objects
    "chair", "couch", "bed", "dining table", "toilet", "door",
    # Handheld / useful
    "bottle", "cup", "bowl", "cell phone", "laptop", "book", "backpack",
    "umbrella", "suitcase", "scissors", "clock",
    # Appliances
    "refrigerator", "oven", "microwave", "sink", "tv",
    # Traffic
    "traffic light", "parking meter",
    # Custom SenseBridge
    "signboard", "currency_note",
}


@dataclass
class Detection:
    label:      str
    class_id:   int
    confidence: float
    bbox:       tuple           # (x1, y1, x2, y2) in pixel coords
    center:     tuple           # (cx, cy)
    position:   str = "center"  # "left" | "center" | "right" — positional awareness
    is_important: bool = True   # whether this is an important class for alerts

    @property
    def voice_alert(self) -> str:
        """Generate a meaningful voice alert for blind assistance."""
        pos_map = {"left": "on your left", "center": "ahead", "right": "on your right"}
        pos_text = pos_map.get(self.position, "nearby")
        return f"{self.label} {pos_text}"


class ObjectDetector:
    """
    Edge-optimized YOLOv8 detector using ONNX Runtime.

    Priority:
        1. ONNX Runtime (fast, no torch required on device)
        2. Ultralytics PyTorch (fallback during development)
    """

    def __init__(self):
        self._backend = None
        self._session = None
        self._model   = None
        self._class_names = SENSEBRIDGE_CLASSES  # default, may switch to COCO_CLASSES
        self._load()

    def _load(self) -> None:
        if Path(YOLO_ONNX_PATH).exists():
            self._load_onnx()
        elif Path(YOLO_PT_PATH).exists():
            print(f"[INFO] Loading custom PyTorch model: {YOLO_PT_PATH}")
            self._load_pytorch(YOLO_PT_PATH)
        else:
            # Fallback to standard pretrained COCO model (80 classes)
            print(f"[INFO] Custom model not found. Using pretrained yolov8n.pt (COCO 80 classes)")
            self._load_pytorch("yolov8n.pt")
            self._class_names = COCO_CLASSES

    def _load_onnx(self) -> None:
        try:
            import onnxruntime as ort
            providers = ["CPUExecutionProvider"]
            # Use NNAPI on Android if available
            if "NNAPIExecutionProvider" in ort.get_all_providers():
                providers.insert(0, "NNAPIExecutionProvider")
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 4
            opts.inter_op_num_threads = 2
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._session = ort.InferenceSession(YOLO_ONNX_PATH, sess_options=opts, providers=providers)
            self._backend = "onnx"
            print(f"[INFO] Loaded ONNX model: {YOLO_ONNX_PATH} (providers: {providers})")
        except Exception as e:
            print(f"[ERROR] ONNX load failed: {e}")
            self._load_pytorch()

    def _load_pytorch(self, model_path: str = YOLO_PT_PATH) -> None:
        from ultralytics import YOLO
        self._model   = YOLO(model_path)
        self._backend = "pytorch"
        # Auto-detect class list from model
        if hasattr(self._model, 'names') and self._model.names:
            nc = len(self._model.names)
            if nc >= 80:
                self._class_names = COCO_CLASSES
                print(f"[INFO] Loaded COCO pretrained model ({nc} classes): {model_path}")
            else:
                self._class_names = SENSEBRIDGE_CLASSES
                print(f"[INFO] Loaded custom model ({nc} classes): {model_path}")
        else:
            print(f"[INFO] Loaded PyTorch model: {model_path}")

    # ─── Preprocessing ────────────────────────────────────────────────────────

    @staticmethod
    def _preprocess(frame: np.ndarray) -> tuple[np.ndarray, float, float]:
        """
        Letterbox-resize to IMGSZ×IMGSZ and normalize to [0,1].
        Returns: (blob, scale_x, scale_y)
        """
        orig_h, orig_w = frame.shape[:2]
        scale = min(IMGSZ / orig_w, IMGSZ / orig_h)
        new_w, new_h = int(orig_w * scale), int(orig_h * scale)
        resized = cv2.resize(frame, (new_w, new_h))

        # Pad
        blob = np.zeros((IMGSZ, IMGSZ, 3), dtype=np.float32)
        blob[:new_h, :new_w] = resized
        blob = blob.transpose(2, 0, 1)   # HWC → CHW
        blob = np.expand_dims(blob / 255.0, axis=0).astype(np.float32)

        scale_x = orig_w / new_w
        scale_y = orig_h / new_h
        return blob, scale_x, scale_y

    # ─── ONNX Postprocess ─────────────────────────────────────────────────────

    @staticmethod
    def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> list[int]:
        """Simple NMS — use cv2.dnn.NMSBoxes for production."""
        indices = cv2.dnn.NMSBoxes(
            boxes.tolist(), scores.tolist(), CONF_THRESHOLD, iou_thresh
        )
        return indices.flatten().tolist() if len(indices) > 0 else []

    def _postprocess_onnx(
        self, output: np.ndarray, scale_x: float, scale_y: float
    ) -> list[Detection]:
        """Parse YOLOv8 ONNX output tensor [1, 4+nc, 8400]."""
        preds = output[0].T        # → [8400, 4+nc]
        boxes_raw  = preds[:, :4]  # cx, cy, w, h (normalized)
        scores_raw = preds[:, 4:]  # class scores

        class_ids  = scores_raw.argmax(axis=1)
        confidences = scores_raw.max(axis=1)
        mask = confidences > CONF_THRESHOLD

        boxes_raw   = boxes_raw[mask]
        class_ids   = class_ids[mask]
        confidences = confidences[mask]

        # cx,cy,w,h → x1,y1,x2,y2 (pixel)
        cx, cy, w, h = (boxes_raw[:, i] * IMGSZ for i in range(4))
        x1 = (cx - w / 2) * scale_x
        y1 = (cy - h / 2) * scale_y
        x2 = (cx + w / 2) * scale_x
        y2 = (cy + h / 2) * scale_y
        boxes_pixel = np.stack([x1, y1, x2 - x1, y2 - y1], axis=1)

        keep = self._nms(boxes_pixel, confidences, IOU_THRESHOLD)

        results: list[Detection] = []
        for i in keep:
            cls = int(class_ids[i])
            label = self._class_names[cls] if cls < len(self._class_names) else str(cls)
            cx = float((x1[i] + x2[i]) / 2)
            cy = float((y1[i] + y2[i]) / 2)
            # Positional awareness based on horizontal bbox center
            position = _get_position(cx, IMGSZ * scale_x)
            results.append(Detection(
                label=label,
                class_id=cls,
                confidence=float(confidences[i]),
                bbox=(float(x1[i]), float(y1[i]), float(x2[i]), float(y2[i])),
                center=(cx, cy),
                position=position,
                is_important=(label in IMPORTANT_CLASSES),
            ))
        return results

    # ─── Public API ───────────────────────────────────────────────────────────

    def detect(self, frame: np.ndarray) -> tuple[list[Detection], float]:
        """
        Run inference on a single BGR frame.

        Returns:
            (detections, inference_ms)
        """
        t0 = time.perf_counter()

        if self._backend == "onnx":
            blob, sx, sy = self._preprocess(frame)
            input_name = self._session.get_inputs()[0].name
            outputs    = self._session.run(None, {input_name: blob})
            detections = self._postprocess_onnx(outputs[0], sx, sy)
        else:
            results    = self._model(frame, conf=CONF_THRESHOLD, iou=IOU_THRESHOLD, verbose=False)[0]
            detections = self._yolo_to_detections(results)

        inference_ms = (time.perf_counter() - t0) * 1000
        return detections, inference_ms

    def _yolo_to_detections(self, results) -> list[Detection]:
        """Convert Ultralytics results to Detection list with positional awareness."""
        dets = []
        # Get frame width from the result's original image shape
        frame_w = results.orig_shape[1] if hasattr(results, 'orig_shape') else 640
        for box in results.boxes:
            cls  = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            # Use model's own names if available, else our class list
            if hasattr(results, 'names') and results.names and cls in results.names:
                label = results.names[cls]
            else:
                label = self._class_names[cls] if cls < len(self._class_names) else str(cls)
            position = _get_position(cx, frame_w)
            dets.append(Detection(
                label=label,
                class_id=cls,
                confidence=conf,
                bbox=(x1, y1, x2, y2),
                center=(cx, cy),
                position=position,
                is_important=(label in IMPORTANT_CLASSES),
            ))
        return dets

    def detect_video(self, source: int | str = 0, callback=None) -> None:
        """
        Stream inference from webcam or video file.
        Calls callback(detections, frame, latency_ms) for each frame.

        Args:
            source:   Camera index or video file path.
            callback: Optional function to receive results.
        """
        cap = cv2.VideoCapture(source)
        frame_skip = 0
        print("[INFO] Starting video stream. Press Q to quit.")
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Frame skipping: process every 2nd frame to save compute
            frame_skip += 1
            if frame_skip % 2 != 0:
                continue

            detections, ms = self.detect(frame)

            if callback:
                callback(detections, frame, ms)
            else:
                _draw_boxes(frame, detections, ms)
                cv2.imshow("SenseBridge — Vision Assist", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

        cap.release()
        cv2.destroyAllWindows()


# ─── Positional Awareness ─────────────────────────────────────────────────────

def _get_position(center_x: float, frame_width: float) -> str:
    """Determine left/center/right based on bbox center position."""
    ratio = center_x / frame_width if frame_width > 0 else 0.5
    if ratio < 0.33:
        return "left"
    elif ratio > 0.67:
        return "right"
    return "center"


def generate_voice_alerts(
    detections: list[Detection],
    important_only: bool = True,
) -> list[str]:
    """
    Convert detections into meaningful voice alerts for blind users.

    Examples:
        "Person ahead"
        "Chair on your left"
        "Car on your right"

    Args:
        detections:     List of Detection objects.
        important_only: If True, only generate alerts for IMPORTANT_CLASSES.

    Returns:
        List of alert strings, sorted by importance.
    """
    alerts = []
    seen_labels = set()   # prevent duplicate alerts for same label+position
    for d in detections:
        if important_only and not d.is_important:
            continue
        key = f"{d.label}_{d.position}"
        if key in seen_labels:
            continue
        seen_labels.add(key)
        alerts.append(d.voice_alert)

    return alerts


def _draw_boxes(frame: np.ndarray, detections: list[Detection], ms: float) -> None:
    """Draw bounding boxes with labels + position (debug / dev mode)."""
    for d in detections:
        x1, y1, x2, y2 = [int(v) for v in d.bbox]
        # Color by importance: green = important, orange = other
        if d.is_important:
            color = (0, 255, 136) if d.confidence > 0.5 else (0, 200, 255)
        else:
            color = (180, 180, 180)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        label = f"{d.label} {d.confidence:.2f} [{d.position}]"
        cv2.putText(frame, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    # Show FPS + detection count
    n_imp = sum(1 for d in detections if d.is_important)
    cv2.putText(frame, f"{ms:.1f}ms | {len(detections)} obj ({n_imp} important)",
                (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    # Show voice alerts in bottom-left corner
    alerts = generate_voice_alerts(detections)
    for i, alert in enumerate(alerts[:4]):
        cv2.putText(frame, f">> {alert}", (10, frame.shape[0] - 20 - i * 25),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)


if __name__ == "__main__":
    detector = ObjectDetector()
    print(f"\n[INFO] Using class list: {len(detector._class_names)} classes")
    print(f"[INFO] IMPORTANT_CLASSES: {len(IMPORTANT_CLASSES)} classes for voice alerts")
    print(f"[INFO] Confidence threshold: {CONF_THRESHOLD}")
    print(f"[INFO] Press Q to quit.\n")
    detector.detect_video(source=0)
