/**
 * DashboardPage — Home screen matching the reference iOS-style design.
 *
 * Layout:
 *  ┌────────────────────────────────┐
 *  │  Hero card (blue gradient)     │
 *  │  SenseBridge logo + tagline    │
 *  │  Loading bar / status          │
 *  ├────────────────────────────────┤
 *  │  Navigation Mode      [blue]   │
 *  │  Read Text (OCR)      [green]  │
 *  │  Speech Mode          [purple] │
 *  │  Gesture Mode         [orange] │
 *  │  Multimodal Mode      [pink]   │
 *  └────────────────────────────────┘
 */

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFusion } from '../context/MultimodalFusionContext';
import AppLayout from '../layouts/AppLayout';
import {
    Navigation,
    ScanText,
    Mic,
    Hand,
    Layers,
    ChevronRight,
    Volume2,
    X,
    AlertTriangle,
} from 'lucide-react';
import { speak, cancelSpeech } from '../services/aiService';

/* ── Modality feature list ─────────────────────────────────────────────────── */
const FEATURES = [
    {
        to:        '/vision',
        state:     { mode: 'navigation' },
        icon:      Navigation,
        iconColor: 'var(--blue)',
        chipClass: 'icon-chip-blue',
        title:     'Navigation Mode',
        desc:      'Detect objects and obstacles',
        roles:     ['blind', 'mixed'],
    },
    {
        to:        '/vision',
        state:     { mode: 'ocr' },
        icon:      ScanText,
        iconColor: 'var(--green)',
        chipClass: 'icon-chip-green',
        title:     'Read Text (OCR)',
        desc:      'Extract and read text',
        roles:     ['blind', 'mixed'],
    },
    {
        to:        '/speech',
        state:     null,
        icon:      Mic,
        iconColor: 'var(--purple)',
        chipClass: 'icon-chip-purple',
        title:     'Speech Mode',
        desc:      'Convert speech to text',
        roles:     ['deaf', 'mixed'],
    },
    {
        to:        '/gesture',
        state:     null,
        icon:      Hand,
        iconColor: 'var(--orange)',
        chipClass: 'icon-chip-orange',
        title:     'Gesture Mode',
        desc:      'Recognize gestures and signs',
        roles:     ['mute', 'deaf', 'mixed'],
    },
    {
        to:        '/multimodal',
        state:     null,
        icon:      Layers,
        iconColor: 'var(--pink)',
        chipClass: 'icon-chip-pink',
        title:     'Multimodal Mode',
        desc:      'Use all AI features together',
        roles:     ['mixed', 'blind', 'deaf', 'mute'],
    },
    {
        to:        '/emergency',
        state:     null,
        icon:      AlertTriangle,
        iconColor: 'var(--red)',
        chipClass: 'icon-chip-red',
        title:     'Emergency SOS',
        desc:      'Instant GPS alert via Phone & Mail',
        roles:     ['mixed', 'blind', 'deaf', 'mute'],
    },
];

const DashboardPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { awareness, activeModals, fusionBusy, clearAwareness } = useFusion();

    const visibleFeatures = FEATURES;

    const speakAwareness = () => {
        if (!awareness?.text) return;
        cancelSpeech();
        speak(awareness.text, { priority: 'high' });
    };

    return (
        <AppLayout title="SenseBridge">
            {/* ── Hero Card ─────────────────────────────────────────────── */}
            <div className="hero-card animate-slide-up">
                {/* Decorative person icon */}
                <div style={{
                    position: 'absolute', right: 20, top: '50%',
                    transform: 'translateY(-50%)',
                    opacity: 0.18, zIndex: 0,
                }}>
                    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
                        <circle cx="45" cy="18" r="12" fill="white"/>
                        <path d="M25 42c0-11 8-18 20-18s20 7 20 18v8H25v-8z" fill="white"/>
                        <rect x="30" y="52" width="8" height="28" rx="4" fill="white"/>
                        <rect x="52" y="52" width="8" height="28" rx="4" fill="white"/>
                        <path d="M20 55 Q15 70 18 80" stroke="white" strokeWidth="7" strokeLinecap="round" fill="none"/>
                        <path d="M70 55 Q75 70 72 80" stroke="white" strokeWidth="7" strokeLinecap="round" fill="none"/>
                        {/* wifi waves */}
                        <path d="M72 30 Q82 45 72 60" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.7"/>
                        <path d="M78 24 Q92 45 78 66" stroke="white" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.4"/>
                    </svg>
                </div>

                <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.75)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                    }}>
                        SenseBridge
                    </div>
                    <h1 style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.55rem',
                        fontWeight: 800,
                        color: '#FFFFFF',
                        lineHeight: 1.25,
                        marginBottom: 8,
                        letterSpacing: '-0.02em',
                    }}>
                        Your AI Assistant for<br />
                        Navigation and<br />
                        Communication
                    </h1>

                    {/* Status / loading bar */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginTop: 16,
                    }}>
                        <div style={{
                            flex: 1,
                            height: 4,
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: 2,
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                height: '100%',
                                width: fusionBusy ? '70%' : '100%',
                                background: 'rgba(255,255,255,0.85)',
                                borderRadius: 2,
                                transition: 'width 0.8s ease',
                            }} />
                        </div>
                        <span style={{
                            fontSize: '0.72rem',
                            color: 'rgba(255,255,255,0.8)',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                        }}>
                            {fusionBusy ? 'Processing…' : 'Ready'}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Fusion awareness alert (when active) ──────────────────── */}
            {awareness && (
                <div
                    className="animate-slide-up"
                    style={{
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '14px 16px',
                        marginBottom: 16,
                        boxShadow: 'var(--shadow-md)',
                        borderLeft: `4px solid ${
                            awareness.priority === 'critical' ? 'var(--red)' :
                            awareness.priority === 'high'     ? 'var(--orange)' :
                            'var(--blue)'
                        }`,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                color: awareness.priority === 'critical' ? 'var(--red)' :
                                       awareness.priority === 'high'     ? 'var(--orange)' : 'var(--blue)',
                                marginBottom: 4,
                            }}>
                                {awareness.priority === 'critical' ? 'Critical Alert' :
                                 awareness.priority === 'high'     ? 'Attention' : 'Awareness'}
                            </div>
                            <p style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.45 }}>
                                {awareness.text}
                            </p>
                        </div>
                        <button
                            onClick={clearAwareness}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 2 }}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Source pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                        {Object.entries(awareness.sources || {}).map(([mod, active]) =>
                            active ? (
                                <span key={mod} className={`pill pill-${mod === 'vision' ? 'blue' : mod === 'speech' ? 'purple' : 'orange'}`}>
                                    {mod}
                                </span>
                            ) : null
                        )}
                        <div style={{ flex: 1 }} />
                        <button
                            onClick={speakAwareness}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                background: 'var(--blue-light)', border: 'none',
                                borderRadius: 'var(--radius-full)', padding: '5px 12px',
                                color: 'var(--blue)', fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            <Volume2 size={13} />
                            <span>Announce</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ── Feature Cards List ────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visibleFeatures.map(({ to, state: routeState, icon: Icon, iconColor, chipClass, title, desc }) => (
                    <button
                        key={title}
                        className="feature-card animate-slide-up"
                        onClick={() => navigate(to, routeState ? { state: routeState } : undefined)}
                    >
                        <div className={`icon-chip ${chipClass}`}>
                            <Icon size={24} color={iconColor} strokeWidth={2} />
                        </div>

                        <div className="feature-card-info">
                            <div className="feature-card-title">{title}</div>
                            <div className="feature-card-desc">{desc}</div>
                        </div>

                        <ChevronRight size={18} className="feature-card-chevron" color="var(--text-dim)" />
                    </button>
                ))}
            </div>

            {/* Bottom spacer */}
            <div style={{ height: 8 }} />
        </AppLayout>
    );
};

export default DashboardPage;
