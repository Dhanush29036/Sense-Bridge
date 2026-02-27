import { useState, useEffect, useRef } from 'react';
import AppLayout from '../layouts/AppLayout';
import { startSpeechRecognition } from '../services/aiService';
import { Mic, MicOff, Volume2, Play, Square } from 'lucide-react';

const SpeechAssistPage = () => {
    const [active, setActive] = useState(false);
    const [captions, setCaptions] = useState([]);
    const [micLevel, setMicLevel] = useState(0);
    const captionEndRef = useRef(null);

    useEffect(() => {
        if (!active) return;
        // Simulate mic level animation
        const lvlInterval = setInterval(() => setMicLevel(Math.random() * 100), 150);
        const stop = startSpeechRecognition((result) => {
            setCaptions((prev) => [
                ...prev,
                { id: Date.now(), text: result.text, confidence: result.confidence, time: new Date().toLocaleTimeString() }
            ].slice(-30)); // keep last 30 captions
        });
        return () => { clearInterval(lvlInterval); stop(); setMicLevel(0); };
    }, [active]);

    // Auto-scroll captions
    useEffect(() => { captionEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [captions]);

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Mic size={24} style={{ color: 'var(--color-accent)' }} /> Speech Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Whisper AI live captions for hearing-impaired users</p>
                    </div>
                    <button onClick={() => setActive(!active)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                {/* Mic indicator */}
                <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1rem 1.5rem' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: active ? 'rgba(0,212,170,0.15)' : 'var(--bg-base)',
                        border: `3px solid ${active ? 'var(--color-accent)' : 'var(--border-color)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.3s',
                        boxShadow: active ? `0 0 ${micLevel / 2}px rgba(0,212,170,0.4)` : 'none',
                    }}>
                        {active ? <Mic size={22} style={{ color: 'var(--color-accent)' }} /> : <MicOff size={22} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{active ? 'Listening...' : 'Microphone Off'}</div>
                        {/* Level bars */}
                        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28 }}>
                            {Array.from({ length: 24 }).map((_, i) => (
                                <div key={i} style={{
                                    width: 4, borderRadius: 2,
                                    background: 'var(--color-accent)',
                                    height: active ? `${Math.random() * micLevel + 10}%` : '15%',
                                    opacity: active ? 0.8 : 0.2,
                                    transition: 'height 0.1s ease',
                                }} />
                            ))}
                        </div>
                    </div>
                    {active && <span className="badge badge-success">LIVE</span>}
                </div>

                {/* Caption display */}
                <div className="card" style={{ minHeight: 300, maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Volume2 size={16} /> Live Captions
                    </div>
                    {captions.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            {active ? 'Waiting for speech...' : 'Start listening to see captions here'}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {captions.map((c) => (
                                <div key={c.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-base)', borderLeft: '3px solid var(--color-accent)' }}>
                                    <div style={{ fontSize: '1rem', marginBottom: 4 }}>{c.text}</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <span>Confidence: {(c.confidence * 100).toFixed(0)}%</span>
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
