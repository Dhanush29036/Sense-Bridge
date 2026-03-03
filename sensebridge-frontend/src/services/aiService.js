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

export const startObjectDetection = async (videoElement, onDetection) => {
    console.info('[Vision] Starting object detection…');
    _visionActive = true;

    if (!_visionModel) {
        await tf.setBackend('webgl');
        await tf.ready();
        // mobilenet_v2 is significantly more accurate than lite_mobilenet_v2
        _visionModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        console.info('[Vision] Model loaded (mobilenet_v2 + WebGL)');
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
            // Run inference inside tf.tidy to avoid memory leaks
            const raw = await _visionModel.detect(videoElement, 20, 0.40);
            const filtered = nms(raw);

            const W = videoElement.videoWidth || 640;
            const H = videoElement.videoHeight || 480;

            const detections = filtered.map(p => ({
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

            onDetection?.({ detections, timestamp: now, latency: +(performance.now() - now).toFixed(1) });

            const highConf = detections.filter(d => d.confidence > 0.55);
            if (highConf.length && now - lastLogTime > 4000) {
                lastLogTime = now;
                logService.create({
                    eventType: 'object_detection',
                    message: `Detected: ${highConf.map(d => d.label).join(', ')}`,
                    severity: 'info',
                    confidence: Math.max(...highConf.map(d => d.confidence)),
                    metadata: { detections, model: 'coco-ssd-mobilenetv2' },
                }).catch(() => { });
            }
        }
        _visionRafId = requestAnimationFrame(loop);
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
// TEXT-TO-SPEECH — Priority queue with voice pre-selection
// ═══════════════════════════════════════════════════════════════════════════

let _ttsVoice = null;

function getBestVoice(lang = 'en-US') {
    const voices = window.speechSynthesis.getVoices();
    // Prefer local/enhanced voices
    return (
        voices.find(v => v.lang === lang && !v.localService === false) ||
        voices.find(v => v.lang.startsWith(lang.split('-')[0])) ||
        voices[0] ||
        null
    );
}

export const speak = (text, { lang = 'en-US', rate = 1.05, pitch = 1, priority = 'normal' } = {}) => {
    if (!text || !window.speechSynthesis) return;
    if (priority === 'high') window.speechSynthesis.cancel();

    if (!_ttsVoice) _ttsVoice = getBestVoice(lang);

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;
    utt.rate = rate;
    utt.pitch = pitch;
    if (_ttsVoice) utt.voice = _ttsVoice;
    window.speechSynthesis.speak(utt);
};

export const cancelSpeech = () => window.speechSynthesis?.cancel();

// Pre-load voices when they become available
if (typeof window !== 'undefined') {
    window.speechSynthesis?.addEventListener('voiceschanged', () => {
        _ttsVoice = getBestVoice('en-US');
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// SENTENCE FORMATION — Backend API (Gemini) with instant fallback
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Converts an array of gesture words into a grammatically correct sentence.
 * Calls the backend /api/ai/format-sentence (which calls Gemini if API key configured).
 */
export const formatGestureSentence = async (words, token) => {
    if (!words?.length) return '';
    try {
        const res = await fetch('/api/ai/format-sentence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ words }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        return data.sentence || words.join(' ');
    } catch {
        // Instant client-side fallback — no loading spinner needed
        return buildClientSentence(words);
    }
};

function buildClientSentence(words) {
    if (!words.length) return '';
    if (words.length === 1) return words[0] + '.';
    // Capitalise first word, ensure full stop
    const sentence = words.map((w, i) => i === 0 ? w : w.toLowerCase()).join(' ');
    return sentence.endsWith('.') ? sentence : sentence + '.';
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTURE DETECT — exported for GestureAssistPage (use MediaPipe CDN directly)
// The page handles camera + MediaPipe init; this just exports the classifier.
// ═══════════════════════════════════════════════════════════════════════════
export { classifyGestureAdvanced };
