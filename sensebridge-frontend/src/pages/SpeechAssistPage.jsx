import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import {
    ChevronLeft, Copy, Trash2, Mic, RefreshCw, Languages,
    Volume2, ArrowRightLeft, Check, X, Globe, Sparkles,
} from 'lucide-react';
import { getConfig, updateConfig } from '../config/config';
import { speak, cancelSpeech, transcribeAudio } from '../services/aiService';
import { getBackendBaseURL } from '../services/networkConfig';
import haptics from '../services/haptics';

const BAR_COUNT = 28;

export const SPEECH_LANGUAGES = [
    { label: 'English',    code: 'en', speechCode: 'en-US', flag: '🇺🇸', native: 'English' },
    { label: 'Hindi',      code: 'hi', speechCode: 'hi-IN', flag: '🇮🇳', native: 'हिन्दी' },
    { label: 'Spanish',    code: 'es', speechCode: 'es-ES', flag: '🇪🇸', native: 'Español' },
    { label: 'French',     code: 'fr', speechCode: 'fr-FR', flag: '🇫🇷', native: 'Français' },
    { label: 'German',     code: 'de', speechCode: 'de-DE', flag: '🇩🇪', native: 'Deutsch' },
    { label: 'Tamil',      code: 'ta', speechCode: 'ta-IN', flag: '🇮🇳', native: 'தமிழ்' },
    { label: 'Telugu',     code: 'te', speechCode: 'te-IN', flag: '🇮🇳', native: 'తెలుగు' },
    { label: 'Kannada',    code: 'kn', speechCode: 'kn-IN', flag: '🇮🇳', native: 'ಕನ್ನಡ' },
    { label: 'Bengali',    code: 'bn', speechCode: 'bn-IN', flag: '🇮🇳', native: 'বাংলা' },
    { label: 'Arabic',     code: 'ar', speechCode: 'ar-SA', flag: '🇸🇦', native: 'العربية' },
    { label: 'Chinese',    code: 'zh', speechCode: 'zh-CN', flag: '🇨🇳', native: '中文' },
    { label: 'Japanese',   code: 'ja', speechCode: 'ja-JP', flag: '🇯🇵', native: '日本語' },
    { label: 'Korean',     code: 'ko', speechCode: 'ko-KR', flag: '🇰🇷', native: '한국어' },
    { label: 'Portuguese', code: 'pt', speechCode: 'pt-PT', flag: '🇵🇹', native: 'Português' },
];

export const AUTO_SOURCE = {
    label: 'Auto Detect',
    code: 'auto',
    speechCode: 'en-US',
    flag: '🌐',
    native: 'Auto Detect'
};

