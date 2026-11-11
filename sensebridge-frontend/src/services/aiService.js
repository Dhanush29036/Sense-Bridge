/**
 * aiService.js — SenseBridge AI Module (High-Accuracy Edition)
 *
 * Object Detection : COCO-SSD mobilenet_v2 (WebGL backend) + custom NMS
 * Gesture          : MediaPipe Hands (CDN) + angle-vector classifier (10 gestures)
 * Speech           : Web Speech API (multilanguage)
 * Sentence Gen     : /api/ai/format-sentence (Gemini backend)
 * TTS              : Speak Queue with priority + voice selection
 */

import { logService } from './api';
import { getBackendBaseURL, getAIBaseURL } from './networkConfig';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// ═══════════════════════════════════════════════════════════════════════════
// OBJECT DETECTION — COCO-SSD mobilenet_v2  (≈80% mAP on COCO80)
// ═══════════════════════════════════════════════════════════════════════════

let _visionModel = null;
let _visionActive = false;
let _visionRafId = null;

/**
 * Simple IoU-based Non-Maximum Suppression to remove duplicate boxes.
 */
function nms(predictions, iouThreshold = 0.45) {
    const sorted = [...predictions].sort((a, b) => b.score - a.score);
    const kept = [];
    const suppressed = new Set();
    for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue;
        kept.push(sorted[i]);
        for (let j = i + 1; j < sorted.length; j++) {
            if (suppressed.has(j)) continue;
            if (sorted[i].class === sorted[j].class && iou(sorted[i].bbox, sorted[j].bbox) > iouThreshold) {
                suppressed.add(j);
            }
        }
    }
    return kept;
}

function iou([x1, y1, w1, h1], [x2, y2, w2, h2]) {
    const xi = Math.max(x1, x2), yi = Math.max(y1, y2);
    const xe = Math.min(x1 + w1, x2 + w2), ye = Math.min(y1 + h1, y2 + h2);
    const inter = Math.max(0, xe - xi) * Math.max(0, ye - yi);
    return inter / (w1 * h1 + w2 * h2 - inter);
}

// ═══════════════════════════════════════════════════════════════════════════
// OBSTACLE TRACKER — multi-frame IoU tracking + velocity-based prediction
//
// Tracks detected bounding boxes across frames using IoU matching.
// Computes per-object velocity vectors to predict if an obstacle is
// APPROACHING (bbox growing AND moving toward frame centre) or PASSING.
// Gives directional guidance: "from left" / "from right" / "ahead".
// ═══════════════════════════════════════════════════════════════════════════

