/**
 * VisionAssistPage.jsx — SenseBridge Vision Assist (with Face Recognition)
 *
 * Object Detection  : COCO-SSD mobilenet_v2 (obstacle-filtered)
 * Motion Prediction : ObstacleTracker — "person approaching from right"
 * Face Recognition  : face-api SSD MobileNet — "Your friend Rahul is ahead"
 *                     Runs every 5 detection frames when persons are in frame.
 *                     Replaces generic "person" label with known name on bbox.
 * Hazard Detection  : pixel-level stair / drop / slope analysis
 */
import { useState, useEffect, useRef, useCallback } from 'react';
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
    Eye, Volume2, AlertTriangle, Play, Square, Navigation, Zap,
    UserCheck, UserPlus, Camera, Trash2, ChevronDown, ChevronUp, Loader,
} from 'lucide-react';

// ── Walking obstacle classes ───────────────────────────────────────────────
const OBSTACLE_CLASSES = new Set([
    'person','bicycle','car','motorcycle','bus','truck','dog','cat','horse','cow',
    'chair','couch','dining table','bench','bed','potted plant','fire hydrant',
    'stop sign','traffic light','parking meter','suitcase','backpack',
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
const DIST_LABEL = { close:'Close!', medium:'Nearby', far:'Far' };
const HAZARD_CFG = {
    stair:{ emoji:'🪜', label:'Stairs Ahead', color:'#FFA94D', msg:'Warning! Stairs ahead. Slow down.' },
    drop: { emoji:'⚠️', label:'Drop / Pit',   color:'#FF4B6E', msg:'Warning! Possible drop ahead. Stop!' },
    slope:{ emoji:'📐', label:'Slope',         color:'#6c63ff', msg:'Slope detected ahead.' },
};

// ── Per-key TTS throttle ──────────────────────────────────────────────────
const _spoken = {};
const canSpeak = (key, ms = 5000) => {
    const now = Date.now();
    if (!_spoken[key] || now - _spoken[key] > ms) { _spoken[key] = now; return true; }
    return false;
};

// ── Spatial overlap helper (face box ↔ person bbox) ───────────────────────
function boxOverlap(faceBox, detBox, W, H) {
    // faceBox is in px relative to full video; detBox is pctBbox [x%,y%,w%,h%]
    const dx = detBox[0] * W / 100, dy = detBox[1] * H / 100;
    const dw = detBox[2] * W / 100, dh = detBox[3] * H / 100;
    const xi = Math.max(faceBox.x, dx), yi = Math.max(faceBox.y, dy);
    const xe = Math.min(faceBox.x + faceBox.w, dx + dw);
    const ye = Math.min(faceBox.y + faceBox.h, dy + dh);
    const inter = Math.max(0, xe-xi) * Math.max(0, ye-yi);
    const union = faceBox.w * faceBox.h + dw * dh - inter;
    return union > 0 ? inter / union : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const VisionAssistPage = () => {
    // Detection state
    const [active,      setActive]      = useState(false);
    const [obstacles,   setObstacles]   = useState([]);
    const [hazard,      setHazard]      = useState(null);
    const [alerts,      setAlerts]      = useState([]);
    const [speaking,    setSpeaking]    = useState(false);
    const [curAlert,    setCurAlert]    = useState('');

    // Face recognition state
    const [faceReady,   setFaceReady]   = useState(false);
    const [faceLoading, setFaceLoading] = useState(false);
    const [knownFaces,  setKnownFaces]  = useState([]);
    const [faceResults, setFaceResults] = useState([]);   // last recognised faces
    const [showEnroll,  setShowEnroll]  = useState(false);
    const [enrollName,  setEnrollName]  = useState('');
    const [enrollMsg,   setEnrollMsg]   = useState('');
    const [showFacePanel, setShowFacePanel] = useState(false);

    const videoRef    = useRef(null);
    const streamRef   = useRef(null);
    const trackerRef  = useRef(new ObstacleTracker());
    const matcherRef  = useRef(null);
    const frameRef    = useRef(0);
    const speakTimer  = useRef(null);

    // ── Voice command support (vc:start / vc:stop from VoiceCommandContext) ──
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

    // ── Load face models (lazy — only when panel is opened or cam starts) ──
    const ensureFaceModels = useCallback(async () => {
        if (faceReady) return true;
        setFaceLoading(true);
        try {
            await loadFaceModels();
            setFaceReady(true);
            setFaceLoading(false);
            return true;
        } catch (e) {
            console.error('[Face] Model load failed:', e);
            setFaceLoading(false);
            return false;
        }
    }, [faceReady]);

    // ── Load known faces on mount ──────────────────────────────────────────
    useEffect(() => {
        const kf = loadKnownFaces();
        setKnownFaces(kf);
        if (kf.length) {
            matcherRef.current = buildMatcher(kf, 0.50);
            // Lazily load models if there are enrolled faces
            loadFaceModels()
                .then(() => setFaceReady(true))
                .catch(() => {});
        }
    }, []);

    // Rebuild matcher when known faces change
    useEffect(() => {
        matcherRef.current = buildMatcher(knownFaces, 0.50);
    }, [knownFaces]);

    // ── TTS helper ────────────────────────────────────────────────────────
    const doSpeak = useCallback((text, urgent = false) => {
        clearTimeout(speakTimer.current);
        setSpeaking(true);
        setCurAlert(text);
        cancelSpeech();
        speak(text, { priority: urgent ? 'high' : 'normal', rate: urgent ? 1.1 : 1.0 });
        speakTimer.current = setTimeout(() => setSpeaking(false), text.length * 65 + 400);
    }, []);

    const addAlert = useCallback((msg, urgent = false) => {
        setAlerts(prev => [
            { id: Date.now() + Math.random(), msg: urgent ? `⚠️ ${msg}` : msg, urgent, time: new Date().toLocaleTimeString() },
            ...prev
        ].slice(0, 15));
    }, []);

    // ── Camera + detection loop ───────────────────────────────────────────
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

                    // Start face models if there are known people
                    if (knownFaces.length && !faceReady) await ensureFaceModels();

                    setTimeout(async () => {
                        stopFn = await startObjectDetection(vid, async (result) => {
                            const W = vid.videoWidth  || 640;
                            const H = vid.videoHeight || 480;
                            frameRef.current++;

                            // ── 1. Filter + enrich with distance/direction ─
                            const obs = result.detections
                                .filter(d => OBSTACLE_CLASSES.has(d.label) && d.confidence > 0.48)
                                .map(d => ({
                                    ...d,
                                    distance:  estimateDistance(d.pctBbox),
                                    direction: getDirection(d.pctBbox),
                                }));

                            // ── 2. Motion tracker ──────────────────────────
                            const tracked = trackerRef.current.update(obs, W, H);

                            // ── 3. Face recognition (every 5 frames, only when persons present) ─
                            const hasPerson = tracked.some(d => d.label === 'person');
                            let enriched = tracked;

                            if (hasPerson && faceReady && matcherRef.current && frameRef.current % 5 === 0) {
                                try {
                                    const detected = await detectFaces(vid);
                                    const matched  = matchFaces(detected, matcherRef.current);
                                    setFaceResults(matched.filter(f => !f.unknown));

                                    // Map each known-face result onto the closest person bbox
                                    enriched = tracked.map(d => {
                                        if (d.label !== 'person') return d;
                                        const face = matched.find(
                                            f => !f.unknown && boxOverlap(f.box, d.pctBbox, W, H) > 0.25
                                        );
                                        return face ? { ...d, knownName: face.name, faceConf: Math.round((1 - face.distance) * 100) } : d;
                                    });

                                    // Announce known faces
                                    for (const m of matched) {
                                        if (m.unknown) continue;
                                        if (canSpeak(`face-${m.name}`, 6000)) {
                                            const msg = `Your friend ${m.name} is in front of you`;
                                            doSpeak(msg);
                                            addAlert(`👤 ${m.name} recognised`, false);
                                        }
                                    }
                                } catch { /* transient */ }
                            }

                            setObstacles(enriched);

                            // ── 4. TTS for obstacles ──────────────────────
                            for (const d of enriched) {
                                const label = d.knownName || d.label;
                                if (d.motion?.approaching && d.motion?.verdict) {
                                    const verdict = d.knownName
                                        ? `Warning! Your friend ${d.knownName} is approaching from ${d.motion.direction}`
                                        : `Warning! ${d.motion.verdict}`;
                                    if (canSpeak(`approach-${label}-${d.motion.direction}`, 3000)) {
                                        doSpeak(verdict, true); addAlert(verdict, true);
                                    }
                                } else if (d.distance === 'close') {
                                    const dir = d.direction === 'ahead' ? 'on your path' : `on your ${d.direction}`;
                                    if (canSpeak(`close-${label}-${d.direction}`, 5000)) {
                                        doSpeak(`${label} very close ${dir}`, true);
                                        addAlert(`${label} very close ${dir}`, true);
                                    }
                                } else if (d.distance === 'medium' && MOVING_CLASSES.has(d.label)) {
                                    if (canSpeak(`med-${label}-${d.direction}`, 7000)) {
                                        doSpeak(`${label} nearby on ${d.direction}`);
                                        addAlert(`${label} nearby on ${d.direction}`);
                                    }
                                }
                            }

                            // ── 5. Hazard detection (every 10 frames) ─────
                            if (frameRef.current % 10 === 0) {
                                const h = analyzeFrameForHazards(vid);
                                setHazard(h);
                                if (h) {
                                    const type = h.stair ? 'stair' : h.drop ? 'drop' : 'slope';
                                    if (canSpeak(`hazard-${type}`, 8000)) {
                                        doSpeak(HAZARD_CFG[type].msg, h.drop);
                                        addAlert(HAZARD_CFG[type].label, h.drop);
                                    }
                                }
                            }
                        });
                    }, 500);
                };
            } catch {
                alert('Camera access denied.');
                setActive(false);
            }
        })();

        return () => {
            if (stopFn) stopFn();
            stopObjectDetection();
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, [active, doSpeak, addAlert, faceReady, knownFaces.length, ensureFaceModels]);

    // ── Enroll a face ─────────────────────────────────────────────────────
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
            setEnrollMsg(`✅ "${enrollName.trim()}" saved! Add more angles for accuracy.`);
        } catch (e) { setEnrollMsg('Error: ' + e.message); }
    }, [enrollName, ensureFaceModels]);

    // ── Derived values ────────────────────────────────────────────────────
    const hazardType = hazard?.stair ? 'stair' : hazard?.drop ? 'drop' : hazard?.slope ? 'slope' : null;
    const hazardCfg  = hazardType ? HAZARD_CFG[hazardType] : null;
    const approaching = obstacles.filter(d => d.motion?.approaching);
    const uniqueNames = [...new Set(knownFaces.map(f => f.name))];

    return (
        <AppLayout>
            <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
                {/* Header */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div>
                        <h1 style={{ fontSize:'1.5rem', fontWeight:800, display:'flex', alignItems:'center', gap:10 }}>
                            <Eye size={24} style={{ color:'var(--color-primary)' }} /> Vision Assist
                        </h1>
                        <p style={{ color:'var(--text-muted)', fontSize:'0.875rem' }}>
                            Obstacle detection · motion prediction · face recognition · stair & drop detection
                        </p>
                    </div>
                    <button onClick={() => setActive(a => !a)} className={`btn ${active ? 'btn-danger' : 'btn-primary'}`}>
                        {active ? <><Square size={16}/> Stop</> : <><Play size={16}/> Start</>}
                    </button>
                </div>

                {/* Hazard banner */}
                {active && hazardCfg && (
                    <div style={{ padding:'0.75rem 1.25rem', borderRadius:12, display:'flex', alignItems:'center', gap:12,
                        background:`${hazardCfg.color}18`, border:`2px solid ${hazardCfg.color}` }}>
                        <span style={{ fontSize:'1.5rem' }}>{hazardCfg.emoji}</span>
                        <div>
                            <div style={{ fontWeight:800, color:hazardCfg.color }}>{hazardCfg.label.toUpperCase()}</div>
                            <div style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{hazardCfg.msg}</div>
                        </div>
                    </div>
                )}

                {/* Approaching banner */}
                {active && approaching.length > 0 && (
                    <div style={{ padding:'0.75rem 1.25rem', borderRadius:12, display:'flex', alignItems:'center', gap:12,
                        background:'rgba(255,75,110,0.1)', border:'2px solid rgba(255,75,110,0.7)' }}>
                        <Zap size={20} style={{ color:'#FF4B6E', flexShrink:0 }}/>
                        <div>
                            <div style={{ fontWeight:700, color:'#FF4B6E', fontSize:'0.9rem' }}>APPROACHING OBSTACLE{approaching.length>1?'S':''}</div>
                            {approaching.map((d,i) => <div key={i} style={{ fontSize:'0.83rem', color:'var(--text-muted)' }}>{d.motion.verdict}</div>)}
                        </div>
                    </div>
                )}

                <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:'1.25rem' }}>
                    {/* Camera */}
                    <div className="card" style={{ aspectRatio:'16/9', position:'relative', background:'#0a0a1a', overflow:'hidden', padding:0 }}>
                        {active ? (
                            <>
                                <video ref={videoRef} style={{ width:'100%', height:'100%', objectFit:'cover' }} muted playsInline/>
                                <span style={{ position:'absolute', top:10, left:10, background:'rgba(255,75,110,0.9)', color:'#fff', padding:'2px 10px', borderRadius:6, fontSize:'0.73rem', fontWeight:700, zIndex:10 }}>● LIVE</span>

                                {/* Bounding boxes */}
                                {obstacles.map((d,i) => {
                                    const isApproach = d.motion?.approaching;
                                    const color = d.knownName ? '#00D4AA' : (isApproach ? '#FF4B6E' : DIST_COLOR[d.distance]);
                                    return (
                                        <div key={i} style={{
                                            position:'absolute', border:`2px solid ${color}`, borderRadius:4,
                                            top:`${d.pctBbox[1]}%`, left:`${d.pctBbox[0]}%`,
                                            width:`${d.pctBbox[2]}%`, height:`${d.pctBbox[3]}%`,
                                            boxShadow:(isApproach || d.knownName || d.distance==='close') ? `0 0 14px ${color}66` : 'none',
                                        }}>
                                            <span style={{
                                                display:'block', padding:'1px 6px', fontSize:'0.68rem', fontWeight:700,
                                                background:color, color:'#000', borderRadius:'0 0 4px 0',
                                                whiteSpace:'nowrap',
                                            }}>
                                                {d.knownName ? `👤 ${d.knownName} (${d.faceConf}%)` : d.label}
                                                {' '}{DIST_LABEL[d.distance]}
                                                {' '}{d.direction==='ahead'?'⬆':d.direction==='left'?'⬅':'➡'}
                                                {isApproach ? ' ⚡' : d.motion?.passing ? ' →' : ''}
                                            </span>
                                        </div>
                                    );
                                })}

                                {/* Hazard overlay on lower frame */}
                                {hazardCfg && (
                                    <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'38%',
                                        background:`linear-gradient(to top, ${hazardCfg.color}33, transparent)`,
                                        borderTop:`2px dashed ${hazardCfg.color}88`,
                                        display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:6 }}>
                                        <span style={{ color:hazardCfg.color, fontWeight:700, fontSize:'0.8rem', background:'rgba(0,0,0,0.7)', padding:'2px 10px', borderRadius:6 }}>
                                            {hazardCfg.emoji} {hazardCfg.label}
                                        </span>
                                    </div>
                                )}

                                {/* Audio subtitle */}
                                {speaking && curAlert && (
                                    <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,0.82)', color:'#fff',
                                        padding:'8px 14px', fontSize:'0.84rem', fontWeight:500, borderTop:'2px solid var(--color-warning)',
                                        display:'flex', alignItems:'center', gap:8 }}>
                                        <Volume2 size={14} style={{ color:'var(--color-warning)', flexShrink:0 }}/>{curAlert}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--text-muted)' }}>
                                <Eye size={48} style={{ opacity:0.3, marginBottom:8 }}/><div style={{ fontSize:'0.875rem' }}>Press Start</div>
                            </div>
                        )}
                    </div>

                    {/* Right column */}
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                        {/* Audio status */}
                        <div className="card" style={{ borderColor: speaking ? 'var(--color-warning)' : undefined }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                                <Volume2 size={14} style={{ color: speaking ? 'var(--color-warning)' : 'var(--text-muted)' }}/>
                                <span style={{ fontWeight:600, fontSize:'0.82rem' }}>Audio Output</span>
                                {speaking && <span style={{ marginLeft:'auto', width:7, height:7, borderRadius:'50%', background:'var(--color-warning)', display:'inline-block' }}/>}
                            </div>
                            <div style={{ fontSize:'0.79rem', color: speaking ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: speaking ? 'normal' : 'italic' }}>
                                {speaking ? `🔊 ${curAlert}` : '🔇 Monitoring…'}
                            </div>
                        </div>

                        {/* Detected obstacles */}
                        <div className="card">
                            <div style={{ fontWeight:600, fontSize:'0.8rem', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                                <Navigation size={13} style={{ color:'var(--color-primary)' }}/> Obstacles
                            </div>
                            {obstacles.length === 0
                                ? <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{active ? '✅ Path clear' : 'Start to detect'}</div>
                                : <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                                    {obstacles.slice(0,8).map((d,i) => (
                                        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                                            padding:'4px 9px', background:'var(--bg-base)', borderRadius:7,
                                            borderLeft:`3px solid ${d.knownName ? '#00D4AA' : (d.motion?.approaching ? '#FF4B6E' : DIST_COLOR[d.distance])}` }}>
                                            <span style={{ fontWeight:600, fontSize:'0.8rem' }}>
                                                {d.knownName ? `👤 ${d.knownName}` : d.label}
                                                <span style={{ fontWeight:400, color:'var(--text-muted)', marginLeft:4, fontSize:'0.7rem' }}>
                                                    {d.direction==='ahead'?'⬆':d.direction==='left'?'⬅':'➡'}
                                                    {d.motion?.approaching ? ' ⚡' : ''}
                                                </span>
                                            </span>
                                            <span style={{ fontSize:'0.7rem', fontWeight:700, color: d.knownName ? '#00D4AA' : (d.motion?.approaching ? '#FF4B6E' : DIST_COLOR[d.distance]) }}>
                                                {DIST_LABEL[d.distance]}
                                            </span>
                                        </div>
                                    ))}
                                  </div>
                            }
                        </div>

                        {/* ── Face Recognition Panel ────────────────────── */}
                        <div className="card" style={{ borderColor: faceResults.length ? 'var(--color-accent)' : undefined }}>
                            <button
                                onClick={() => setShowFacePanel(f => !f)}
                                style={{ display:'flex', width:'100%', background:'none', border:'none', cursor:'pointer', alignItems:'center', gap:6, padding:0, color:'var(--text-primary)' }}
                            >
                                <UserCheck size={13} style={{ color:'var(--color-primary)' }}/>
                                <span style={{ fontWeight:600, fontSize:'0.8rem', flex:1, textAlign:'left' }}>
                                    Face Recognition
                                    {faceLoading && <Loader size={11} style={{ marginLeft:6, animation:'spin 1s linear infinite', display:'inline-block' }}/>}
                                </span>
                                {uniqueNames.length > 0 && (
                                    <span style={{ background:'var(--color-primary)', color:'#fff', padding:'1px 7px', borderRadius:8, fontSize:'0.7rem', fontWeight:700 }}>
                                        {uniqueNames.length}
                                    </span>
                                )}
                                {showFacePanel ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                            </button>

                            {showFacePanel && (
                                <div style={{ marginTop:10 }}>
                                    {/* Currently recognised */}
                                    {faceResults.length > 0 && (
                                        <div style={{ marginBottom:8, padding:'6px 10px', background:'rgba(0,212,170,0.1)', borderRadius:8, borderLeft:'3px solid var(--color-accent)', fontSize:'0.78rem' }}>
                                            {faceResults.map((f,i) => <div key={i}>👤 <strong>{f.name}</strong> — {Math.round((1-f.distance)*100)}% match</div>)}
                                        </div>
                                    )}

                                    {/* Known people list */}
                                    {uniqueNames.length === 0 ? (
                                        <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:8 }}>No faces enrolled yet.</div>
                                    ) : (
                                        <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
                                            {uniqueNames.map(name => (
                                                <div key={name} style={{ display:'flex', alignItems:'center', gap:4, background:'var(--bg-base)', borderRadius:6, padding:'3px 8px', fontSize:'0.75rem' }}>
                                                    <span style={{ width:18, height:18, borderRadius:'50%', background:`hsl(${name.charCodeAt(0)*7%360},55%,45%)`, display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:'0.65rem', flexShrink:0 }}>{name[0].toUpperCase()}</span>
                                                    {name}
                                                    <button onClick={() => setKnownFaces(deleteKnownFace(name))} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:'0 0 0 2px', lineHeight:1 }}>
                                                        <Trash2 size={10}/>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Enroll section */}
                                    <button onClick={() => setShowEnroll(e => !e)} className="btn btn-ghost" style={{ padding:'4px 10px', fontSize:'0.76rem', gap:5, borderRadius:7, width:'100%', justifyContent:'center' }}>
                                        <UserPlus size={12}/> {showEnroll ? 'Cancel' : 'Add a person'}
                                    </button>

                                    {showEnroll && (
                                        <div style={{ marginTop:8 }}>
                                            <input
                                                className="form-input"
                                                placeholder="Person's name (e.g. Rahul)"
                                                value={enrollName}
                                                onChange={e => { setEnrollName(e.target.value); setEnrollMsg(''); }}
                                                style={{ width:'100%', fontSize:'0.8rem', marginBottom:6 }}
                                            />
                                            <button
                                                onClick={captureEnroll}
                                                className="btn btn-primary"
                                                disabled={!active}
                                                style={{ width:'100%', fontSize:'0.8rem', gap:6, justifyContent:'center' }}
                                            >
                                                <Camera size={13}/> Capture from camera
                                            </button>
                                            {enrollMsg && (
                                                <div style={{ marginTop:6, fontSize:'0.74rem', color: enrollMsg.startsWith('✅') ? 'var(--color-accent)' : 'var(--color-warning)' }}>
                                                    {enrollMsg}
                                                </div>
                                            )}
                                            <div style={{ marginTop:4, fontSize:'0.7rem', color:'var(--text-muted)' }}>
                                                💡 3–5 photos from different angles for best accuracy.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Hazard status */}
                        <div className="card" style={{ borderColor: hazardCfg?.color }}>
                            <div style={{ fontWeight:600, fontSize:'0.8rem', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                                <AlertTriangle size={13} style={{ color:'var(--color-danger)' }}/> Surface Hazards
                            </div>
                            {hazardCfg
                                ? <div style={{ fontSize:'0.82rem', color: hazardCfg.color, fontWeight:600 }}>{hazardCfg.emoji} {hazardCfg.label}</div>
                                : <div style={{ fontSize:'0.78rem', color: active ? 'var(--color-accent)' : 'var(--text-muted)' }}>{active ? '✅ No hazards' : 'Start to detect'}</div>
                            }
                        </div>
                    </div>
                </div>

                {/* Alert log */}
                <div className="card">
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                        <AlertTriangle size={15} style={{ color:'var(--color-warning)' }}/>
                        <span style={{ fontWeight:600, fontSize:'0.875rem' }}>Alert History</span>
                        {alerts.length > 0 && <button onClick={() => setAlerts([])} style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.75rem' }}>Clear</button>}
                    </div>
                    {alerts.length === 0
                        ? <div style={{ color:'var(--text-muted)', fontSize:'0.875rem' }}>No alerts yet</div>
                        : <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                            {alerts.map(a => (
                                <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 12px', borderRadius:8,
                                    background: a.urgent ? 'rgba(255,75,110,0.08)' : 'rgba(255,169,77,0.06)',
                                    border:`1px solid ${a.urgent ? 'rgba(255,75,110,0.3)' : 'rgba(255,169,77,0.2)'}` }}>
                                    <span style={{ fontSize:'0.845rem' }}>{a.msg}</span>
                                    <span style={{ fontSize:'0.73rem', color:'var(--text-muted)', flexShrink:0, marginLeft:8 }}>{a.time}</span>
                                </div>
                            ))}
                          </div>
                    }
                </div>
            </div>
        </AppLayout>
    );
};

export default VisionAssistPage;
