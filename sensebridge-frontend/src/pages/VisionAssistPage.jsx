import { useState, useEffect, useRef } from 'react';
import AppLayout from '../layouts/AppLayout';
import { startObjectDetection, stopObjectDetection } from '../services/aiService';
import { Eye, Volume2, AlertTriangle, Play, Square } from 'lucide-react';

const VisionAssistPage = () => {
    const [active, setActive] = useState(false);
    const [detections, setDetections] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [speaking, setSpeaking] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    const speak = (text) => {
        if (!window.speechSynthesis) return;
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 1.1;
        utt.onstart = () => setSpeaking(true);
        utt.onend = () => setSpeaking(false);
        window.speechSynthesis.speak(utt);
    };

    useEffect(() => {
        let stopFn = null;

        const startCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 640 } }
                });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current.play();
                        // Delay AI start slightly to ensure video is fully rendering
                        setTimeout(async () => {
                            stopFn = await startObjectDetection(videoRef.current, (result) => {
                                setDetections(result.detections);
                                const highConf = result.detections.filter((d) => d.confidence > 0.65);
                                if (highConf.length) {
                                    const msg = highConf.map((d) => `${d.label} detected`).join(', ');
                                    setAlerts((prev) => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
                                    speak(msg);
                                }
                            });
                        }, 500);
                    };
                }
            } catch (err) {
                console.error('Camera error:', err);
                alert('Could not access camera for Vision Assist.');
                setActive(false);
            }
        };

        if (active) {
            startCamera();
        } else {
            if (stopFn) stopFn();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
            if (videoRef.current) videoRef.current.srcObject = null;
        }

        return () => {
            if (stopFn) stopFn();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, [active]);

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Eye size={24} style={{ color: 'var(--color-primary)' }} /> Vision Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>YOLO object detection + audio feedback</p>
                    </div>
                    <button onClick={() => setActive(!active)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
                    {/* Camera feed placeholder */}
                    <div className="card" style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: '#0a0a1a', minHeight: 240 }}>
                        {active ? (
                            <>
                                <video
                                    ref={videoRef}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
                                    muted playsInline
                                />
                                <div style={{ position: 'absolute', top: 12, left: 12 }}>
                                    <span className="badge badge-danger" style={{ background: 'rgba(255,75,110,0.9)', color: '#fff', display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
                                        LIVE
                                    </span>
                                </div>
                                {/* Detection overlays */}
                                {detections.map((d, i) => (
                                    <div key={i} style={{
                                        position: 'absolute', border: '2px solid var(--color-accent)',
                                        borderRadius: 4, padding: '2px 4px',
                                        background: 'rgba(0,212,170,0.15)',
                                        top: `${d.pctBbox[1]}%`, left: `${d.pctBbox[0]}%`,
                                        width: `${d.pctBbox[2]}%`, height: `${d.pctBbox[3]}%`,
                                        color: 'var(--color-accent)', fontSize: '0.75rem', fontWeight: 600,
                                        display: 'flex', alignItems: 'flex-start'
                                    }}>
                                        <span style={{ background: 'var(--color-accent)', color: '#000', padding: '0 4px', borderRadius: 2 }}>
                                            {d.label} {(d.confidence * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                ))}
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                <Eye size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
                                <div style={{ fontSize: '0.875rem' }}>Camera will appear here</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>Press Start to activate vision mode</div>
                            </div>
                        )}
                    </div>

                    {/* Right panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {/* Voice output indicator */}
                        <div className="card" style={{ borderColor: speaking ? 'var(--color-accent)' : 'var(--border-color)', transition: 'border-color 0.3s' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                <Volume2 size={16} style={{ color: speaking ? 'var(--color-accent)' : 'var(--text-muted)' }} />
                                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Audio Output</span>
                                {speaking && <span className="pulse-dot" />}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {speaking ? '🔊 Speaking alert...' : '🔇 Waiting for detections'}
                            </div>
                        </div>

                        {/* Current detections */}
                        <div className="card" style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 12 }}>Live Detections</div>
                            {detections.length === 0 ? (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No objects detected yet</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {detections.map((d, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.875rem', textTransform: 'capitalize' }}>{d.label}</span>
                                            <span className={`badge ${d.confidence > 0.85 ? 'badge-warning' : 'badge-info'}`}>{(d.confidence * 100).toFixed(0)}%</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Alert panel */}
                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <AlertTriangle size={16} style={{ color: 'var(--color-warning)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Alert History</span>
                    </div>
                    {alerts.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No alerts yet</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {alerts.map((a) => (
                                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,169,77,0.08)', border: '1px solid rgba(255,169,77,0.2)', borderRadius: 8 }}>
                                    <span style={{ fontSize: '0.875rem' }}>{a.msg}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>{a.time}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};

export default VisionAssistPage;