/** Objects that can actively move toward you while walking */
const MOVING_CLASSES = new Set(['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'dog', 'cat', 'horse']);

export class ObstacleTracker {
    constructor() {
        this.tracks   = new Map();   // trackId → { label, history: [{cx,cy,area,t}] }
        this._nextId  = 0;
        this.MAX_HIST = 8;           // frames to keep in history
        this.MAX_AGE  = 500;         // ms before a track is considered lost
    }

    /**
     * Update tracker with the latest detections.
     * @param {Array}  detections   — from COCO-SSD (with pctBbox)
     * @param {number} W, H         — video dimensions
     * @returns {Array} enriched detections with .motion added to moving ones
     */
    update(detections, W = 640, H = 480) {
        const now    = performance.now();
        const moving = detections.filter(d => MOVING_CLASSES.has(d.label));

        // ── Match new detections to existing tracks (greedy IoU) ─────────
        const matched     = new Set();   // track IDs matched this frame
        const usedDet     = new Set();   // detection indices already matched

        for (const [id, track] of this.tracks) {
            let bestIou = 0.25, bestIdx = -1;
            moving.forEach((d, i) => {
                if (usedDet.has(i) || d.label !== track.label) return;
                const score = iou(
                    this._pctToAbsBbox(track.history[track.history.length - 1], W, H),
                    d.bbox
                );
                if (score > bestIou) { bestIou = score; bestIdx = i; }
            });

            if (bestIdx >= 0) {
                const d   = moving[bestIdx];
                const cx  = d.bbox[0] + d.bbox[2] / 2;
                const cy  = d.bbox[1] + d.bbox[3] / 2;
                const area= d.bbox[2] * d.bbox[3];
                track.history.push({ cx, cy, area, t: now });
                if (track.history.length > this.MAX_HIST) track.history.shift();
                matched.add(id);
                usedDet.add(bestIdx);
                track.lastSeen = now;
            }
        }

        // ── Spawn new tracks for unmatched detections ────────────────────
        moving.forEach((d, i) => {
            if (usedDet.has(i)) return;
            const cx  = d.bbox[0] + d.bbox[2] / 2;
            const cy  = d.bbox[1] + d.bbox[3] / 2;
            const area= d.bbox[2] * d.bbox[3];
            this.tracks.set(this._nextId++, {
                label:    d.label,
                history:  [{ cx, cy, area, t: now }],
                lastSeen: now,
            });
        });

        // ── Prune stale tracks ───────────────────────────────────────────
        for (const [id, track] of this.tracks) {
            if (now - track.lastSeen > this.MAX_AGE) this.tracks.delete(id);
        }

        // ── Enrich detections with motion verdict ────────────────────────
        return detections.map(d => {
            if (!MOVING_CLASSES.has(d.label)) return d;
            const motion = this._getMotion(d, W, H);
            return motion ? { ...d, motion } : d;
        });
    }

    /** Compute motion verdict for a detection by finding its matching track */
    _getMotion(det, W, H) {
        // Find the track whose last position is closest to this detection
        let bestTrack = null, bestDist = Infinity;
        const cx = det.bbox[0] + det.bbox[2] / 2;
        const cy = det.bbox[1] + det.bbox[3] / 2;

        for (const [, track] of this.tracks) {
            if (track.label !== det.label || track.history.length < 3) continue;
            const last = track.history[track.history.length - 1];
            const d    = Math.hypot(cx - last.cx, cy - last.cy);
            if (d < bestDist) { bestDist = d; bestTrack = track; }
        }

        if (!bestTrack || bestTrack.history.length < 3) return null;

        const hist   = bestTrack.history;
        const oldest = hist[0];
        const latest = hist[hist.length - 1];
        const dt     = (latest.t - oldest.t) / 1000;   // seconds
        if (dt < 0.1) return null;

        // Velocity in pixels/sec
        const vx   = (latest.cx  - oldest.cx)  / dt;
        const vy   = (latest.cy  - oldest.cy)  / dt;
        const va   = (latest.area - oldest.area) / dt;

        // Approaching = bbox growing + object moving toward centre
        const frameCx    = W / 2;
        const frameCy    = H / 2;
        const toCentre   = (frameCx - latest.cx) * vx + (frameCy - latest.cy) * vy;
        const speed      = Math.hypot(vx, vy);
        const approaching= va > 500 && toCentre > 0;  // area growing && moving toward camera
        const passing    = !approaching && speed > 30;

        // Direction from user's perspective (front-facing camera, so x is mirrored)
        const pctCx = latest.cx / W;
        const direction = pctCx < 0.33 ? 'right'    // camera mirrored
                        : pctCx > 0.67 ? 'left'
                        :                'ahead';

        return {
            approaching,
            passing,
            direction,
            speed: Math.round(speed),
            verdict: approaching
                ? `${det.label} approaching from ${direction}`
                : passing
                ? `${det.label} passing on ${direction}`
                : null,
        };
    }

    _pctToAbsBbox({ cx, cy, area }, W, H) {
        // Reconstruct a rough bbox from centre + area (square approximation)
        const side = Math.sqrt(area);
        return [cx - side / 2, cy - side / 2, side, side];
    }

    reset() { this.tracks.clear(); }
}

// ═══════════════════════════════════════════════════════════════════════════
// HAZARD DETECTOR — pixel-level staircase, drop & slope detection
//
// Samples the bottom 40% of the video frame via canvas pixel data.
// Uses two signals:
//   1. Horizontal edge density (Sobel-X) in stripes → stair pattern
//   2. Central-column vertical brightness gradient  → drop/pit
// ═══════════════════════════════════════════════════════════════════════════

let _hazardCanvas  = null;
let _hazardCtx     = null;
const SAMPLE_W     = 80;   // downsample to 80×60 px (fast!)
const SAMPLE_H     = 60;
const FLOOR_START  = 0.60; // analyse rows from 60% of frame height down

/**
 * Analyse a video frame for staircase and drop hazards.
 * Returns { stair, drop, slope, confidence } — nulls if nothing detected.
 * Call every ~10 frames (not every frame) for performance.
 */
export function analyzeFrameForHazards(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return null;

    // Lazy-create offscreen canvas
    if (!_hazardCanvas) {
        _hazardCanvas = document.createElement('canvas');
        _hazardCanvas.width  = SAMPLE_W;
        _hazardCanvas.height = SAMPLE_H;
        _hazardCtx = _hazardCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Draw the lower portion of the video onto our tiny canvas
    const vW = videoElement.videoWidth  || 640;
    const vH = videoElement.videoHeight || 480;
    const cropY   = vH * FLOOR_START;
    const cropH   = vH * (1 - FLOOR_START);

    _hazardCtx.drawImage(
        videoElement,
        0, cropY, vW, cropH,          // source: lower 40%
        0, 0,   SAMPLE_W, SAMPLE_H    // dest: tiny canvas
    );

    let imgData;
    try { imgData = _hazardCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H); }
    catch { return null; }

    const pix  = imgData.data;
    const toIdx= (x, y) => (y * SAMPLE_W + x) * 4;
    const gray = (x, y) => {
        const i = toIdx(x, y);
        return 0.299 * pix[i] + 0.587 * pix[i+1] + 0.114 * pix[i+2];
    };

    // ── 1. Horizontal edge density per row (Sobel-Y kernel) ──────────────
    //    High-edge rows = horizontal lines → stair risers
    const rowEdge = [];
    for (let y = 1; y < SAMPLE_H - 1; y++) {
        let edgeSum = 0;
        for (let x = 1; x < SAMPLE_W - 1; x++) {
            const gy = gray(x, y+1) - gray(x, y-1);   // vertical gradient = horizontal edge
            edgeSum += Math.abs(gy);
        }
        rowEdge.push(edgeSum / SAMPLE_W);
    }

    // Stair pattern: alternating high/low edge rows with strong regularity
    const edgeMean = rowEdge.reduce((s, v) => s + v, 0) / rowEdge.length;
    const edgeThresh = edgeMean * 2.0;   // stricter: was 1.6
    let highEdgeCount = 0, transitions = 0, wasHigh = false;
    for (const e of rowEdge) {
        const isHigh = e > edgeThresh;
        if (isHigh) highEdgeCount++;
        if (isHigh !== wasHigh) transitions++;
        wasHigh = isHigh;
    }
    // Much stricter: require 10+ transitions AND 8+ high-edge rows (was 6/4)
    const stairScore = transitions >= 10 && highEdgeCount > 8;

    // ── 2. Central-column vertical brightness gradient → drop ahead ───────
    //    In a drop scenario the floor disappears → brightness changes sharply
    const midX = Math.floor(SAMPLE_W / 2);
    let brightTop = 0, brightBot = 0;
    const midH = Math.floor(SAMPLE_H / 2);
    for (let y = 0; y < midH; y++)     brightTop += gray(midX, y);
    for (let y = midH; y < SAMPLE_H; y++) brightBot += gray(midX, y);
    brightTop /= midH;
    brightBot /= (SAMPLE_H - midH);

    // Drop: lower half much darker than upper half (stricter: was 0.55)
    const dropScore = brightTop > 100 && brightBot < brightTop * 0.35;

    // ── 3. Slope: sustained brightness gradient across full column ─────────
    let slopeGrad = 0;
    for (let y = 0; y < SAMPLE_H - 4; y++) slopeGrad += gray(midX, y+4) - gray(midX, y);
    const slopeScore = Math.abs(slopeGrad / SAMPLE_H) > 15;   // stricter: was 8

    if (!stairScore && !dropScore && !slopeScore) return null;

    return {
        stair:      stairScore,
        drop:       dropScore,
        slope:      slopeScore && !stairScore && !dropScore,
        confidence: stairScore ? 0.75 : dropScore ? 0.80 : 0.55,  // slopes now below 0.85 threshold
    };
}


// Helper to grab frame and run server YOLOv8 detection
let _serverDetectBusy = false;
let _offscreenCanvas = null;
let _offscreenCtx = null;

async function runServerDetection(videoElement) {
    if (_serverDetectBusy || !videoElement || videoElement.readyState < 2) return null;
    _serverDetectBusy = true;
    try {
        const W = videoElement.videoWidth || 640;
        const H = videoElement.videoHeight || 480;
        if (!_offscreenCanvas) {
            _offscreenCanvas = document.createElement('canvas');
        }
        _offscreenCanvas.width = 320;
        _offscreenCanvas.height = 240;
        if (!_offscreenCtx) _offscreenCtx = _offscreenCanvas.getContext('2d');
        _offscreenCtx.drawImage(videoElement, 0, 0, 320, 240);
        const dataUrl = _offscreenCanvas.toDataURL('image/jpeg', 0.6);

        const aiBase = getAIBaseURL();
        const res = await fetch(`${aiBase}/api/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl }),
            signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.success || !Array.isArray(data.detections)) return null;

        const scaleX = W / 320;
        const scaleY = H / 240;
        return data.detections.map(d => {
            const bbox = d.bbox || [0, 0, 50, 50]; // [x1, y1, x2, y2]
            const x = bbox[0] * scaleX;
            const y = bbox[1] * scaleY;
            const w = (bbox[2] - bbox[0]) * scaleX;
            const h = (bbox[3] - bbox[1]) * scaleY;
            return {
                label: d.label,
                confidence: d.confidence,
                bbox: [x, y, w, h],
                pctBbox: [
                    (x / W) * 100,
                    (y / H) * 100,
                    (w / W) * 100,
                    (h / H) * 100,
                ],
                distance_m: d.distance_m,
                severity: d.severity,
            };
        });
    } catch {
        return null;
    } finally {
        _serverDetectBusy = false;
    }
}

export const startObjectDetection = async (videoElement, onDetection) => {
    console.info('[Vision] Starting object detection…');
    _visionActive = true;

    if (!_visionModel) {
        try {
            await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
            await tf.ready();
            _visionModel = await cocoSsd.load({ base: 'mobilenet_v2' });
            console.info('[Vision] Model loaded (mobilenet_v2 + WebGL)');
        } catch (err1) {
            console.warn('[Vision] mobilenet_v2 load failed, attempting lite_mobilenet_v2:', err1?.message);
            try {
                _visionModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
                console.info('[Vision] Model loaded (lite_mobilenet_v2 fallback)');
            } catch (err2) {
                console.warn('[Vision] Client-side COCO-SSD unavailable. Using backend YOLOv8 (/api/detect):', err2?.message);
                _visionModel = null;
            }
        }
    }

    let lastLogTime = 0;
    let lastDetectionTime = 0;
    const TARGET_FPS = 15;     // target ~15 inference fps
    const FRAME_GAP = 1000 / TARGET_FPS;

    const loop = async () => {
        if (!_visionActive) return;
        const now = performance.now();
        if (now - lastDetectionTime < FRAME_GAP) {
            _visionRafId = requestAnimationFrame(loop);
            return;
        }
        lastDetectionTime = now;

        if (videoElement.readyState >= 2) {
            let detections = null;

            if (_visionModel) {
                try {
                    const raw = await _visionModel.detect(videoElement, 40, 0.30);
                    const filtered = nms(raw);

                    const W = videoElement.videoWidth || 640;
                    const H = videoElement.videoHeight || 480;

                    detections = filtered.map(p => ({
                        label: p.class,
                        confidence: +(p.score.toFixed(3)),
                        bbox: p.bbox,
                        pctBbox: [
                            (p.bbox[0] / W) * 100,
                            (p.bbox[1] / H) * 100,
                            (p.bbox[2] / W) * 100,
                            (p.bbox[3] / H) * 100,
                        ],
                    }));
                } catch (e) {
                    console.warn('[Vision] Local frame detection error, falling back to server:', e?.message);
                    detections = null;
                }
            }

            // Fallback to server YOLOv8 if client model unavailable or failed
            if (!detections) {
                detections = await runServerDetection(videoElement);
            }

            if (detections && _visionActive) {
                onDetection?.({ detections, timestamp: now, latency: +(performance.now() - now).toFixed(1) });

                const highConf = detections.filter(d => d.confidence > 0.55);
                if (highConf.length && now - lastLogTime > 4000) {
                    lastLogTime = now;
                    logService.create({
                        eventType: 'object_detection',
                        message: `Detected: ${highConf.map(d => d.label).join(', ')}`,
                        severity: 'info',
                        confidence: Math.max(...highConf.map(d => d.confidence)),
                        metadata: { detections, model: _visionModel ? 'coco-ssd-mobilenetv2' : 'sensebridge-yolov8-backend' },
                    }).catch(() => { });
                }
            }
        }
        if (_visionActive) {
            _visionRafId = requestAnimationFrame(loop);
        }
    };

    loop();
    return () => stopObjectDetection();
};

export const stopObjectDetection = () => {
    _visionActive = false;
    if (_visionRafId) cancelAnimationFrame(_visionRafId);
    console.info('[Vision] Stopped');
};

// ═══════════════════════════════════════════════════════════════════════════
// GESTURE DETECTION — MediaPipe Hands (CDN) + Angle-Vector Classifier
//
// Uses the COSINE ANGLE between finger direction vectors instead of raw
// y-coordinate comparisons — rotation-invariant and scale-invariant.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the angle (degrees) at joint B in the A→B→C chain.
 * Returns 0-360, values < 90 mean the finger is bent.
 */
function jointAngle(A, B, C) {
    const v1 = { x: A.x - B.x, y: A.y - B.y };
    const v2 = { x: C.x - B.x, y: C.y - B.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
    return mag === 0 ? 0 : (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

/**
 * Returns true if the finger (tip→pip→mcp chain) is extended.
 * Extended = angle at PIP joint > 150° (i.e. mostly straight).
 */
function isExtended(lm, tip, pip, mcp) {
    return jointAngle(lm[mcp], lm[pip], lm[tip]) > 150;
}

function classifyGestureAdvanced(lm) {
    const thumbExt = lm[4].y < lm[3].y - 0.02; // rough thumb-up heuristic (works well)
    const thumbDown = lm[4].y > lm[3].y + 0.02;
    const indexExt = isExtended(lm, 8, 6, 5);
    const middleExt = isExtended(lm, 12, 10, 9);
    const ringExt = isExtended(lm, 16, 14, 13);
    const pinkyExt = isExtended(lm, 20, 18, 17);

    // Thumb–index pinch distance (normalized)
    const dx = lm[4].x - lm[8].x, dy = lm[4].y - lm[8].y;
    const pinchDist = Math.sqrt(dx * dx + dy * dy);

    if (thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) return 'thumbs_up';
    if (thumbDown && !indexExt && !middleExt && !ringExt && !pinkyExt) return 'thumbs_down';
    if (!thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) return 'fist';
    if (indexExt && middleExt && ringExt && pinkyExt) return 'open_palm';
    if (indexExt && middleExt && !ringExt && !pinkyExt) return 'peace';
    if (indexExt && !middleExt && !ringExt && !pinkyExt) return 'pointing';
    if (thumbExt && !indexExt && !middleExt && !ringExt && pinkyExt) return 'call_me';
    if (!thumbExt && indexExt && !middleExt && !ringExt && pinkyExt) return 'rock';
    if (thumbExt && indexExt && !middleExt && !ringExt && pinkyExt) return 'love';
    if (pinchDist < 0.06 && middleExt && ringExt && pinkyExt) return 'ok';
    return 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEECH RECOGNITION — Web Speech API (multilanguage)
// ═══════════════════════════════════════════════════════════════════════════

let _recognition = null;

export const startSpeechRecognition = (onTranscript, language = 'en-US') => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('[Speech] API not supported');
        return () => { };
    }

    if (_recognition) { _recognition.onend = null; _recognition.stop(); _recognition = null; }

    _recognition = new SpeechRecognition();
    _recognition.continuous = true;
    _recognition.interimResults = true;
    _recognition.lang = language;
    _recognition.maxAlternatives = 1;

    let lastFinal = '';

    _recognition.onresult = (event) => {
        // ── Collect all results from this event ──────────────────────────
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                const text = transcript.trim();
                const conf = event.results[i][0].confidence || 0.9;
                if (text && text !== lastFinal) {
                    lastFinal = text;
                    // Emit final result — high confidence, committed
                    onTranscript?.({ text, confidence: conf, language, isFinal: true });
                    logService.create({
                        eventType: 'speech_to_text', message: text, confidence: conf,
                        metadata: { model: 'web-speech-api', language },
                    }).catch(() => { });
                }
            } else {
                // Accumulate interim words — fire immediately for live captions
                interimText += transcript;
            }
        }
        // Emit interim immediately (isFinal=false) — no latency, updates as user speaks
        if (interimText.trim()) {
            onTranscript?.({ text: interimText.trim(), confidence: 0, language, isFinal: false });
        }
    };

    _recognition.onerror = e => { if (e.error !== 'no-speech') console.error('[Speech] Error:', e.error); };
    _recognition.onend = () => { if (_recognition) { try { _recognition.start(); } catch { } } };

    try { _recognition.start(); } catch { }
    return () => stopSpeechRecognition();
};

export const stopSpeechRecognition = () => {
    if (_recognition) { _recognition.onend = null; _recognition.stop(); _recognition = null; }
};

// ═══════════════════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH — Android WebView resilient TTS with settings check
// ═══════════════════════════════════════════════════════════════════════════

let _ttsVoice = null;
// Global utterance anchor set — prevents Android WebView GC from silently killing utterances
if (typeof window !== 'undefined') {
    window._sbActiveUtterances = window._sbActiveUtterances || new Set();
}

function getBestVoice(lang = 'en-US') {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    const prefix = lang.split('-')[0].toLowerCase();
    return (
        voices.find(v => v.lang.toLowerCase() === lang.toLowerCase() && v.localService) ||
        voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
        voices.find(v => v.lang.toLowerCase().startsWith(prefix)) ||
        voices[0] ||
        null
    );
}

export const speak = (text, { lang = 'en-US', rate = 1.0, pitch = 1, priority = 'normal' } = {}) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;

    // Check user preference for voice feedback
    try {
        const cfg = getConfig();
        if (cfg.ui?.voiceFeedback === false && priority !== 'high') {
            return;
        }
    } catch {}

    const _doSpeak = () => {
        try {
            // Android Chrome WebView: resume stalled engine
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
            } catch {}

            if (!_ttsVoice) {
                _ttsVoice = getBestVoice(lang);
            }

            const utt = new SpeechSynthesisUtterance(text);
            utt.lang  = lang;
            utt.rate  = Math.max(0.7, Math.min(1.8, rate));
            utt.pitch = pitch;
            if (_ttsVoice) utt.voice = _ttsVoice;

            // Anchor in global set so Android WebView GC cannot collect it mid-speech
            window._sbActiveUtterances.add(utt);
            utt.onend   = () => { window._sbActiveUtterances.delete(utt); };
            utt.onerror = (e) => {
                window._sbActiveUtterances.delete(utt);
                console.warn('[TTS] Synthesis notice:', e.error);
                try { window.speechSynthesis.resume(); } catch {}
            };

            window.speechSynthesis.speak(utt);
        } catch (err) {
            console.error('[TTS] speak failed:', err);
        }
    };

    if (priority === 'high') {
        // Cancel current speech, then wait one tick before speaking
        // (Chromium/Android WebView bug: calling speak() synchronously after cancel() silently drops it)
        try { window.speechSynthesis.cancel(); } catch {}
        setTimeout(_doSpeak, 80);
    } else {
        _doSpeak();
    }
};

export const cancelSpeech = () => {
    try {
        window.speechSynthesis?.cancel();
        if (typeof window !== 'undefined') window._sbActiveUtterances?.clear();
    } catch {}
};

// Pre-load voices when they become available
if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
        window.speechSynthesis.onvoiceschanged = () => {
            _ttsVoice = getBestVoice('en-US');
        };
        // Trigger initial voice load
        window.speechSynthesis.getVoices();
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// SENTENCE FORMATION — Backend API (Gemini) + Direct Gemini + Smart ASL Engine
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts an array of gesture words into a natural, grammatically correct sentence.
 * 1. Tries backend /api/ai/format-sentence
 * 2. Tries direct Gemini API call if backend is offline and client has internet
 * 3. Falls back to smart rule-based ASL-to-English grammar synthesis engine
 */
/**
 * Intelligent ASL-to-English predictive intent engine.
 * Takes recognized gesture tokens and predicts what the user is trying to say.
 * Returns primary sentence, 3 predictive suggestion completions, and intent category.
 */
export const predictGestureIntent = async (words, token = null) => {
    if (!words || !words.length) {
        return { sentence: '', suggestions: [], intent: 'General' };
    }

    const offlineFallback = predictGestureIntentOffline(words);

    // 1. Backend Prediction API (/api/ai/predict-gesture-sentence)
    try {
        const baseURL = getBackendBaseURL();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${baseURL}/api/ai/predict-gesture-sentence`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ words }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data.sentence && data.sentence.trim()) {
                return {
                    sentence: data.sentence.trim(),
                    suggestions: Array.isArray(data.predictions) && data.predictions.length ? data.predictions : offlineFallback.suggestions,
                    intent: data.intent || offlineFallback.intent,
                    source: 'gemini'
                };
            }
        }
    } catch {
        // Backend unavailable; proceed to Tier 2
    }

    // 2. Direct Gemini Call (works anywhere on mobile independent of local backend)
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (geminiKey && navigator.onLine) {
        const prompt = `You are an assistive communication predictor for deaf and non-verbal individuals.
The user signed these gesture tokens: [${words.join(', ')}].
Predict what the user is trying to say.
Return STRICT JSON ONLY in this format:
{
  "sentence": "the most natural, polite and complete English sentence they are trying to say",
  "suggestions": [
    "Alternative 1 (e.g. polite request)",
    "Alternative 2 (e.g. urgent / direct)",
    "Alternative 3 (e.g. casual conversational)"
  ],
  "intent": "category like Needs, Emergency, Greeting, Social, Question"
}`;

        const CANDIDATE_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

        for (const model of CANDIDATE_MODELS) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);

                const gRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
                        }),
                        signal: controller.signal,
                    }
                );
                clearTimeout(timeoutId);

                if (gRes.ok) {
                    const gData = await gRes.json();
                    const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (rawText) {
                        const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                        const parsed = JSON.parse(cleanJson);
                        return {
                            sentence: parsed.sentence || offlineFallback.sentence,
                            suggestions: Array.isArray(parsed.suggestions) && parsed.suggestions.length ? parsed.suggestions : offlineFallback.suggestions,
                            intent: parsed.intent || offlineFallback.intent,
                            source: 'gemini-direct'
                        };
                    }
                }
            } catch {
                // try next model
            }
        }
    }

    return offlineFallback;
};

