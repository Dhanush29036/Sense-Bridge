import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFusion } from '../context/MultimodalFusionContext';
import AppLayout from '../layouts/AppLayout';
import {
    Eye, MessageSquare, Hand, AlertTriangle,
    Bell, Settings as SettingsIcon, ChevronRight,
    Mic, Zap, Brain, RefreshCw, Volume2,
} from 'lucide-react';
import { speak, cancelSpeech } from '../services/aiService';

const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
};

const FEATURES = [
    {
        to: '/vision',
        icon: Eye,
        title: 'Vision Assist',
        desc: 'Object detection & navigation guidance',
        badge: '● AI ACTIVE',
        badgeColor: '#6C63FF',
        gradient: 'linear-gradient(135deg, #1a1560 0%, #2d2080 50%, #1a157a 100%)',
        iconBg: 'rgba(108,99,255,0.3)',
        roles: ['blind', 'mixed'],
        modalKey: 'vision',
    },
    {
        to: '/speech',
        icon: MessageSquare,
        title: 'Speech Assist',
        desc: 'Live captions & speech recognition',
        badge: '● REAL-TIME',
        badgeColor: '#00D4AA',
        gradient: 'linear-gradient(135deg, #0a2e28 0%, #0d4035 50%, #0a3530 100%)',
        iconBg: 'rgba(0,212,170,0.2)',
        roles: ['deaf', 'mixed'],
        modalKey: 'speech',
    },
    {
        to: '/gesture',
        icon: Hand,
        title: 'Gesture Assist',
        desc: 'Sign language & gesture recognition',
        badge: '● HAND TRACKING',
        badgeColor: '#8B5CF6',
        gradient: 'linear-gradient(135deg, #200a40 0%, #2e1060 50%, #281058 100%)',
        iconBg: 'rgba(139,92,246,0.25)',
        roles: ['mute', 'deaf', 'mixed'],
        modalKey: 'gesture',
    },
];

const PRIORITY_STYLE = {
    critical: { bg: 'rgba(255,75,110,0.12)', border: '#FF4B6E', dot: '#FF4B6E', label: 'CRITICAL' },
    high:     { bg: 'rgba(255,169,77,0.12)',  border: '#FFA94D', dot: '#FFA94D', label: 'HIGH PRIORITY' },
    normal:   { bg: 'rgba(108,99,255,0.10)',  border: '#6C63FF', dot: '#00D4AA', label: 'INSIGHT' },
};

const INTENT_ICON = {
    emergency:  '🚨', hazard: '⚠️', warning: '🛑', needs: '🙏',
    navigation: '🧭', social: '👋', general: '🧠',
};

const DashboardPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { awareness, activeModals, fusionBusy, clearAwareness } = useFusion();

    const visibleFeatures = user?.isAdmin
        ? FEATURES
        : FEATURES.filter(f => f.roles.includes(user?.role));

    const priorityStyle = awareness ? (PRIORITY_STYLE[awareness.priority] || PRIORITY_STYLE.normal) : null;

    const speakAwareness = () => {
        if (!awareness?.text) return;
        cancelSpeech();
        speak(awareness.text, { priority: 'high' });
    };

    // Active modalities for the fusion status bar
    const activeCount = Object.values(activeModals).filter(Boolean).length;

    return (
        <AppLayout>
            {/* ── Status bar ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.08em' }}>
                    <span className="live-dot" />
                    ALL SYSTEMS ACTIVE
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="icon-btn" onClick={() => navigate('/settings')} style={{ width: 36, height: 36 }}>
                        <Bell size={17} />
                    </button>
                    <button className="icon-btn" onClick={() => navigate('/settings')} style={{ width: 36, height: 36 }}>
                        <SettingsIcon size={17} />
                    </button>
                </div>
            </div>

            {/* ── Greeting ───────────────────────────────────────────── */}
            <h1 style={{ fontSize: '1.9rem', fontWeight: 800, marginBottom: '1rem', lineHeight: 1.2 }}>
                Good {getGreeting()},<br />
                <span style={{ color: 'var(--color-accent)' }}>{user?.name?.split(' ')[0] || 'Alex'}</span> 👋
            </h1>

            {/* ══════════════════════════════════════════════════════════
                MULTIMODAL FUSION PANEL
                Shows live correlated insights from all 3 AI modalities
                ══════════════════════════════════════════════════════════ */}
            <div style={{
                background: 'linear-gradient(135deg, #0d0d2b 0%, #130c28 100%)',
                border: `1.5px solid ${priorityStyle ? priorityStyle.border : 'rgba(108,99,255,0.3)'}`,
                borderRadius: 18,
                marginBottom: '1rem',
                overflow: 'hidden',
                transition: 'border-color 0.4s ease',
            }}>
                {/* Fusion header */}
                <div style={{ padding: '0.65rem 0.9rem', borderBottom: '1px solid rgba(108,99,255,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Brain size={14} style={{ color: '#C4B5FD' }} />
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#C4B5FD', letterSpacing: '0.1em' }}>
                        MULTIMODAL AI FUSION
                    </span>
                    {fusionBusy && (
                        <RefreshCw size={11} style={{ color: '#C4B5FD', marginLeft: 4, animation: 'spin 1s linear infinite' }} />
                    )}

                    {/* Active modal indicators */}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {FEATURES.map(f => {
                            const isActive = activeModals[f.modalKey];
                            return (
                                <div
                                    key={f.modalKey}
                                    title={f.title}
                                    style={{
                                        width: 22, height: 22, borderRadius: 7,
                                        background: isActive ? `${f.badgeColor}22` : 'rgba(255,255,255,0.04)',
                                        border: `1.5px solid ${isActive ? f.badgeColor : 'rgba(255,255,255,0.08)'}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.3s',
                                    }}
                                >
                                    <f.icon size={11} color={isActive ? f.badgeColor : 'rgba(255,255,255,0.2)'} />
                                </div>
                            );
                        })}
                        {activeCount >= 2 && (
                            <span style={{ fontSize: '0.55rem', color: '#00D4AA', fontWeight: 700, marginLeft: 2 }}>
                                {activeCount}× FUSED
                            </span>
                        )}
                    </div>
                </div>

                {/* Fusion content */}
                <div style={{ padding: '0.75rem 0.9rem' }}>
                    {awareness ? (
                        <>
                            {/* Priority badge */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                <span style={{ fontSize: '1rem' }}>{INTENT_ICON[awareness.intent] || '🧠'}</span>
                                <span style={{
                                    fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em',
                                    color: priorityStyle.dot, background: priorityStyle.bg,
                                    padding: '2px 8px', borderRadius: 6,
                                }}>
                                    {priorityStyle.label}
                                </span>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                    {awareness.fused_at}
                                </span>
                            </div>

                            {/* Main awareness text */}
                            <p style={{
                                fontSize: '0.92rem', fontWeight: 600,
                                color: '#E8E0FF', lineHeight: 1.5,
                                margin: '0 0 0.6rem 0',
                            }}>
                                {awareness.text}
                            </p>

                            {/* Suggestions */}
                            {awareness.suggestions?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                                    {awareness.suggestions.map((s, i) => (
                                        <span key={i} style={{
                                            fontSize: '0.62rem', padding: '3px 10px', borderRadius: 20,
                                            background: 'rgba(0,212,170,0.1)',
                                            border: '1px solid rgba(0,212,170,0.25)',
                                            color: '#00D4AA', fontWeight: 600,
                                        }}>
                                            → {s}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Source chips + actions */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {Object.entries(awareness.sources || {}).map(([mod, active]) =>
                                    active ? (
                                        <span key={mod} style={{
                                            fontSize: '0.58rem', padding: '1px 7px', borderRadius: 10,
                                            background: 'rgba(255,255,255,0.06)',
                                            color: 'var(--text-muted)', fontWeight: 600,
                                        }}>
                                            {mod}
                                        </span>
                                    ) : null
                                )}
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                                    <button onClick={speakAwareness} style={{ background: 'rgba(108,99,255,0.2)', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                                        <Volume2 size={13} style={{ color: '#C4B5FD' }} />
                                    </button>
                                    <button onClick={clearAwareness} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        /* Empty state */
                        <div style={{ textAlign: 'center', padding: '0.75rem 0', color: 'var(--text-muted)' }}>
                            <Zap size={20} style={{ color: 'rgba(108,99,255,0.3)', marginBottom: 6 }} />
                            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 3 }}>
                                Fusion Standby
                            </div>
                            <div style={{ fontSize: '0.68rem', lineHeight: 1.4 }}>
                                Run any 2+ AI modes together.<br />
                                Insights will appear here automatically.
                            </div>
                        </div>
                    )}
                </div>

                {/* Fusion progress dots (animated when busy) */}
                {fusionBusy && (
                    <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #6C63FF, #8B5CF6, transparent)', animation: 'shimmer 1.5s infinite' }} />
                )}
            </div>

            {/* ── Voice navigation bar ───────────────────────────────── */}
            <div style={{
                background: 'var(--bg-card)',
                border: '1.5px solid var(--color-accent)',
                borderRadius: 14,
                padding: '0.75rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1.25rem',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(0,212,170,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Mic size={18} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-accent)' }}>Voice Navigation Active</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Say "Open Vision" or "Start Caption"</div>
                    </div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>◁▷</div>
            </div>

            {/* ── Feature cards ──────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1rem' }}>
                {visibleFeatures.map(({ to, icon: Icon, title, desc, badge, badgeColor, gradient, iconBg, modalKey }) => {
                    const isLive = activeModals[modalKey];
                    return (
                        <button
                            key={to}
                            className="feature-card"
                            onClick={() => navigate(to)}
                            style={{
                                background: gradient,
                                boxShadow: isLive ? `0 0 0 1.5px ${badgeColor}55` : 'none',
                                transition: 'box-shadow 0.3s',
                            }}
                        >
                            <div className="feature-card-icon" style={{ background: iconBg }}>
                                <Icon size={26} color="#fff" strokeWidth={1.75} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 3 }}>{title}</div>
                                <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', marginBottom: 6, lineHeight: 1.35 }}>{desc}</div>
                                <span style={{
                                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em',
                                    color: badgeColor, background: `${badgeColor}22`,
                                    padding: '2px 8px', borderRadius: 6,
                                }}>
                                    {isLive ? '● FEEDING FUSION' : badge}
                                </span>
                            </div>
                            <ChevronRight size={18} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                        </button>
                    );
                })}
            </div>

            {/* ── Emergency SOS ──────────────────────────────────────── */}
            <button
                className="emergency-card"
                onClick={() => navigate('/emergency')}
                style={{ marginBottom: '0.5rem' }}
            >
                <AlertTriangle size={22} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>Emergency SOS</span>
                <span style={{ letterSpacing: 2, opacity: 0.5, fontSize: '0.9rem' }}>···</span>
            </button>
        </AppLayout>
    );
};

export default DashboardPage;
