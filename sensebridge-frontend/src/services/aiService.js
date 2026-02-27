import { logService } from './api';

/**
 * AI Module Placeholders
 * ─────────────────────────────────────────────────────────
 * These functions mimic the interface that real AI services
 * (YOLO, Whisper, MediaPipe) will ultimately fill.
 * Replace the body of each function when wiring real models.
 */

// ─── Object Detection (YOLO) ───────────────────────────────────────────────

let _objectDetectionInterval = null;

export const startObjectDetection = (onDetection) => {
    console.info('[AI] Object detection started (placeholder)');

    // Simulate YOLO detections every 3 seconds
    _objectDetectionInterval = setInterval(() => {
        const mockDetections = [
            { label: 'person', confidence: 0.92, bbox: [120, 80, 200, 300] },
            { label: 'car', confidence: 0.78, bbox: [300, 150, 480, 250] },
        ];
        const result = {
            detections: mockDetections,
            timestamp: new Date().toISOString(),
        };
        onDetection?.(result);

        // Auto-log critical detections to backend
        const highConf = mockDetections.filter((d) => d.confidence > 0.85);
        if (highConf.length) {
            logService.create({
                eventType: 'object_detection',
                message: `Detected: ${highConf.map((d) => d.label).join(', ')}`,
                severity: 'warning',
                confidence: Math.max(...highConf.map((d) => d.confidence)),
                metadata: { detections: mockDetections, model: 'YOLOv8-placeholder' },
            }).catch(console.error);
        }
    }, 3000);

    return () => stopObjectDetection();
};

export const stopObjectDetection = () => {
    if (_objectDetectionInterval) {
        clearInterval(_objectDetectionInterval);
        _objectDetectionInterval = null;
        console.info('[AI] Object detection stopped');
    }
};

// ─── Speech Recognition (Whisper) ─────────────────────────────────────────

let _speechRecognitionActive = false;

export const startSpeechRecognition = (onTranscript, language = 'en') => {
    console.info('[AI] Speech recognition started (placeholder) — lang:', language);
    _speechRecognitionActive = true;

    // In production: connect to Whisper microservice WebSocket
    // Placeholder: emit a fake transcript every 5s
    const interval = setInterval(() => {
        if (!_speechRecognitionActive) return;
        const phrases = [
            'Hello, how can I help you?',
            'Please proceed to the next corridor.',
            'Obstacle detected ahead.',
        ];
        const transcript = phrases[Math.floor(Math.random() * phrases.length)];
        onTranscript?.({ text: transcript, confidence: 0.94, language });

        logService.create({
            eventType: 'speech_to_text',
            message: transcript,
            confidence: 0.94,
            metadata: { model: 'whisper-placeholder', language },
        }).catch(console.error);
    }, 5000);

    return () => {
        _speechRecognitionActive = false;
        clearInterval(interval);
        console.info('[AI] Speech recognition stopped');
    };
};

export const stopSpeechRecognition = () => {
    _speechRecognitionActive = false;
};

// ─── Gesture Recognition (MediaPipe) ──────────────────────────────────────

let _gestureInterval = null;

export const startGestureRecognition = (onGesture) => {
    console.info('[AI] Gesture recognition started (placeholder)');

    const gestures = ['thumbs_up', 'peace', 'open_palm', 'pointing', 'fist'];

    _gestureInterval = setInterval(() => {
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        const result = { gesture, confidence: 0.88, timestamp: Date.now() };
        onGesture?.(result);

        logService.create({
            eventType: 'gesture',
            message: `Gesture: ${gesture}`,
            confidence: 0.88,
            metadata: { model: 'mediapipe-placeholder', gesture },
        }).catch(console.error);
    }, 2500);

    return () => stopGestureRecognition();
};

export const stopGestureRecognition = () => {
    if (_gestureInterval) {
        clearInterval(_gestureInterval);
        _gestureInterval = null;
        console.info('[AI] Gesture recognition stopped');
    }
};
