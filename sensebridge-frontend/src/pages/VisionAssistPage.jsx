/**
 * VisionAssistPage.jsx — SenseBridge Vision Assist (new mobile UI)
 * All AI/detection logic unchanged; only presentation updated.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import {
    startObjectDetection, stopObjectDetection, speak, cancelSpeech,
    ObstacleTracker, analyzeFrameForHazards,
} from '../services/aiService';
import {
    loadModels as loadFaceModels, detectFaces, buildMatcher, matchFaces,
    loadKnownFaces, saveKnownFace, deleteKnownFace,
} from '../services/faceService';
import {
    Eye, Volume2, AlertTriangle, Square, Zap,
    UserCheck, UserPlus, Camera, Trash2, ChevronDown, ChevronUp, Loader,
    ChevronLeft,
} from 'lucide-react';

// ── ALL 80 COCO classes — detect everything the model can see ─────────────
const OBSTACLE_CLASSES = new Set([
    'person','bicycle','car','motorcycle','airplane','bus','train','truck',
    'boat','traffic light','fire hydrant','stop sign','parking meter','bench',
    'bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe',
    'backpack','umbrella','handbag','tie','suitcase','frisbee',
    'skis','snowboard','sports ball','kite','baseball bat','baseball glove',
    'skateboard','surfboard','tennis racket','bottle','wine glass','cup',
    'fork','knife','spoon','bowl','banana','apple','sandwich','orange',
    'broccoli','carrot','hot dog','pizza','donut','cake','chair','couch',
    'potted plant','bed','dining table','toilet','tv','laptop','mouse',
    'remote','keyboard','cell phone','microwave','oven','toaster','sink',
    'refrigerator','book','clock','vase','scissors','teddy bear',
    'hair drier','toothbrush',
]);
const MOVING_CLASSES = new Set(['person','bicycle','car','motorcycle','bus','truck','dog','cat','horse']);

const estimateDistance = (pctBbox) => {
    const a = pctBbox[2] * pctBbox[3];
    if (a > 900 || pctBbox[2] > 30) return 'close';
    if (a > 200 || pctBbox[2] > 12) return 'medium';
    return 'far';
};
const getDirection = (pctBbox) => {
    const cx = pctBbox[0] + pctBbox[2] / 2;
    return cx < 33 ? 'left' : cx > 67 ? 'right' : 'ahead';
};

const DIST_COLOR = { close:'#FF4B6E', medium:'#FFA94D', far:'#00D4AA' };
const DIST_METERS = { close: '0.5m', medium: '1.5m', far: '3.0m' };
const HAZARD_CFG = {
    stair:{ emoji:'🪜', label:'Stairs Ahead', color:'#FFA94D', msg:'Warning! Stairs ahead. Slow down.' },
    drop: { emoji:'⚠️', label:'Drop / Pit',   color:'#FF4B6E', msg:'Warning! Possible drop ahead. Stop!' },
    slope:{ emoji:'📐', label:'Slope',         color:'#6c63ff', msg:'Slope detected ahead.' },
};

const _spoken = {};
const canSpeak = (key, ms = 5000) => {
    const now = Date.now();
    if (!_spoken[key] || now - _spoken[key] > ms) { _spoken[key] = now; return true; }
    return false;
};

function boxOverlap(faceBox, detBox, W, H) {
    const dx = detBox[0] * W / 100, dy = detBox[1] * H / 100;
    const dw = detBox[2] * W / 100, dh = detBox[3] * H / 100;
    const xi = Math.max(faceBox.x, dx), yi = Math.max(faceBox.y, dy);
    const xe = Math.min(faceBox.x + faceBox.w, dx + dw);
    const ye = Math.min(faceBox.y + faceBox.h, dy + dh);
    const inter = Math.max(0, xe-xi) * Math.max(0, ye-yi);
    const union = faceBox.w * faceBox.h + dw * dh - inter;
    return union > 0 ? inter / union : 0;
}

// ── Simulated confidence (0–100) ─────────────────────────────────────────
const getAIConfidence = (obstacles) => {
    if (!obstacles.length) return 0;
    const avg = obstacles.reduce((s, d) => s + (d.confidence || 0.8), 0) / obstacles.length;
    return Math.round(avg * 100);
};

const getNearestMeters = (obstacles) => {
    const close = obstacles.find(d => d.distance === 'close');
    if (close) return '0.8m';
    const med = obstacles.find(d => d.distance === 'medium');
    if (med) return '1.5m';
    return '5.0m';
};

// ═══════════════════════════════════════════════════════════════════════════
const VisionAssistPage = () => {
    const navigate = useNavigate();
    const [active,      setActive]      = useState(false);
    const [obstacles,   setObstacles]   = useState([]);
    const [hazard,      setHazard]      = useState(null);
    const [alerts,      setAlerts]      = useState([]);
    const [speaking,    setSpeaking]    = useState(false);
    const [curAlert,    setCurAlert]    = useState('');
    const [faceReady,   setFaceReady]   = useState(false);
    const [faceLoading, setFaceLoading] = useState(false);
    const [knownFaces,  setKnownFaces]  = useState([]);
    const [faceResults, setFaceResults] = useState([]);
    const [showEnroll,  setShowEnroll]  = useState(false);
    const [enrollName,  setEnrollName]  = useState('');
    const [enrollMsg,   setEnrollMsg]   = useState('');
    const [showFacePanel, setShowFacePanel] = useState(false);

    const videoRef   = useRef(null);
    const streamRef  = useRef(null);
    const trackerRef = useRef(new ObstacleTracker());
    const matcherRef = useRef(null);
    const frameRef   = useRef(0);
    const speakTimer = useRef(null);

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

    const ensureFaceModels = useCallback(async () => {
        if (faceReady) return true;
        setFaceLoading(true);
        try { await loadFaceModels(); setFaceReady(true); setFaceLoading(false); return true; }
        catch (e) { console.error('[Face]', e); setFaceLoading(false); return false; }
    }, [faceReady]);

    useEffect(() => {
        const kf = loadKnownFaces();
        setKnownFaces(kf);
        if (kf.length) {
            matcherRef.current = buildMatcher(kf, 0.50);
            loadFaceModels().then(() => setFaceReady(true)).catch(() => {});
        }
    }, []);

    useEffect(() => { matcherRef.current = buildMatcher(knownFaces, 0.50); }, [knownFaces]);

    const doSpeak = useCallback((text, urgent = false) => {
        clearTimeout(speakTimer.current);
        setSpeaking(true); setCurAlert(text); cancelSpeech();
        speak(text, { priority: urgent ? 'high' : 'normal', rate: urgent ? 1.1 : 1.0 });
        speakTimer.current = setTimeout(() => setSpeaking(false), text.length * 65 + 400);
    }, []);

    const addAlert = useCallback((msg, urgent = false) => {
        setAlerts(prev => [
            { id: Date.now() + Math.random(), msg: urgent ? `⚠️ ${msg}` : msg, urgent, time: new Date().toLocaleTimeString() },
            ...prev
        ].slice(0, 15));
    }, []);

    useEffect(() => {
        let stopFn = null;
        trackerRef.current.reset();
        if (!active) {
            stopObjectDetection();
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            if (videoRef.current) videoRef.current.srcObject = null;
            setHazard(null); setFaceResults([]);
            return;
        }
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 640 } }
                });
                streamRef.current = stream;
                const vid = videoRef.current;
                if (!vid) return;
                vid.srcObject = stream;
                vid.onloadedmetadata = async () => {
                    vid.play();
                    if (knownFaces.length && !faceReady) await ensureFaceModels();
                    setTimeout(async () => {
                        stopFn = await startObjectDetection(vid, async (result) => {
                            const W = vid.videoWidth || 640;
                            const H = vid.videoHeight || 480;
                            frameRef.current++;
                            const obs = result.detections
                                .filter(d => OBSTACLE_CLASSES.has(d.label) && d.confidence > 0.35)
                                .map(d => ({ ...d, distance: estimateDistance(d.pctBbox), direction: getDirection(d.pctBbox) }));
                            const tracked = trackerRef.current.update(obs, W, H);
                            const hasPerson = tracked.some(d => d.label === 'person');
                            let enriched = tracked;
                            if (hasPerson && faceReady && matcherRef.current && frameRef.current % 5 === 0) {
                                try {
                                    const detected = await detectFaces(vid);
                                    const matched  = matchFaces(detected, matcherRef.current);
                                    setFaceResults(matched.filter(f => !f.unknown));
                                    enriched = tracked.map(d => {
                                        if (d.label !== 'person') return d;
                                        const face = matched.find(f => !f.unknown && boxOverlap(f.box, d.pctBbox, W, H) > 0.25);
                                        return face ? { ...d, knownName: face.name, faceConf: Math.round((1 - face.distance) * 100) } : d;
                                    });
                                    for (const m of matched) {
                                        if (m.unknown) continue;
                                        if (canSpeak(`face-${m.name}`, 6000)) {
                                            doSpeak(`Your friend ${m.name} is in front of you`);
                                            addAlert(`👤 ${m.name} recognised`, false);
                                        }
                                    }
                                } catch { /* transient */ }
                            }
                            setObstacles(enriched);
                            window.dispatchEvent(new CustomEvent('sb:vision', { 
                                detail: { detections: enriched.map(d => ({ label: d.knownName || d.label, confidence: d.confidence, pctBbox: d.pctBbox })) } 
                            }));
                            
                            for (const d of enriched) {
                                const label = d.knownName || d.label;
                                if (d.motion?.approaching && d.motion?.verdict) {
                                    const verdict = d.knownName
                                        ? `Warning! Your friend ${d.knownName} is approaching from ${d.motion.direction}`
                                        : `Warning! ${d.motion.verdict}`;
                                    if (canSpeak(`approach-${label}-${d.motion.direction}`, 3000)) { doSpeak(verdict, true); addAlert(verdict, true); }
                                } else if (d.distance === 'close') {
                                    const dir = d.direction === 'ahead' ? 'on your path' : `on your ${d.direction}`;
                                    if (canSpeak(`close-${label}-${d.direction}`, 5000)) { doSpeak(`${label} very close ${dir}`, true); addAlert(`${label} very close ${dir}`, true); }
                                } else if (d.distance === 'medium' && MOVING_CLASSES.has(d.label)) {
                                    if (canSpeak(`med-${label}-${d.direction}`, 7000)) { doSpeak(`${label} nearby on ${d.direction}`); addAlert(`${label} nearby on ${d.direction}`); }
                                }
                            }
                            // Hazard analysis every 30 frames with stricter confidence filter
                            if (frameRef.current % 30 === 0) {
                                const h = analyzeFrameForHazards(vid);
                                // Only accept hazards with high confidence to prevent false positives
                                const validHazard = h && h.confidence >= 0.85;
                                setHazard(validHazard ? h : null);
                                if (validHazard) {
                                    window.dispatchEvent(new CustomEvent('sb:vision', { detail: { hazard: h } }));
                                    const type = h.stair ? 'stair' : h.drop ? 'drop' : 'slope';
                                    if (canSpeak(`hazard-${type}`, 12000)) { doSpeak(HAZARD_CFG[type].msg, h.drop); addAlert(HAZARD_CFG[type].label, h.drop); }
                                }
                            }
                        });
                    }, 500);
                };
            } catch { alert('Camera access denied.'); setActive(false); }
        })();
        return () => { if (stopFn) stopFn(); stopObjectDetection(); streamRef.current?.getTracks().forEach(t => t.stop()); };
    }, [active, doSpeak, addAlert, faceReady, knownFaces.length, ensureFaceModels]);

    const captureEnroll = useCallback(async () => {
        if (!enrollName.trim()) { setEnrollMsg('Enter a name first.'); return; }
        const ok = await ensureFaceModels();
        if (!ok) { setEnrollMsg('Models failed to load.'); return; }
        const vid = videoRef.current;
        if (!vid || vid.readyState < 2) { setEnrollMsg('Start camera first.'); return; }
        setEnrollMsg('Detecting…');
        try {
            const detected = await detectFaces(vid);
            if (!detected.length)  { setEnrollMsg('⚠️ No face detected. Look at camera.'); return; }
            if (detected.length > 1) { setEnrollMsg('⚠️ Multiple faces. Be alone in frame.'); return; }
            const updated = saveKnownFace(enrollName.trim(), detected[0].descriptor);
            setKnownFaces(updated);
            setEnrollMsg(`✅ "${enrollName.trim()}" saved!`);
        } catch (e) { setEnrollMsg('Error: ' + e.message); }
    }, [enrollName, ensureFaceModels]);

    const hazardType = hazard?.stair ? 'stair' : hazard?.drop ? 'drop' : hazard?.slope ? 'slope' : null;
    const hazardCfg  = hazardType ? HAZARD_CFG[hazardType] : null;
    const uniqueNames = [...new Set(knownFaces.map(f => f.name))];
    const aiConf = getAIConfidence(obstacles);
    const nearest = getNearestMeters(obstacles);

    // The "primary nearest obstacle" label for the status bar
    const nearestLabel = obstacles.length > 0
        ? `${obstacles[0].knownName || obstacles[0].label} detected ${obstacles[0].direction === 'ahead' ? 'ahead' : `on your ${obstacles[0].direction}`}, ${DIST_METERS[obstacles[0].distance] || '?'}`
        : active ? 'No obstacles detected' : 'Press start to begin detection';

    return (
        <AppLayout noPad>
            {/* Page header */}
            <div className="page-header">
                <button className="icon-btn" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft size={20} />
                </button>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {active && <span className="live-dot" />}
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: active ? 'var(--color-accent)' : 'var(--text-muted)' }}>
                        {active ? 'LIVE' : 'VISION ASSIST'}
                    </span>
                </div>
                <button
                    className="icon-btn"
                    onClick={() => { cancelSpeech(); }}
                    style={{ background: 'rgba(0,212,170,0.15)', borderColor: 'var(--color-accent)' }}
                >
                    <Volume2 size={18} style={{ color: 'var(--color-accent)' }} />
                </button>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', padding: '0.5rem 1rem 0.75rem' }}>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>DETECTED</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{obstacles.length}</div>
                </div>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>NEAREST</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#FFA94D' }}>{obstacles.length ? nearest : '—'}</div>
                </div>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 10, padding: '0.6rem 0.75rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
                        ⚡ AI CONFIDENCE
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: active ? '#FF4B6E' : 'var(--text-muted)' }}>
                        {active ? `${aiConf || '--'}%` : '--'}
                    </div>
                    {active && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,75,110,0.08)', pointerEvents: 'none' }} />}
                </div>
            </div>

            {/* Radar / Camera canvas */}
            <div style={{ flex: 1, position: 'relative', margin: '0 1rem', overflow: 'hidden' }}>
                <div className="radar-canvas" style={{ width: '100%', height: '100%', minHeight: 280 }}>
                    {active ? (
                        <>
                            <video
                                ref={videoRef}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }}
                                muted playsInline
                            />
                            {/* Bounding boxes */}
                            {obstacles.map((d, i) => {
                                const isApproach = d.motion?.approaching;
                                const color = d.knownName ? '#00D4AA' : (isApproach ? '#FF4B6E' : DIST_COLOR[d.distance]);
                                const distM = DIST_METERS[d.distance] || '?';
                                return (
                                    <div key={i} style={{
                                        position: 'absolute',
                                        border: `2px solid ${color}`,
                                        borderRadius: 4,
                                        top: `${d.pctBbox[1]}%`, left: `${d.pctBbox[0]}%`,
                                        width: `${d.pctBbox[2]}%`, height: `${d.pctBbox[3]}%`,
                                        boxShadow: `0 0 10px ${color}55`,
                                    }}>
                                        <span style={{
                                            position: 'absolute', top: -22, left: -1,
                                            background: color, color: '#000',
                                            fontSize: '0.62rem', fontWeight: 700,
                                            padding: '2px 7px', borderRadius: '6px 6px 6px 0',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {d.knownName || d.label} · {distM}
                                        </span>
                                    </div>
                                );
                            })}
                            {/* Hazard overlay */}
                            {hazardCfg && (
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%',
                                    background: `linear-gradient(to top, ${hazardCfg.color}44, transparent)`,
                                    borderTop: `2px dashed ${hazardCfg.color}88`,
                                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8,
                                }}>
                                    <span style={{
                                        color: hazardCfg.color, fontWeight: 700, fontSize: '0.78rem',
                                        background: 'rgba(0,0,0,0.7)', padding: '2px 10px', borderRadius: 6,
                                    }}>
                                        {hazardCfg.emoji} {hazardCfg.label}
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted)',
                        }}>
                            <Eye size={52} style={{ opacity: 0.15, marginBottom: 10 }} />
                            <div style={{ fontSize: '0.82rem' }}>Tap Start to activate camera</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Status strip */}
            <div style={{
                margin: '0.6rem 1rem 0',
                background: 'var(--bg-card)',
                borderRadius: 12,
                padding: '0.65rem 1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Volume2 size={14} style={{ color: speaking ? 'var(--color-accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{nearestLabel}</span>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                    {[1,2,3,4].map(i => (
                        <div key={i} style={{
                            width: 3, borderRadius: 3,
                            height: speaking ? `${8 + i * 4}px` : '6px',
                            background: speaking ? 'var(--color-accent)' : 'var(--text-muted)',
                            opacity: speaking ? 0.9 : 0.3,
                            transition: 'all 0.15s',
                        }} />
                    ))}
                </div>
            </div>

            {/* Face Recognition (collapsible) */}
            <div style={{ margin: '0.6rem 1rem 0', background: 'var(--bg-card)', borderRadius: 14, padding: '0.75rem 1rem', border: `1px solid ${faceResults.length ? 'var(--color-accent)' : 'var(--border-card)'}` }}>
                <button onClick={() => setShowFacePanel(f => !f)} style={{ display: 'flex', width: '100%', background: 'none', border: 'none', cursor: 'pointer', alignItems: 'center', gap: 6, padding: 0, color: 'var(--text-primary)' }}>
                    <UserCheck size={14} style={{ color: 'var(--color-primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.8rem', flex: 1, textAlign: 'left' }}>
                        Face Recognition {faceLoading && <Loader size={11} style={{ marginLeft: 6, animation: 'spin 1s linear infinite', display: 'inline-block' }} />}
                    </span>
                    {uniqueNames.length > 0 && <span style={{ background: 'var(--color-primary)', color: '#fff', padding: '1px 7px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700 }}>{uniqueNames.length}</span>}
                    {showFacePanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showFacePanel && (
                    <div style={{ marginTop: 10 }}>
                        {faceResults.length > 0 && (
                            <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(0,212,170,0.1)', borderRadius: 8, borderLeft: '3px solid var(--color-accent)', fontSize: '0.78rem' }}>
                                {faceResults.map((f, i) => <div key={i}>👤 <strong>{f.name}</strong> — {Math.round((1 - f.distance) * 100)}% match</div>)}
                            </div>
                        )}
                        {uniqueNames.length === 0
                            ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>No faces enrolled yet.</div>
                            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                                {uniqueNames.map(name => (
                                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card2)', borderRadius: 6, padding: '3px 8px', fontSize: '0.75rem' }}>
                                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: `hsl(${name.charCodeAt(0) * 7 % 360},55%,45%)`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.65rem', flexShrink: 0 }}>{name[0].toUpperCase()}</span>
                                        {name}
                                        <button onClick={() => setKnownFaces(deleteKnownFace(name))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 0 0 2px', lineHeight: 1 }}>
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        }
                        <button onClick={() => setShowEnroll(e => !e)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.76rem', gap: 5, borderRadius: 7, width: '100%', justifyContent: 'center' }}>
                            <UserPlus size={12} /> {showEnroll ? 'Cancel' : 'Add a person'}
                        </button>
                        {showEnroll && (
                            <div style={{ marginTop: 8 }}>
                                <input className="form-input" placeholder="Person's name" value={enrollName} onChange={e => { setEnrollName(e.target.value); setEnrollMsg(''); }} style={{ width: '100%', fontSize: '0.8rem', marginBottom: 6 }} />
                                <button onClick={captureEnroll} className="btn btn-primary" disabled={!active} style={{ width: '100%', fontSize: '0.8rem', gap: 6, justifyContent: 'center' }}>
                                    <Camera size={13} /> Capture from camera
                                </button>
                                {enrollMsg && <div style={{ marginTop: 6, fontSize: '0.74rem', color: enrollMsg.startsWith('✅') ? 'var(--color-accent)' : 'var(--color-warning)' }}>{enrollMsg}</div>}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Start/Stop button */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 1rem 0.5rem' }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 20, padding: '0.875rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 180 }}>
                    <button
                        className="fab-stop"
                        onClick={() => setActive(a => !a)}
                        style={{ background: active ? '#FF4B6E' : 'var(--color-accent)', boxShadow: active ? '0 0 0 8px rgba(255,75,110,0.2)' : '0 0 0 8px rgba(0,212,170,0.2)' }}
                    >
                        {active
                            ? <Square size={22} color="#fff" fill="#fff" />
                            : <Eye size={24} color="#000" />
                        }
                    </button>
                </div>
            </div>
        </AppLayout>
    );
};

export default VisionAssistPage;
