import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { logService } from '../services/api';
import { Hand, Play, Square, Zap, Volume2, Trash2, Delete, MessageSquare } from 'lucide-react';

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

// ── Landmark classifier ────────────────────────────────────────────────────
function fingerIsUp(lm, tipIdx, pipIdx) {
    return lm[tipIdx].y < lm[pipIdx].y;
}

function classifyGesture(lm) {
    const thumbUp = lm[4].y < lm[3].y && lm[3].y < lm[2].y;
    const thumbDown = lm[4].y > lm[3].y && lm[3].y > lm[2].y;
    const indexUp = fingerIsUp(lm, 8, 6);
    const middleUp = fingerIsUp(lm, 12, 10);
    const ringUp = fingerIsUp(lm, 16, 14);
    const pinkyUp = fingerIsUp(lm, 20, 18);

    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'thumbs_up';
    if (thumbDown && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'thumbs_down';
    if (!thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'fist';
    if (indexUp && middleUp && ringUp && pinkyUp) return 'open_palm';
    if (indexUp && middleUp && !ringUp && !pinkyUp) return 'peace';
    if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'pointing';
    if (thumbUp && !indexUp && !middleUp && !ringUp && pinkyUp) return 'call_me';
    if (!thumbUp && indexUp && !middleUp && !ringUp && pinkyUp) return 'rock';
    if (thumbUp && indexUp && !middleUp && !ringUp && pinkyUp) return 'love';
    const dx = lm[4].x - lm[8].x, dy = lm[4].y - lm[8].y;
    if (Math.sqrt(dx * dx + dy * dy) < 0.07 && middleUp && ringUp && pinkyUp) return 'ok';
    return 'unknown';
}

// ── Canvas skeleton draw ───────────────────────────────────────────────────
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
    ctx.strokeStyle = 'rgba(0,212,170,0.8)';
    ctx.lineWidth = 2.5;
    CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
    });
    lm.forEach(({ x, y }) => {
        ctx.beginPath();
        ctx.arc(x * w, y * h, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFA94D';
        ctx.fill();
    });
}