// High-speed zero-quota translation with multi-tier fallback
export async function translateMultilingual(text, targetCode, sourceCode = 'auto') {
    if (!text || !text.trim()) return { translated: '', detected: sourceCode };

    if (sourceCode !== 'auto' && sourceCode === targetCode) {
        return { translated: text, detected: sourceCode };
    }

    const baseURL = getBackendBaseURL();

    // Tier 1: Local / Backend Proxy (/api/ai/translate) — zero CORS, ultra-fast
    try {
        const res = await fetch(`${baseURL}/api/ai/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, targetLang: targetCode, sourceLang: sourceCode }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.translated) {
                return { translated: data.translated, detected: data.detected || sourceCode };
            }
        }
    } catch {
        // fallback to direct client fetch
    }

    // Tier 2: Google Translate free endpoint
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceCode}&tl=${targetCode}&dt=t&q=${encodeURIComponent(text.trim())}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data[0])) {
                const translated = data[0].map(item => item[0]).filter(Boolean).join('');
                const detected = data[2] || sourceCode;
                if (translated && translated.trim()) {
                    return { translated: translated.trim(), detected };
                }
            }
        }
    } catch (e1) {
        console.warn('[Translate] Tier 2 error:', e1);
    }

    // Tier 3: MyMemory Translated API fallback
    try {
        const pair = `${sourceCode === 'auto' ? 'autodetect' : sourceCode}|${targetCode}`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=${pair}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data?.responseData?.translatedText) {
                return { translated: data.responseData.translatedText, detected: sourceCode };
            }
        }
    } catch (e2) {
        console.warn('[Translate] Tier 3 error:', e2);
    }

    return { translated: text, detected: sourceCode };
}

// Encode raw Float32 audio samples into a standard 16kHz 16-bit mono WAV Blob
function encodeWavBlob(samples, inSampleRate) {
    const outSampleRate = 16000;
    let downsampled;
    if (inSampleRate === outSampleRate) {
        downsampled = samples;
    } else {
        const ratio = inSampleRate / outSampleRate;
        const newLen = Math.round(samples.length / ratio);
        downsampled = new Float32Array(newLen);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < newLen) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < samples.length; i++) {
                accum += samples[i];
                count++;
            }
            downsampled[offsetResult] = count > 0 ? accum / count : 0;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
    }

    const buffer = new ArrayBuffer(44 + downsampled.length * 2);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + downsampled.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, outSampleRate, true);
    view.setUint32(28, outSampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, downsampled.length * 2, true);

    let offset = 44;
    for (let i = 0; i < downsampled.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, downsampled[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

const SpeechAssistPage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [active,         setActive]         = useState(location.state?.autoStart || false);
    const [captions,       setCaptions]       = useState([]);
    const [interimText,    setInterimText]    = useState('');
    const [barHeights,     setBarHeights]     = useState(Array(BAR_COUNT).fill(8));
    const [sourceLang,     setSourceLang]     = useState(AUTO_SOURCE);
    const [targetLang,     setTargetLang]     = useState(() => {
        const saved = localStorage.getItem('sb_language');
        return SPEECH_LANGUAGES.find(l => l.code === saved) || SPEECH_LANGUAGES[0];
    });
    const [showLangModal,  setShowLangModal]  = useState(false);
    const [modalTab,       setModalTab]       = useState('target'); // 'source' | 'target'
    const [processing,     setProcessing]     = useState(false);
    const [atBottom,       setAtBottom]       = useState(true);
    const [supported,      setSupported]      = useState(true);
    const [speakingId,     setSpeakingId]     = useState(null);
    const [showAIDetails,  setShowAIDetails]  = useState(() => getConfig().ui?.showAIDetails ?? false);

    const [speechState,    setSpeechState]    = useState('idle'); // 'idle' | 'listening' | 'hearing' | 'transcribing'

    const listRef                = useRef(null);
    const captionEndRef          = useRef(null);
    const audioCtxRef            = useRef(null);
    const analyserRef            = useRef(null);
    const scriptProcessorRef     = useRef(null);
    const rafRef                 = useRef(null);
    const streamRef              = useRef(null);
    const recognitionRef         = useRef(null);
    const speechActiveRef        = useRef(false);
    const silenceTimerRef        = useRef(null);
    const lastWebSpeechTimeRef   = useRef(0);
    const isTranscribingAudioRef = useRef(false);
    const pendingInterimRef      = useRef('');
    const pcmSamplesRef          = useRef([]);
    const activeRef              = useRef(false);

    activeRef.current = active;

    // ── Check device / browser support ──────────────────────────────────
    useEffect(() => {
        const hasMedia = !!(navigator?.mediaDevices?.getUserMedia);
        const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        setSupported(hasMedia || hasSR);
    }, []);

    // ── Voice command listener ───────────────────────────────────────────
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

    // ── Add caption ──────────────────────────────────────────────────────
    const addCaption = useCallback((nativeText, translatedText, langCode, confidence = null) => {
        const id = Date.now() + Math.random();
        setCaptions(prev => [...prev, {
            id,
            time:       new Date().toLocaleTimeString(),
            text:       translatedText,
            nativeText: nativeText,
            lang:       langCode,
            confidence: confidence,
        }]);
        window.dispatchEvent(new CustomEvent('sb:speech', {
            detail: { text: translatedText, isFinal: true, lang: langCode, confidence }
        }));
    }, []);

    const processFinalSpeech = useCallback(async (finalText, conf) => {
        if (!finalText || !finalText.trim()) return;
        setInterimText('');
        pendingInterimRef.current = '';
        pcmSamplesRef.current = [];
        haptics.tap();

        const id = Date.now() + Math.random();
        const time = new Date().toLocaleTimeString();

        // 1. Instantly display spoken text so the user never sees an empty screen
        setCaptions(prev => [...prev, {
            id,
            time,
            text: finalText,
            nativeText: finalText,
            lang: sourceLang.code === 'auto' ? 'auto' : sourceLang.code,
            confidence: conf,
        }]);

        window.dispatchEvent(new CustomEvent('sb:speech', {
            detail: { text: finalText, isFinal: true, lang: sourceLang.code, confidence: conf }
        }));

        // 2. If required target language is different, translate in background and update caption
        if (targetLang.code !== sourceLang.code && targetLang.code !== 'auto') {
            setProcessing(true);
            try {
                const { translated, detected } = await translateMultilingual(
                    finalText,
                    targetLang.code,
                    sourceLang.code
                );
                if (translated && translated !== finalText) {
                    setCaptions(prev => prev.map(c => c.id === id ? {
                        ...c,
                        text: translated,
                        nativeText: finalText,
                        lang: detected || targetLang.code,
                    } : c));
                    window.dispatchEvent(new CustomEvent('sb:speech', {
                        detail: { text: translated, isFinal: true, lang: detected || targetLang.code, confidence: conf }
                    }));
                }
            } catch (err) {
                console.warn('[Speech] Translation error:', err);
            } finally {
                setProcessing(false);
            }
        }
    }, [sourceLang, targetLang]);

    // ── Start mic visualizer & Voice Activity Detector + Raw Audio Capture
    const startVisualizer = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContext();
            audioCtxRef.current = audioCtx;

            const analyser = audioCtx.createAnalyser();
            analyserRef.current = analyser;
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;

            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            // Raw PCM audio capture node for high-fidelity offline/online transcription
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            processor.onaudioprocess = (e) => {
                if (!speechActiveRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                if (pcmSamplesRef.current.length < 20 * audioCtx.sampleRate) {
                    pcmSamplesRef.current.push(new Float32Array(inputData));
                }
            };
            source.connect(processor);
            processor.connect(audioCtx.destination);

            const freqData = new Uint8Array(analyser.frequencyBinCount);
            setSpeechState('listening');

            const draw = () => {
                if (!activeRef.current) return;
                rafRef.current = requestAnimationFrame(draw);
                analyser.getByteFrequencyData(freqData);

                // Frequency height mapping
                const step = Math.floor(freqData.length / BAR_COUNT);
                const heights = Array.from({ length: BAR_COUNT }, (_, i) => {
                    const val = freqData[i * step];
                    return Math.max(4, (val / 255) * 36);
                });
                setBarHeights(heights);

                // Voice Activity Detection (VAD) via microphone energy
                const avgVol = freqData.reduce((acc, v) => acc + v, 0) / freqData.length;
                if (avgVol > 12) {
                    if (!speechActiveRef.current) {
                        speechActiveRef.current = true;
                        setSpeechState('hearing');
                    }
                    if (silenceTimerRef.current) {
                        clearTimeout(silenceTimerRef.current);
                        silenceTimerRef.current = null;
                    }
                } else if (speechActiveRef.current) {
                    if (!silenceTimerRef.current) {
                        silenceTimerRef.current = setTimeout(async () => {
                            speechActiveRef.current = false;
                            silenceTimerRef.current = null;

                            // 1. If Web Speech API delivered interim words, commit them instantly
                            if (pendingInterimRef.current && pendingInterimRef.current.trim()) {
                                const committedText = pendingInterimRef.current.trim();
                                pendingInterimRef.current = '';
                                setInterimText('');
                                lastWebSpeechTimeRef.current = Date.now();
                                pcmSamplesRef.current = [];
                                processFinalSpeech(committedText, 92);
                                setSpeechState('listening');
                                return;
                            }

                            // 2. If Web Speech delivered text recently, clear audio buffer
                            if (Date.now() - lastWebSpeechTimeRef.current < 2000) {
                                pcmSamplesRef.current = [];
                                setSpeechState('listening');
                                return;
                            }

                            // 3. Web Speech API was silent/unavailable: synthesize recorded PCM audio chunk
                            const chunks = pcmSamplesRef.current;
                            pcmSamplesRef.current = [];

                            const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
                            if (totalLen < 6000 || isTranscribingAudioRef.current) {
                                setSpeechState('listening');
                                return;
                            }

                            const mergedSamples = new Float32Array(totalLen);
                            let offset = 0;
                            for (const chunk of chunks) {
                                mergedSamples.set(chunk, offset);
                                offset += chunk.length;
                            }

                            const wavBlob = encodeWavBlob(mergedSamples, audioCtx.sampleRate);
                            if (wavBlob.size < 2000) {
                                setSpeechState('listening');
                                return;
                            }

                            try {
                                isTranscribingAudioRef.current = true;
                                setSpeechState('transcribing');
                                const result = await transcribeAudio(wavBlob, targetLang.code, sourceLang.code);
                                if (result?.text && result.text.trim()) {
                                    lastWebSpeechTimeRef.current = Date.now();
                                    processFinalSpeech(result.text.trim(), 95);
                                }
                            } catch (err) {
                                console.warn('[Audio STT] Transcribe error:', err);
                            } finally {
                                isTranscribingAudioRef.current = false;
                                setSpeechState('listening');
                            }
                        }, 750);
                    }
                }
            };
            draw();
        } catch (err) {
            console.error('[Audio] Mic denied:', err);
            setActive(false);
            setSpeechState('idle');
        }
    }, [processFinalSpeech, sourceLang, targetLang]);

    // ── Start Web Speech Recognition ─────────────────────────────────────
    const startRecognition = useCallback(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            console.log('[Speech] Web Speech API not present; using Universal AI Audio STT');
            return;
        }

        try {
            const rec = new SR();
            rec.continuous     = true;
            rec.interimResults = true;
            rec.lang = sourceLang.code === 'auto'
                ? (navigator.language || 'en-US')
                : (sourceLang.speechCode || 'en-US');

            recognitionRef.current = rec;

            rec.onresult = (event) => {
                lastWebSpeechTimeRef.current = Date.now();
                setSpeechState('hearing');
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const res = event.results[i];
                    const transcript = res[0]?.transcript || '';
                    if (res.isFinal) {
                        const text = transcript.trim();
                        if (text) {
                            lastWebSpeechTimeRef.current = Date.now();
                            pendingInterimRef.current = '';
                            setInterimText('');
                            pcmSamplesRef.current = [];
                            const conf = res[0].confidence != null && res[0].confidence > 0
                                ? Math.round(res[0].confidence * 100)
                                : 95;
                            processFinalSpeech(text, conf);
                        }
                    } else {
                        interim += transcript;
                    }
                }
                if (interim) {
                    pendingInterimRef.current = interim;
                    setInterimText(interim);
                }
            };

            rec.onerror = (e) => {
                if (e.error === 'no-speech') return;
                console.warn('[Speech] Recognition warning:', e.error);
                if (['network', 'aborted'].includes(e.error) && activeRef.current) {
                    setTimeout(() => {
                        if (activeRef.current) {
                            try { rec.start(); } catch {}
                        }
                    }, 400);
                }
            };

            rec.onend = () => {
                if (pendingInterimRef.current && pendingInterimRef.current.trim()) {
                    const committed = pendingInterimRef.current.trim();
                    pendingInterimRef.current = '';
                    setInterimText('');
                    pcmSamplesRef.current = [];
                    processFinalSpeech(committed, 90);
                }
                if (recognitionRef.current === rec && activeRef.current) {
                    try { rec.start(); } catch {}
                }
            };

            rec.start();
        } catch (err) {
            console.warn('[Speech] Web Speech start error:', err);
        }
    }, [sourceLang, processFinalSpeech]);

    // ── Stop all audio/recognition ───────────────────────────────────────
    const stopAll = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        speechActiveRef.current = false;
        isTranscribingAudioRef.current = false;
        setSpeechState('idle');

        if (scriptProcessorRef.current) {
            try {
                scriptProcessorRef.current.disconnect();
                scriptProcessorRef.current.onaudioprocess = null;
            } catch {}
            scriptProcessorRef.current = null;
        }
        pcmSamplesRef.current = [];
        pendingInterimRef.current = '';

        if (recognitionRef.current) {
            recognitionRef.current.onend = null;
            try { recognitionRef.current.stop(); } catch {}
            recognitionRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setBarHeights(Array(BAR_COUNT).fill(4));
        setProcessing(false);
        setInterimText('');
    }, []);

    useEffect(() => {
        if (active) {
            startVisualizer();
            startRecognition();
        } else {
            stopAll();
        }
        return stopAll;
    }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-start recognition when source/target language changes
    useEffect(() => {
        if (!active) return;
        if (recognitionRef.current) {
            recognitionRef.current.onend = null;
            try { recognitionRef.current.stop(); } catch {}
            recognitionRef.current = null;
        }
        startRecognition();
    }, [sourceLang, targetLang]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-scroll ──────────────────────────────────────────────────────
    useEffect(() => {
        if (atBottom) captionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [captions, interimText, atBottom, processing]);

    const handleScroll = () => {
        const el = listRef.current;
        if (!el) return;
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
    };

    const handleCopy = () => {
        const text = captions.map(c => c.text).join('\n');
        navigator.clipboard?.writeText(text).catch(() => {});
        haptics.tap();
    };

    const handleSwapLanguages = () => {
        if (sourceLang.code === 'auto') {
            // Swap auto with target by setting source to target and target to English
            setSourceLang(targetLang);
            setTargetLang(SPEECH_LANGUAGES.find(l => l.code === 'en') || SPEECH_LANGUAGES[0]);
        } else {
            const oldSource = sourceLang;
            setSourceLang(targetLang);
            setTargetLang(oldSource);
        }
        haptics.tap();
    };

    const handleSpeakCaption = (caption) => {
        cancelSpeech();
        if (speakingId === caption.id) {
            setSpeakingId(null);
            return;
        }
        speak(caption.text, { priority: 'high', rate: 1.0 });
        setSpeakingId(caption.id);
        setTimeout(() => setSpeakingId(null), caption.text.length * 75 + 600);
    };

    const toggleActive = () => {
        const next = !active;
        setActive(next);
        if (next) haptics.success();
        else haptics.tap();
    };

    return (
        <AppLayout title="Speech Mode" showBack backLabel="Home">
            {/* ── Action Bar ─────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem', background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)', margin: '0.5rem 0.5rem 0.6rem',
                boxShadow: 'var(--shadow-card)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {active ? (
                        <>
                            <span className="live-dot" style={{
                                width: 8, height: 8,
                                background: speechState === 'hearing' ? '#00D4AA' : speechState === 'transcribing' ? '#8B5CF6' : 'var(--green)',
                                boxShadow: speechState === 'hearing' ? '0 0 10px #00D4AA' : undefined
                            }} />
                            <span style={{
                                fontSize: '0.82rem', fontWeight: 700,
                                color: speechState === 'hearing' ? '#00D4AA' : speechState === 'transcribing' ? '#C4B5FD' : 'var(--green)'
                            }}>
                                {speechState === 'hearing' ? 'Hearing Voice… 🎙️' : speechState === 'transcribing' ? 'Transcribing… ✨' : 'Listening for Speech…'}
                            </span>
                        </>
                    ) : (
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                            Ready · Tap Mic to Speak
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                        className="btn-icon"
                        onClick={() => setShowAIDetails(v => {
                            const next = !v;
                            updateConfig({ ui: { showAIDetails: next } });
                            return next;
                        })}
                        style={{
                            fontSize: '0.72rem', fontWeight: 700,
                            color: showAIDetails ? 'var(--blue)' : 'var(--text-muted)',
                            padding: '4px 8px', width: 'auto',
                        }}
                        title="Toggle AI Technical Metrics"
                    >
                        {showAIDetails ? 'AI ON' : 'AI OFF'}
                    </button>
                    <button className="btn-icon" onClick={handleCopy} title="Copy all captions">
                        <Copy size={16} color="var(--text-secondary)" />
                    </button>
                    <button className="btn-icon" onClick={() => setCaptions([])} title="Clear">
                        <Trash2 size={16} color="var(--red)" />
                    </button>
                </div>
            </div>

            {/* ── Multilingual Language Selector Bar ─────────────────── */}
            <div style={{
                margin: '0 0.5rem 0.6rem',
                padding: '10px 14px',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8,
            }}>
                {/* Spoken Language Button */}
                <button
                    onClick={() => { setModalTab('source'); setShowLangModal(true); }}
                    style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--bg-inset)', border: '1px solid var(--separator)',
                        borderRadius: 12, padding: '8px 10px', cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <span style={{ fontSize: '1.2rem' }}>{sourceLang.flag}</span>
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Speaking
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {sourceLang.label}
                        </div>
                    </div>
                </button>

                {/* Swap Button */}
                <button
                    onClick={handleSwapLanguages}
                    title="Swap languages"
                    style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: 'var(--blue-light)', border: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0,
                    }}
                >
                    <ArrowRightLeft size={16} color="var(--blue)" />
                </button>

                {/* Target Language Button */}
                <button
                    onClick={() => { setModalTab('target'); setShowLangModal(true); }}
                    style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--blue-light)', border: '1px solid rgba(0,122,255,0.25)',
                        borderRadius: 12, padding: '8px 10px', cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <span style={{ fontSize: '1.2rem' }}>{targetLang.flag}</span>
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--blue)', fontWeight: 700, textTransform: 'uppercase' }}>
                            Convert To
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--blue)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {targetLang.label}
                        </div>
                    </div>
                </button>
            </div>

            {/* ── Unsupported browser warning ─────────────────────────── */}
            {!supported && (
                <div style={{
                    margin: '0.5rem 1rem', padding: '0.75rem 1rem',
                    background: 'rgba(255,75,110,0.15)', border: '1px solid rgba(255,75,110,0.4)',
                    borderRadius: 12, fontSize: '0.78rem', color: '#FF4B6E',
                }}>
                    ⚠️ Speech recognition requires microphone access. Please allow permissions.
                </div>
            )}

            {/* ── Caption list ───────────────────────────────────────── */}
            <div
                ref={listRef}
                onScroll={handleScroll}
                style={{
                    flex: 1, overflowY: 'auto', padding: '0.5rem 1rem',
                    display: 'flex', flexDirection: 'column', gap: '0.65rem',
                }}
            >
                {captions.length === 0 && !interimText && !processing && (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-muted)', padding: '2rem 1rem',
                    }}>
                        <div style={{
                            width: 58, height: 58, borderRadius: '50%',
                            background: 'var(--blue-light)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: 12,
                        }}>
                            <Globe size={28} color="var(--blue)" />
                        </div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {active ? 'Listening for speech…' : 'Tap the microphone to speak'}
                        </div>
                        <div style={{ fontSize: '0.75rem', maxWidth: 280, textAlign: 'center', lineHeight: 1.5, color: 'var(--text-muted)' }}>
                            Speak in any language. Your speech is recognized and converted into {targetLang.label} instantly in real-time.
                        </div>

                        {/* Quick test phrases */}
                        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 600 }}>Quick Test Phrases:</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 320 }}>
                                {[
                                    'Hello, how can I help you?',
                                    'Where is the emergency exit?',
                                    'I need water please',
                                    'Thank you very much'
                                ].map((phrase) => (
                                    <button
                                        key={phrase}
                                        onClick={() => processFinalSpeech(phrase, 99)}
                                        style={{
                                            background: 'var(--bg-inset)', border: '1px solid var(--separator)',
                                            borderRadius: 20, padding: '5px 12px', fontSize: '0.72rem',
                                            color: 'var(--blue)', cursor: 'pointer', fontWeight: 600,
                                            boxShadow: 'var(--shadow-sm)',
                                        }}
                                    >
                                        + "{phrase}"
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {captions.map((c, idx) => {
                    const showTime = idx === 0 || captions[idx - 1]?.time !== c.time;
                    return (
                        <div key={c.id} className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {showTime && (
                                <div style={{
                                    textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)',
                                    margin: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                }}>
                                    <span>{c.time}</span>
                                    {c.lang && c.lang !== 'auto' && (
                                        <span style={{
                                            background: 'rgba(108,99,255,0.15)', color: '#C4B5FD',
                                            padding: '1px 6px', borderRadius: 4, fontSize: '0.6rem',
                                            fontWeight: 700, textTransform: 'uppercase',
                                        }}>
                                            {c.lang}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <div className="bubble-other" style={{
                                    display: 'flex', flexDirection: 'column', gap: 4,
                                    maxWidth: '85%', position: 'relative',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                        <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {c.text}
                                        </span>
                                        <button
                                            onClick={() => handleSpeakCaption(c)}
                                            style={{
                                                background: 'none', border: 'none', padding: 2,
                                                cursor: 'pointer', flexShrink: 0,
                                            }}
                                            title="Read aloud"
                                        >
                                            <Volume2
                                                size={16}
                                                color={speakingId === c.id ? 'var(--blue)' : 'var(--text-muted)'}
                                            />
                                        </button>
                                    </div>
                                    {c.nativeText && c.nativeText !== c.text && (
                                        <span style={{
                                            fontSize: '0.74rem', color: 'var(--text-muted)',
                                            fontStyle: 'italic', borderTop: '1px solid var(--separator)',
                                            paddingTop: 4, marginTop: 2,
                                        }}>
                                            "{c.nativeText}"
                                        </span>
                                    )}
                                    {showAIDetails && c.confidence != null && (
                                        <div style={{ marginTop: 2 }}>
                                            <span style={{
                                                fontSize: '0.62rem', background: 'rgba(0,212,170,0.15)',
                                                color: '#00D4AA', padding: '1px 6px', borderRadius: 4, fontWeight: 700,
                                            }}>
                                                Accuracy: {c.confidence}%
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Interim speech recognition bubble */}
                {interimText && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }} className="fade-in">
                        <div style={{
                            background: 'rgba(0,122,255,0.08)',
                            border: '1.5px dashed var(--blue)',
                            borderRadius: '16px 16px 16px 4px',
                            padding: '10px 14px',
                            color: 'var(--blue)',
                            fontSize: '0.92rem',
                            fontWeight: 500,
                            maxWidth: '85%',
                        }}>
                            <span>{interimText}</span>
                            <span style={{
                                display: 'inline-block', width: 2, height: '0.9em',
                                background: 'var(--blue)', marginLeft: 4, verticalAlign: 'middle',
                                animation: 'blink 1s step-end infinite',
                            }} />
                        </div>
                    </div>
                )}

                {/* Processing indicator */}
                {processing && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }} className="fade-in">
                        <div className="bubble-interim" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <RefreshCw size={14} style={{ color: 'var(--blue)', animation: 'spin 1s linear infinite' }} />
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Converting to {targetLang.label}...
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
                background: 'var(--bg-card)',
                borderTop: '1px solid var(--border-card)',
                padding: '0.85rem 1rem',
                paddingBottom: 'calc(0.85rem + var(--nav-height))',
                boxShadow: 'var(--shadow-card)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    {/* Audio wave bars */}
                    <div style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'center', height: 42, overflow: 'hidden' }}>
                        {barHeights.map((h, i) => (
                            <div key={i} style={{
                                flex: 1,
                                borderRadius: 3,
                                background: active ? 'var(--blue)' : 'var(--text-dim)',
                                height: `${h}px`,
                                maxHeight: 36,
                                opacity: active ? 1 : 0.35,
                                transition: 'height 0.06s ease',
                            }} />
                        ))}
                    </div>
                    {/* Mic Button */}
                    <button
                        className={`fab-mic ${active ? 'recording' : ''}`}
                        onClick={toggleActive}
                        disabled={!supported}
                        style={{
                            width: 54, height: 54, borderRadius: '50%',
                            background: active ? 'var(--red)' : 'var(--blue)',
                            border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: active ? '0 0 20px rgba(255,45,85,0.5)' : '0 4px 14px rgba(0,122,255,0.4)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <Mic size={24} color="#fff" />
                    </button>
                </div>
                <div style={{
                    fontSize: '0.68rem', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 6, marginTop: 8, fontWeight: 500,
                }}>
                    <Sparkles size={12} color="var(--blue)" />
                    <span>Real-time Speech Recognition & Multilingual Translation</span>
                </div>
            </div>

            {/* ── Multilingual Language Modal ─────────────────────────── */}
            {showLangModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    animation: 'fadeIn 0.2s ease',
                }} onClick={() => setShowLangModal(false)}>
                    <div style={{
                        width: '100%', maxWidth: 480, maxHeight: '82vh',
                        background: 'var(--bg-card)',
                        borderRadius: '24px 24px 0 0',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden', boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
                        borderTop: '1px solid var(--border-card)',
                    }} onClick={e => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '16px 20px', borderBottom: '1px solid var(--separator)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {modalTab === 'source' ? 'Spoken Language' : 'Translate To'}
                                </h3>
                                <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    {modalTab === 'source'
                                        ? 'Select the language you will speak in (or Auto Detect)'
                                        : 'Select the required translation language'
                                    }
                                </p>
                            </div>
                            <button className="btn-icon" onClick={() => setShowLangModal(false)}>
                                <X size={18} color="var(--text-secondary)" />
                            </button>
                        </div>

                        {/* Modal Tab Switcher */}
                        <div style={{ display: 'flex', padding: '10px 16px', gap: 8, background: 'var(--bg-inset)' }}>
                            <button
                                onClick={() => setModalTab('source')}
                                style={{
                                    flex: 1, padding: '8px', borderRadius: 10,
                                    border: 'none', cursor: 'pointer',
                                    fontWeight: 700, fontSize: '0.8rem',
                                    background: modalTab === 'source' ? 'var(--bg-card)' : 'transparent',
                                    color: modalTab === 'source' ? 'var(--blue)' : 'var(--text-muted)',
                                    boxShadow: modalTab === 'source' ? 'var(--shadow-sm)' : 'none',
                                }}
                            >
                                Speaking: {sourceLang.label}
                            </button>
                            <button
                                onClick={() => setModalTab('target')}
                                style={{
                                    flex: 1, padding: '8px', borderRadius: 10,
                                    border: 'none', cursor: 'pointer',
                                    fontWeight: 700, fontSize: '0.8rem',
                                    background: modalTab === 'target' ? 'var(--bg-card)' : 'transparent',
                                    color: modalTab === 'target' ? 'var(--blue)' : 'var(--text-muted)',
                                    boxShadow: modalTab === 'target' ? 'var(--shadow-sm)' : 'none',
                                }}
                            >
                                Convert to: {targetLang.label}
                            </button>
                        </div>

                        {/* Language List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
                            {/* Auto Detect option for source tab */}
                            {modalTab === 'source' && (
                                <div
                                    onClick={() => {
                                        setSourceLang(AUTO_SOURCE);
                                        setShowLangModal(false);
                                        haptics.tap();
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 14,
                                        padding: '13px 16px', borderRadius: 14, cursor: 'pointer',
                                        margin: '4px 0',
                                        background: sourceLang.code === 'auto' ? 'var(--blue-light)' : 'transparent',
                                        border: `1.5px solid ${sourceLang.code === 'auto' ? 'var(--blue)' : 'transparent'}`,
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>🌐</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                            Auto Detect Spoken Language
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            Automatically detects what you speak
                                        </div>
                                    </div>
                                    {sourceLang.code === 'auto' && (
                                        <div style={{
                                            width: 24, height: 24, borderRadius: '50%',
                                            background: 'var(--blue)', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Check size={14} color="#fff" strokeWidth={3} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {SPEECH_LANGUAGES.map(lang => {
                                const isSelected = modalTab === 'source'
                                    ? sourceLang.code === lang.code
                                    : targetLang.code === lang.code;

                                return (
                                    <div
                                        key={lang.code}
                                        onClick={() => {
                                            if (modalTab === 'source') {
                                                setSourceLang(lang);
                                            } else {
                                                setTargetLang(lang);
                                                localStorage.setItem('sb_language', lang.code);
                                            }
                                            setShowLangModal(false);
                                            haptics.tap();
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 14,
                                            padding: '13px 16px', borderRadius: 14, cursor: 'pointer',
                                            margin: '4px 0',
                                            background: isSelected ? 'var(--blue-light)' : 'transparent',
                                            border: `1.5px solid ${isSelected ? 'var(--blue)' : 'transparent'}`,
                                        }}
                                    >
                                        <span style={{ fontSize: '1.4rem' }}>{lang.flag}</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.95rem', fontWeight: isSelected ? 700 : 500, color: 'var(--text-primary)' }}>
                                                {lang.label}
                                            </div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                {lang.native}
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <div style={{
                                                width: 24, height: 24, borderRadius: '50%',
                                                background: 'var(--blue)', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <Check size={14} color="#fff" strokeWidth={3} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
};

export default SpeechAssistPage;
