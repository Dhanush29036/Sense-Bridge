import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { startObjectDetection, stopObjectDetection, speak, cancelSpeech } from '../services/aiService';
import { Eye, Volume2, AlertTriangle, Play, Square, Navigation } from 'lucide-react';

// ── Obstacle categories relevant when walking ─────────────────────────────
// Anything NOT in this set is silently ignored
const OBSTACLE_CLASSES = new Set([
    'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck',
    'dog', 'cat', 'horse', 'cow',
    'chair', 'couch', 'dining table', 'bench', 'bed',
    'potted plant', 'vase', 'fire hydrant', 'stop sign',
    'bottle', 'sports ball', 'suitcase', 'backpack',
    'traffic light', 'parking meter', 'door', 'stairs',
]);

// Urgency colour based on proximity
const URGENCY = { close: '#FF4B6E', medium: '#FFA94D', far: '#00D4AA' };

/**
 * Estimate distance from bounding box area ratio.
 * A bbox > 30% of frame width = "close" (danger zone).
 * A bbox 10-30% = "medium". < 10% = "far".
 */
function estimateDistance(pctBbox) {
    const bboxWidthPct = pctBbox[2]; // % of frame width
    const bboxHeightPct = pctBbox[3]; // % of frame height
    const area = bboxWidthPct * bboxHeightPct;
    if (area > 900 || bboxWidthPct > 30) return 'close';
    if (area > 200 || bboxWidthPct > 12) return 'medium';
    return 'far';
}

/**
 * Determine directional position of the object in the frame.
 * pctBbox[0] = left edge %; pctBbox[2] = width %
 */
function getDirection(pctBbox) {
    const cx = pctBbox[0] + pctBbox[2] / 2; // center x in %
    if (cx < 33) return 'left';
    if (cx > 67) return 'right';
    return 'ahead';
}

function buildAlertMsg(detections) {
    // Group by direction, report closest item per direction
    const closest = {};
    for (const d of detections) {
        const dir = d.direction;
        if (!closest[dir] || closest[dir].area < d.area) closest[dir] = d;
    }
    const parts = Object.entries(closest).map(([dir, d]) => {
        const dist = d.distance === 'close' ? 'very close' : d.distance === 'medium' ? 'nearby' : 'ahead';
        return `${d.label} ${dist} on ${dir === 'ahead' ? 'your path' : 'your ' + dir}`;
    });
    return parts.join('. ');
}

// Throttle per-object speech (only speak about an object if new or closer)
const lastSpokenState = {};

function shouldSpeak(label, distance) {
    const prev = lastSpokenState[label];
    const now = Date.now();
    // Re-speak if: first detection, distance changed to closer, or 6s passed
    if (!prev) { lastSpokenState[label] = { distance, time: now }; return true; }
    if (prev.distance !== 'close' && distance === 'close') { lastSpokenState[label] = { distance, time: now }; return true; }
    if (now - prev.time > 6000) { lastSpokenState[label] = { distance, time: now }; return true; }
    return false;
}