// ── Component ──────────────────────────────────────────────────────────────
const GestureAssistPage = () => {
    const [active, setActive] = useState(false);
    const [lastGesture, setLastGesture] = useState(null);
    const [history, setHistory] = useState([]);
    const [sentence, setSentence] = useState([]);
    const [status, setStatus] = useState('');

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const handsRef = useRef(null);
    const cameraRef = useRef(null);
    const streamRef = useRef(null);
    const lastAddRef = useRef(0);

    const speakSentence = () => {
        if (!sentence.length) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(sentence.join(' '));
        window.speechSynthesis.speak(utt);
    };

    // ── Load MediaPipe scripts from CDN ────────────────────────────────────
    const loadScripts = () => new Promise((resolve, reject) => {
        if (window.Hands) { resolve(); return; }
        const load = (src) => new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.crossOrigin = 'anonymous';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        load('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js')
            .then(() => load('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js'))
            .then(resolve).catch(reject);
    });

    // ── Start ──────────────────────────────────────────────────────────────
    const startDetection = useCallback(async () => {
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
                locateFile: f =>
                    `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
            });
            hands.setOptions({
                maxNumHands: 1, modelComplexity: 1,
                minDetectionConfidence: 0.7, minTrackingConfidence: 0.5,
            });

            hands.onResults(results => {
                const c = canvasRef.current;
                if (!c) return;
                const ctx = c.getContext('2d');
                ctx.clearRect(0, 0, c.width, c.height);

                if (results.multiHandLandmarks?.length) {
                    const lm = results.multiHandLandmarks[0];
                    drawSkeleton(ctx, lm, c.width, c.height);

                    const gesture = classifyGesture(lm);
                    if (gesture !== 'unknown') {
                        setLastGesture({ gesture });
                        const now = Date.now();
                        if (now - lastAddRef.current > 2000) {
                            lastAddRef.current = now;
                            const word = GESTURE_WORD[gesture] || gesture;
                            setSentence(prev => [...prev, word]);
                            setHistory(prev => [
                                { id: now, gesture, time: new Date().toLocaleTimeString() },
                                ...prev
                            ].slice(0, 25));
                            logService.create({
                                eventType: 'gesture',
                                message: `Gesture: ${gesture} → "${word}"`,
                                confidence: 0.85,
                                metadata: { model: 'mediapipe-hands', gesture, word },
                            }).catch(() => { });
                        }
                    } else {
                        setLastGesture(null);
                    }
                } else {
                    setLastGesture(null);
                }
            });

            handsRef.current = hands;

            const camera = new window.Camera(vid, {
                onFrame: async () => { await hands.send({ image: vid }); },
                width: 640, height: 480,
            });
            cameraRef.current = camera;
            camera.start();
            setStatus('');
        } catch (err) {
            console.error('[Gesture]', err);
            setStatus(`❌ ${err.message}. Check console / internet.`);
            setActive(false);
        }
    }, []);

    const stopDetection = useCallback(() => {
        cameraRef.current?.stop();
        handsRef.current?.close();
        streamRef.current?.getTracks().forEach(t => t.stop());
        cameraRef.current = null; handsRef.current = null; streamRef.current = null;
        setLastGesture(null);
        setStatus('');
        const c = canvasRef.current;
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }, []);

    useEffect(() => {
        if (active) startDetection();
        else stopDetection();
        return stopDetection;
    }, [active, startDetection, stopDetection]);

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
                            MediaPipe hand tracking · gestures build sentences
                        </p>
                    </div>
                    <button onClick={() => setActive(a => !a)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                {status && (
                    <div className="card" style={{ padding: '0.6rem 1rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', display: 'inline-block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                        {status}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
                    {/* Camera + canvas overlay */}
                    <div className="card" style={{ aspectRatio: '4/3', position: 'relative', background: '#0a0a1a', overflow: 'hidden', padding: 0, minHeight: 240 }}>
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
                            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center' }}>
                                <span style={{ background: 'rgba(255,169,77,0.92)', color: '#000', padding: '4px 14px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem' }}>
                                    {GESTURE_EMOJI[lastGesture.gesture]} {GESTURE_WORD[lastGesture.gesture]}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Right panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div className="card" style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Zap size={14} style={{ color: 'var(--color-warning)' }} /> Detected
                            </div>
                            {lastGesture ? (
                                <>
                                    <div style={{ fontSize: '2.5rem' }}>{GESTURE_EMOJI[lastGesture.gesture]}</div>
                                    <div style={{ fontWeight: 700, color: 'var(--color-warning)', textTransform: 'capitalize', marginTop: 4 }}>
                                        {lastGesture.gesture.replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                        → <strong>"{GESTURE_WORD[lastGesture.gesture]}"</strong>
                                    </div>
                                </>
                            ) : (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Show hand to camera</div>
                            )}
                        </div>

                        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 8 }}>Gesture → Word</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {Object.entries(GESTURE_WORD).map(([g, w]) => (
                                    <div key={g} style={{
                                        display: 'flex', justifyContent: 'space-between',
                                        padding: '3px 8px', borderRadius: 5, fontSize: '0.76rem',
                                        background: lastGesture?.gesture === g ? 'rgba(255,169,77,0.12)' : 'transparent',
                                        border: `1px solid ${lastGesture?.gesture === g ? 'rgba(255,169,77,0.4)' : 'transparent'}`,
                                    }}>
                                        <span>{GESTURE_EMOJI[g]} {g.replace(/_/g, ' ')}</span>
                                        <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{w}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Sentence Builder ─────────────────────────────────────*/}
                <div className="card" style={{ borderColor: sentence.length ? 'var(--color-primary)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <MessageSquare size={16} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Sentence Builder</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.73rem', marginLeft: 'auto' }}>
                            Hold gesture 2 s to add word
                        </span>
                    </div>
                    <div style={{
                        minHeight: 52, padding: '10px 14px', borderRadius: 10,
                        background: 'var(--bg-base)', marginBottom: 12,
                        fontSize: '1.1rem', fontWeight: 500, border: '1px solid var(--border-color)',
                        color: sentence.length ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>
                        {sentence.length ? sentence.map((w, i) => (
                            <span key={i} style={{
                                display: 'inline-block', margin: '2px 3px', padding: '1px 8px', borderRadius: 5,
                                background: i === sentence.length - 1 ? 'rgba(108,99,255,0.18)' : 'transparent',
                                border: `1px solid ${i === sentence.length - 1 ? 'var(--color-primary)' : 'transparent'}`,
                            }}>{w}</span>
                        )) : 'Gesture to build a sentence…'}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary" onClick={speakSentence} disabled={!sentence.length} style={{ gap: 6 }}>
                            <Volume2 size={14} /> Speak
                        </button>
                        <button className="btn btn-ghost" onClick={() => setSentence(p => p.slice(0, -1))} disabled={!sentence.length} style={{ gap: 6 }}>
                            <Delete size={14} /> Backspace
                        </button>
                        <button className="btn btn-ghost" onClick={() => setSentence([])} disabled={!sentence.length} style={{ gap: 6, color: 'var(--color-danger)' }}>
                            <Trash2 size={14} /> Clear
                        </button>
                    </div>
                </div>

                {/* Gesture log */}
                <div className="card">
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 10 }}>Gesture Log</div>
                    {history.length === 0
                        ? <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No gestures yet</div>
                        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {history.map(h => (
                                <span key={h.id} style={{ padding: '2px 10px', borderRadius: 6, background: 'rgba(255,169,77,0.08)', border: '1px solid rgba(255,169,77,0.25)', fontSize: '0.75rem', color: 'var(--color-warning)' }}>
                                    {GESTURE_EMOJI[h.gesture]} {GESTURE_WORD[h.gesture]} · {h.time}
                                </span>
                            ))}
                        </div>
                    }
                </div>
            </div>
        </AppLayout>
    );
};

export default GestureAssistPage;
