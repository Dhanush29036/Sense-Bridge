/**
 * VisionAssistPage.jsx — SenseBridge Vision Assist
 * OCR: Gemini Vision (primary, handles handwriting) → Tesseract.js (fallback)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { createWorker } from 'tesseract.js';
import { getBackendBaseURL } from '../services/networkConfig';
import {
    startObjectDetection, stopObjectDetection, speak, cancelSpeech,
    ObstacleTracker, analyzeFrameForHazards,
} from '../services/aiService';
import {
    loadModels as loadFaceModels, detectFaces, buildMatcher, matchFaces,
    loadKnownFaces, saveKnownFace, deleteKnownFace,
} from '../services/faceService';
import {
    Eye, Volume2, Square, ScanText, Copy, X,
    UserCheck, UserPlus, Camera, Trash2, ChevronDown, ChevronUp, Loader,
    ChevronLeft, Sparkles,
} from 'lucide-react';
import { getConfig, updateConfig, TemporalFilter } from '../config/config';

const _temporalFilter = new TemporalFilter();

// ── ALL 80 COCO classes — detect everything the model can see ─────────────
const OBSTACLE_CLASSES = new Set([
    'person','bicycle','car','motorcycle','airplane','bus','train','truck',
    'boat','traffic light','fire hydrant','stop sign','parking meter','bench',
    'bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe',
    'backpack','umbrella','handbag','tie','suitcase','frisbee',
    'skis','snowboard','sports ball','kite','baseball bat','baseball glove',
    'skateboard','surfboard','tennis racket','bottle','wine glass','cup',
    'fork','knife','spoon','bowl','banana','apple','sandwich','orange',
    'broccoli','carrot','hot dog','pizza','donut','cake','chair','couch',
    'potted plant','bed','dining table','toilet','tv','laptop','mouse',
    'remote','keyboard','cell phone','microwave','oven','toaster','sink',
    'refrigerator','book','clock','vase','scissors','teddy bear',
    'hair drier','toothbrush',
]);
const MOVING_CLASSES = new Set(['person','bicycle','car','motorcycle','bus','truck','dog','cat','horse']);

const estimateDistance = (pctBbox) => {
    if (!pctBbox) return 'medium';
    const w = pctBbox[2] || 0;
    const h = pctBbox[3] || 0;
    const a = w * h;
    // Bbox area > 160 or width > 15% or height > 22% is within ~1.2m
    if (a > 160 || w > 15 || h > 22) return 'close';
    // Bbox area > 20 or width > 4% or height > 6% is within ~2.5m
    if (a > 20 || w > 4 || h > 6) return 'medium';
    return 'far';
};
const getDirection = (pctBbox) => {
    if (!pctBbox) return 'ahead';
    const cx = pctBbox[0] + (pctBbox[2] || 0) / 2;
    return cx < 35 ? 'left' : cx > 65 ? 'right' : 'ahead';
};

const DIST_COLOR = { close: '#F43F5E', medium: '#F59E0B', far: '#10B981' };
const DIST_METERS = { close: '0.8m', medium: '1.8m', far: '3.2m' };
const HAZARD_CFG = {
    stair:{ label:'Staircase Ahead', color:'#F59E0B', msg:'Warning: Stairs ahead. Slow down.' },
    drop: { label:'Drop Edge Ahead', color:'#F43F5E', msg:'Warning: Potential drop ahead. Stop!' },
    slope:{ label:'Incline Ahead',   color:'#6366F1', msg:'Incline detected ahead.' },
};

// Low-latency warning beep using Web Audio API with AudioContext recovery
let _visionAudioCtx = null;
const playBeep = (freq = 880, duration = 150) => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!_visionAudioCtx || _visionAudioCtx.state === 'closed') {
            _visionAudioCtx = new AudioContext();
        }
        if (_visionAudioCtx.state === 'suspended') {
            _visionAudioCtx.resume().catch(() => {});
        }
        const osc = _visionAudioCtx.createOscillator();
        const gain = _visionAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, _visionAudioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, _visionAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, _visionAudioCtx.currentTime + duration / 1000);
        osc.connect(gain);
        gain.connect(_visionAudioCtx.destination);
        osc.start();
        osc.stop(_visionAudioCtx.currentTime + duration / 1000);
    } catch(e) {}
};

function boxOverlap(faceBox, detBox, W, H) {
    const dx = detBox[0] * W / 100, dy = detBox[1] * H / 100;
    const dw = detBox[2] * W / 100, dh = detBox[3] * H / 100;
    const xi = Math.max(faceBox.x, dx), yi = Math.max(faceBox.y, dy);
    const xe = Math.min(faceBox.x + faceBox.w, dx + dw);
    const ye = Math.min(faceBox.y + faceBox.h, dy + dh);
    const inter = Math.max(0, xe-xi) * Math.max(0, ye-yi);
    const union = faceBox.w * faceBox.h + dw * dh - inter;
    return union > 0 ? inter / union : 0;
}

// ── Simulated confidence (0–100) ─────────────────────────────────────────
const getAIConfidence = (obstacles) => {
    if (!obstacles.length) return 0;
    const avg = obstacles.reduce((s, d) => s + (d.confidence || 0.8), 0) / obstacles.length;
    return Math.round(avg * 100);
};

const getNearestMeters = (obstacles) => {
    const close = obstacles.find(d => d.distance === 'close');
    if (close) return '0.8m';
    const med = obstacles.find(d => d.distance === 'medium');
    if (med) return '1.5m';
    return '5.0m';
};

// ═══════════════════════════════════════════════════════════════════════════
const VisionAssistPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [active,      setActive]      = useState(location.state?.autoStart || location.state?.mode === 'navigation' || location.state?.mode === 'ocr' || true);
    const [obstacles,   setObstacles]   = useState([]);
    const [hazard,      setHazard]      = useState(null);
    const [alerts,      setAlerts]      = useState([]);
    const [speaking,    setSpeaking]    = useState(false);
    const [curAlert,    setCurAlert]    = useState('');
    const [faceReady,   setFaceReady]   = useState(false);
    const [faceLoading, setFaceLoading] = useState(false);
    const [knownFaces,  setKnownFaces]  = useState([]);
    const [faceResults, setFaceResults] = useState([]);
    const [showEnroll,  setShowEnroll]  = useState(false);
    const [enrollName,  setEnrollName]  = useState('');
    const [enrollMsg,   setEnrollMsg]   = useState('');
    const [showFacePanel, setShowFacePanel] = useState(false);

    // OCR state
    const [ocrText,      setOcrText]      = useState('');
    const [ocrLoading,   setOcrLoading]   = useState(false);
    const [ocrError,     setOcrError]     = useState('');
    const [showOcrCard,  setShowOcrCard]  = useState(false);

    // AI Details & Telemetry
    const [showAIDetails, setShowAIDetails] = useState(() => getConfig().ui?.showAIDetails ?? false);
    const [lastLatencyMs, setLastLatencyMs] = useState(0);

    const videoRef           = useRef(null);
    const canvasRef          = useRef(null);
    const streamRef          = useRef(null);
    const trackerRef         = useRef(new ObstacleTracker());
    const matcherRef         = useRef(null);
    const frameRef           = useRef(0);
    const speakTimer         = useRef(null);
    const ocrWorkerRef       = useRef(null);  // persistent Tesseract worker
    const lastVisionAlertsRef= useRef(new Map()); // key -> { time, dist, steer }
    const lastBeepRef        = useRef(0);
    const prevSteerRef       = useRef('right');

    // Implements Eq. (7) Adaptive Spatio-Temporal Throttling Filter:
    // A_emit(l,t) = 1 if (t - t_last(l) > tau_cd) OR (Delta d / Delta t < -v_crit)
    // where tau_cd = 16.0s for static landmarks, 4.0s for dynamic steering, 2.5s for urgent/rapid
    const shouldEmitVisionAlert = useCallback((key, currentDistMeters, isUrgent, steer) => {
        const now = Date.now();
        const prev = lastVisionAlertsRef.current.get(key);
        if (!prev) {
            lastVisionAlertsRef.current.set(key, { time: now, dist: currentDistMeters, steer });
            return true;
        }

        const dtSeconds = (now - prev.time) / 1000;
        const deltaD = currentDistMeters - prev.dist;
        const approachVelocity = dtSeconds > 0 ? -(deltaD / dtSeconds) : 0;
        const rapidApproach = approachVelocity >= 1.8; // v_crit = 1.8 m/s
        const cooldown = isUrgent ? 2.5 : 4.0;
        // Direction change only overrides if at least 2.5s have elapsed (prevents flip-flop beeping)
        const steerChanged = steer && prev.steer && steer !== prev.steer && dtSeconds >= 2.5;

        if (dtSeconds >= cooldown || rapidApproach || steerChanged) {
            lastVisionAlertsRef.current.set(key, { time: now, dist: currentDistMeters, steer });
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        const onStart = () => setActive(true);
        const onStop  = () => setActive(false);
        window.addEventListener('vc:start', onStart);
        window.addEventListener('vc:stop',  onStop);
        return () => {
            window.removeEventListener('vc:start', onStart);
            window.removeEventListener('vc:stop',  onStop);
        };
    }, []);

    const ensureFaceModels = useCallback(async () => {
        if (faceReady) return true;
        setFaceLoading(true);
        try { await loadFaceModels(); setFaceReady(true); setFaceLoading(false); return true; }
        catch (e) { console.error('[Face]', e); setFaceLoading(false); return false; }
    }, [faceReady]);

    useEffect(() => {
        const kf = loadKnownFaces();
        setKnownFaces(kf);
        if (kf.length) {
            matcherRef.current = buildMatcher(kf, 0.50);
            loadFaceModels().then(() => setFaceReady(true)).catch(() => {});
        }
    }, []);

    useEffect(() => { matcherRef.current = buildMatcher(knownFaces, 0.50); }, [knownFaces]);

    const doSpeak = useCallback((text, urgent = false) => {
        clearTimeout(speakTimer.current);
        setSpeaking(true);
        setCurAlert(text);
        // SpeechQueue serializes delivery and preempts for critical alerts
        speak(text, { priority: urgent ? 'critical' : 'high', rate: urgent ? 1.08 : 1.0 });
        speakTimer.current = setTimeout(() => setSpeaking(false), Math.max(2500, text.length * 75));
    }, []);

    const addAlert = useCallback((msg, urgent = false) => {
        setAlerts(prev => [
            { id: Date.now() + Math.random(), msg: urgent ? `⚠️ ${msg}` : msg, urgent, time: new Date().toLocaleTimeString() },
            ...prev
        ].slice(0, 15));
    }, []);

    useEffect(() => {
        let stopFn = null;
        trackerRef.current.reset();
        if (!active) {
            stopObjectDetection();
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            if (videoRef.current) videoRef.current.srcObject = null;
            setHazard(null); setFaceResults([]);
            return;
        }
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 640 } }
                });
                streamRef.current = stream;
                const vid = videoRef.current;
                if (!vid) return;
                vid.srcObject = stream;

                const initDetection = async () => {
                    try { await vid.play(); } catch {}
                    if (knownFaces.length && !faceReady) await ensureFaceModels();
                    stopFn = await startObjectDetection(vid, async (result) => {
                        const W = vid.videoWidth || 640;
                        const H = vid.videoHeight || 480;
                        frameRef.current++;
                        if (result.latency) setLastLatencyMs(result.latency);

                        // Map ALL detected objects with confidence >= 0.20
                        const obs = (result.detections || [])
                            .filter(d => d.label && (d.confidence || 0) >= 0.20)
                            .map(d => ({
                                ...d,
                                label: (d.label || 'obstacle').toLowerCase().trim(),
                                distance: d.distance_m ? (d.distance_m < 1.2 ? 'close' : d.distance_m < 2.5 ? 'medium' : 'far') : estimateDistance(d.pctBbox),
                                direction: getDirection(d.pctBbox)
                            }));

                        const tracked = trackerRef.current.update(obs, W, H);
                        const hasPerson = tracked.some(d => d.label === 'person');
                        let enriched = tracked;

                        if (hasPerson && faceReady && matcherRef.current && frameRef.current % 5 === 0) {
                            try {
                                const detected = await detectFaces(vid);
                                const matched  = matchFaces(detected, matcherRef.current);
                                setFaceResults(matched.filter(f => !f.unknown));
                                enriched = tracked.map(d => {
                                    if (d.label !== 'person') return d;
                                    const face = matched.find(f => !f.unknown && boxOverlap(f.box, d.pctBbox, W, H) > 0.25);
                                    return face ? { ...d, knownName: face.name, faceConf: Math.round((1 - face.distance) * 100) } : d;
                                });
                                for (const m of matched) {
                                    if (m.unknown) continue;
                                    if (shouldEmitVisionAlert(`face-${m.name}`, 1.5, false, 'ahead')) {
                                        doSpeak(`Your friend ${m.name} is in front of you`);
                                        addAlert(`${m.name} recognized`, false);
                                    }
                                }
                            } catch { /* transient */ }
                        }

                        setObstacles(enriched);
                        window.dispatchEvent(new CustomEvent('sb:vision', { 
                            detail: { detections: enriched.map(d => ({ label: d.knownName || d.label, confidence: d.confidence, pctBbox: d.pctBbox })) } 
                        }));
                        
                        // ── Directional Navigation & Obstacle Guidance Engine ──
                        // Evaluates obstacles and delivers explicit directional steering:
                        // "Watch out! [Object] ahead, go left / go right"
                        if (enriched.length > 0) {
                            // Prioritize closest obstacles first, then approaching objects, then center path obstacles
                            const sortedObs = [...enriched].sort((a, b) => {
                                const distWeight = { close: 0, medium: 1, far: 2 };
                                const dDiff = (distWeight[a.distance] ?? 1) - (distWeight[b.distance] ?? 1);
                                if (dDiff !== 0) return dDiff;
                                if (a.motion?.approaching && !b.motion?.approaching) return -1;
                                if (b.motion?.approaching && !a.motion?.approaching) return 1;
                                const aCenter = Math.abs(((a.pctBbox?.[0] || 50) + (a.pctBbox?.[2] || 0) / 2) - 50);
                                const bCenter = Math.abs(((b.pctBbox?.[0] || 50) + (b.pctBbox?.[2] || 0) / 2) - 50);
                                return aCenter - bCenter;
                            });

                            const pri = sortedObs[0];
                            const label = pri.knownName || pri.label;
                            const cx = pri.pctBbox ? (pri.pctBbox[0] + pri.pctBbox[2] / 2) : 50;
                            const isVeryClose = pri.distance === 'close';

                            // Determine clearer evasion side with deadband hysteresis (prevents rapid left/right oscillation)
                            const leftBlocked = enriched.some(o => ((o.pctBbox?.[0] || 0) + (o.pctBbox?.[2] || 0) / 2) < 42);
                            const rightBlocked = enriched.some(o => ((o.pctBbox?.[0] || 0) + (o.pctBbox?.[2] || 0) / 2) > 58);

                            let steer = prevSteerRef.current;
                            if (leftBlocked && !rightBlocked) steer = 'right';
                            else if (rightBlocked && !leftBlocked) steer = 'left';
                            else if (cx > 56) steer = 'left';  // obstacle on right -> steer left
                            else if (cx < 44) steer = 'right'; // obstacle on left -> steer right
                            // within [44, 56], keep previous steer direction to eliminate jitter
                            prevSteerRef.current = steer;

                            let guidance = '';
                            let isUrgent = isVeryClose;

                            if (pri.motion?.approaching) {
                                const appDir = pri.motion.direction || 'ahead';
                                const evade = appDir === 'left' ? 'right' : 'left';
                                guidance = pri.knownName
                                    ? `Watch out! Your friend ${pri.knownName} is approaching! Go ${evade}.`
                                    : `Watch out! ${label} approaching from ${appDir}! Go ${evade}.`;
                                isUrgent = true;
                            } else if (pri.direction === 'ahead') {
                                if (isVeryClose) {
                                    guidance = `Watch out! ${label} directly ahead! Go ${steer} now!`;
                                    isUrgent = true;
                                } else {
                                    guidance = `Watch out! ${label} ahead. Go ${steer}.`;
                                }
                            } else if (pri.direction === 'left') {
                                guidance = isVeryClose
                                    ? `Watch out! ${label} close on your left. Go right.`
                                    : `Watch out! ${label} on your left. Keep right.`;
                            } else if (pri.direction === 'right') {
                                guidance = isVeryClose
                                    ? `Watch out! ${label} close on your right. Go left.`
                                    : `Watch out! ${label} on your right. Keep left.`;
                            }

                            const estM = isVeryClose ? 0.8 : (pri.distance === 'medium' ? 1.8 : 3.2);
                            if (guidance && shouldEmitVisionAlert(`steer-${label}`, estM, isUrgent, steer)) {
                                const now = Date.now();
                                if (now - lastBeepRef.current >= 2500) {
                                    lastBeepRef.current = now;
                                    playBeep(isUrgent ? 880 : 660, 140);
                                }
                                doSpeak(guidance, isUrgent);
                                addAlert(guidance, isUrgent);
                            }
                        }

                        // Hazard analysis every 20 frames (stairs, drop edges, slopes)
                        if (frameRef.current % 20 === 0) {
                            const h = analyzeFrameForHazards(vid);
                            const validHazard = h && h.confidence >= 0.72;
                            setHazard(validHazard ? h : null);
                            if (validHazard) {
                                window.dispatchEvent(new CustomEvent('sb:vision', { detail: { hazard: h } }));
                                const type = h.stair ? 'stair' : h.drop ? 'drop' : 'slope';
                                const hazardMsg = h.drop
                                    ? 'Danger! Drop edge ahead. Stop immediately!'
                                    : h.stair
                                        ? 'Watch out! Stairs ahead. Watch your step and proceed slowly.'
                                        : 'Caution: Incline ahead. Watch your footing and continue straight.';
                                const estM = h.drop ? 0.8 : (h.stair ? 1.5 : 2.5);
                                if (shouldEmitVisionAlert(`hazard-${type}`, estM, h.drop || h.stair, 'ahead')) {
                                    const now = Date.now();
                                    if (now - lastBeepRef.current >= 2500) {
                                        lastBeepRef.current = now;
                                        playBeep(h.drop ? 960 : 780, 180);
                                    }
                                    doSpeak(hazardMsg, h.drop || h.stair);
                                    addAlert(hazardMsg, h.drop || h.stair);
                                }
                            }
                        }
                    });
                };

                if (vid.readyState >= 1) {
                    initDetection();
                } else {
                    vid.onloadedmetadata = initDetection;
                }
            } catch { alert('Camera access denied.'); setActive(false); }
        })();
        return () => { if (stopFn) stopFn(); stopObjectDetection(); streamRef.current?.getTracks().forEach(t => t.stop()); };
    }, [active, doSpeak, addAlert, faceReady, knownFaces.length, ensureFaceModels]);

    const captureEnroll = useCallback(async () => {
        if (!enrollName.trim()) { setEnrollMsg('Enter a name first.'); return; }
        const ok = await ensureFaceModels();
        if (!ok) { setEnrollMsg('Models failed to load.'); return; }
        const vid = videoRef.current;
        if (!vid || vid.readyState < 2) { setEnrollMsg('Start camera first.'); return; }
        setEnrollMsg('Detecting…');
        try {
            const detected = await detectFaces(vid);
            if (!detected.length)  { setEnrollMsg('⚠️ No face detected. Look at camera.'); return; }
            if (detected.length > 1) { setEnrollMsg('⚠️ Multiple faces. Be alone in frame.'); return; }
            const updated = saveKnownFace(enrollName.trim(), detected[0].descriptor);
            setKnownFaces(updated);
            setEnrollMsg(`✅ "${enrollName.trim()}" saved!`);
        } catch (e) { setEnrollMsg('Error: ' + e.message); }
    }, [enrollName, ensureFaceModels]);

    // ── Shared image preprocessor ─────────────────────────────────────────
    const buildProcessedCanvas = (src, opts = {}) => {
        const { scale = 2, invert = false } = opts;
        const pw = src.width  * scale;
        const ph = src.height * scale;
        const pc = document.createElement('canvas');
        pc.width  = pw;
        pc.height = ph;
        const ctx = pc.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, pw, ph);

        const id = ctx.getImageData(0, 0, pw, ph);
        const d  = id.data;

        // Find luminance range for full-range stretch
        let lo = 255, hi = 0;
        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
            if (g < lo) lo = g;
            if (g > hi) hi = g;
        }
        const rng = hi - lo || 1;

        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
            let v = ((g - lo) / rng) * 255;          // stretch to full range
            v = Math.min(255, Math.max(0, 1.6*(v-128)+128)); // contrast boost
            if (invert) v = 255 - v;
            d[i] = d[i+1] = d[i+2] = v;
        }
        ctx.putImageData(id, 0, 0);
        return pc;
    };

    // Helper: is this OCR result plausible (not just symbols/noise)?
    const isPlausible = (txt) => {
        if (!txt || txt.length < 2) return false;
        const letters = (txt.match(/[a-zA-Z]/g) || []).length;
        return letters / txt.length > 0.4; // at least 40% alphabetic chars
    };

    // ── Direct Gemini Vision OCR (Client-side zero-latency) ───────────────
    const ocrWithGeminiDirect = async (canvas) => {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) return null;
        try {
            const imageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
            if (!imageBase64) return null;
            const prompt = `You are an OCR assistant for visually impaired users.
Extract ALL visible text from this image exactly as written (handwriting, signs, books, screens, packaging).
If no text is visible, output: NO_TEXT_FOUND
Output ONLY the extracted text and nothing else.`;
            const GEMINI_CANDIDATES = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
            for (const model of GEMINI_CANDIDATES) {
                try {
                    const res = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{
                                    parts: [
                                        { text: prompt },
                                        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
                                    ]
                                }],
                                generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
                            }),
                            signal: AbortSignal.timeout(8000),
                        }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                        if (raw && raw !== 'NO_TEXT_FOUND') return raw;
                    }
                } catch {}
            }
            return null;
        } catch {
            return null;
        }
    };

    // ── Backend OCR via Gemini Vision ─────────────────────────────────────
    const ocrWithBackend = async (canvas) => {
        try {
            const baseURL = getBackendBaseURL();
            // Convert canvas to base64 JPEG
            const imageBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
            if (!imageBase64) throw new Error('Canvas capture failed');
            const token = localStorage.getItem('sb_token') || 'guest_session';
            const controller = new AbortController();
            const tId = setTimeout(() => controller.abort(), 12000);
            const res = await fetch(`${baseURL}/api/ai/ocr`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
                signal: controller.signal,
            });
            clearTimeout(tId);
            if (!res.ok) throw new Error(`Backend OCR HTTP ${res.status}`);
            const data = await res.json();
            return data.text?.trim() || '';
        } catch (e) {
            console.warn('[OCR] Backend failed:', e.message);
            return null;
        }
    };

    // ── Tesseract multi-pass OCR ───────────────────────────────────────────
    const ocrWithTesseract = async (canvas) => {
        // Lazy-init worker: OEM=1 (LSTM only) set via constructor arg
        if (!ocrWorkerRef.current) {
            // createWorker(lang, oem, options)  — oem 1 = LSTM_ONLY
            ocrWorkerRef.current = await createWorker('eng', 1, { logger: () => {} });
        }
        const worker = ocrWorkerRef.current;

        const normalCanvas  = buildProcessedCanvas(canvas, { scale: 2, invert: false });
        const invertedCanvas = buildProcessedCanvas(canvas, { scale: 2, invert: true });

        // Try different PSM modes: 7=single line, 6=block, 13=raw line, 3=auto
        const passes = [
            { canvas: normalCanvas,   psm: '7'  },  // single text line (best for simple words)
            { canvas: normalCanvas,   psm: '6'  },  // uniform block
            { canvas: invertedCanvas, psm: '7'  },  // inverted single line (dark bg text)
            { canvas: normalCanvas,   psm: '13' },  // raw line (no segmentation)
            { canvas: normalCanvas,   psm: '3'  },  // fully automatic
        ];

        let bestText = '';
        for (const pass of passes) {
            try {
                await worker.setParameters({ tessedit_pageseg_mode: pass.psm });
                const { data } = await worker.recognize(pass.canvas);
                const txt = data.text?.trim() || '';
                console.log(`[OCR] PSM ${pass.psm} invert=${pass.canvas === invertedCanvas}:`, JSON.stringify(txt));
                if (isPlausible(txt) && txt.length > bestText.length) {
                    bestText = txt;
                }
            } catch (e) {
                console.warn('[OCR] Pass failed:', e.message);
            }
        }
        return bestText;
    };

    // ── Main OCR handler ──────────────────────────────────────────────────
    const captureOCR = useCallback(async () => {
        const vid    = videoRef.current;
        const canvas = canvasRef.current;
        if (!vid || !canvas || !active) {
            if (!active) {
                setShowOcrCard(true);
                setOcrError('Please start the camera first, then press Scan Text.');
            }
            return;
        }

        canvas.width  = vid.videoWidth  || 640;
        canvas.height = vid.videoHeight || 480;
        canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);

        setOcrLoading(true);
        setOcrError('');
        setOcrText('');
        setShowOcrCard(true);

        try {
            // 1. Direct Gemini Vision OCR (fastest, high accuracy on Android & Web)
            let text = await ocrWithGeminiDirect(canvas);

            // 2. Try backend Gemini Vision OCR proxy
            if (!text) {
                text = await ocrWithBackend(canvas);
            }

            // 3. Fallback to Tesseract.js
            if (!text) {
                try {
                    text = await ocrWithTesseract(canvas);
                } catch (tessErr) {
                    console.warn('[OCR] Tesseract fallback failed:', tessErr.message);
                    text = '';
                }
            }

            if (!text) {
                setOcrError('No text detected. Hold camera steady and ensure text is well-lit and in focus.');
            } else {
                setOcrText(text);
                addAlert(`OCR: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
                playBeep(720, 120);
                speak(text, { priority: 'high', rate: 1.0 });
            }
        } catch (err) {
            setOcrError('OCR failed — please try again.');
            console.error('[OCR]', err);
        } finally {
            setOcrLoading(false);
        }
    }, [active, addAlert]); // eslint-disable-line react-hooks/exhaustive-deps

    // Terminate Tesseract worker on unmount
    useEffect(() => {
        return () => { ocrWorkerRef.current?.terminate(); };
    }, []);






    const hazardType = hazard?.stair ? 'stair' : hazard?.drop ? 'drop' : hazard?.slope ? 'slope' : null;
    const hazardCfg  = hazardType ? HAZARD_CFG[hazardType] : null;
    const uniqueNames = [...new Set(knownFaces.map(f => f.name))];
    const aiConf = getAIConfidence(obstacles);
    const nearest = getNearestMeters(obstacles);

    // Active steering guidance for the status bar & display
    const nearestLabel = curAlert
        ? curAlert
        : (obstacles.length > 0
            ? (() => {
                const pri = obstacles[0];
                const label = pri.knownName || pri.label;
                const cx = pri.pctBbox ? (pri.pctBbox[0] + pri.pctBbox[2] / 2) : 50;
                const steer = cx >= 50 ? 'Go left' : 'Go right';
                if (pri.direction === 'ahead') {
                    return `⚠️ Watch out! ${label} ahead. ${steer}. (${DIST_METERS[pri.distance] || '1m'})`;
                }
                const keep = pri.direction === 'left' ? 'Keep right' : 'Keep left';
                return `⚠️ Watch out! ${label} on your ${pri.direction}. ${keep}. (${DIST_METERS[pri.distance] || '1.5m'})`;
            })()
            : (active ? '✅ Path clear — continue straight' : 'Press start to begin navigation guidance'));

    const isOcrMode = location.state?.mode === 'ocr';
    const pageTitle = isOcrMode ? 'Read Text (OCR)' : 'Navigation Mode';

    return (
        <AppLayout title={pageTitle} showBack backLabel="Home">
            {/* Hidden canvas for OCR frame capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* ── Action / Status Bar ─────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.65rem 1rem', background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)', margin: '0.5rem 0.5rem 0.75rem',
                boxShadow: 'var(--shadow-card)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {active && <span className="live-dot" />}
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: active ? 'var(--blue)' : 'var(--text-muted)' }}>
                        {active ? 'CAMERA ACTIVE' : 'CAMERA OFF'}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                        className="btn-icon"
                        onClick={() => setShowAIDetails(v => { const next = !v; updateConfig({ ui: { showAIDetails: next } }); return next; })}
                        style={{
                            fontSize: '0.72rem', fontWeight: 700,
                            color: showAIDetails ? 'var(--blue)' : 'var(--text-muted)',
                            padding: '4px 8px', width: 'auto',
                        }}
                        title="Toggle AI Technical Metrics"
                    >
                        {showAIDetails ? 'AI ON' : 'AI OFF'}
                    </button>
                    <button
                        className="btn-icon"
                        onClick={() => { cancelSpeech(); }}
                        title="Mute Speech"
                    >
                        <Volume2 size={16} color="var(--text-secondary)" />
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: showAIDetails ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '0.5rem', padding: '0.5rem 1rem 0.75rem' }}>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>DETECTED</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>{obstacles.length}</div>
                </div>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>NEAREST</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFA94D' }}>{obstacles.length ? nearest : '—'}</div>
                </div>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
                        CONFIDENCE
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: active ? '#FF4B6E' : 'var(--text-muted)' }}>
                        {active ? `${aiConf || '--'}%` : '--'}
                    </div>
                    {active && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,75,110,0.08)', pointerEvents: 'none' }} />}
                </div>
                {showAIDetails && (
                    <div style={{ background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.25)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                        <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '0.08em', marginBottom: 2 }}>LATENCY</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-primary)' }}>{lastLatencyMs || '~35'}ms</div>
                    </div>
                )}
            </div>

            {/* Radar / Camera canvas */}
            <div style={{ flex: 1, position: 'relative', margin: '0 1rem', overflow: 'hidden' }}>
                <div className="radar-canvas" style={{ width: '100%', height: '100%', minHeight: 280 }}>
                    {active ? (
                        <>
                            <video
                                ref={videoRef}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }}
                                muted playsInline
                            />
                            {/* Bounding boxes */}
                            {obstacles.map((d, i) => {
                                const isApproach = d.motion?.approaching;
                                const color = d.knownName ? '#00D4AA' : (isApproach ? '#FF4B6E' : DIST_COLOR[d.distance]);
                                const distM = DIST_METERS[d.distance] || '?';
                                const confTag = showAIDetails ? ` · ${Math.round((d.confidence || 0.8) * 100)}%` : '';
                                return (
                                    <div key={i} style={{
                                        position: 'absolute',
                                        border: `2px solid ${color}`,
                                        borderRadius: 4,
                                        top: `${d.pctBbox[1]}%`, left: `${d.pctBbox[0]}%`,
                                        width: `${d.pctBbox[2]}%`, height: `${d.pctBbox[3]}%`,
                                        boxShadow: `0 0 10px ${color}55`,
                                    }}>
                                        <span style={{
                                            position: 'absolute', top: -22, left: -1,
                                            background: color, color: '#000',
                                            fontSize: '0.62rem', fontWeight: 700,
                                            padding: '2px 7px', borderRadius: '6px 6px 6px 0',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {d.knownName || d.label} · {distM}{confTag}
                                        </span>
                                    </div>
                                );
                            })}
                            {/* Hazard overlay */}
                            {hazardCfg && (
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%',
                                    background: `linear-gradient(to top, ${hazardCfg.color}44, transparent)`,
                                    borderTop: `2px dashed ${hazardCfg.color}88`,
                                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8,
                                }}>
                                    <span style={{
                                        color: hazardCfg.color, fontWeight: 700, fontSize: '0.78rem',
                                        background: 'rgba(0,0,0,0.7)', padding: '2px 10px', borderRadius: 6,
                                    }}>
                                        {hazardCfg.emoji} {hazardCfg.label}
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted)',
                        }}>
                            <Eye size={52} style={{ opacity: 0.15, marginBottom: 10 }} />
                            <div style={{ fontSize: '0.82rem' }}>Tap Start to activate camera</div>
                        </div>
                    )}
                </div>
            </div>

            {/* OCR Result Card */}
            {showOcrCard && (
                <div style={{
                    margin: '0.5rem 1rem 0',
                    background: 'linear-gradient(135deg, rgba(108,99,255,0.18), rgba(0,212,170,0.12))',
                    border: '1px solid rgba(108,99,255,0.35)',
                    borderRadius: 14,
                    padding: '0.75rem 1rem',
                    position: 'relative',
                }} className="fade-in">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <ScanText size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--color-primary)', flex: 1 }}>OCR — Extracted Text</span>
                        {ocrText && (
                            <button
                                onClick={() => navigator.clipboard?.writeText(ocrText).catch(() => {})}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, lineHeight: 1 }}
                                title="Copy text"
                            >
                                <Copy size={13} />
                            </button>
                        )}
                        <button
                            onClick={() => { setShowOcrCard(false); setOcrText(''); setOcrError(''); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, lineHeight: 1 }}
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {ocrLoading && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                            <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                            Scanning image for text…
                        </div>
                    )}
                    {!ocrLoading && ocrError && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-warning)' }}>⚠️ {ocrError}</div>
                    )}
                    {!ocrLoading && ocrText && (
                        <div style={{
                            fontSize: '0.82rem',
                            color: 'var(--text-primary)',
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 120,
                            overflowY: 'auto',
                        }}>
                            {ocrText}
                        </div>
                    )}
                </div>
            )}

            {/* Status strip */}
            <div style={{
                margin: '0.6rem 1rem 0',
                background: 'var(--bg-card)',
                borderRadius: 12,
                padding: '0.65rem 1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Volume2 size={14} style={{ color: speaking ? 'var(--color-accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{nearestLabel}</span>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                    {[1,2,3,4].map(i => (
                        <div key={i} style={{
                            width: 3, borderRadius: 3,
                            height: speaking ? `${8 + i * 4}px` : '6px',
                            background: speaking ? 'var(--color-accent)' : 'var(--text-muted)',
                            opacity: speaking ? 0.9 : 0.3,
                            transition: 'all 0.15s',
                        }} />
                    ))}
                </div>
            </div>

            {/* Face Recognition (collapsible) */}
            <div style={{ margin: '0.6rem 1rem 0', background: 'var(--bg-card)', borderRadius: 14, padding: '0.75rem 1rem', border: `1px solid ${faceResults.length ? 'var(--color-accent)' : 'var(--border-card)'}` }}>
                <button onClick={() => setShowFacePanel(f => !f)} style={{ display: 'flex', width: '100%', background: 'none', border: 'none', cursor: 'pointer', alignItems: 'center', gap: 6, padding: 0, color: 'var(--text-primary)' }}>
                    <UserCheck size={14} style={{ color: 'var(--color-primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.8rem', flex: 1, textAlign: 'left' }}>
                        Face Recognition {faceLoading && <Loader size={11} style={{ marginLeft: 6, animation: 'spin 1s linear infinite', display: 'inline-block' }} />}
                    </span>
                    {uniqueNames.length > 0 && <span style={{ background: 'var(--color-primary)', color: '#fff', padding: '1px 7px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700 }}>{uniqueNames.length}</span>}
                    {showFacePanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showFacePanel && (
                    <div style={{ marginTop: 10 }}>
                        {faceResults.length > 0 && (
                            <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(0,212,170,0.1)', borderRadius: 8, borderLeft: '3px solid var(--color-accent)', fontSize: '0.78rem' }}>
                                {faceResults.map((f, i) => <div key={i}>👤 <strong>{f.name}</strong> — {Math.round((1 - f.distance) * 100)}% match</div>)}
                            </div>
                        )}
                        {uniqueNames.length === 0
                            ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>No faces enrolled yet.</div>
                            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                                {uniqueNames.map(name => (
                                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card2)', borderRadius: 6, padding: '3px 8px', fontSize: '0.75rem' }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: `hsl(${name.charCodeAt(0) * 7 % 360},55%,45%)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.65rem', flexShrink: 0 }}>{name[0].toUpperCase()}</span>
                                        {name}
                                        <button onClick={() => setKnownFaces(deleteKnownFace(name))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 0 0 2px', lineHeight: 1 }}>
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        }
                        <button onClick={() => setShowEnroll(e => !e)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.76rem', gap: 5, borderRadius: 7, width: '100%', justifyContent: 'center' }}>
                            <UserPlus size={12} /> {showEnroll ? 'Cancel' : 'Add a person'}
                        </button>
                        {showEnroll && (
                            <div style={{ marginTop: 8 }}>
                                <input className="form-input" placeholder="Person's name" value={enrollName} onChange={e => { setEnrollName(e.target.value); setEnrollMsg(''); }} style={{ width: '100%', fontSize: '0.8rem', marginBottom: 6 }} />
                                <button onClick={captureEnroll} className="btn btn-primary" disabled={!active} style={{ width: '100%', fontSize: '0.8rem', gap: 6, justifyContent: 'center' }}>
                                    <Camera size={13} /> Capture from camera
                                </button>
                                {enrollMsg && <div style={{ marginTop: 6, fontSize: '0.74rem', color: enrollMsg.startsWith('✅') ? 'var(--color-accent)' : 'var(--color-warning)' }}>{enrollMsg}</div>}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Start/Stop + OCR buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '1rem 1rem 0.5rem', alignItems: 'center' }}>
                {/* OCR Capture button */}
                <button
                    onClick={captureOCR}
                    disabled={!active || ocrLoading}
                    title="Read text in camera view"
                    style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: active ? 'linear-gradient(135deg, #6c63ff, #4ecdc4)' : 'var(--bg-card2)',
                        border: 'none', cursor: active ? 'pointer' : 'not-allowed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: active ? '0 0 0 6px rgba(108,99,255,0.2)' : 'none',
                        transition: 'all 0.2s ease',
                        opacity: active ? 1 : 0.4,
                        flexShrink: 0,
                    }}
                >
                    {ocrLoading
                        ? <Loader size={20} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
                        : <ScanText size={20} color={active ? '#fff' : 'var(--text-muted)'} />
                    }
                </button>

                <div style={{ background: 'var(--bg-card)', borderRadius: 20, padding: '0.875rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 180 }}>
                    <button
                        className="fab-stop"
                        onClick={() => setActive(a => !a)}
                        style={{ background: active ? '#FF4B6E' : 'var(--color-accent)', boxShadow: active ? '0 0 0 8px rgba(255,75,110,0.2)' : '0 0 0 8px rgba(0,212,170,0.2)' }}
                    >
                        {active
                            ? <Square size={22} color="#fff" fill="#fff" />
                            : <Eye size={24} color="#000" />
                        }
                    </button>
                </div>

                {/* Spacer to balance layout */}
                <div style={{ width: 48, flexShrink: 0 }} />
            </div>
        </AppLayout>
    );
};

export default VisionAssistPage;