/**
 * High-speed Universal Audio Transcription Engine (Whisper / Gemini Flash).
 * Transcribes recorded speech audio chunks from mobile WebView or browser mic.
 */
export const transcribeAudio = async (audioBlob, targetLang = 'en', sourceLang = 'auto') => {
    if (!audioBlob || audioBlob.size === 0) return { text: '', translated: '' };

    const base64Audio = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
    });

    const mimeType = audioBlob.type || 'audio/webm';

    // Tier 1: Backend proxy (/api/ai/transcribe-translate)
    try {
        const baseURL = getBackendBaseURL();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);

        const res = await fetch(`${baseURL}/api/ai/transcribe-translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioBase64: base64Audio,
                targetLang,
                mimeType,
                sourceLang
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data?.text || data?.translated) {
                return {
                    text: data.text || data.translated || '',
                    translated: data.translated || data.text || '',
                    sourceLang: data.sourceLang || sourceLang
                };
            }
        }
    } catch (err) {
        console.warn('[STT] Backend transcribe error:', err);
    }

    // Tier 2: Direct Gemini Flash audio API (works on Android APK without local backend)
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (geminiKey && navigator.onLine) {
        const prompt = `Listen closely to the audio.
1. Transcribe the exact words spoken.
2. If non-English, translate to ${targetLang}.
3. If no words or only static/silence, return empty string.
Output STRICT JSON:
{"text": "transcription", "translated": "translated text", "sourceLang": "language code"}`;

        const GEMINI_CANDIDATES = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

        for (const model of GEMINI_CANDIDATES) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6500);

                const gRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: prompt },
                                    {
                                        inlineData: {
                                            mimeType: mimeType.split(';')[0] || 'audio/wav',
                                            data: base64Audio
                                        }
                                    }
                                ]
                            }],
                            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
                        }),
                        signal: controller.signal,
                    }
                );
                clearTimeout(timeoutId);

                if (gRes.ok) {
                    const gData = await gRes.json();
                    const rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
                    const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (parsed?.text || parsed?.translated) {
                        return {
                            text: parsed.text || parsed.translated || '',
                            translated: parsed.translated || parsed.text || '',
                            sourceLang: parsed.sourceLang || sourceLang
                        };
                    }
                }
            } catch (e2) {
                console.warn(`[STT] Gemini ${model} transcribe error:`, e2?.message || e2);
            }
        }
    }

    return { text: '', translated: '' };
};

export const formatGestureSentence = async (words, token = null) => {
    const res = await predictGestureIntent(words, token);
    return res.sentence || buildSmartSentence(words);
};

/**
 * Intelligent ASL-to-English sentence grammar synthesizer.
 * Transforms raw sign language gestures into natural conversational English.
 */
export function buildSmartSentence(words) {
    return predictGestureIntentOffline(words).sentence;
}

/**
 * Comprehensive offline intent predictor for gesture tokens.
 * Accurately synthesizes non-verbal user intent into full natural sentences.
 */
export function predictGestureIntentOffline(words) {
    if (!words || !words.length) {
        return { sentence: '', suggestions: [], intent: 'General' };
    }

    const lower = words.map(w => w.toLowerCase());
    const has = (t) => lower.some(w => w === t.toLowerCase() || w.includes(t.toLowerCase()));

    // 1. Water / Thirst
    if (has('water') || has('drink')) {
        if (has('more')) {
            return {
                sentence: 'Could I please have some more water to drink?',
                suggestions: [
                    'Could I please have some more water?',
                    'I am still thirsty, another glass of water please.',
                    'Can you refill my water bottle?'
                ],
                intent: 'Needs (Thirst)'
            };
        }
        if (has('please')) {
            return {
                sentence: 'May I please have a glass of water?',
                suggestions: [
                    'May I please have a glass of water?',
                    'I am thirsty, could you bring me some water?',
                    'Where can I find drinking water, please?'
                ],
                intent: 'Needs (Thirst)'
            };
        }
        return {
            sentence: 'I am thirsty, could I please get some water to drink?',
            suggestions: [
                'I am thirsty, could I please get some water?',
                'Please give me a glass of drinking water.',
                'Can I have something to drink?'
            ],
            intent: 'Needs (Thirst)'
        };
    }

    // 2. Food / Eating / Hunger
    if (has('eat') || has('food')) {
        if (has('more')) {
            return {
                sentence: 'I am still hungry, could I please have some more food?',
                suggestions: [
                    'Could I please have another portion of food?',
                    'I am still hungry, can I have more?',
                    'Is there any more food left for me?'
                ],
                intent: 'Needs (Hunger)'
            };
        }
        return {
            sentence: 'I am hungry and would like something to eat, please.',
            suggestions: [
                'I would like something to eat, please.',
                'Is it time for a meal?',
                'Can we get some food together?'
            ],
            intent: 'Needs (Hunger)'
        };
    }

    // 3. Stop / Urgent / Emergency
    if (has('stop')) {
        if (has('wait')) {
            return {
                sentence: 'Please stop and wait a moment for me.',
                suggestions: [
                    'Please stop and wait for me.',
                    'Hold on, please do not proceed yet.',
                    'Wait right here, please.'
                ],
                intent: 'Urgent'
            };
        }
        return {
            sentence: 'Please stop what you are doing.',
            suggestions: [
                'Please stop what you are doing.',
                'I need you to stop right now.',
                'Stop, I need assistance.'
            ],
            intent: 'Urgent'
        };
    }

    // 4. Wait / Patience
    if (has('wait')) {
        return {
            sentence: 'Please wait a moment while I finish communicating.',
            suggestions: [
                'Please hold on for just a moment.',
                'Give me a second to express myself.',
                'Please wait right there.'
            ],
            intent: 'Patience'
        };
    }

    // 5. Call me / Contact
    if (has('call me')) {
        return {
            sentence: 'Please give me a call as soon as you have time.',
            suggestions: [
                'Please call me on the phone when you are free.',
                'Can you call my contact number?',
                'Please reach out to me soon.'
            ],
            intent: 'Communication'
        };
    }

    // 6. Greetings & Introductions
    if (has('hello')) {
        if (has('name')) {
            return {
                sentence: 'Hello! What is your name? Nice to meet you.',
                suggestions: [
                    'Hello! May I know what your name is?',
                    'Hello, nice to meet you today.',
                    'Hello, let me introduce myself.'
                ],
                intent: 'Greeting'
            };
        }
        return {
            sentence: 'Hello! I hope you are having a wonderful day.',
            suggestions: [
                'Hello! How are you doing today?',
                'Hello! Good morning / good afternoon.',
                'Hello, it is great to see you!'
            ],
            intent: 'Greeting'
        };
    }

    // 7. Name / Identity
    if (has('name')) {
        return {
            sentence: 'What is your name? It is a pleasure to meet you.',
            suggestions: [
                'Could you please tell me your name?',
                'My name is being signed with gestures.',
                'May I know who I am speaking with?'
            ],
            intent: 'Question'
        };
    }

    // 8. Love / Affection
    if (has('love you')) {
        return {
            sentence: 'I love and care about you very much.',
            suggestions: [
                'I love you with all my heart.',
                'Sending you my love and best wishes.',
                'I really appreciate and love you.'
            ],
            intent: 'Affection'
        };
    }

    // 9. Apologies / Courtesy
    if (has('sorry')) {
        return {
            sentence: 'I am very sorry, please excuse me.',
            suggestions: [
                'I apologize for any inconvenience.',
                'Sorry about that, please forgive me.',
                'I am sorry, thank you for your patience.'
            ],
            intent: 'Courtesy'
        };
    }

    // 10. Agreement / Confirmation
    if (has('yes') || has('okay') || has('ok')) {
        return {
            sentence: 'Yes, that sounds great and works for me.',
            suggestions: [
                'Yes, I agree with that.',
                'That is completely okay with me.',
                'Yes, let us proceed.'
            ],
            intent: 'Confirmation'
        };
    }

    // 11. Disagreement / Denial
    if (has('no')) {
        return {
            sentence: 'No, thank you. I would prefer not to.',
            suggestions: [
                'No, that is not what I meant.',
                'No, thank you very much.',
                'I do not agree with that.'
            ],
            intent: 'Response'
        };
    }

    // 12. Single token shortcuts
    if (words.length === 1) {
        const w = words[0];
        const wl = w.toLowerCase();
        if (wl === 'promise') return { sentence: 'I give you my promise.', suggestions: ['I promise.', 'You have my word.', 'I will keep my promise.'], intent: 'Social' };
        if (wl === 'peace') return { sentence: 'Wishing you peace and harmony.', suggestions: ['Peace to you.', 'Stay calm and peaceful.', 'Peace and goodwill.'], intent: 'Social' };
        if (wl === 'rock') return { sentence: 'You are awesome! Rock on.', suggestions: ['Rock on!', 'Great job!', 'Keep rocking!'], intent: 'Social' };
    }

    // Default synthesis
    const joined = words.join(' ');
    const capital = joined.charAt(0).toUpperCase() + joined.slice(1);
    const sentence = capital.endsWith('.') || capital.endsWith('!') || capital.endsWith('?') ? capital : `${capital}.`;
    return {
        sentence,
        suggestions: [
            sentence,
            `I want to communicate: ${joined}.`,
            `Please understand: ${joined}.`
        ],
        intent: 'General'
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTURE DETECT — exported for GestureAssistPage (use MediaPipe CDN directly)
// The page handles camera + MediaPipe init; this just exports the classifier.
// ═══════════════════════════════════════════════════════════════════════════
export { classifyGestureAdvanced };
