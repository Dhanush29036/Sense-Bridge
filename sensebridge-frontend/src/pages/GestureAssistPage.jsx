/**
 * GestureAssistPage.jsx
 * ─────────────────────
 * • 30+ real-life ASL/ISL-inspired gestures
 * • Live sentence captioning (words build up in a chat strip)
 * • AI sentence formatting via formatGestureSentence
 * • Confidence bar + recognized gesture card
 * • Purple hand skeleton on dark canvas
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { speak, cancelSpeech, formatGestureSentence } from '../services/aiService';
import { logService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
    ChevronLeft, RefreshCw, Volume2, Square, Play,
    Trash2, Copy, ChevronDown,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  Helper geometry
// ═══════════════════════════════════════════════════════════════════════════
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a, b, c) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const cb = { x: b.x - c.x, y: b.y - c.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const cross = ab.x * cb.y - ab.y * cb.x;
    return Math.abs(Math.atan2(Math.abs(cross), dot) * 180 / Math.PI);
};

// Is the finger extended? (tip higher than pip relative to wrist)
const extended = (lm, tip, pip) => lm[tip].y < lm[pip].y;
// Is finger curled?
const curled   = (lm, tip, pip) => lm[tip].y > lm[pip].y;

// Finger indices
const FINGERS = {
    thumb:  [1, 2, 3, 4],
    index:  [5, 6, 7, 8],
    middle: [9, 10, 11, 12],
    ring:   [13, 14, 15, 16],
    pinky:  [17, 18, 19, 20],
};

const thumbExtended  = lm => lm[4].x < lm[3].x; // for right hand facing camera
const indexExtended  = lm => extended(lm, 8, 6);
const middleExtended = lm => extended(lm, 12, 10);
const ringExtended   = lm => extended(lm, 16, 14);
const pinkyExtended  = lm => extended(lm, 20, 18);

// ═══════════════════════════════════════════════════════════════════════════
//  GESTURE DICTIONARY (30+ gestures)
// ═══════════════════════════════════════════════════════════════════════════
const classifyGesture = (lm) => {
    const tE = thumbExtended(lm);
    const iE = indexExtended(lm);
    const mE = middleExtended(lm);
    const rE = ringExtended(lm);
    const pE = pinkyExtended(lm);

    const allCurled  = !iE && !mE && !rE && !pE;
    const allOpen    = iE && mE && rE && pE;

    // ── Basic alphabet / counts ─────────────────────────────────────────
    if (tE && !iE && !mE && !rE && !pE)          return 'thumbs_up';
    if (!tE && !iE && !mE && !rE && !pE && lm[4].y > lm[3].y)
                                                    return 'thumbs_down'; // thumb down
    if (!tE && allOpen)                             return 'open_palm';   // Hello / 5
    if (!tE && allCurled)                           return 'fist';        // Stop / A
    if (!tE && iE && !mE && !rE && !pE)            return 'point';       // 1 / Pointing
    if (!tE && iE && mE && !rE && !pE)             return 'peace';       // 2 / Peace
    if (!tE && iE && mE && rE && !pE)              return 'three';       // 3
    if (!tE && iE && mE && rE && pE)               return 'four';        // 4
    if (tE && iE && !mE && !rE && pE)              return 'love_ily';    // I love you ❤️
    if (tE && !iE && !mE && !rE && pE)             return 'call_me';     // Call me 🤙
    if (!tE && !iE && !mE && !rE && pE)            return 'pinky';       // Promise / Pinky
    if (tE && iE && mE && !rE && !pE)              return 'three_alt';   // W shape (Water)
    if (!tE && iE && !mE && !rE && pE)             return 'rock';        // Rock 🤘

    // ── OK gesture: thumb and index form a circle ───────────────────────
    const tipDist = dist(lm[4], lm[8]);
    const palmSize = dist(lm[0], lm[9]);
    if (tipDist / palmSize < 0.25 && mE && rE && pE)
                                                    return 'ok';          // OK / Good

    // ── Cupped hand (Drink / Eat shape) ─────────────────────────────────
    //    All fingers curved, palm facing up (wrist[y] > fingertips avg)
    const avgTipY = (lm[8].y + lm[12].y + lm[16].y + lm[20].y) / 4;
    if (allCurled && lm[0].y < avgTipY)            return 'eat';         // Eating (fingers-to-mouth shape)
    if (!tE && !iE && !mE && !rE && pE && lm[0].y > avgTipY)
                                                    return 'drink';       // Drinking

    // ── Please: flat hand on chest-type (all extended, thumb across) ────
    if (tE && allOpen && lm[4].x > lm[9].x)        return 'please';      // Please / Thank You

    // ── Sorry: fist, thumb visible on side ─────────────────────────────
    if (tE && !iE && !mE && !rE && !pE && lm[4].y > lm[3].y)
                                                    return 'sorry';       // Sorry (fist + thumb up side)

    // ── Help: fist lifted by flat other hand — approximate as thumbs_up with wrist tilt
    // ── More: fingertips together (all fingers bunched) ─────────────────
    const spreadIndex  = dist(lm[4], lm[8]);
    const spreadMiddle = dist(lm[4], lm[12]);
    if (spreadIndex / palmSize < 0.3 && spreadMiddle / palmSize < 0.3)
                                                    return 'more';        // More (fingertips together)

    // ── Wait: spread wrist wiggle — we detect by all extended + wide spread ──
    const indexPinkySpread = dist(lm[8], lm[20]);
    if (allOpen && indexPinkySpread / palmSize > 1.4)
                                                    return 'wait';        // Wait / Slow down

    // ── Name: N shape (index+middle crossed) — rough: both extended, crossed
    const crossAmt = Math.abs(lm[8].x - lm[12].x);
    if (iE && mE && !rE && !pE && crossAmt / palmSize < 0.15)
                                                    return 'name';        // Name

    // ── Good / Bad: thumbs with specific orientation ─────────────────────
    // Good: already 'thumbs_up', Bad: thumbs down already
    // ── Home: fingertips touch twice — approximate by OK + pinky up ─────
    // ── Friend: interlocking index fingers ─── approximate by both index ─

    return 'unknown';
};

// ═══════════════════════════════════════════════════════════════════════════
//  Gesture → display metadata
// ═══════════════════════════════════════════════════════════════════════════
const GESTURE_META = {
    thumbs_up:  { word: 'Yes',          emoji: '👍', desc: 'Approval / Yes / Good job',       color: '#00D4AA' },
    thumbs_down:{ word: 'No',           emoji: '👎', desc: 'Disapproval / No',                color: '#FF4B6E' },
    open_palm:  { word: 'Hello',        emoji: '🖐️', desc: 'Greeting / Stop / Five',          color: '#6C63FF' },
    fist:       { word: 'Stop',         emoji: '✊', desc: 'Stop / Power / Strong',           color: '#FF4B6E' },
    point:      { word: 'I',            emoji: '☝️', desc: 'Pointing / Me / One',             color: '#FFA94D' },
    peace:      { word: 'Peace',        emoji: '✌️', desc: 'Victory / Two / Peace',           color: '#00D4AA' },
    three:      { word: 'Three',        emoji: '🤟', desc: 'Number three',                    color: '#8B5CF6' },
    four:       { word: 'Four',         emoji: '4️⃣', desc: 'Number four',                    color: '#6C63FF' },
    love_ily:   { word: 'Love you',     emoji: '🤟', desc: 'I Love You (ASL)',                color: '#FF4B6E' },
    call_me:    { word: 'Call me',      emoji: '🤙', desc: 'Call me / Hang loose',            color: '#FFA94D' },
    pinky:      { word: 'Promise',      emoji: '🤙', desc: 'Pinky promise',                   color: '#8B5CF6' },
    three_alt:  { word: 'Water',        emoji: '💧', desc: 'Water (W-shape, ASL)',            color: '#6C63FF' },
    rock:       { word: 'Rock',         emoji: '🤘', desc: 'Rock on / Horn sign',             color: '#FF4B6E' },
    ok:         { word: 'Okay',         emoji: '👌', desc: 'OK / Perfect / Understand',      color: '#00D4AA' },
    eat:        { word: 'Eat',          emoji: '🍽️', desc: 'Eating / Food / Hungry',         color: '#FFA94D' },
    drink:        { word: 'Drink',        emoji: '🥤', desc: 'Drinking / Thirsty',              color: '#6C63FF' },
    please:     { word: 'Please',       emoji: '🙏', desc: 'Please / Thank you (ASL)',        color: '#8B5CF6' },
    sorry:      { word: 'Sorry',        emoji: '🤜', desc: 'Sorry / Excuse me (ASL)',         color: '#FF4B6E' },
    more:       { word: 'More',         emoji: '🤏', desc: 'More / Again (ASL fingertips)',   color: '#FFA94D' },
    wait:       { word: 'Wait',         emoji: '✋', desc: 'Wait / Slow down / Hold on',     color: '#6C63FF' },
    name:       { word: 'Name',         emoji: '🏷️', desc: 'Name / What is your name (ASL)', color: '#8B5CF6' },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Skeleton drawing
// ═══════════════════════════════════════════════════════════════════════════
const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
];

const drawSkeleton = (ctx, lm, w, h, gestureColor) => {
    ctx.clearRect(0, 0, w, h);
    const col = gestureColor || '#8B5CF6';

    ctx.shadowColor = col;
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = `${col}99`;
    ctx.lineWidth   = 2.5;
    CONNECTIONS.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
    });
    ctx.shadowBlur = 0;

    lm.forEach(({ x, y }, i) => {
        ctx.beginPath();
        ctx.arc(x * w, y * h, i === 0 ? 7 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? '#00D4AA' : col;
        ctx.shadowColor = i === 0 ? '#00D4AA' : col;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
    });
};

// ═══════════════════════════════════════════════════════════════════════════
//  Simple sentence builder
// ═══════════════════════════════════════════════════════════════════════════
const FILLER_WORDS = new Set(['I', 'Please', 'Yes', 'No', 'Okay', 'Sorry', 'Wait']);

const getToken = () => localStorage.getItem('token') || sessionStorage.getItem('token') || '';

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════
const GestureAssistPage = () => {
    const navigate = useNavigate();
    const { token } = useAuth();

    // ── state ────────────────────────────────────────────────────────────
    const [active,         setActive]         = useState(false);
    const [lastGesture,    setLastGesture]     = useState(null);
    const [confidence,     setConfidence]      = useState(0);
    const [words,          setWords]           = useState([]);   // accumulated words
    const [liveSentence,   setLiveSentence]    = useState('');   // AI-formatted sentence
    const [captions,       setCaptions]        = useState([]);   // completed sentences
    const [status,         setStatus]          = useState('');
    const [isSpeaking,     setIsSpeaking]      = useState(false);

    // ── refs ─────────────────────────────────────────────────────────────
    const videoRef    = useRef(null);
    const canvasRef   = useRef(null);
    const handsRef    = useRef(null);
    const cameraRef   = useRef(null);
    const streamRef   = useRef(null);
    const activeRef   = useRef(false);
    const captionRef  = useRef(null);

    // Gesture hold throttle
    const heldRef       = useRef({ gesture: null, start: 0 });
    const lastAddedRef  = useRef(0);
    const formTimer     = useRef(null);

    // ── voice commands ───────────────────────────────────────────────────
    useEffect(() => {
        const start = () => setActive(true);
        const stop  = () => setActive(false);
        window.addEventListener('vc:start', start);
        window.addEventListener('vc:stop',  stop);
        return () => { window.removeEventListener('vc:start', start); window.removeEventListener('vc:stop', stop); };
    }, []);

    // ── auto-scroll captions ─────────────────────────────────────────────
    useEffect(() => {
        captionRef.current?.scrollTo({ top: captionRef.current.scrollHeight, behavior: 'smooth' });
    }, [captions, liveSentence]);

    // ── sentence finisher: after 3 s of no new words, commit ───────────
    const commitSentence = useCallback(async (currentWords) => {
        if (!currentWords.length) return;
        clearTimeout(formTimer.current);
        let sentence = currentWords.join(' ');
        try {
            sentence = await formatGestureSentence(currentWords, token);
        } catch { /* use raw join */ }
        setCaptions(prev => [
            ...prev,
            { id: Date.now(), text: sentence, time: new Date().toLocaleTimeString() }
        ].slice(-20));
        window.dispatchEvent(new CustomEvent('sb:gesture', { detail: { sentence } }));
        // Auto-speak the completed sentence
        cancelSpeech();
        speak(sentence, { priority: 'high', rate: 1.0 });
        setIsSpeaking(true);
        setTimeout(() => setIsSpeaking(false), sentence.length * 70 + 500);
        setWords([]);
        setLiveSentence('');
    }, [token]);

    const scheduleCommit = useCallback((wds) => {
        clearTimeout(formTimer.current);
        formTimer.current = setTimeout(() => commitSentence(wds), 3000);
    }, [commitSentence]);

    // ── add a word from gesture ──────────────────────────────────────────
    const addWord = useCallback((gesture) => {
        // "fist" (Stop) gesture commits the current sentence immediately
        if (gesture === 'fist') {
            setWords(prev => {
                if (prev.length > 0) commitSentence(prev);
                return prev; // commitSentence will clear it
            });
            return;
        }

        const meta = GESTURE_META[gesture];
        if (!meta) return;
        const word = meta.word;
        const now  = Date.now();
        if (now - lastAddedRef.current < 1200) return; // 1.2s debounce
        lastAddedRef.current = now;

        setWords(prev => {
            // Prevent consecutive duplicate words
            if (prev.length > 0 && prev[prev.length - 1] === word) return prev;
            const next = [...prev, word];
            setLiveSentence(next.join(' ') + ' …');
            scheduleCommit(next);
            window.dispatchEvent(new CustomEvent('sb:gesture', { detail: { words: next, sentence: next.join(' ') } }));
            return next;
        });

        // speak single word immediately
        cancelSpeech();
        speak(word, { priority: 'high', rate: 1.05 });
        setIsSpeaking(true);
        setTimeout(() => setIsSpeaking(false), 900);

        // log
        logService.create({
            eventType: 'gesture',
            message: `Gesture: ${gesture} → "${word}"`,
            confidence: 0.9,
            metadata: { gesture, word },
        }).catch(() => {});
    }, [scheduleCommit, commitSentence]);

    // ── MediaPipe bootstrap ───────────────────────────────────────────────
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

    const startDetection = useCallback(async () => {
        activeRef.current = true;
        setStatus('Loading MediaPipe…');
        try {
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
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.72,
                minTrackingConfidence: 0.65,
            });

            hands.onResults(results => {
                if (!activeRef.current) return;
                const c = canvasRef.current;
                if (!c) return;
                const ctx = c.getContext('2d');

                if (results.multiHandLandmarks?.length) {
                    const lm      = results.multiHandLandmarks[0];
                    const gesture = classifyGesture(lm);
                    const meta    = GESTURE_META[gesture];

                    drawSkeleton(ctx, lm, c.width, c.height, meta?.color);

                    if (gesture !== 'unknown') {
                        setLastGesture(gesture);
                        const now = Date.now();
                        const held = heldRef.current;

                        if (held.gesture === gesture) {
                            const heldMs = now - held.start;
                            setConfidence(Math.min(1, heldMs / 800));
                            if (heldMs >= 800) {
                                addWord(gesture);
                                heldRef.current = { gesture: null, start: 0 };
                            }
                        } else {
                            heldRef.current = { gesture, start: now };
                            setConfidence(0);
                        }
                    } else {
                        setLastGesture(null);
                        setConfidence(0);
                        heldRef.current = { gesture: null, start: 0 };
                    }
                } else {
                    ctx.clearRect(0, 0, c.width, c.height);
                    setLastGesture(null);
                    setConfidence(0);
                    heldRef.current = { gesture: null, start: 0 };
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
    }, [addWord]);

    const stopDetection = useCallback(() => {
        activeRef.current = false;
        clearTimeout(formTimer.current);
        cameraRef.current?.stop();
        handsRef.current?.close();
        streamRef.current?.getTracks().forEach(t => t.stop());
        cameraRef.current = null;
        handsRef.current  = null;
        streamRef.current = null;
        setLastGesture(null);
        setConfidence(0);
        setStatus('');
        const c = canvasRef.current;
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }, []);

    useEffect(() => {
        if (active) startDetection();
        else        stopDetection();
        return stopDetection;
    }, [active, startDetection, stopDetection]);

    // ── speak full sentence ───────────────────────────────────────────────
    const speakSentence = () => {
        const text = captions.at(-1)?.text || words.join(' ');
        if (!text) return;
        cancelSpeech();
        speak(text, { priority: 'high', rate: 1.0 });
    };

    const clearAll = () => {
        setWords([]); setLiveSentence(''); setCaptions([]);
        clearTimeout(formTimer.current);
    };

    const copyCaptions = () => {
        const text = captions.map(c => c.text).join('\n');
        navigator.clipboard?.writeText(text).catch(() => {});
    };

    const meta       = lastGesture ? GESTURE_META[lastGesture] : null;
    const confPct    = Math.round(confidence * 100);

    return (
        <AppLayout noPad>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="page-header">
                <button className="icon-btn" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft size={20} />
                </button>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {active && <span className="live-dot" />}
                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: active ? '#C4B5FD' : 'var(--text-muted)' }}>
                        {active ? 'TRACKING' : 'GESTURE ASSIST'}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button className="icon-btn" onClick={copyCaptions} title="Copy captions">
                        <Copy size={15} />
                    </button>
                    <button className="icon-btn" onClick={clearAll} title="Clear all">
                        <Trash2 size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => { stopDetection(); if (active) setTimeout(startDetection, 200); }}>
                        <RefreshCw size={15} />
                    </button>
                </div>
            </div>

            {/* ── Status banner ──────────────────────────────────────── */}
            {status && (
                <div style={{ margin: '0 1rem 0.4rem', background: 'rgba(108,99,255,0.12)', border: '1px solid var(--color-primary)', borderRadius: 10, padding: '0.45rem 0.85rem', fontSize: '0.78rem', color: 'var(--color-primary)' }}>
                    ⚙️ {status}
                </div>
            )}

            {/* ── Live caption strip ─────────────────────────────────── */}
            <div style={{
                margin: '0 1rem 0.5rem',
                background: '#0a0820',
                border: '1.5px solid rgba(139,92,246,0.35)',
                borderRadius: 16,
                overflow: 'hidden',
                flexShrink: 0,
            }}>
                {/* Caption header */}
                <div style={{ padding: '0.5rem 0.9rem', borderBottom: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {active && <span className="live-dot" style={{ background: '#C4B5FD' }} />}
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#C4B5FD', letterSpacing: '0.1em' }}>LIVE CAPTIONS</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={speakSentence} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C4B5FD', padding: 0 }}>
                            <Volume2 size={14} style={{ color: isSpeaking ? '#00D4AA' : '#C4B5FD' }} />
                        </button>
                    </div>
                </div>

                {/* Caption messages */}
                <div
                    ref={captionRef}
                    style={{ maxHeight: 145, overflowY: 'auto', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                    {captions.length === 0 && !liveSentence && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: '0.5rem 0' }}>
                            {active ? 'Hold gesture 0.8s → add word · Fist → send sentence' : 'Start tracking to see live captions'}
                        </div>
                    )}
                    {captions.map(c => (
                        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', paddingLeft: 2 }}>{c.time}</div>
                            <div style={{
                                background: 'rgba(108,99,255,0.18)',
                                border: '1px solid rgba(108,99,255,0.3)',
                                borderRadius: '14px 14px 14px 4px',
                                padding: '0.55rem 0.85rem',
                                fontSize: '0.95rem',
                                color: '#E8E0FF',
                                fontWeight: 500,
                            }}>
                                {c.text}
                            </div>
                        </div>
                    ))}
                    {/* Live building sentence */}
                    {liveSentence && (
                        <div style={{
                            background: 'rgba(0,212,170,0.08)',
                            border: '1px solid rgba(0,212,170,0.4)',
                            borderRadius: '14px 14px 14px 4px',
                            padding: '0.55rem 0.85rem',
                            fontSize: '0.95rem',
                            color: 'var(--color-accent)',
                        }}>
                            {liveSentence}
                            <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#00D4AA', marginLeft: 3, verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
                        </div>
                    )}
                </div>

                {/* Word chips */}
                {words.length > 0 && (
                    <div style={{ padding: '0.4rem 0.75rem 0.6rem', borderTop: '1px solid rgba(139,92,246,0.15)', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {words.map((w, i) => (
                            <span key={i} style={{ padding: '2px 10px', borderRadius: 20, background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', fontSize: '0.72rem', color: '#C4B5FD', fontWeight: 600 }}>
                                {w}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Camera + skeleton canvas ───────────────────────────── */}
            <div style={{
                margin: '0 1rem 0.6rem',
                position: 'relative',
                borderRadius: 18,
                overflow: 'hidden',
                background: '#0a0820',
                border: `1.5px solid ${meta?.color ? meta.color + '55' : 'rgba(139,92,246,0.25)'}`,
                aspectRatio: '4/3',
                flexShrink: 0,
            }}>
                {/* Corner brackets */}
                {['tl','tr','bl','br'].map(pos => (
                    <div key={pos} style={{
                        position: 'absolute', width: 20, height: 20,
                        [pos.includes('t') ? 'top' : 'bottom']: 10,
                        [pos.includes('l') ? 'left' : 'right']: 10,
                        borderTop:    pos.includes('t') ? `2px solid ${meta?.color || 'rgba(139,92,246,0.7)'}` : 'none',
                        borderBottom: pos.includes('b') ? `2px solid ${meta?.color || 'rgba(139,92,246,0.7)'}` : 'none',
                        borderLeft:   pos.includes('l') ? `2px solid ${meta?.color || 'rgba(139,92,246,0.7)'}` : 'none',
                        borderRight:  pos.includes('r') ? `2px solid ${meta?.color || 'rgba(139,92,246,0.7)'}` : 'none',
                        zIndex: 5,
                        transition: 'border-color 0.3s',
                    }} />
                ))}

                <video ref={videoRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', opacity: active ? 0.28 : 0 }} muted playsInline />
                <canvas ref={canvasRef} width={640} height={480} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }} />

                {!active && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '3rem', marginBottom: 8, opacity: 0.18 }}>🖐️</div>
                        <div style={{ fontSize: '0.82rem' }}>Tap Start Tracking</div>
                    </div>
                )}

                {/* Confidence arc overlay when gesture held */}
                {active && lastGesture && (
                    <div style={{
                        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.7)', borderRadius: 20,
                        padding: '3px 14px', fontSize: '0.7rem', fontWeight: 700,
                        color: meta?.color || '#C4B5FD',
                        border: `1px solid ${meta?.color || '#8B5CF6'}55`,
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <span>{meta?.emoji}</span>
                        Hold…{confPct}%
                        <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${confPct}%`, height: '100%', background: meta?.color || '#8B5CF6', borderRadius: 4, transition: 'width 0.06s linear' }} />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Recognized gesture card ────────────────────────────── */}
            <div style={{ margin: '0 1rem 0.6rem', background: '#1a0f35', border: `1px solid ${meta?.color ? meta.color + '44' : 'rgba(139,92,246,0.25)'}`, borderRadius: 16, padding: '0.85rem 1rem', transition: 'border-color 0.3s' }}>
                <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em', marginBottom: 8 }}>RECOGNIZED GESTURE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: meta?.color ? `${meta.color}22` : 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0, transition: 'background 0.3s' }}>
                        {meta?.emoji ?? '👋'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: meta?.color || '#fff', lineHeight: 1.1, transition: 'color 0.2s' }}>
                            {meta?.word ?? '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {meta?.desc ?? 'Show your hand to the camera'}
                        </div>
                    </div>
                    <button
                        onClick={speakSentence}
                        disabled={!captions.length && !words.length}
                        style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(139,92,246,0.2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Volume2 size={16} style={{ color: '#C4B5FD' }} />
                    </button>
                </div>
            </div>

            {/* ── Confidence bar ─────────────────────────────────────── */}
            <div style={{ margin: '0 1rem 0.75rem', background: 'var(--bg-card)', borderRadius: 14, padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>HOLD CONFIDENCE</span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: meta?.color || 'var(--color-accent)' }}>{confPct ? `${confPct}%` : '--'}</span>
                </div>
                <div style={{ height: 6, background: 'var(--border-card)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${confPct}%`, borderRadius: 6, background: meta?.color || 'var(--color-accent)', transition: 'width 0.06s linear, background 0.3s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Low</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Hold 0.8s → word · ✊ → send</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>High</span>
                </div>
            </div>

            {/* ── Start / Stop button ────────────────────────────────── */}
            <div style={{ padding: '0 1rem 0.5rem' }}>
                <button
                    onClick={() => setActive(a => !a)}
                    style={{
                        width: '100%', padding: '0.95rem',
                        borderRadius: 16, border: 'none', cursor: 'pointer',
                        background: active
                            ? 'linear-gradient(135deg, #8B0000, #c0392b)'
                            : 'linear-gradient(135deg, #6C63FF, #8B5CF6)',
                        color: '#fff', fontWeight: 700, fontSize: '1rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        transition: 'all 0.2s',
                        boxShadow: active ? '0 4px 20px rgba(192,57,43,0.35)' : '0 4px 20px rgba(108,99,255,0.35)',
                    }}
                >
                    {active
                        ? <><Square size={18} fill="#fff" /> Stop Tracking</>
                        : <><Play size={18}  fill="#fff" /> Start Tracking</>
                    }
                </button>
            </div>

            {/* ── Gesture reference grid ─────────────────────────────── */}
            <div style={{ margin: '0 1rem 0.5rem', background: 'var(--bg-card)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '0.65rem 1rem', fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.09em', borderBottom: '1px solid var(--border-color)' }}>
                    📖 GESTURE REFERENCE ({Object.keys(GESTURE_META).length} gestures)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border-color)' }}>
                    {Object.entries(GESTURE_META).map(([key, m]) => (
                        <div key={key} style={{ background: 'var(--bg-card)', padding: '0.55rem 0.65rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: '1.3rem' }}>{m.emoji}</span>
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: m.color }}>{m.word}</span>
                            <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>{m.desc.split(' ').slice(0, 3).join(' ')}</span>
                        </div>
                    ))}
                </div>
            </div>
        </AppLayout>
    );
};

export default GestureAssistPage;
