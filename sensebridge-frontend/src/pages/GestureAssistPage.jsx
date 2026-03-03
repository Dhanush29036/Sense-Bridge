import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { classifyGestureAdvanced, formatGestureSentence, speak, cancelSpeech } from '../services/aiService';
import { logService } from '../services/api';
import { Hand, Play, Square, Zap, Volume2, Trash2, Delete, MessageSquare, RefreshCw, Loader } from 'lucide-react';

// ── Gesture → word mapping ─────────────────────────────────────────────────
const GESTURE_WORD = {
    thumbs_up: 'Yes',
    thumbs_down: 'No',
    peace: 'Peace',
    open_palm: 'Hello',
    pointing: 'There',
    fist: 'Stop',
    ok: 'Okay',
    love: 'Love',
    call_me: 'Call me',
    rock: 'Rock',
};

const GESTURE_EMOJI = {
    thumbs_up: '👍', thumbs_down: '👎', peace: '✌️',
    open_palm: '🖐️', pointing: '☝️', fist: '✊',
    ok: '👌', love: '🤟', call_me: '🤙', rock: '🤘',
};

// Skeleton connections for MediaPipe Hands (21 landmarks)
const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
];

function drawSkeleton(ctx, lm, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,212,170,0.85)';
    ctx.lineWidth = 2.5;
    CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
    });
    lm.forEach(({ x, y }, i) => {
        ctx.beginPath();
        ctx.arc(x * w, y * h, i === 0 ? 7 : 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? '#fff' : '#FFA94D';
        ctx.shadowColor = '#FFA94D';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
    });
}

