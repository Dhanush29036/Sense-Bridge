/**
 * MultimodalPage.jsx — "Multimodal Mode"
 * ════════════════════════════════════════
 * Combines vision, text, speech, and gesture into one unified view.
 * Matches reference design: live camera feed + AI details sidebar.
 *
 * Architecture:
 *   - Uses the MultimodalFusionContext to show the fused awareness result
 *   - Pulls live signals from the fusion event bus (sb:vision, sb:speech, sb:gesture)
 *   - Shows per-modality confidence breakdown in the AI Details panel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { useFusion, EV_FUSION } from '../context/MultimodalFusionContext';
import { speak, cancelSpeech } from '../services/aiService';
import { getAIBaseURL } from '../services/networkConfig';
import { useLocation } from 'react-router-dom';
import {
    Eye, Mic, Hand, ScanText, Layers,
    Volume2, Square, Play, RefreshCw, ChevronRight
} from 'lucide-react';
import haptics from '../services/haptics';

/* ── Modality display config ─────────────────────────────────────────────── */
const MODALITIES = [
    {
        key: 'vision',
        label: 'Object Detection',
        Icon: Eye,
        chipClass: 'icon-chip-blue',
        color: 'var(--blue)',
        badgeClass: 'pill-blue',
    },
    {
        key: 'ocr',
        label: 'OCR',
        Icon: ScanText,
        chipClass: 'icon-chip-green',
        color: 'var(--green)',
        badgeClass: 'pill-green',
    },
    {
        key: 'speech',
        label: 'Speech',
        Icon: Mic,
        chipClass: 'icon-chip-purple',
        color: 'var(--purple)',
        badgeClass: 'pill-purple',
    },
    {
        key: 'gesture',
        label: 'Gesture',
        Icon: Hand,
        chipClass: 'icon-chip-orange',
        color: 'var(--orange)',
        badgeClass: 'pill-orange',
    },
];

