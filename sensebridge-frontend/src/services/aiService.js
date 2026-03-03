import { logService } from './api';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';

// ─── Object Detection (YOLO / COCO-SSD) ────────────────────────────────────

let _visionModel = null;
let _visionActive = false;
let _visionRaf = null;

export const startObjectDetection = async (videoElement, onDetection) => {
    console.info('[AI] Object detection starting...');
    _visionActive = true;

    if (!_visionModel) {
        await tf.ready();
        _visionModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    }

    let lastLogTime = 0;

    const detectFrame = async () => {
        if (!_visionActive) return;
        if (videoElement.readyState === 4) {
            const predictions = await _visionModel.detect(videoElement);

            // Map bounding boxes to percentages
            const width = videoElement.videoWidth;
            const height = videoElement.videoHeight;

            const detections = predictions.map(p => ({
                label: p.class,
                confidence: p.score,
                bbox: p.bbox, // [x, y, width, height]
                pctBbox: [
                    (p.bbox[0] / width) * 100,
                    (p.bbox[1] / height) * 100,
                    (p.bbox[2] / width) * 100,
                    (p.bbox[3] / height) * 100
                ]
            }));

            onDetection?.({ detections, timestamp: Date.now() });

            // Log high confidence detections throttle to once every 3 sec
            const highConf = detections.filter(d => d.confidence > 0.65);
            if (highConf.length && Date.now() - lastLogTime > 3000) {
                lastLogTime = Date.now();
                logService.create({
                    eventType: 'object_detection',
                    message: `Detected: ${highConf.map(d => d.label).join(', ')}`,
                    severity: 'warning',
                    confidence: Math.max(...highConf.map(d => d.confidence)),
                    metadata: { detections, model: 'coco-ssd-lite' }
                }).catch(console.error);
            }
        }
        _visionRaf = requestAnimationFrame(detectFrame);
    };

    detectFrame();

    return () => stopObjectDetection();
};

export const stopObjectDetection = () => {
    _visionActive = false;
    if (_visionRaf) cancelAnimationFrame(_visionRaf);
    console.info('[AI] Object detection stopped');
};

// ─── Speech Recognition (Web Speech API) ──────────────────────────────────

let _recognition = null;

export const startSpeechRecognition = (onTranscript, language = 'en-US') => {
    console.info('[AI] Speech recognition starting — lang:', language);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('Speech Recognition API not supported in this browser.');
        return () => { };
    }

    _recognition = new SpeechRecognition();
    _recognition.continuous = true;
    _recognition.interimResults = true;
    _recognition.lang = language;

    let lastLoggedTranscript = '';

    _recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
                const conf = event.results[i][0].confidence || 0.9;

                if (finalTranscript.trim() && finalTranscript !== lastLoggedTranscript) {
                    lastLoggedTranscript = finalTranscript;
                    onTranscript?.({ text: finalTranscript, confidence: conf, language });

                    logService.create({
                        eventType: 'speech_to_text',
                        message: finalTranscript,
                        confidence: conf,
                        metadata: { model: 'web-speech-api', language },
                    }).catch(console.error);
                }
            }
        }
    };

    _recognition.onerror = (e) => console.error('[AI] Speech Error:', e.error);

    // Auto restart if it stops while supposedly active
    _recognition.onend = () => {
        if (_recognition) {
            try { _recognition.start(); } catch { }
        }
    };

    try { _recognition.start(); } catch { }

    return () => stopSpeechRecognition();
};

export const stopSpeechRecognition = () => {
    if (_recognition) {
        _recognition.onend = null;
        _recognition.stop();
        _recognition = null;
    }
    console.info('[AI] Speech recognition stopped');
};

// ─── Gesture Recognition (Handpose) ────────────────────────────────────────

let _gestureModel = null;
let _gestureActive = false;
let _gestureRaf = null;

export const startGestureRecognition = async (videoElement, onGesture) => {
    console.info('[AI] Gesture recognition starting (MediaPipe Hands)...');
    _gestureActive = true;

    if (!_gestureModel) {
        await tf.setBackend('webgl');
        await tf.ready();
        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        _gestureModel = await handPoseDetection.createDetector(model, {
            runtime: 'tfjs',
            modelType: 'lite',
            maxHands: 1,
        });
    }

    let lastLogTime = 0;

    const detectFrame = async () => {
        if (!_gestureActive) return;
        if (videoElement.readyState >= 2) {
            try {
                const hands = await _gestureModel.estimateHands(videoElement, { flipHorizontal: true });
                if (hands.length > 0) {
                    const keypoints = hands[0].keypoints;
                    const gesture = determineGesture(keypoints);
                    if (gesture && gesture !== 'unknown' && Date.now() - lastLogTime > 1500) {
                        onGesture?.({ gesture, confidence: hands[0].score ?? 0.85, timestamp: Date.now() });
                        lastLogTime = Date.now();
                        logService.create({
                            eventType: 'gesture',
                            message: `Gesture: ${gesture}`,
                            confidence: hands[0].score ?? 0.85,
                            metadata: { model: 'mediapipe-hands-tfjs', gesture },
                        }).catch(console.error);
                    }
                }
            } catch (e) { /* ignore frame errors */ }
        }
        setTimeout(() => {
            if (_gestureActive) _gestureRaf = requestAnimationFrame(detectFrame);
        }, 80);
    };

    detectFrame();
    return () => stopGestureRecognition();
};

export const stopGestureRecognition = () => {
    _gestureActive = false;
    if (_gestureRaf) cancelAnimationFrame(_gestureRaf);
    console.info('[AI] Gesture recognition stopped');
};

// ── Gesture heuristic from MediaPipe 21 keypoints ─────────────────────────
// keypoints array: thumb(0-4), index(5-8), middle(9-12), ring(13-16), pinky(17-20)
function determineGesture(kp) {
    // Use y-coordinates: smaller y = higher on screen (video coords)
    const tip = (i) => kp[i];
    const mcp = (i) => kp[i]; // metacarpal base

    const fingerExtended = (tipIdx, mcpIdx) =>
        tip(tipIdx).y < mcp(mcpIdx).y; // tip higher than base = extended

    const indexUp = fingerExtended(8, 5);
    const middleUp = fingerExtended(12, 9);
    const ringUp = fingerExtended(16, 13);
    const pinkyUp = fingerExtended(20, 17);

    // Thumb: compare tip.x to ip.x (landmark 3) — mirrored video
    const thumbUp = kp[4].y < kp[3].y && kp[3].y < kp[2].y;

    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'thumbs_up';
    if (!indexUp && !middleUp && !ringUp && !pinkyUp && !thumbUp) return 'fist';
    if (indexUp && middleUp && !ringUp && !pinkyUp) return 'peace';
    if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'pointing';
    if (indexUp && middleUp && ringUp && pinkyUp) return 'open_palm';
    return 'unknown';
}
