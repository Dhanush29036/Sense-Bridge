import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { startSpeechRecognition } from '../services/aiService';
import { Mic, MicOff, Volume2, Play, Square, Globe } from 'lucide-react';

const LANGUAGES = [
    { code: 'en-US', label: '🇺🇸 English (US)' },
    { code: 'en-IN', label: '🇮🇳 English (India)' },
    { code: 'hi-IN', label: '🇮🇳 हिंदी (Hindi)' },
    { code: 'ta-IN', label: '🇮🇳 தமிழ் (Tamil)' },
    { code: 'te-IN', label: '🇮🇳 తెలుగు (Telugu)' },
    { code: 'bn-IN', label: '🇮🇳 বাংলা (Bengali)' },
    { code: 'mr-IN', label: '🇮🇳 मराठी (Marathi)' },
    { code: 'es-ES', label: '🇪🇸 Español (Spanish)' },
    { code: 'fr-FR', label: '🇫🇷 Français (French)' },
    { code: 'de-DE', label: '🇩🇪 Deutsch (German)' },
    { code: 'ar-SA', label: '🇸🇦 العربية (Arabic)' },
    { code: 'ja-JP', label: '🇯🇵 日本語 (Japanese)' },
    { code: 'zh-CN', label: '🇨🇳 中文 (Chinese)' },
];

const BAR_COUNT = 24;

const SpeechAssistPage = () => {
    const [active, setActive] = useState(false);
    const [captions, setCaptions] = useState([]);   // committed final captions
    const [interimText, setInterimText] = useState('');  // live word-by-word preview
    const [barHeights, setBarHeights] = useState(Array(BAR_COUNT).fill(15));
    const [language, setLanguage] = useState('en-US');
    const captionEndRef = useRef(null);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const rafRef = useRef(null);
    const streamRef = useRef(null);

    // ── Voice command support (vc:start / vc:stop events from VoiceCommandContext) ──
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

    // ── Web Audio visualizer ────────────────────────────────────────────────
    const startVisualizer = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;

            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            analyserRef.current = audioCtxRef.current.createAnalyser();
            analyserRef.current.fftSize = 128;          // 64 frequency bands
            analyserRef.current.smoothingTimeConstant = 0.75;

            const source = audioCtxRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);

            const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);

            const draw = () => {
                rafRef.current = requestAnimationFrame(draw);
                analyserRef.current.getByteFrequencyData(freqData);
                // Pick BAR_COUNT evenly-spaced bands from the low-mid freq range
                const step = Math.floor(freqData.length / BAR_COUNT);
                const heights = Array.from({ length: BAR_COUNT }, (_, i) => {
                    const val = freqData[i * step]; // 0-255
                    return Math.max(8, (val / 255) * 100); // scale to % height, min 8
                });
                setBarHeights(heights);
            };
            draw();
        } catch (err) {
            console.error('[Audio] Mic access denied for visualizer:', err);
        }
    }, []);

    const stopVisualizer = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        setBarHeights(Array(BAR_COUNT).fill(15));
    }, []);

    // ── Speech recognition + visualizer lifecycle ───────────────────────────
    useEffect(() => {
        if (!active) return;
        startVisualizer();
        setInterimText('');
        const stop = startSpeechRecognition((result) => {
            if (result.isFinal) {
                // Committed sentence — add to captions list, clear interim
                setInterimText('');
                setCaptions((prev) => [
                    ...prev,
                    { id: Date.now(), text: result.text, confidence: result.confidence, time: new Date().toLocaleTimeString() }
                ].slice(-30));
            } else {
                // Interim — update live preview immediately (fires on every word)
                setInterimText(result.text);
            }
        }, language);
        return () => { stop(); stopVisualizer(); setInterimText(''); };
    }, [active, language, startVisualizer, stopVisualizer]);

    // Auto-scroll captions
    useEffect(() => { captionEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [captions]);

    // Derive glow intensity from average bar height
    const avgLevel = barHeights.reduce((s, h) => s + h, 0) / barHeights.length;

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Mic size={24} style={{ color: 'var(--color-accent)' }} /> Speech Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Live captions powered by browser Speech API</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Globe size={15} style={{ color: 'var(--text-muted)' }} />
                            <select
                                value={language}
                                onChange={e => { setLanguage(e.target.value); if (active) { setActive(false); setTimeout(() => setActive(true), 150); } }}
                                className="form-input"
                                style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', minWidth: 160 }}
                            >
                                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                            </select>
                        </div>
                        <button onClick={() => setActive(!active)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                            {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                        </button>
                    </div>
                </div>

                {/* Mic indicator */}
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1rem 1.5rem' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: active ? 'rgba(0,212,170,0.15)' : 'var(--bg-base)',
                        border: `3px solid ${active ? 'var(--color-accent)' : 'var(--border-color)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.3s',
                        boxShadow: active ? `0 0 ${avgLevel / 2}px rgba(0,212,170,0.5)` : 'none',
                    }}>
                        {active ? <Mic size={22} style={{ color: 'var(--color-accent)' }} /> : <MicOff size={22} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{active ? 'Listening...' : 'Microphone Off'}</div>
                        {/* Real frequency bars */}
                        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28 }}>
                            {barHeights.map((h, i) => (
                                <div key={i} style={{
                                    width: 4, borderRadius: 2,
                                    background: `hsl(${163 + i * 1.5}, 80%, ${active ? 55 : 30}%)`,
                                    height: `${h}%`,
                                    opacity: active ? 0.9 : 0.2,
                                    transition: 'height 0.06s ease',
                                }} />
                            ))}
                        </div>
                    </div>
                    {active && <span className="badge badge-success">LIVE</span>}
                </div>

                {/* Caption display */}
                <div className="card" style={{ minHeight: 300, maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Volume2 size={16} /> Live Captions
                        {active && <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Interim words shown instantly</span>}
                    </div>

                    {/* ── Live interim preview (updates word-by-word) ─────────── */}
                    {active && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 10, marginBottom: 8,
                            background: 'rgba(0,212,170,0.06)',
                            border: `1px solid ${interimText ? 'rgba(0,212,170,0.4)' : 'rgba(0,212,170,0.1)'}`,
                            minHeight: 44, display: 'flex', alignItems: 'center',
                            transition: 'border-color 0.1s',
                        }}>
                            {interimText ? (
                                <span style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', letterSpacing: '0.01em' }}>
                                    {interimText}
                                    <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--color-accent)', marginLeft: 3, verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
                                </span>
                            ) : (
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Listening… speak now</span>
                            )}
                        </div>
                    )}

                    {/* ── Committed final captions ──────────────────────────── */}
                    {captions.length === 0 && !interimText ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            {active ? 'Waiting for speech…' : 'Start listening to see captions'}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {captions.map((c) => (
                                <div key={c.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-base)', borderLeft: '3px solid var(--color-accent)' }}>
                                    <div style={{ fontSize: '1rem', marginBottom: 4 }}>{c.text}</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        <span>{c.confidence > 0 ? `${(c.confidence * 100).toFixed(0)}% confidence` : ''}</span>
                                        <span>{c.time}</span>
                                    </div>
                                </div>
                            ))}
                            <div ref={captionEndRef} />
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};

export default SpeechAssistPage;

