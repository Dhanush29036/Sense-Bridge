import { useState, useEffect } from 'react';
import AppLayout from '../layouts/AppLayout';
import { startGestureRecognition } from '../services/aiService';
import { Hand, Play, Square, Zap } from 'lucide-react';

const GESTURE_MEANINGS = {
    thumbs_up: '✅ Yes / Approved',
    peace: '✌️ Peace / Two',
    open_palm: '✋ Stop / Hello',
    pointing: '👉 Point / Select',
    fist: '✊ No / Cancel',
};

const GestureAssistPage = () => {
    const [active, setActive] = useState(false);
    const [lastGesture, setLastGesture] = useState(null);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        if (!active) return;
        const stop = startGestureRecognition((result) => {
            setLastGesture(result);
            setHistory((prev) => [
                { ...result, time: new Date().toLocaleTimeString(), id: Date.now() },
                ...prev,
            ].slice(0, 15));
        });
        return stop;
    }, [active]);

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Hand size={24} style={{ color: 'var(--color-warning)' }} /> Gesture Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>MediaPipe hand gesture recognition</p>
                    </div>
                    <button onClick={() => setActive(!active)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
                    {/* Camera feed */}
                    <div className="card" style={{ aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', position: 'relative', minHeight: 260 }}>
                        {active ? (
                            <>
                                {lastGesture && (
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '4rem', marginBottom: 12 }}>🤚</div>
                                        <div style={{
                                            padding: '8px 20px', borderRadius: 12,
                                            background: 'rgba(255,169,77,0.15)', border: '2px solid var(--color-warning)',
                                            color: 'var(--color-warning)', fontWeight: 700, fontSize: '1rem',
                                        }}>
                                            {lastGesture.gesture.replace('_', ' ').toUpperCase()}
                                        </div>
                                        <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                            {(lastGesture.confidence * 100).toFixed(0)}% confidence
                                        </div>
                                    </div>
                                )}
                                <span className="badge badge-danger" style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(255,75,110,0.9)', color: '#fff' }}>
                                    ● LIVE
                                </span>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                <Hand size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
                                <div style={{ fontSize: '0.875rem' }}>Camera feed placeholder</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Press Start to activate gesture mode</div>
                            </div>
                        )}
                    </div>

                    {/* Gesture meaning panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="card">
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Zap size={15} style={{ color: 'var(--color-warning)' }} /> Recognized Gesture
                            </div>
                            {lastGesture ? (
                                <div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 4, textTransform: 'capitalize' }}>
                                        {lastGesture.gesture.replace('_', ' ')}
                                    </div>
                                    <div style={{ color: 'var(--color-accent)', fontWeight: 600 }}>
                                        {GESTURE_MEANINGS[lastGesture.gesture] || 'Custom gesture'}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No gesture detected</div>
                            )}
                        </div>

                        {/* Reference card */}
                        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 10 }}>Gesture Reference</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {Object.entries(GESTURE_MEANINGS).map(([key, val]) => (
                                    <div key={key} style={{
                                        display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                                        borderRadius: 8, background: lastGesture?.gesture === key ? 'rgba(255,169,77,0.1)' : 'var(--bg-base)',
                                        border: `1px solid ${lastGesture?.gesture === key ? 'var(--color-warning)' : 'transparent'}`,
                                        fontSize: '0.8rem',
                                    }}>
                                        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{key.replace('_', ' ')}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>{val}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Gesture history */}
                <div className="card">
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12 }}>Gesture History</div>
                    {history.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No gestures yet</div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {history.map((h) => (
                                <span key={h.id} className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                                    {h.gesture.replace('_', ' ')} · {h.time}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};

export default GestureAssistPage;
