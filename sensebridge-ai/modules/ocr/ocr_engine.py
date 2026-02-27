"""
Module 2 — OCR Engine (EasyOCR + PaddleOCR)
=============================================
Handles three tasks:
  1. Signboard / general text reading
  2. Currency note detection (Indian INR)
  3. Label / product text reading

Usage:
    engine = OCREngine(backend="easyocr")
    frame  = cv2.imread("sample.jpg")
    results = engine.read(frame)
"""

import os
import time
import numpy as np
import cv2
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

OCR_ENGINE_TYPE = os.getenv("OCR_ENGINE", "easyocr")
OCR_LANGUAGES   = os.getenv("OCR_LANGUAGES", "en,hi").split(",")


@dataclass
class OCRResult:
    text:       str
    confidence: float
    bbox:       list    # 4-point polygon [[x,y], ...]
    category:   str     # "signboard" | "currency" | "label" | "general"


class OCREngine:
    """
    Unified OCR wrapper supporting EasyOCR and PaddleOCR.

    Args:
        backend:   "easyocr" | "paddleocr"
        languages: List of language codes, e.g. ["en", "hi"]
        gpu:       Use GPU if available.
    """

    def __init__(
        self,
        backend: str = OCR_ENGINE_TYPE,
        languages: list[str] = OCR_LANGUAGES,
        gpu: bool = False,
    ):
        self.backend   = backend
        self.languages = languages
        self.gpu       = gpu
        self._reader   = None
        self._load()

    def _load(self) -> None:
        if self.backend == "easyocr":
            import easyocr
            self._reader = easyocr.Reader(self.languages, gpu=self.gpu, verbose=False)
            print(f"[INFO] EasyOCR loaded — langs: {self.languages}")
        elif self.backend == "paddleocr":
            from paddleocr import PaddleOCR
            lang = self.languages[0] if len(self.languages) == 1 else "latin"
            self._reader = PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=self.gpu)
            print(f"[INFO] PaddleOCR loaded — lang: {lang}")
        else:
            raise ValueError(f"Unknown OCR backend: {self.backend}")

    # ─── Preprocessing ────────────────────────────────────────────────────────

    @staticmethod
    def preprocess(frame: np.ndarray, task: str = "general") -> np.ndarray:
        """
        Apply task-specific preprocessing before OCR.

        Args:
            frame: BGR image.
            task:  "signboard" | "currency" | "label" | "general"

        Returns:
            Preprocessed BGR image.
        """
        img = frame.copy()

        # ── Convert to LAB and apply CLAHE for low-light ──────────────────
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        l = clahe.apply(l)
        img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)

        if task == "currency":
            # Enhance for fine print text on banknotes
            img = cv2.detailEnhance(img, sigma_s=10, sigma_r=0.15)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            _, img = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

        elif task == "signboard":
            # Denoise + sharpen for outdoor signboards
            img = cv2.fastNlMeansDenoisingColored(img, h=10, hColor=10)
            kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
            img = cv2.filter2D(img, -1, kernel)

        elif task == "label":
            # Slight upscale + sharpening for small print
            h, w = img.shape[:2]
            img = cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
            img = cv2.GaussianBlur(img, (1, 1), 0)

        return img

    @staticmethod
    def clean_text(raw: str) -> str:
        """
        Remove OCR noise: stray characters, excessive whitespace.
        """
        import re
        text = raw.strip()
        text = re.sub(r"[^a-zA-Z0-9\u0900-\u097F\s₹$.,-]", "", text)  # keep Latin, Devanagari, currency symbols
        text = re.sub(r"\s+", " ", text)
        return text

    # ─── Inference ────────────────────────────────────────────────────────────

    def read(
        self,
        frame: np.ndarray,
        task: str = "general",
        min_confidence: float = 0.4,
    ) -> tuple[list[OCRResult], float]:
        """
        Read text from a single frame.

        Args:
            frame:          BGR input image.
            task:           Hint for preprocessing strategy.
            min_confidence: Discard results below this confidence.

        Returns:
            (results, inference_ms)
        """
        processed = self.preprocess(frame, task)
        t0 = time.perf_counter()

        raw_results = self._run_backend(processed)
        ms = (time.perf_counter() - t0) * 1000

        results: list[OCRResult] = []
        for item in raw_results:
            text, conf, bbox = self._parse_backend_result(item)
            text = self.clean_text(text)
            if conf >= min_confidence and len(text) >= 2:
                results.append(OCRResult(
                    text=text,
                    confidence=conf,
                    bbox=bbox,
                    category=self._categorize(text),
                ))

        return sorted(results, key=lambda r: -r.confidence), ms

    def _run_backend(self, img: np.ndarray) -> list:
        if self.backend == "easyocr":
            return self._reader.readtext(img, detail=1, paragraph=False)
        elif self.backend == "paddleocr":
            res = self._reader.ocr(img, cls=True)
            return res[0] if res and res[0] else []
        return []

    @staticmethod
    def _parse_backend_result(item) -> tuple[str, float, list]:
        """Normalize output from different backends."""
        if len(item) == 3:  # EasyOCR: (bbox, text, conf)
            bbox, text, conf = item
        else:               # PaddleOCR: (bbox, (text, conf))
            bbox, (text, conf) = item
        return str(text), float(conf), bbox

    @staticmethod
    def _categorize(text: str) -> str:
        """Rule-based category detection."""
        t = text.lower()
        if any(k in t for k in ["₹", "rupee", "rbi", "reserve bank", "100", "200", "500", "2000"]):
            return "currency"
        if any(k in t for k in ["exit", "enter", "stop", "warning", "danger", "no entry", "school"]):
            return "signboard"
        return "general"

    def read_region(self, frame: np.ndarray, bbox: tuple, task: str = "label") -> list[OCRResult]:
        """Crop a region and run OCR on it."""
        x1, y1, x2, y2 = [int(v) for v in bbox]
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return []
        results, _ = self.read(roi, task=task)
        return results