// ── Component ──────────────────────────────────────────────────────────────
const GestureAssistPage = () => {
    const [active, setActive] = useState(false);
    const [lastGesture, setLastGesture] = useState(null);
    const [history, setHistory] = useState([]);
    const [sentence, setSentence] = useState([]);
    const [formattedSentence, setFormattedSentence] = useState('');
    const [forming, setForming] = useState(false);
    const [status, setStatus] = useState('');
    const [gestureConfidence, setGestureConfidence] = useState(null);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const handsRef = useRef(null);
    const cameraRef = useRef(null);
    const streamRef = useRef(null);
    const lastAddRef = useRef(0);
    const heldGesture = useRef({ gesture: null, start: 0, count: 0 });
    const activeRef = useRef(false);

    // Get auth token for API calls
    const getToken = () => localStorage.getItem('token') || sessionStorage.getItem('token') || '';

    // ── Sentence formation ──────────────────────────────────────────────────
    const formSentence = async (words = sentence) => {
        if (!words.length) return;
        setForming(true);
        try {
            const result = await formatGestureSentence(words, getToken());
            setFormattedSentence(result);
        } catch {
            setFormattedSentence(words.join(' ') + '.');
        } finally {
            setForming(false);
        }
    };

    const speakSentence = () => {
        const text = formattedSentence || sentence.join(' ');
        if (!text) return;
        cancelSpeech();
        speak(text, { priority: 'high', rate: 1.0 });
    };

    // ── MediaPipe loader ────────────────────────────────────────────────────
    const loadScripts = () => new Promise((resolve, reject) => {
        if (window.Hands) { resolve(); return; }
        const load = src => new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.crossOrigin = 'anonymous';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        load('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js')
            .then(() => load('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js'))
            .then(resolve).catch(reject);
    });

    // ── Start detection ─────────────────────────────────────────────────────
    const startDetection = useCallback(async () => {
        activeRef.current = true;
        try {
            setStatus('Loading MediaPipe model…');
            await loadScripts();

            setStatus('Starting camera…');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            streamRef.current = stream;
            const vid = videoRef.current;
            vid.srcObject = stream;
            await vid.play();

            const hands = new window.Hands({
                locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
            });
            hands.setOptions({
                maxNumHands: 1, modelComplexity: 1,
                minDetectionConfidence: 0.75, minTrackingConfidence: 0.6,
            });

            hands.onResults(results => {
                if (!activeRef.current) return;
                const c = canvasRef.current;
                if (!c) return;
                const ctx = c.getContext('2d');
                ctx.clearRect(0, 0, c.width, c.height);

                if (results.multiHandLandmarks?.length) {
                    const lm = results.multiHandLandmarks[0];
                    drawSkeleton(ctx, lm, c.width, c.height);

                    // ── Improved angle-vector classifier ─────────────────
                    const gesture = classifyGestureAdvanced(lm);

                    if (gesture !== 'unknown') {
                        setLastGesture(gesture);

                        // Hold-based accumulation: gesture must be held consistently 
                        // for 1.5s before adding to sentence (reduces false triggers)
                        const now = Date.now();
                        const held = heldGesture.current;
                        if (held.gesture === gesture) {
                            held.count++;
                            const heldMs = now - held.start;
                            setGestureConfidence(Math.min(1, heldMs / 1500));

                            if (heldMs >= 1500 && now - lastAddRef.current > 2000) {
                                lastAddRef.current = now;
                                const word = GESTURE_WORD[gesture] || gesture;
                                setSentence(prev => [...prev, word]);
                                setFormattedSentence(''); // clear previous formatted sentence
                                setHistory(prev => [
                                    { id: now, gesture, time: new Date().toLocaleTimeString() },
                                    ...prev
                                ].slice(0, 30));
                                // Speak the word immediately as feedback
                                speak(word, { priority: 'high', rate: 1.1 });
                                logService.create({
                                    eventType: 'gesture',
                                    message: `Gesture: ${gesture} → "${word}"`,
                                    confidence: 0.9,
                                    metadata: { model: 'mediapipe-hands+angle-vector', gesture, word },
                                }).catch(() => { });
                                held.gesture = null; held.count = 0; held.start = 0;
                            }
                        } else {
                            heldGesture.current = { gesture, start: now, count: 1 };
                            setGestureConfidence(0);
                        }
                    } else {
                        setLastGesture(null);
                        setGestureConfidence(null);
                        heldGesture.current = { gesture: null, start: 0, count: 0 };
                    }
                } else {
                    setLastGesture(null);
                    setGestureConfidence(null);
                    heldGesture.current = { gesture: null, start: 0, count: 0 };
                }
            });

            handsRef.current = hands;
            const camera = new window.Camera(vid, {
                onFrame: async () => { if (activeRef.current) await hands.send({ image: vid }); },
                width: 640, height: 480,
            });
            cameraRef.current = camera;
            camera.start();
            setStatus('');
        } catch (err) {
            console.error('[Gesture]', err);
            setStatus(`❌ ${err.message}`);
            setActive(false);
        }
    }, []);

    const stopDetection = useCallback(() => {
        activeRef.current = false;
        cameraRef.current?.stop();
        handsRef.current?.close();
        streamRef.current?.getTracks().forEach(t => t.stop());
        cameraRef.current = null; handsRef.current = null; streamRef.current = null;
        setLastGesture(null); setGestureConfidence(null);
        setStatus('');
        const c = canvasRef.current;
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }, []);

    useEffect(() => {
        if (active) startDetection(); else stopDetection();
        return stopDetection;
    }, [active, startDetection, stopDetection]);

    // Auto-form sentence when >= 3 words are accumulated
    useEffect(() => {
        if (sentence.length >= 3 && !formattedSentence) {
            formSentence(sentence);
        }
    }, [sentence]);

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Hand size={24} style={{ color: 'var(--color-warning)' }} /> Gesture Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            MediaPipe Hands + angle-vector classifier · hold 1.5s to add word
                        </p>
                    </div>
                    <button onClick={() => setActive(a => !a)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                {status && (
                    <div className="card" style={{ padding: '0.6rem 1rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                        {status}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
                    {/* Camera feed */}
                    <div className="card" style={{ aspectRatio: '4/3', position: 'relative', background: '#0a0a1a', overflow: 'hidden', padding: 0 }}>
                        <video ref={videoRef}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: active ? 'block' : 'none' }}
                            muted playsInline />
                        <canvas ref={canvasRef} width={640} height={480}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }} />
                        {!active && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                <Hand size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
                                <div style={{ fontSize: '0.875rem' }}>Press Start to activate</div>
                            </div>
                        )}
                        {active && <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,75,110,0.9)', color: '#fff', padding: '2px 10px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700 }}>● LIVE</span>}
                        {active && lastGesture && (
                            <div style={{ position: 'absolute', bottom: 12, inlineSize: '100%', textAlign: 'center', pointerEvents: 'none' }}>
                                <span style={{ background: 'rgba(0,0,0,0.7)', color: '#FFA94D', padding: '4px 14px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', border: '1px solid rgba(255,169,77,0.5)' }}>
                                    {GESTURE_EMOJI[lastGesture]} {GESTURE_WORD[lastGesture]}
                                    {gestureConfidence !== null && (
                                        <span style={{ marginLeft: 8, fontSize: '0.75rem', opacity: 0.8 }}>
                                            {Math.round(gestureConfidence * 100)}%
                                        </span>
                                    )}
                                </span>
                            </div>
                        )}
                        {/* Hold progress bar */}
                        {active && gestureConfidence !== null && gestureConfidence > 0 && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, width: `${gestureConfidence * 100}%`, height: 3, background: 'var(--color-warning)', transition: 'width 0.1s linear', borderRadius: '0 2px 2px 0' }} />
                        )}
                    </div>

                    {/* Right panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div className="card" style={{ textAlign: 'center', minHeight: 110 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Zap size={14} style={{ color: 'var(--color-warning)' }} /> Detected Gesture
                            </div>
                            {lastGesture ? (
                                <>
                                    <div style={{ fontSize: '2.5rem', lineHeight: 1 }}>{GESTURE_EMOJI[lastGesture]}</div>
                                    <div style={{ fontWeight: 700, color: 'var(--color-warning)', textTransform: 'capitalize', marginTop: 4 }}>
                                        {lastGesture.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>→ "{GESTURE_WORD[lastGesture]}"</div>
                                    {/* Hold progress */}
                                    {gestureConfidence !== null && (
                                        <div style={{ marginTop: 8, height: 4, background: 'var(--border-color)', borderRadius: 4, overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${gestureConfidence * 100}%`, background: 'var(--color-warning)', transition: 'width 0.1s linear', borderRadius: 4 }} />
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 12 }}>Show your hand to the camera</div>
                            )}
                        </div>

                        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: 6, color: 'var(--text-muted)' }}>GESTURE → WORD</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {Object.entries(GESTURE_WORD).map(([g, w]) => (
                                    <div key={g} style={{
                                        display: 'flex', justifyContent: 'space-between', padding: '3px 8px',
                                        borderRadius: 5, fontSize: '0.76rem',
                                        background: lastGesture === g ? 'rgba(255,169,77,0.12)' : 'transparent',
                                        border: `1px solid ${lastGesture === g ? 'rgba(255,169,77,0.5)' : 'transparent'}`,
                                        transition: 'all 0.15s',
                                    }}>
                                        <span>{GESTURE_EMOJI[g]} {g.replace(/_/g, ' ')}</span>
                                        <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{w}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Sentence Builder ─────────────────────────────────────── */}
                <div className="card" style={{ borderColor: sentence.length ? 'var(--color-primary)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <MessageSquare size={16} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Sentence Builder</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.73rem', marginLeft: 'auto' }}>Hold gesture 1.5s to add word · Auto-forms sentence at 3+ words</span>
                    </div>

                    {/* Raw words */}
                    <div style={{ minHeight: 40, padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8, marginBottom: 8, fontSize: '1rem', color: sentence.length ? 'var(--text-primary)' : 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                        {sentence.length ? sentence.map((w, i) => (
                            <span key={i} style={{
                                display: 'inline-block', margin: '2px 3px', padding: '1px 8px', borderRadius: 5,
                                background: i === sentence.length - 1 ? 'rgba(108,99,255,0.18)' : 'transparent',
                                border: `1px solid ${i === sentence.length - 1 ? 'var(--color-primary)' : 'transparent'}`,
                            }}>{w}</span>
                        )) : <span>Gesture to build a sentence…</span>}
                    </div>

                    {/* Formatted sentence (Gemini) */}
                    {(formattedSentence || forming) && (
                        <div style={{
                            padding: '10px 14px', background: 'rgba(108,99,255,0.06)',
                            border: '1px solid rgba(108,99,255,0.25)', borderRadius: 10, marginBottom: 12,
                            fontSize: '1.05rem', fontWeight: 500, fontStyle: 'italic',
                            display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                            {forming
                                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--color-primary)', flexShrink: 0 }} /><span style={{ color: 'var(--text-muted)' }}>Forming sentence…</span></>
                                : <><span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontStyle: 'normal', fontWeight: 700, flexShrink: 0 }}>AI:</span><span>{formattedSentence}</span></>
                            }
                        </div>
                    )}

                    {/* Controls */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={speakSentence} disabled={!sentence.length} style={{ gap: 6 }}>
                            <Volume2 size={14} /> Speak
                        </button>
                        <button className="btn btn-ghost" onClick={() => formSentence()} disabled={!sentence.length || forming} style={{ gap: 6 }}>
                            <RefreshCw size={14} style={{ animation: forming ? 'spin 1s linear infinite' : 'none' }} />
                            {forming ? 'Forming…' : 'Form Sentence'}
                        </button>
                        <button className="btn btn-ghost" onClick={() => { setSentence(p => p.slice(0, -1)); setFormattedSentence(''); }} disabled={!sentence.length} style={{ gap: 6 }}>
                            <Delete size={14} /> Backspace
                        </button>
                        <button className="btn btn-ghost" onClick={() => { setSentence([]); setFormattedSentence(''); }} disabled={!sentence.length} style={{ gap: 6, color: 'var(--color-danger)' }}>
                            <Trash2 size={14} /> Clear
                        </button>
                    </div>
                </div>

                {/* History */}
                {history.length > 0 && (
                    <div className="card">
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 10 }}>Gesture Log</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {history.map(h => (
                                <span key={h.id} style={{ padding: '2px 10px', borderRadius: 6, background: 'rgba(255,169,77,0.08)', border: '1px solid rgba(255,169,77,0.25)', fontSize: '0.75rem', color: 'var(--color-warning)' }}>
                                    {GESTURE_EMOJI[h.gesture]} {GESTURE_WORD[h.gesture]} · {h.time}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
};

export default GestureAssistPage;
