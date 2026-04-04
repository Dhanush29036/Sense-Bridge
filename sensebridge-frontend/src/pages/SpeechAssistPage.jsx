import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { useAuth } from '../context/AuthContext';
import { ChevronLeft, Copy, Trash2, Mic, RefreshCw, Languages } from 'lucide-react';

const BAR_COUNT = 28;
const MAX_CHUNK_MS = 8000;  // Force chunk if speaking for 8s
const SILENCE_MS   = 1200;  // Pause duration to trigger translation

const LANGUAGES = [
    'English', 'Spanish', 'French', 'German', 'Hindi', 'Japanese', 'Arabic', 'Portuguese'
];

const SpeechAssistPage = () => {
    const navigate = useNavigate();
    const { token } = useAuth();

    const [active, setActive] = useState(false);
    const [captions, setCaptions] = useState([]);
    const [barHeights, setBarHeights] = useState(Array(BAR_COUNT).fill(8));
    const [targetLang, setTargetLang] = useState('English');
    const [processing, setProcessing] = useState(false);
    const [atBottom, setAtBottom] = useState(true);

    const listRef = useRef(null);
    const captionEndRef = useRef(null);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const rafRef = useRef(null);
    const streamRef = useRef(null);
    
    // VAD & Recording refs
    const mediaRecRef     = useRef(null);
    const isSpeakingRef   = useRef(false);
    const silenceStartRef = useRef(0);
    const chunkStartRef   = useRef(0);
    const lastSentRef     = useRef(0);   // rate-limit: timestamp of last API call
    const MIN_SEND_INTERVAL_MS = 4000;  // at most 1 request per 4 seconds

    // ── Emit multimodal events ───────────────────────────────────────────
    useEffect(() => {
        const onStart = () => setActive(true);
        const onStop  = () => setActive(false);
        window.addEventListener('vc:start', onStart);
        window.addEventListener('vc:stop',  onStop);
        return () => { window.removeEventListener('vc:start', onStart); window.removeEventListener('vc:stop', onStop); };
    }, []);

    // ── Backend Chunk Processor ──────────────────────────────────────────
    const processChunk = async (blob) => {
        // Ignore tiny/empty blobs (raised threshold to avoid wasting quota on noise)
        if (blob.size < 12000) return;

        // Client-side rate limiter — max 1 request per 4 seconds
        const now = Date.now();
        if (now - lastSentRef.current < MIN_SEND_INTERVAL_MS) return;
        lastSentRef.current = now;
        
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64Audio = reader.result.split(',')[1];
            setProcessing(true);
            try {
                const res = await fetch('/api/ai/transcribe-translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ audioBase64: base64Audio, targetLang })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.translated && data.text) {
                        setCaptions(prev => [...prev, {
                            id: Date.now(),
                            time: new Date().toLocaleTimeString(),
                            text: data.translated,
                            nativeText: data.text,
                            lang: data.sourceLang,
                            isMe: false,
                        }]);
                        window.dispatchEvent(new CustomEvent('sb:speech', { 
                            detail: { text: data.translated, isFinal: true, lang: data.sourceLang } 
                        }));
                    }
                } else if (res.status === 429 || res.status === 500) {
                    // Show quota/server error as a system caption
                    setCaptions(prev => [...prev, {
                        id: Date.now(),
                        time: new Date().toLocaleTimeString(),
                        text: res.status === 429
                            ? '⚠️ AI quota limit reached — please wait a moment.'
                            : '⚠️ Transcription failed — please try again.',
                        nativeText: '',
                        lang: 'system',
                        isMe: false,
                    }]);
                }
            } catch (err) {
                console.error('[Speech] Translation error:', err);
            } finally {
                setProcessing(false);
            }
        };
    };

    // ── Mic & VAD Setup ──────────────────────────────────────────────────
    const startVisualizerAndVAD = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;
            
            // Audio visualizer setup
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtxRef.current = new AudioContext();
            analyserRef.current = audioCtxRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            analyserRef.current.smoothingTimeConstant = 0.8;
            
            const source = audioCtxRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);
            const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);

            // MediaRecorder setup
            const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecRef.current = mr;
            chunkStartRef.current = Date.now();

            mr.ondataavailable = (e) => {
                if (e.data.size > 0) processChunk(e.data);
            };
            mr.start();

            const draw = () => {
                rafRef.current = requestAnimationFrame(draw);
                analyserRef.current.getByteFrequencyData(freqData);
                
                // UI Bars
                const step = Math.floor(freqData.length / BAR_COUNT);
                const heights = Array.from({ length: BAR_COUNT }, (_, i) => {
                    const val = freqData[i * step];
                    return Math.max(4, (val / 255) * 36);
                });
                setBarHeights(heights);

                // Voice Activity Detection (VAD)
                const sum = freqData.reduce((a, b) => a + b, 0);
                const avgVolume = sum / freqData.length;
                const now = Date.now();

                const VOL_THRESHOLD = 15; // Tuned for voice vs background

                if (avgVolume > VOL_THRESHOLD) {
                    isSpeakingRef.current = true;
                    silenceStartRef.current = 0;
                } else if (isSpeakingRef.current) {
                    if (!silenceStartRef.current) silenceStartRef.current = now;
                    // Trigger chunk on 1.2s silence
                    if (now - silenceStartRef.current > SILENCE_MS) {
                        isSpeakingRef.current = false;
                        silenceStartRef.current = 0;
                        if (mr.state === 'recording') {
                            mr.stop();
                            mr.start(); // immediately restart
                            chunkStartRef.current = now;
                        }
                    }
                }

                // Force chunk if speaking continuously for 8 seconds
                if (isSpeakingRef.current && (now - chunkStartRef.current > MAX_CHUNK_MS)) {
                    if (mr.state === 'recording') {
                        mr.stop();
                        mr.start();
                        chunkStartRef.current = now;
                        silenceStartRef.current = 0;
                    }
                }
            };
            draw();
        } catch (err) { 
            console.error('[Audio] Mic denied or failed:', err); 
            setActive(false);
        }
    }, [targetLang, token]); // Rebind if targetLang changes, but we try to keep it steady

    const stopAll = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (mediaRecRef.current && mediaRecRef.current.state === 'recording') {
            mediaRecRef.current.stop();
        }
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        
        setBarHeights(Array(BAR_COUNT).fill(4));
        isSpeakingRef.current = false;
        silenceStartRef.current = 0;
        mediaRecRef.current = null;
    }, []);

    useEffect(() => {
        if (active) startVisualizerAndVAD();
        else stopAll();
        return stopAll;
    }, [active, startVisualizerAndVAD, stopAll]);

    // ── Auto-scroll ──────────────────────────────────────────────────────
    useEffect(() => {
        if (atBottom) captionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [captions, atBottom, processing]);

    const handleScroll = () => {
        const el = listRef.current;
        if (!el) return;
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
    };

    const handleCopy = () => {
        const text = captions.map(c => c.text).join('\n');
        navigator.clipboard?.writeText(text).catch(() => {});
    };

    return (
        <AppLayout noPad>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="page-header" style={{ padding: '0.65rem 1rem' }}>
                <button className="icon-btn" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft size={20} />
                </button>
                <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Speech Assist</div>
                    <div style={{ fontSize: '0.62rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 1 }}>
                        {active ? (
                            <>
                                <span className="live-dot" style={{ width: 6, height: 6 }} />
                                <span style={{ color: 'var(--color-accent)' }}>Live Translation</span>
                            </>
                        ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Tap mic to start</span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button className="icon-btn" onClick={handleCopy} title="Copy all captions">
                        <Copy size={16} />
                    </button>
                    <button className="icon-btn" onClick={() => setCaptions([])} title="Clear">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {/* ── Target Language Select ──────────────────────────────── */}
            <div style={{ 
                padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-card)', borderBottom: '1px solid rgba(108,99,255,0.15)'
            }}>
                <Languages size={16} style={{ color: 'var(--color-accent)' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Target:</span>
                <select 
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff', padding: '4px 8px', borderRadius: 8,
                        fontSize: '0.75rem', fontWeight: 600, outline: 'none'
                    }}
                >
                    {LANGUAGES.map(l => <option key={l} value={l} style={{ color: '#000' }}>{l}</option>)}
                </select>
                <div style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#00D4AA', background: 'rgba(0,212,170,0.1)', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>
                    AUTO-DETECT MIXED
                </div>
            </div>

            {/* ── Caption list ───────────────────────────────────────── */}
            <div
                ref={listRef}
                onScroll={handleScroll}
                style={{
                    flex: 1, overflowY: 'auto', padding: '0.75rem 1rem',
                    display: 'flex', flexDirection: 'column', gap: '0.65rem',
                }}
            >
                {captions.length === 0 && !processing && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                            {active ? 'Listening for speech…' : 'Start listening to translate'}
                        </div>
                        <div style={{ fontSize: '0.65rem', maxWidth: '70%', textAlign: 'center', lineHeight: 1.4 }}>
                            Speak naturally in any language. The AI will chunk your sentences and translate them to {targetLang}.
                        </div>
                    </div>
                )}

                {captions.map((c, idx) => {
                    const showTime = idx === 0 || captions[idx - 1]?.time !== c.time;
                    return (
                        <div key={c.id} className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {showTime && (
                                <div style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)', margin: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                    <span>{c.time}</span>
                                    {c.lang && (
                                        <span style={{ background: 'rgba(108,99,255,0.15)', color: '#C4B5FD', padding: '1px 5px', borderRadius: 4, fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase' }}>
                                            {c.lang}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <div className="bubble-other" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{c.text}</span>
                                    {c.nativeText && c.nativeText !== c.text && (
                                        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4, marginTop: 2 }}>
                                            "{c.nativeText}"
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Processing indicator */}
                {processing && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }} className="fade-in">
                        <div className="bubble-interim" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <RefreshCw size={14} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Translating to {targetLang}...
                            </span>
                        </div>
                    </div>
                )}
                <div ref={captionEndRef} />
            </div>

            {/* ── Scroll hint ────────────────────────────────────────── */}
            {!atBottom && (
                <div
                    onClick={() => { captionEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setAtBottom(true); }}
                    style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', padding: '4px 0', cursor: 'pointer' }}
                >
                    ˅ Scroll to bottom
                </div>
            )}

            {/* ── Bottom controls ─────────────────────────────────────── */}
            <div style={{
                background: 'var(--bg-surface)',
                borderTop: '1px solid var(--border-color)',
                padding: '0.75rem 1rem',
                paddingBottom: 'calc(0.75rem + var(--nav-height))',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {/* VAD Waveform bars */}
                    <div style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'center', height: 40, overflow: 'hidden' }}>
                        {barHeights.map((h, i) => (
                            <div key={i} style={{
                                flex: 1,
                                borderRadius: 3,
                                background: `hsl(${163 + i * 2}, 80%, ${active ? 55 : 25}%)`,
                                height: `${h}px`,
                                maxHeight: 36,
                                opacity: active ? 1 : 0.25,
                                transition: 'height 0.06s ease',
                            }} />
                        ))}
                    </div>
                    {/* Mic FAB */}
                    <button
                        className={`fab-mic ${active ? 'recording' : ''}`}
                        onClick={() => setActive(a => !a)}
                    >
                        <Mic size={24} color={active ? '#000' : '#000'} />
                    </button>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontWeight: 500 }}>
                    🔒 Audio securely translated in real-time
                </div>
            </div>
        </AppLayout>
    );
};

export default SpeechAssistPage;
