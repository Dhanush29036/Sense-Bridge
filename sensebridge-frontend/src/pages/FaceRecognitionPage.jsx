/**
 * FaceRecognitionPage.jsx — SenseBridge Face Recognition
 *
 * Features:
 *  • Real-time face detection (SSD MobileNet v1, runs in browser)
 *  • Match detected faces against enrolled known people
 *  • Voice announcement: "Your friend Rahul is in front of you"
 *  • Add new person: live snapshot → extract descriptor → save to localStorage
 *  • Multi-sample support: enroll multiple photos per person for better accuracy
 *  • Canvas overlay showing name labels and bounding boxes
 *  • Recognition history log
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import {
    loadModels, detectFaces, buildMatcher, matchFaces,
    loadKnownFaces, saveKnownFace, deleteKnownFace,
} from '../services/faceService';
import { speak } from '../services/aiService';
import {
    User, UserPlus, UserCheck, Trash2, Camera, Play, Square,
    AlertTriangle, Loader, Eye, Volume2, CheckCircle
} from 'lucide-react';

// ── Voice alert throttle ──────────────────────────────────────────────────
const _lastAnnounced = {};
function canAnnounce(name, cooldownMs = 6000) {
    const now = Date.now();
    if (!_lastAnnounced[name] || now - _lastAnnounced[name] > cooldownMs) {
        _lastAnnounced[name] = now;
        return true;
    }
    return false;
}

// ── Box colours by match confidence ──────────────────────────────────────
const matchColor = (distance) => {
    if (distance < 0.35) return '#00D4AA';   // very confident — teal
    if (distance < 0.50) return '#6c63ff';   // confident — purple
    return '#FFA94D';                         // borderline — orange
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const FaceRecognitionPage = () => {
    const [modelsReady, setModelsReady] = useState(false);
    const [modelError,  setModelError]  = useState('');
    const [active,      setActive]      = useState(false);
    const [faces,       setFaces]       = useState([]);   // recognition results
    const [knownFaces,  setKnownFaces]  = useState([]);   // kept in localStorage
    const [log,         setLog]         = useState([]);
    const [enrollMode,  setEnrollMode]  = useState(false);
    const [enrollName,  setEnrollName]  = useState('');
    const [enrollMsg,   setEnrollMsg]   = useState('');
    const [enrollCount, setEnrollCount] = useState(0);   // samples added for this name
    const [loading,     setLoading]     = useState('');

    const videoRef    = useRef(null);
    const canvasRef   = useRef(null);
    const streamRef   = useRef(null);
    const matcherRef  = useRef(null);
    const rafRef      = useRef(null);
    const frameRef    = useRef(0);

    // ── Load models on mount ───────────────────────────────────────────────
    useEffect(() => {
        setLoading('Loading face recognition models…');
        loadModels()
            .then(() => { setModelsReady(true); setLoading(''); })
            .catch(e  => { setModelError(e.message); setLoading(''); });
        setKnownFaces(loadKnownFaces());
    }, []);

    // ── Rebuild matcher whenever known faces change ────────────────────────
    useEffect(() => {
        matcherRef.current = buildMatcher(knownFaces, 0.50);
    }, [knownFaces]);

    // ── Camera start/stop ─────────────────────────────────────────────────
    useEffect(() => {
        if (!active) {
            stopAll(); return;
        }
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
                });
                streamRef.current = stream;
                const vid = videoRef.current;
                vid.srcObject = stream;
                vid.onloadedmetadata = () => {
                    vid.play();
                    startLoop();
                };
            } catch (e) {
                alert('Camera access denied: ' + e.message);
                setActive(false);
            }
        })();
        return () => stopAll();
    }, [active]);

    const stopAll = () => {
        cancelAnimationFrame(rafRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };

    // ── Detection loop (runs every ~5 frames to balance CPU) ─────────────
    const startLoop = useCallback(() => {
        const loop = async () => {
            rafRef.current = requestAnimationFrame(loop);
            frameRef.current++;

            const vid = videoRef.current;
            const cvs = canvasRef.current;
            if (!vid || !cvs || vid.readyState < 2) return;

            // Sync canvas to video size
            const W = vid.videoWidth, H = vid.videoHeight;
            if (!W || !H) return;
            cvs.width  = W;
            cvs.height = H;
            const ctx = cvs.getContext('2d');

            // Only run inference every 5 frames (~3fps at 15 video fps)
            if (frameRef.current % 5 === 0) {
                try {
                    const detected = await detectFaces(vid);
                    const results  = matchFaces(detected, matcherRef.current);
                    setFaces(results);

                    // ── Draw overlays ──────────────────────────────────────
                    ctx.clearRect(0, 0, W, H);
                    for (const r of results) {
                        const { x, y, w, h } = r.box;
                        const color = r.unknown ? '#ff4b6e' : matchColor(r.distance);

                        // Bounding box
                        ctx.strokeStyle = color;
                        ctx.lineWidth   = 3;
                        ctx.strokeRect(x, y, w, h);

                        // Corner accents
                        const d = 16;
                        const corners = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
                        ctx.lineWidth = 4;
                        corners.forEach(([cx, cy]) => {
                            ctx.beginPath();
                            ctx.moveTo(cx, cy + (cy === y ? d : -d));
                            ctx.lineTo(cx, cy);
                            ctx.lineTo(cx + (cx === x ? d : -d), cy);
                            ctx.stroke();
                        });

                        // Label pill
                        const label = r.unknown ? 'Unknown' : r.name;
                        const conf  = r.unknown ? '' : ` ${Math.round((1 - r.distance) * 100)}%`;
                        ctx.font      = 'bold 14px Inter, sans-serif';
                        const tw      = ctx.measureText(label + conf).width;
                        const lx = x, ly = y > 28 ? y - 28 : y + h + 4;
                        ctx.fillStyle = color + 'ee';
                        ctx.beginPath();
                        ctx.roundRect(lx, ly, tw + 16, 24, 6);
                        ctx.fill();
                        ctx.fillStyle = '#000';
                        ctx.fillText(label + conf, lx + 8, ly + 16);

                        // ── Voice announcement ─────────────────────────────
                        if (!r.unknown && canAnnounce(r.name)) {
                            const msg = `Your friend ${r.name} is in front of you`;
                            speak(msg, { priority: 'normal' });
                            setLog(prev => [
                                { id: Date.now(), msg, time: new Date().toLocaleTimeString(), name: r.name, conf: Math.round((1 - r.distance) * 100) },
                                ...prev
                            ].slice(0, 20));
                        }
                    }
                } catch (err) {
                    // Silent — model inference transient error
                }
            }
        };
        loop();
    }, []);

    // ── Enroll: capture snapshot + extract descriptor ─────────────────────
    const captureEnroll = useCallback(async () => {
        if (!enrollName.trim()) {
            setEnrollMsg('Enter a name first.');
            return;
        }
        const vid = videoRef.current;
        if (!vid || vid.readyState < 2) {
            setEnrollMsg('Camera not ready. Start the camera first.');
            return;
        }

        setLoading('Detecting face…');
        try {
            const detected = await detectFaces(vid);
            if (!detected.length) {
                setEnrollMsg('⚠️ No face detected. Look into camera.');
                setLoading('');
                return;
            }
            if (detected.length > 1) {
                setEnrollMsg('⚠️ Multiple faces. Ensure only you are visible.');
                setLoading('');
                return;
            }

            const updated = saveKnownFace(enrollName.trim(), detected[0].descriptor);
            setKnownFaces(updated);
            setEnrollCount(c => c + 1);
            setEnrollMsg(`✅ Sample ${enrollCount + 1} saved for "${enrollName.trim()}". Add more for better accuracy.`);
        } catch (e) {
            setEnrollMsg('Error: ' + e.message);
        } finally {
            setLoading('');
        }
    }, [enrollName, enrollCount]);

    const handleDelete = (name) => {
        if (!confirm(`Remove "${name}" from known faces?`)) return;
        setKnownFaces(deleteKnownFace(name));
    };

    // Unique names with sample count
    const uniqueNames = [...new Set(knownFaces.map(f => f.name))].map(name => ({
        name,
        samples: knownFaces.filter(f => f.name === name).length,
    }));

    return (
        <AppLayout>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <UserCheck size={24} style={{ color: 'var(--color-primary)' }} /> Face Recognition
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            Recognize known people · voice announcement · add unlimited faces
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => { setEnrollMode(e => !e); setEnrollMsg(''); setEnrollCount(0); }}
                            className={`btn ${enrollMode ? 'btn-primary' : 'btn-ghost'}`}
                            disabled={!modelsReady}
                            style={{ gap: 6 }}
                        >
                            <UserPlus size={15} /> {enrollMode ? 'Done Adding' : 'Add Person'}
                        </button>
                        <button
                            onClick={() => setActive(a => !a)}
                            className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}
                            disabled={!modelsReady}
                            style={{ gap: 6 }}
                        >
                            {active ? <><Square size={15} /> Stop</> : <><Play size={15} /> Start Camera</>}
                        </button>
                    </div>
                </div>

                {/* Model status */}
                {(loading || modelError || !modelsReady) && (
                    <div className="card" style={{
                        padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: 8,
                        borderColor: modelError ? 'var(--color-danger)' : 'var(--color-primary)',
                        color: modelError ? 'var(--color-danger)' : 'var(--color-primary)',
                        fontSize: '0.85rem',
                    }}>
                        {!modelError && <Loader size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                        {modelError ? `❌ ${modelError}` : loading || 'Loading models from CDN (one-time ~8MB download)…'}
                    </div>
                )}

                {/* Enroll banner */}
                {enrollMode && (
                    <div className="card" style={{ borderColor: 'var(--color-primary)', background: 'rgba(108,99,255,0.06)' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <UserPlus size={16} style={{ color: 'var(--color-primary)' }} /> Add New Person
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                className="form-input"
                                placeholder="Person's name (e.g. Rahul)"
                                value={enrollName}
                                onChange={e => { setEnrollName(e.target.value); setEnrollMsg(''); setEnrollCount(0); }}
                                style={{ flex: 1, minWidth: 180, fontSize: '0.875rem' }}
                            />
                            <button
                                onClick={captureEnroll}
                                className="btn btn-primary"
                                disabled={!modelsReady || !active}
                                style={{ gap: 6, flexShrink: 0 }}
                            >
                                <Camera size={15} /> Capture Face
                            </button>
                        </div>
                        {enrollMsg && (
                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: enrollMsg.startsWith('✅') ? 'var(--color-accent)' : 'var(--color-warning)' }}>
                                {enrollMsg}
                            </div>
                        )}
                        <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            💡 Tip: Capture 3–5 photos per person (different angles) for the best accuracy.
                        </div>
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '1.25rem' }}>
                    {/* Camera + canvas overlay */}
                    <div style={{ position: 'relative', background: '#0a0a1a', borderRadius: 16, overflow: 'hidden', aspectRatio: '4/3' }}>
                        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} muted playsInline />
                        <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }} />
                        {active && <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(108,99,255,0.9)', color: '#fff', padding: '2px 10px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700 }}>● LIVE</span>}
                        {!active && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                <Eye size={48} style={{ opacity: 0.2, marginBottom: 8 }} />
                                <div style={{ fontSize: '0.875rem' }}>Press Start Camera</div>
                            </div>
                        )}

                        {/* Live recognised faces overlay info */}
                        {active && faces.length > 0 && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.8)', padding: '8px 14px', borderTop: '2px solid var(--color-primary)' }}>
                                {faces.map((f, i) => (
                                    <div key={i} style={{ fontSize: '0.83rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Volume2 size={13} style={{ color: f.unknown ? '#ff4b6e' : 'var(--color-accent)', flexShrink: 0 }} />
                                        {f.unknown
                                            ? <span style={{ color: '#ff4b6e' }}>Unknown person</span>
                                            : <span><strong style={{ color: 'var(--color-accent)' }}>{f.name}</strong> — {Math.round((1-f.distance)*100)}% match</span>
                                        }
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* Known people */}
                        <div className="card" style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <User size={13} style={{ color: 'var(--color-primary)' }} />
                                Known People
                                <span style={{ marginLeft: 'auto', background: 'var(--color-primary)', color: '#fff', padding: '1px 7px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700 }}>
                                    {uniqueNames.length}
                                </span>
                            </div>
                            {uniqueNames.length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                                    <UserPlus size={28} style={{ opacity: 0.3, display: 'block', margin: '0 auto 6px' }} />
                                    No faces enrolled yet.<br />
                                    Click "Add Person" to start.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {uniqueNames.map(({ name, samples }) => {
                                        const recognized = faces.find(f => f.name === name);
                                        return (
                                            <div key={name} style={{
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '7px 10px', borderRadius: 9, background: 'var(--bg-base)',
                                                border: `1px solid ${recognized ? 'var(--color-accent)' : 'transparent'}`,
                                                transition: 'border-color 0.2s',
                                            }}>
                                                {/* Avatar */}
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: '50%',
                                                    background: `hsl(${name.charCodeAt(0) * 7 % 360}, 60%, 45%)`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: '#fff', fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
                                                }}>
                                                    {name[0].toUpperCase()}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        {name}
                                                        {recognized && <CheckCircle size={12} style={{ color: 'var(--color-accent)' }} />}
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                        {samples} sample{samples > 1 ? 's' : ''}
                                                        {recognized && <span style={{ color: 'var(--color-accent)', marginLeft: 5 }}>● Detected!</span>}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDelete(name)}
                                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                                                    title="Remove"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="card">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {[
                                    { label: 'In Frame',  value: faces.filter(f => !f.unknown).length, color: 'var(--color-accent)' },
                                    { label: 'Unknown',   value: faces.filter(f => f.unknown).length,  color: '#FF4B6E' },
                                    { label: 'Enrolled',  value: uniqueNames.length,                   color: 'var(--color-primary)' },
                                    { label: 'Samples',   value: knownFaces.length,                    color: '#FFA94D' },
                                ].map(s => (
                                    <div key={s.label} style={{ textAlign: 'center', padding: '6px', background: 'var(--bg-base)', borderRadius: 8 }}>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recognition log */}
                <div className="card">
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Volume2 size={15} style={{ color: 'var(--color-primary)' }} /> Announced
                        {log.length > 0 && (
                            <button onClick={() => setLog([])} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>
                                Clear
                            </button>
                        )}
                    </div>
                    {log.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Announcements will appear here when faces are recognised</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {log.map(l => (
                                <div key={l.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '7px 12px', borderRadius: 9, background: 'var(--bg-base)',
                                    borderLeft: '3px solid var(--color-primary)',
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.845rem' }}>🔊 {l.msg}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.conf}% confidence</div>
                                    </div>
                                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{l.time}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};

export default FaceRecognitionPage;
