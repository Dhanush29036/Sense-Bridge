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
// keywords: any phrase containing one of these strings triggers the command
const COMMANDS = [
    // ── Page actions (dispatched as CustomEvents) ────────────────────────
    // These specific actions must come BEFORE generic navigation to prevent collisions
    { keywords: ['start vision', 'start vision assist', 'begin vision', 'activate camera', 'turn on camera'],
      action: 'event', event: 'vc:start',  path: '/vision',   label: 'Start Vision Assist',
      tts: 'Starting Vision Assist camera' },
    { keywords: ['stop vision', 'stop vision assist', 'deactivate camera', 'turn off camera'],
      action: 'event', event: 'vc:stop',    label: 'Stop Vision Assist',
      tts: 'Stopping camera' },
    { keywords: ['start speech', 'start speech assist', 'begin listening', 'activate microphone'],
      action: 'event', event: 'vc:start',  path: '/speech',   label: 'Start Speech Assist',
      tts: 'Starting Speech Assist microphone' },
    { keywords: ['stop speech', 'stop speech assist', 'deactivate microphone', 'stop recording'],
      action: 'event', event: 'vc:stop',    label: 'Stop Speech Assist',
      tts: 'Stopping microphone' },
    { keywords: ['start gesture', 'start gesture assist', 'begin gesture'],
      action: 'event', event: 'vc:start',  path: '/gesture',   label: 'Start Gesture Assist',
      tts: 'Starting Gesture Assist detection' },
    { keywords: ['stop gesture', 'stop gesture assist', 'deactivate gesture'],
      action: 'event', event: 'vc:stop',    label: 'Stop Gesture Assist',
      tts: 'Stopping gesture detection' },
    { keywords: ['start navigation', 'begin navigation', 'start guidance'],
      action: 'event', event: 'vc:start',  path: '/navigation',   label: 'Start Navigation',
      tts: 'Starting navigation' },
    { keywords: ['stop navigation', 'stop guidance', 'cancel navigation'],
      action: 'event', event: 'vc:stop',    label: 'Stop Navigation',
      tts: 'Stopping navigation' },
    { keywords: ['send sos', 'trigger sos', 'emergency alert'],
      action: 'event', event: 'vc:sos',     path: '/emergency', label: 'Send SOS',
      tts: 'Triggering SOS alert' },

    // ── Navigation ──────────────────────────────────────────────────────
    { keywords: ['dashboard', 'home', 'go home', 'main page'],
      action: 'navigate', path: '/dashboard',   label: 'Dashboard',
      tts: 'Opening Dashboard' },
    { keywords: ['vision assist', 'vision', 'camera', 'detect objects', 'object detection'],
      action: 'navigate', path: '/vision',      label: 'Vision Assist',
      tts: 'Opening Vision Assist' },
    { keywords: ['speech assist', 'speech', 'captions', 'transcribe', 'speech to text'],
      action: 'navigate', path: '/speech',      label: 'Speech Assist',
      tts: 'Opening Speech Assist' },
    { keywords: ['gesture assist', 'gesture', 'sign language', 'hand gesture'],
      action: 'navigate', path: '/gesture',     label: 'Gesture Assist',
      tts: 'Opening Gesture Assist' },
    { keywords: ['navigation', 'maps', 'directions', 'navigate to', 'path guidance', 'map'],
      action: 'navigate', path: '/navigation',  label: 'Navigation',
      tts: 'Opening Navigation and path guidance' },
    { keywords: ['emergency', 'danger', 'sos', 'help me', 'i need help', 'call help'],
      action: 'navigate', path: '/emergency',   label: 'Emergency',
      tts: 'Opening Emergency page. Stay calm.' },
    { keywords: ['logs', 'history', 'activity log'],
      action: 'navigate', path: '/logs',        label: 'Logs',
      tts: 'Opening Activity Logs' },
    { keywords: ['settings', 'preferences', 'configuration'],
      action: 'navigate', path: '/settings',    label: 'Settings',
      tts: 'Opening Settings' },

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

const HELP_TEXT = `You can say: Open Vision Assist, Open Speech Assist, Open Gesture Assist,
Open Navigation, Open Emergency, Open Dashboard, Open Settings, Open Logs,
Start Camera, Stop Camera, Start Listening, Stop Listening,
Send SOS, Go Back, Scroll Down, Scroll Up, Stop Voice Control.`;

// ── Fuzzy match: does transcript contain any of the keywords? ─────────────
function matchCommand(transcript) {
    const t = transcript.toLowerCase().trim();
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
        if (cmd.path === '/navigation') {
            const match = transcript.match(/(?:navigate to|directions to)\s+(.+)/i);
            if (match && match[1]) {
                state = { destinationQuery: match[1].trim(), autoNavigate: true };
            }
        }

        if (cmd.path) {
            navigate(cmd.path, { state });
        }

        switch (cmd.action) {
            case 'event':
                // Small delay to ensure navigation completes if path was changed
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
