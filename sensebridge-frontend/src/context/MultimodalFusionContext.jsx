/**
 * MultimodalFusionContext.jsx
 * ════════════════════════════
 * Central fusion engine for SenseBridge multimodal AI.
 *
 * Architecture:
 *   VisionAssistPage  ──emit('sb:vision')──┐
 *   SpeechAssistPage  ──emit('sb:speech')──┼──► FusionContext ──► /api/ai/fuse ──► Insight
 *   GestureAssistPage ──emit('sb:gesture')─┘
 *
 * Each page emits a CustomEvent with its latest signal.
 * This context collects them, debounces, runs fusion, and broadcasts
 * the result back via 'sb:fusion' so any component can subscribe.
 */

import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

// ─── Event names ─────────────────────────────────────────────────────────────
export const EV_VISION  = 'sb:vision';
export const EV_SPEECH  = 'sb:speech';
export const EV_GESTURE = 'sb:gesture';
export const EV_FUSION  = 'sb:fusion';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const now = () => Date.now();
const STALE_MS = 8000; // signals older than 8 s are discarded from fusion

// ─── Context ──────────────────────────────────────────────────────────────────
const MultimodalFusionContext = createContext(null);

export const MultimodalFusionProvider = ({ children }) => {
    const { token } = useAuth();

    // Latest signals from each modality (with timestamp)
    const signals = useRef({ vision: null, speech: null, gesture: null });

    // UI state (so components can consume without subscribing to the event)
    const [awareness,   setAwareness]   = useState(null);  // { text, intent, priority, sources }
    const [activeModals, setActive]     = useState({ vision: false, speech: false, gesture: false });
    const [fusionBusy,   setFusionBusy] = useState(false);

    const fuseTimer = useRef(null);

    // ── Emit a signal from any page ────────────────────────────────────────
    // Called by VisionAssistPage, SpeechAssistPage, GestureAssistPage
    // We also listen to the custom events from pages that don't directly import this context.

    // ── Collect incoming events from pages ────────────────────────────────
    const onVision = useCallback((e) => {
        signals.current.vision = { data: e.detail, at: now() };
        setActive(prev => ({ ...prev, vision: true }));
        scheduleFusion();
    }, []); // eslint-disable-line

    const onSpeech = useCallback((e) => {
        signals.current.speech = { data: e.detail, at: now() };
        setActive(prev => ({ ...prev, speech: true }));
        scheduleFusion();
    }, []); // eslint-disable-line

    const onGesture = useCallback((e) => {
        signals.current.gesture = { data: e.detail, at: now() };
        setActive(prev => ({ ...prev, gesture: true }));
        scheduleFusion();
    }, []); // eslint-disable-line

    useEffect(() => {
        window.addEventListener(EV_VISION,  onVision);
        window.addEventListener(EV_SPEECH,  onSpeech);
        window.addEventListener(EV_GESTURE, onGesture);
        return () => {
            window.removeEventListener(EV_VISION,  onVision);
            window.removeEventListener(EV_SPEECH,  onSpeech);
            window.removeEventListener(EV_GESTURE, onGesture);
        };
    }, [onVision, onSpeech, onGesture]);

    // ── Debounced fusion trigger ───────────────────────────────────────────
    const scheduleFusion = useCallback(() => {
        clearTimeout(fuseTimer.current);
        fuseTimer.current = setTimeout(runFusion, 1200); // fuse 1.2 s after last signal
    }, []); // eslint-disable-line

    // ── Core fusion engine ────────────────────────────────────────────────
    const runFusion = useCallback(async () => {
        const s = signals.current;
        const t = now();

        // Only include fresh signals
        const vision  = s.vision  && (t - s.vision.at)  < STALE_MS ? s.vision.data  : null;
        const speech  = s.speech  && (t - s.speech.at)  < STALE_MS ? s.speech.data  : null;
        const gesture = s.gesture && (t - s.gesture.at) < STALE_MS ? s.gesture.data : null;

        // Need at least 2 modalities for meaningful fusion
        const count = [vision, speech, gesture].filter(Boolean).length;
        if (count < 1) return;

        const payload = { vision, speech, gesture };
        setFusionBusy(true);

        try {
            let result;

            // ── Try cloud fusion (Gemini backend) ──────────────────────
            if (token) {
                const res = await fetch('/api/ai/fuse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) result = await res.json();
            }

            // ── Client-side fusion fallback ────────────────────────────
            if (!result) result = clientFusion(vision, speech, gesture);

            const insight = {
                text:     result.awareness,
                intent:   result.intent    || 'general',
                priority: result.priority  || 'normal',
                suggestions: result.suggestions || [],
                sources:  {
                    vision:  !!vision,
                    speech:  !!speech,
                    gesture: !!gesture,
                },
                fused_at: new Date().toLocaleTimeString(),
            };

            setAwareness(insight);

            // Broadcast so any component can listen
            window.dispatchEvent(new CustomEvent(EV_FUSION, { detail: insight }));

        } catch (err) {
            // Graceful — try client fallback
            const result = clientFusion(vision, speech, gesture);
            if (result) {
                const insight = { text: result.awareness, intent: 'general', priority: 'normal', suggestions: [], sources: { vision: !!vision, speech: !!speech, gesture: !!gesture }, fused_at: new Date().toLocaleTimeString() };
                setAwareness(insight);
                window.dispatchEvent(new CustomEvent(EV_FUSION, { detail: insight }));
            }
        } finally {
            setFusionBusy(false);
        }
    }, [token]);

    // ── Public emitters for pages to call directly ────────────────────────
    const emitVision  = useCallback((data) => window.dispatchEvent(new CustomEvent(EV_VISION,  { detail: data })), []);
    const emitSpeech  = useCallback((data) => window.dispatchEvent(new CustomEvent(EV_SPEECH,  { detail: data })), []);
    const emitGesture = useCallback((data) => window.dispatchEvent(new CustomEvent(EV_GESTURE, { detail: data })), []);

    const clearAwareness = useCallback(() => setAwareness(null), []);

    return (
        <MultimodalFusionContext.Provider value={{
            awareness, activeModals, fusionBusy,
            emitVision, emitSpeech, emitGesture,
            clearAwareness,
        }}>
            {children}
        </MultimodalFusionContext.Provider>
    );
};

export const useFusion = () => {
    const ctx = useContext(MultimodalFusionContext);
    if (!ctx) throw new Error('useFusion must be used inside <MultimodalFusionProvider>');
    return ctx;
};

// ═════════════════════════════════════════════════════════════════════════════
//  CLIENT-SIDE FUSION ENGINE (runs offline / when backend is unavailable)
//  Handles all cross-modal correlations locally using rule patterns.
// ═════════════════════════════════════════════════════════════════════════════
function clientFusion(vision, speech, gesture) {
    const parts  = [];
    const intents = [];

    // ── Vision analysis ───────────────────────────────────────────────────
    if (vision) {
        const detections = Array.isArray(vision) ? vision : (vision.detections || []);
        const objects = detections.map(d => d.label || d).filter(Boolean);

        if (objects.length) {
            const topObj = objects.slice(0, 3).join(', ');
            parts.push(`👁️ ${objects.length} object${objects.length > 1 ? 's' : ''} detected: ${topObj}`);
        }

        // Hazard detection
        if (vision.hazard) {
            const h = vision.hazard;
            if (h.stair) { parts.push('⚠️ Stairs detected ahead'); intents.push('hazard'); }
            if (h.drop)  { parts.push('⚠️ Drop or edge detected'); intents.push('hazard'); }
        }
    }

    // ── Speech analysis ───────────────────────────────────────────────────
    if (speech) {
        const text = typeof speech === 'string' ? speech : (speech.text || '');
        if (text) {
            const lower = text.toLowerCase();
            parts.push(`🎙️ Heard: "${text}"`);
            if (/help|emergency|danger/.test(lower)) intents.push('emergency');
            else if (/hungry|eat|food|water|drink/.test(lower))  intents.push('needs');
            else if (/where|find|look/.test(lower)) intents.push('navigation');
        }
    }

    // ── Gesture analysis ──────────────────────────────────────────────────
    if (gesture) {
        const words = Array.isArray(gesture) ? gesture : (gesture.words || [gesture.gesture || gesture]);
        const sentence = gesture.sentence || words.join(' ');
        if (sentence) {
            parts.push(`🖐️ Signing: "${sentence}"`);
            const lower = sentence.toLowerCase();
            if (/help|emergency/.test(lower)) intents.push('emergency');
            else if (/eat|drink|water|food/.test(lower)) intents.push('needs');
            else if (/stop|no|danger/.test(lower)) intents.push('warning');
        }
    }

    if (!parts.length) return null;

    // ── Cross-modal correlation ───────────────────────────────────────────
    return {
        awareness:   buildAwarenessText(vision, speech, gesture, parts),
        intent:      getMostCriticalIntent(intents),
        priority:    intents.includes('emergency') ? 'critical' : intents.includes('hazard') ? 'high' : 'normal',
        suggestions: buildSuggestions(vision, speech, gesture, intents),
    };
}

function buildAwarenessText(vision, speech, gesture, parts) {
    // Cross-modal smart correlations
    if (vision && gesture) {
        const objs = vision?.detections?.map(d => d.label) || [];
        const gesWords = Array.isArray(gesture) ? gesture : [gesture?.gesture || ''];
        const wantsEat  = gesWords.some(w => ['eat','food','hungry','more'].includes(w?.toLowerCase()));
        const wantsDrink = gesWords.some(w => ['drink','water','thirsty'].includes(w?.toLowerCase()));
        const needsHelp  = gesWords.some(w => ['help','stop'].includes(w?.toLowerCase()));

        if (wantsEat  && objs.some(o => ['bowl', 'pizza', 'sandwich', 'cake', 'apple', 'banana', 'orange'].includes(o))) {
            return `User wants to eat. Food (${objs.filter(o => ['bowl','pizza','sandwich'].includes(o)).join(', ')}) is nearby.`;
        }
        if (wantsDrink && objs.some(o => ['bottle', 'cup', 'wine glass'].includes(o))) {
            return `User is thirsty. A drink container is visible nearby.`;
        }
        if (needsHelp  && objs.some(o => ['person'].includes(o))) {
            return `User needs help. A person is detected nearby — alert them.`;
        }
    }

    if (vision && speech) {
        const objs = vision?.detections?.map(d => d.label) || [];
        const txt  = typeof speech === 'string' ? speech : (speech?.text || '');
        if (/where/i.test(txt) && objs.length) {
            return `User asked "${txt}". Detected nearby: ${objs.slice(0,2).join(', ')}.`;
        }
    }

    if (gesture && speech) {
        const gesWords = Array.isArray(gesture) ? gesture : [gesture?.gesture || ''];
        const txt  = typeof speech === 'string' ? speech : (speech?.text || '');
        if (gesWords.length && txt) {
            return `Signing "${gesWords.join(' ')}" while saying "${txt}". Combined intent: ${gesWords.join(' ')} — ${txt}.`;
        }
    }

    return parts.join(' • ');
}

function getMostCriticalIntent(intents) {
    if (intents.includes('emergency')) return 'emergency';
    if (intents.includes('hazard'))    return 'hazard';
    if (intents.includes('warning'))   return 'warning';
    if (intents.includes('needs'))     return 'needs';
    if (intents.includes('navigation')) return 'navigation';
    return 'general';
}

function buildSuggestions(vision, speech, gesture, intents) {
    const s = [];
    if (intents.includes('emergency')) s.push('Activate SOS');
    if (intents.includes('hazard'))    s.push('Alert caregiver', 'Read hazard aloud');
    if (intents.includes('needs'))     s.push('Speak user\'s need aloud');
    if (intents.includes('navigation')) s.push('Open navigation assist');
    return s.slice(0, 3);
}
