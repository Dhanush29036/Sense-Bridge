/**
 * VoiceCommandContext.jsx — Global Speech Command System
 *
 * Always-on Web Speech API listener that maps spoken phrases to:
 *   • Page navigation  ("open vision assist", "go to emergency")
 *   • Page actions     ("start camera", "stop", "send SOS")
 *   • App control      ("help", "list commands", "read page")
 *
 * Dispatches CustomEvents for page-specific actions so pages can react
 * without tight coupling.
 *
 * Toggle: Alt+V keyboard shortcut, or click the mic button in the top bar.
 * TTS confirms every recognised command ("Opening Vision Assist…").
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const VoiceCommandContext = createContext({});
export const useVoiceCommands = () => useContext(VoiceCommandContext);

// ── Command table ──────────────────────────────────────────────────────────
// Each entry: { keywords, action, label, tts }
// Specific multi-word commands come first to prevent generic keyword collisions.
const COMMANDS = [
    // ── Module-specific Start Actions ─────────────────────────────────────
    { keywords: ['start vision', 'start the vision', 'begin vision', 'activate camera', 'turn on camera', 'enable camera', 'start camera'],
      action: 'event', event: 'vc:start',  path: '/vision',   label: 'Start Vision Assist',
      tts: 'Starting Vision Assist camera' },
    { keywords: ['stop vision', 'stop the vision', 'deactivate camera', 'turn off camera', 'disable camera', 'stop camera'],
      action: 'event', event: 'vc:stop',    label: 'Stop Vision Assist',
      tts: 'Stopping camera' },

    { keywords: ['start speech', 'start the speech', 'begin listening', 'activate microphone', 'turn on microphone', 'enable microphone', 'start microphone', 'start recording', 'start listening'],
      action: 'event', event: 'vc:start',  path: '/speech',   label: 'Start Speech Assist',
      tts: 'Starting Speech Assist microphone' },
    { keywords: ['stop speech', 'stop the speech', 'deactivate microphone', 'stop recording', 'turn off microphone', 'stop listening'],
      action: 'event', event: 'vc:stop',    label: 'Stop Speech Assist',
      tts: 'Stopping microphone' },

    { keywords: ['start gesture', 'start the gesture', 'begin gesture', 'turn on gesture', 'activate gesture', 'enable gesture', 'start signs'],
      action: 'event', event: 'vc:start',  path: '/gesture',   label: 'Start Gesture Assist',
      tts: 'Starting Gesture Assist detection' },
    { keywords: ['stop gesture', 'stop the gesture', 'deactivate gesture', 'turn off gesture', 'disable gesture'],
      action: 'event', event: 'vc:stop',    label: 'Stop Gesture Assist',
      tts: 'Stopping gesture detection' },

    { keywords: ['start navigation', 'begin navigation', 'start guidance', 'start route'],
      action: 'event', event: 'vc:start',  path: '/navigation',   label: 'Start Navigation',
      tts: 'Starting navigation' },
    { keywords: ['stop navigation', 'stop guidance', 'cancel navigation', 'end navigation'],
      action: 'event', event: 'vc:stop',    label: 'Stop Navigation',
      tts: 'Stopping navigation' },

    { keywords: ['send sos', 'trigger sos', 'emergency alert', 'send emergency'],
      action: 'event', event: 'vc:sos',     path: '/emergency', label: 'Send SOS',
      tts: 'Triggering SOS alert' },

    // ── Navigation ("Open X") ─────────────────────────────────────────────
    { keywords: ['open dashboard', 'go to dashboard', 'dashboard', 'open home', 'go home', 'home', 'main page'],
      action: 'navigate', path: '/dashboard',   label: 'Dashboard',
      tts: 'Opening Dashboard' },
    { keywords: ['open vision assist', 'open vision', 'vision assist', 'vision', 'open camera', 'detect objects', 'object detection'],
      action: 'navigate', path: '/vision',      label: 'Vision Assist',
      tts: 'Opening Vision Assist' },
    { keywords: ['open speech assist', 'open speech', 'speech assist', 'speech', 'speech to text', 'captions', 'transcribe'],
      action: 'navigate', path: '/speech',      label: 'Speech Assist',
      tts: 'Opening Speech Assist' },
    { keywords: ['open gesture assist', 'open gesture', 'gesture assist', 'gesture', 'sign language', 'hand gesture'],
      action: 'navigate', path: '/gesture',     label: 'Gesture Assist',
      tts: 'Opening Gesture Assist' },
    { keywords: ['open navigation', 'open maps', 'open map', 'navigation', 'maps', 'directions', 'navigate to', 'path guidance', 'map'],
      action: 'navigate', path: '/navigation',  label: 'Navigation',
      tts: 'Opening Navigation and path guidance' },
    { keywords: ['open emergency', 'emergency', 'danger', 'open sos', 'sos', 'help me', 'i need help', 'call help'],
      action: 'navigate', path: '/emergency',   label: 'Emergency',
      tts: 'Opening Emergency page. Stay calm.' },
    { keywords: ['open experiments', 'open research', 'experiments', 'research mode', 'experiment mode', 'ablation', 'research'],
      action: 'navigate', path: '/research',    label: 'Experiments',
      tts: 'Opening Research and Experiments' },
    { keywords: [
        'open multi modal mode', 'open multimodal mode',
        'open multi modal', 'open multimodal',
        'multi modal mode', 'multimodal mode',
        'multi modal', 'multimodal',
        'open fusion mode', 'open fusion',
        'sensor fusion', 'fusion mode', 'fusion'
      ],
      action: 'navigate', path: '/multimodal',  label: 'Multimodal Fusion',
      tts: 'Opening Multimodal Fusion' },
    { keywords: ['where do i go', 'which direction', 'repeat direction', 'current direction', 'next turn', 'repeat turn'],
      action: 'event', event: 'vc:direction',   label: 'Repeat Direction',
      tts: '' },
    { keywords: ['open logs', 'logs', 'open history', 'history', 'activity log'],
      action: 'navigate', path: '/logs',        label: 'Logs',
      tts: 'Opening Activity Logs' },
    { keywords: ['open settings', 'settings', 'preferences', 'configuration'],
      action: 'navigate', path: '/settings',    label: 'Settings',
      tts: 'Opening Settings' },

    // ── Generic Start / Stop for Current Active Module ────────────────────
    { keywords: ['start now', 'start detection', 'start', 'begin', 'activate', 'turn on'],
      action: 'event', event: 'vc:start',       label: 'Start Active Module',
      tts: 'Starting' },
    { keywords: ['stop now', 'stop detection', 'stop', 'pause', 'deactivate', 'turn off', 'halt'],
      action: 'event', event: 'vc:stop',        label: 'Stop Active Module',
      tts: 'Stopping' },

    // ── Scrolling & Back ──────────────────────────────────────────────────
    { keywords: ['scroll down', 'page down'],
      action: 'scroll', dir: 300,               label: 'Scroll Down',
      tts: '' },
    { keywords: ['scroll up', 'page up'],
      action: 'scroll', dir: -300,              label: 'Scroll Up',
      tts: '' },
    { keywords: ['go back', 'previous page', 'back'],
      action: 'back',                           label: 'Go Back',
      tts: 'Going back' },

    // ── Meta ─────────────────────────────────────────────────────────────
    { keywords: ['help', 'what can i say', 'list commands', 'commands', 'what commands'],
      action: 'help',                           label: 'Help',
      tts: '' },
    { keywords: ['stop voice control', 'turn off voice', 'disable voice', 'stop commands'],
      action: 'disable',                        label: 'Disable Voice Control',
      tts: 'Voice control disabled' },
];

const HELP_TEXT = `You can say: Open Vision, Open Speech, Open Gesture, Open Navigation,
Open Experiments, Open Emergency, Open Dashboard, Open Settings, Open Logs,
Start, Stop, Send SOS, Go Back, Scroll Down, Scroll Up.`;

// ── Fuzzy match: does transcript contain any of the keywords? ─────────────
function matchCommand(transcript) {
    const t = transcript.toLowerCase().replace(/[.,!?]/g, '').trim();
    for (const cmd of COMMANDS) {
        if (cmd.keywords.some(kw => t.includes(kw))) return cmd;
    }
    return null;
}

// ── Native TTS (separate from aiService to avoid circular deps) ───────────
function tts(text, rate = 1.05) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate; u.pitch = 1; u.volume = 1;
    window.speechSynthesis.speak(u);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════════════
export const VoiceCommandProvider = ({ children }) => {
    const navigate  = useNavigate();
    const location  = useLocation();
    const [enabled, setEnabled]       = useState(false);
    const [listening, setListening]   = useState(false);
    const [lastCommand, setLastCmd]   = useState('');
    const [feedback, setFeedback]     = useState('');    // transient display
    const recogRef  = useRef(null);
    const fbTimer   = useRef(null);

    // ── Show brief feedback bubble ─────────────────────────────────────────
    const showFeedback = useCallback((text) => {
        clearTimeout(fbTimer.current);
        setFeedback(text);
        fbTimer.current = setTimeout(() => setFeedback(''), 3000);
    }, []);

    // ── Execute a matched command ──────────────────────────────────────────
    const execute = useCallback((cmd, transcript) => {
        setLastCmd(cmd.label);
        if (cmd.tts) tts(cmd.tts);
        showFeedback(`"${transcript}" → ${cmd.label}`);

        let state = undefined;
        if (cmd.event === 'vc:start') {
            state = { autoStart: true };
        }
        if (cmd.path === '/navigation') {
            const match = transcript.match(/(?:navigate to|directions to)\s+(.+)/i);
            if (match && match[1]) {
                state = { ...state, destinationQuery: match[1].trim(), autoNavigate: true };
            }
        }

        if (cmd.path) {
            navigate(cmd.path, { state });
        }

        switch (cmd.action) {
            case 'event':
                // Small delay to ensure navigation completes if path was changed, 
                // but we also rely on autoStart state for robustness.
                const dispatch = () => window.dispatchEvent(new CustomEvent(cmd.event, { detail: { source: 'voice' } }));
                if (cmd.path) setTimeout(dispatch, 800); else dispatch();
                break;
            case 'scroll':
                window.scrollBy({ top: cmd.dir, behavior: 'smooth' });
                break;
            case 'back':
                navigate(-1);
                break;
            case 'help':
                tts(HELP_TEXT, 0.95);
                showFeedback('Listing all commands…');
                break;
            case 'disable':
                setEnabled(false);
                break;
            default: break;
        }
    }, [navigate, showFeedback]);

    // ── Build / tear down recognition ─────────────────────────────────────
    useEffect(() => {
        if (!enabled) {
            recogRef.current?.stop();
            recogRef.current = null;
            setListening(false);
            return;
        }

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert('Speech recognition not supported in this browser.'); return; }

        const r = new SR();
        r.continuous      = true;
        r.interimResults  = false;
        r.lang            = 'en-US';
        r.maxAlternatives = 3;

        r.onstart  = () => setListening(true);
        r.onend    = () => {
            setListening(false);
            // auto-restart so it stays always-on
            if (enabled) { try { r.start(); } catch {} }
        };
        r.onerror  = (e) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            console.warn('[VoiceCmd] error:', e.error);
        };

        r.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (!event.results[i].isFinal) continue;
                // Try all alternatives
                for (let a = 0; a < event.results[i].length; a++) {
                    const transcript = event.results[i][a].transcript;
                    const cmd = matchCommand(transcript);
                    if (cmd) { execute(cmd, transcript); break; }
                }
            }
        };

        recogRef.current = r;
        try { r.start(); } catch {}

        return () => { r.onend = null; r.stop(); };
    }, [enabled, execute]);

    // ── Alt+V keyboard toggle ─────────────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            if (e.altKey && e.key === 'v') {
                e.preventDefault();
                setEnabled(prev => {
                    const next = !prev;
                    tts(next ? 'Voice control activated. Say Help for commands.' : 'Voice control off.');
                    return next;
                });
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // ── Announce page changes ─────────────────────────────────────────────
    const prevPath = useRef('');
    useEffect(() => {
        if (!enabled || location.pathname === prevPath.current) return;
        prevPath.current = location.pathname;
        const labels = {
            '/dashboard': 'Dashboard', '/vision': 'Vision Assist', '/speech': 'Speech Assist',
            '/gesture': 'Gesture Assist', '/navigation': 'Navigation', '/emergency': 'Emergency',
            '/logs': 'Logs', '/settings': 'Settings',
        };
        const name = labels[location.pathname];
        if (name) setTimeout(() => tts(`${name} page loaded`), 400);
    }, [location.pathname, enabled]);

    return (
        <VoiceCommandContext.Provider value={{ enabled, setEnabled, listening, lastCommand, feedback }}>
            {children}
        </VoiceCommandContext.Provider>
    );
};