// ── Component ──────────────────────────────────────────────────────────────
const VisionAssistPage = () => {
    const [active, setActive] = useState(false);
    const [allDetections, setAllDetections] = useState([]);  // all detected objects
    const [obstacles, setObstacles] = useState([]);  // filtered obstacles only
    const [alerts, setAlerts] = useState([]);
    const [speaking, setSpeaking] = useState(false);
    const [currentAlert, setCurrentAlert] = useState('');

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const speakTimerRef = useRef(null);

    const doSpeak = useCallback((text, urgent = false) => {
        if (!text) return;
        clearTimeout(speakTimerRef.current);
        setSpeaking(true);
        setCurrentAlert(text);
        cancelSpeech();
        speak(text, { priority: urgent ? 'high' : 'normal', rate: urgent ? 1.15 : 1.0 });
        speakTimerRef.current = setTimeout(() => setSpeaking(false), text.length * 65 + 400);
    }, []);

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
                        setTimeout(async () => {
                            stopFn = await startObjectDetection(videoRef.current, (result) => {
                                setAllDetections(result.detections);

                                // ── Filter to walking obstacles only ───────────
                                const obs = result.detections
                                    .filter(d => OBSTACLE_CLASSES.has(d.label) && d.confidence > 0.50)
                                    .map(d => ({
                                        ...d,
                                        distance: estimateDistance(d.pctBbox),
                                        direction: getDirection(d.pctBbox),
                                        area: d.pctBbox[2] * d.pctBbox[3],
                                    }));

                                setObstacles(obs);

                                // ── Audio alert logic ──────────────────────────
                                const speakable = obs.filter(d => shouldSpeak(d.label, d.distance));
                                const urgent = speakable.some(d => d.distance === 'close');

                                if (speakable.length > 0) {
                                    const msg = buildAlertMsg(speakable);
                                    if (msg) {
                                        doSpeak(
                                            urgent ? `Warning! ${msg}` : msg,
                                            urgent
                                        );
                                        setAlerts(prev => [
                                            { id: Date.now(), msg: urgent ? `⚠️ ${msg}` : msg, urgent, time: new Date().toLocaleTimeString() },
                                            ...prev
                                        ].slice(0, 12));
                                    }
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
            stopObjectDetection();
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            if (videoRef.current) videoRef.current.srcObject = null;
        }

        return () => {
            if (stopFn) stopFn();
            stopObjectDetection();
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, [active, doSpeak]);

    const DIST_COLOR = { close: '#FF4B6E', medium: '#FFA94D', far: '#00D4AA' };
    const DIST_LABEL = { close: 'Close!', medium: 'Nearby', far: 'Far' };

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Eye size={24} style={{ color: 'var(--color-primary)' }} /> Vision Assist
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            Obstacle detection · distance estimation · directional audio guidance
                        </p>
                    </div>
                    <button onClick={() => setActive(a => !a)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16} /> Stop</> : <><Play size={16} /> Start</>}
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.25rem' }}>
                    {/* Camera */}
                    <div className="card" style={{ aspectRatio: '16/9', position: 'relative', background: '#0a0a1a', overflow: 'hidden', padding: 0 }}>
                        {active ? (
                            <>
                                <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                                <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,75,110,0.9)', color: '#fff', padding: '2px 10px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700 }}>● LIVE</span>

                                {/* Bounding box overlays — obstacles ONLY, colour-coded by distance */}
                                {obstacles.map((d, i) => (
                                    <div key={`${d.label}-${i}`} style={{
                                        position: 'absolute',
                                        border: `2px solid ${DIST_COLOR[d.distance]}`,
                                        borderRadius: 4,
                                        top: `${d.pctBbox[1]}%`,
                                        left: `${d.pctBbox[0]}%`,
                                        width: `${d.pctBbox[2]}%`,
                                        height: `${d.pctBbox[3]}%`,
                                        boxShadow: d.distance === 'close' ? `0 0 12px ${DIST_COLOR.close}55` : 'none',
                                    }}>
                                        <span style={{
                                            display: 'block', padding: '1px 6px', fontSize: '0.72rem', fontWeight: 700,
                                            background: DIST_COLOR[d.distance], color: '#000', borderRadius: '0 0 4px 0',
                                        }}>
                                            {d.label}  {DIST_LABEL[d.distance]}  {d.direction === 'ahead' ? '⬆' : d.direction === 'left' ? '⬅' : '➡'}
                                        </span>
                                    </div>
                                ))}

                                {/* Current spoken alert banner */}
                                {speaking && currentAlert && (
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'rgba(0,0,0,0.8)', color: '#fff',
                                        padding: '8px 14px', fontSize: '0.85rem', fontWeight: 500,
                                        borderTop: '2px solid var(--color-warning)',
                                        display: 'flex', alignItems: 'center', gap: 8,
                                    }}>
                                        <Volume2 size={14} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                                        {currentAlert}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                <Eye size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
                                <div style={{ fontSize: '0.875rem' }}>Press Start to activate</div>
                            </div>
                        )}
                    </div>

                    {/* Right panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* Audio output */}
                        <div className="card" style={{ borderColor: speaking ? 'var(--color-warning)' : undefined, transition: 'border-color 0.2s' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Volume2 size={15} style={{ color: speaking ? 'var(--color-warning)' : 'var(--text-muted)' }} />
                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Audio Output</span>
                                {speaking && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block', animation: 'pulse 0.8s ease-in-out infinite' }} />}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: speaking ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: speaking ? 'normal' : 'italic' }}>
                                {speaking ? `🔊 ${currentAlert}` : '🔇 Waiting for obstacles…'}
                            </div>
                        </div>

                        {/* Obstacle list */}
                        <div className="card" style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Navigation size={14} style={{ color: 'var(--color-primary)' }} />
                                Nearby Obstacles
                            </div>
                            {obstacles.length === 0 ? (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                    {active ? '✅ Path is clear' : 'Start to detect obstacles'}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {obstacles.map((d, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: 'var(--bg-base)', borderRadius: 8, borderLeft: `3px solid ${DIST_COLOR[d.distance]}` }}>
                                            <div>
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>{d.label}</span>
                                                <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                                                    {d.direction === 'ahead' ? '⬆ ahead' : d.direction === 'left' ? '⬅ left' : '➡ right'}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: '0.73rem', fontWeight: 700, color: DIST_COLOR[d.distance] }}>
                                                {DIST_LABEL[d.distance]}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Alert history */}
                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <AlertTriangle size={15} style={{ color: 'var(--color-warning)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Alert History</span>
                    </div>
                    {alerts.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No alerts yet</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {alerts.map((a) => (
                                <div key={a.id} style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    padding: '6px 12px', borderRadius: 8,
                                    background: a.urgent ? 'rgba(255,75,110,0.08)' : 'rgba(255,169,77,0.06)',
                                    border: `1px solid ${a.urgent ? 'rgba(255,75,110,0.25)' : 'rgba(255,169,77,0.2)'}`,
                                }}>
                                    <span style={{ fontSize: '0.845rem' }}>{a.msg}</span>
                                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{a.time}</span>
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