const MultimodalPage = () => {
    const { awareness, fusionBusy, emitVision, emitSpeech, emitGesture } = useFusion();
    const location = useLocation();

    const [running, setRunning]         = useState(false);
    const [camError, setCamError]       = useState(null);
    const [detections, setDetections]   = useState([]);   // latest vision detections
    const [speechText, setSpeechText]   = useState('');
    const [gestureSigns, setGestureSigns] = useState([]);
    const [activeTab, setActiveTab]     = useState('detections'); // 'detections' | 'system'

    const runningRef = useRef(false);
    const videoRef   = useRef(null);
    const canvasRef  = useRef(null);
    const streamRef  = useRef(null);
    const detLoopRef = useRef(null);
    const recognitionRef = useRef(null);

    /* ── Camera start/stop ──────────────────────────────────────────────── */
    const startCamera = useCallback(async () => {
        try {
            // Use mobile-friendly resolution (640x480) for fluid 60fps rendering without overheating
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30, max: 30 }
                }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (err) {
            setCamError('Camera access denied. Please allow camera permission.');
        }
    }, []);

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
    }, []);

    /* ── Object detection polling (lightweight offscreen frame processing) ── */
    const isDetectingRef = useRef(false);

    const runDetectionLoop = useCallback(async () => {
        if (!runningRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (isDetectingRef.current) return;

        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (video.readyState < 2 || video.paused || video.ended) {
            if (runningRef.current) {
                detLoopRef.current = setTimeout(runDetectionLoop, 300);
            }
            return;
        }

        isDetectingRef.current = true;

        try {
            // Fast downscaled offscreen canvas for network transmission (400x300)
            const off = document.createElement('canvas');
            off.width = 400;
            off.height = 300;
            const offCtx = off.getContext('2d');
            offCtx.drawImage(video, 0, 0, 400, 300);

            const blob = await new Promise(res => off.toBlob(res, 'image/jpeg', 0.65));
            if (!blob) {
                isDetectingRef.current = false;
                return;
            }

            const fd = new FormData();
            fd.append('image', blob, 'frame.jpg');

            const aiBase = getAIBaseURL();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2800);

            const res = await fetch(`${aiBase}/api/detect`, {
                method: 'POST',
                body: fd,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const dets = data.detections || [];
                setDetections(dets);

                // Transparent canvas overlay: clear previous boxes without redrawing video
                canvas.width  = video.videoWidth  || 640;
                canvas.height = video.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const scaleX = canvas.width / 400;
                const scaleY = canvas.height / 300;

                dets.forEach(d => {
                    const [rawX, rawY, rawW, rawH] = d.bbox || [];
                    if (rawX == null) return;
                    const x = rawX * scaleX;
                    const y = rawY * scaleY;
                    const w = rawW * scaleX;
                    const h = rawH * scaleY;

                    const conf = Math.round((d.confidence || 0) * 100);
                    ctx.strokeStyle = '#3B7BF8';
                    ctx.lineWidth   = 2.5;
                    ctx.strokeRect(x, y, w, h);
                    ctx.fillStyle = 'rgba(59,123,248,0.85)';
                    const labelW = (d.label?.length || 4) * 8 + conf.toString().length * 7 + 12;
                    ctx.fillRect(x, Math.max(0, y - 22), labelW, 22);
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 12px Inter, sans-serif';
                    ctx.fillText(`${d.label} ${conf}%`, x + 5, Math.max(14, y - 6));
                });

                // Emit to fusion engine
                emitVision({ detections: dets, frame_id: Date.now() });
            }
        } catch {
            // Transient network frame skip
        } finally {
            isDetectingRef.current = false;
            if (runningRef.current) {
                detLoopRef.current = setTimeout(runDetectionLoop, 1200);
            }
        }
    }, [emitVision]);

    /* ── Speech recognition ──────────────────────────────────────────────── */
    const startSpeech = useCallback(() => {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const r  = new SR();
        r.continuous     = true;
        r.interimResults = true;
        r.onresult = (e) => {
            const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
            setSpeechText(transcript);
            emitSpeech({ text: transcript, confidence: e.results[e.results.length - 1][0].confidence });
        };
        r.start();
        recognitionRef.current = r;
    }, [emitSpeech]);

    const stopSpeech = useCallback(() => {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
    }, []);

    /* ── Start / Stop all ────────────────────────────────────────────────── */
    const handleStart = useCallback(async () => {
        haptics.tap();
        runningRef.current = true;
        setRunning(true);
        setCamError(null);
        setDetections([]);
        setSpeechText('');
        await startCamera();
        startSpeech();
        detLoopRef.current = setTimeout(runDetectionLoop, 800);
    }, [startCamera, startSpeech, runDetectionLoop]);

    const handleStop = useCallback(() => {
        haptics.tap();
        runningRef.current = false;
        setRunning(false);
        clearTimeout(detLoopRef.current);
        stopCamera();
        stopSpeech();
        cancelSpeech();
    }, [stopCamera, stopSpeech]);

    /* ── Cleanup on unmount ──────────────────────────────────────────────── */
    useEffect(() => () => {
        clearTimeout(detLoopRef.current);
        stopCamera();
        stopSpeech();
    }, [stopCamera, stopSpeech]);

    /* ── Auto-start when opened via voice command ────────────────────────── */
    useEffect(() => {
        // Voice command passes autoStart:true in location state
        if (location.state?.autoStart && !running) {
            setTimeout(() => handleStart(), 500);
        }
        // Also listen for vc:start event dispatched after navigation delay
        const onVcStart = () => { if (!runningRef.current) handleStart(); };
        const onVcStop  = () => { if (runningRef.current) handleStop(); };
        window.addEventListener('vc:start', onVcStart);
        window.addEventListener('vc:stop',  onVcStop);
        return () => {
            window.removeEventListener('vc:start', onVcStart);
            window.removeEventListener('vc:stop',  onVcStop);
        };
    }, [location.state, handleStart, handleStop]); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── Announce fused result ───────────────────────────────────────────── */
    const announceResult = () => {
        if (!awareness?.text) return;
        cancelSpeech();
        speak(awareness.text, { priority: 'high' });
    };

    /* ── Render ──────────────────────────────────────────────────────────── */
    return (
        <AppLayout title="Multimodal Mode" showBack backLabel="Home">
            {/* ── Camera Feed ───────────────────────────────────────────── */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
                <div className="camera-container" style={{ borderRadius: 'var(--radius-xl)', overflow: 'hidden', position: 'relative' }}>
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        style={{
                            width: '100%', height: '100%', objectFit: 'cover',
                            display: running ? 'block' : 'none',
                        }}
                    />
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: 'absolute', inset: 0,
                            width: '100%', height: '100%',
                            display: running ? 'block' : 'none',
                        }}
                    />
                    {/* Placeholder when not running */}
                    {!running && (
                        <div style={{
                            width: '100%', aspectRatio: '4/3',
                            background: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 12,
                        }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: '50%',
                                background: 'rgba(255,45,85,0.15)',
                                border: '1.5px solid rgba(255,45,85,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Layers size={28} color="var(--pink)" />
                            </div>
                            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.88rem', fontWeight: 500 }}>
                                Tap Start to activate all sensors
                            </div>
                        </div>
                    )}
                    {camError && (
                        <div style={{
                            position: 'absolute', inset: 0, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.7)', padding: 16, textAlign: 'center',
                        }}>
                            <span style={{ color: 'var(--red)', fontSize: '0.85rem', fontWeight: 500 }}>{camError}</span>
                        </div>
                    )}

                    {/* Live badge */}
                    {running && (
                        <div style={{ position: 'absolute', top: 12, right: 12 }}>
                            <span className="badge-live">LIVE</span>
                        </div>
                    )}
                </div>

                {/* Control row */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 20, marginTop: 14,
                }}>
                    <button
                        className="btn-icon"
                        onClick={announceResult}
                        disabled={!awareness}
                        title="Speak fused result"
                        style={{ opacity: awareness ? 1 : 0.4 }}
                    >
                        <Volume2 size={20} color="var(--text-secondary)" />
                    </button>

                    {/* Record / Stop button */}
                    <button
                        className="btn-record"
                        onClick={running ? handleStop : handleStart}
                        aria-label={running ? 'Stop' : 'Start multimodal mode'}
                    >
                        {running
                            ? <Square size={20} fill="white" color="white" />
                            : <Play  size={20} fill="white" color="white" />
                        }
                    </button>

                    <button
                        className="btn-icon"
                        onClick={() => { handleStop(); setTimeout(handleStart, 300); }}
                        title="Restart"
                    >
                        <RefreshCw size={20} color="var(--text-secondary)" />
                    </button>
                </div>
            </div>

            {/* ── Fused Alert ───────────────────────────────────────────── */}
            {awareness && (
                <div style={{
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '14px 16px',
                    marginBottom: 14,
                    display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: 'var(--shadow-card)',
                }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'var(--blue-light)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <Volume2 size={18} color="var(--blue)" />
                    </div>
                    <p style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                        {awareness.text}
                    </p>
                    <span className={`pill ${
                        awareness.priority === 'critical' ? 'pill-red' :
                        awareness.priority === 'high'     ? 'pill-orange' : 'pill-blue'
                    }`} style={{ fontSize: '0.68rem' }}>
                        {awareness.priority === 'critical' ? 'Critical' :
                         awareness.priority === 'high'     ? 'High' : 'Live'}
                    </span>
                </div>
            )}

            {/* ── AI Details Panel ──────────────────────────────────────── */}
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)', marginBottom: 16 }}>
                {/* Tab headers */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--separator)' }}>
                    {['detections', 'system'].map(t => (
                        <button
                            key={t}
                            onClick={() => setActiveTab(t)}
                            style={{
                                flex: 1, padding: '12px 0',
                                fontSize: '0.85rem', fontWeight: 600,
                                color: activeTab === t ? 'var(--blue)' : 'var(--text-muted)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                borderBottom: activeTab === t ? '2px solid var(--blue)' : '2px solid transparent',
                                marginBottom: -1, transition: 'color 0.15s',
                                textTransform: 'capitalize',
                            }}
                        >
                            {t === 'detections' ? 'AI Details' : 'System'}
                        </button>
                    ))}
                </div>

                <div style={{ padding: '4px 16px 8px' }}>
                    {activeTab === 'detections' ? (
                        <>
                            {/* Detections */}
                            {detections.length === 0 && !speechText && (
                                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    {running ? 'Scanning…' : 'Start to see AI detections'}
                                </div>
                            )}

                            {detections.slice(0, 4).map((d, i) => (
                                <div key={i} className="ai-detail-row">
                                    <div className="ai-detail-icon-chip icon-chip-blue">
                                        <Eye size={18} color="var(--blue)" />
                                    </div>
                                    <div className="ai-detail-info">
                                        <div className="ai-detail-label">{d.label}</div>
                                        <div className="ai-detail-meta">
                                            Confidence: {Math.round((d.confidence || 0) * 100)}%
                                            {d.latency_ms ? ` · Latency: ${Math.round(d.latency_ms)} ms` : ''}
                                        </div>
                                    </div>
                                    <span className="ai-detail-badge">
                                        {Math.round((d.confidence || 0) * 100)}%
                                    </span>
                                </div>
                            ))}

                            {speechText && (
                                <div className="ai-detail-row">
                                    <div className="ai-detail-icon-chip icon-chip-purple">
                                        <Mic size={18} color="var(--purple)" />
                                    </div>
                                    <div className="ai-detail-info">
                                        <div className="ai-detail-label">Speech</div>
                                        <div className="ai-detail-meta">"{speechText.slice(0, 50)}{speechText.length > 50 ? '…' : ''}"</div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        /* System tab */
                        <div>
                            {MODALITIES.map(({ key, label, Icon, chipClass, color, badgeClass }) => (
                                <div key={key} className="ai-detail-row">
                                    <div className={`ai-detail-icon-chip ${chipClass}`}>
                                        <Icon size={18} color={color} />
                                    </div>
                                    <div className="ai-detail-info">
                                        <div className="ai-detail-label">{label}</div>
                                        <div className="ai-detail-meta">
                                            {running ? 'Active · Streaming' : 'Standby'}
                                        </div>
                                    </div>
                                    <span className={`pill ${badgeClass}`} style={{ fontSize: '0.68rem' }}>
                                        {running ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};

export default MultimodalPage;
