import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppLayout from '../layouts/AppLayout';
import { Eye, Mic, Hand, Navigation, AlertTriangle, Activity, Zap, Crown } from 'lucide-react';

// ── All available feature modes ───────────────────────────────────────────────
const ALL_MODES = [
    {
        to: '/vision', icon: Eye, title: 'Vision Assist',
        roles: ['blind', 'mixed'],
        desc: 'Real-time object detection, face recognition, and audio navigation.',
        gradient: 'linear-gradient(135deg, #6C63FF 0%, #9B59B6 100%)',
        stats: 'YOLO Object Detection',
    },
    {
        to: '/speech', icon: Mic, title: 'Speech Assist',
        roles: ['deaf', 'mixed'],
        desc: 'Live speech-to-text captions and visual sound indicators.',
        gradient: 'linear-gradient(135deg, #00D4AA 0%, #0099CC 100%)',
        stats: 'Whisper AI Transcription',
    },
    {
        to: '/gesture', icon: Hand, title: 'Gesture Assist',
        roles: ['mute', 'deaf', 'mixed'],
        desc: 'Hand gesture recognition to enable touchless communication.',
        gradient: 'linear-gradient(135deg, #FFA94D 0%, #FF6B6B 100%)',
        stats: 'MediaPipe Gestures',
    },
    {
        to: '/navigation', icon: Navigation, title: 'Navigation',
        roles: ['blind', 'mixed'],
        desc: 'Turn-by-turn audio navigation with obstacle detection.',
        gradient: 'linear-gradient(135deg, #FF6B9D 0%, #C44FFF 100%)',
        stats: 'OpenStreetMap + OSRM',
    },
];

const ROLE_SUBTITLE = {
    blind:  'Your Vision Assist & Navigation features are ready.',
    deaf:   'Your Speech Assist & Gesture features are ready.',
    mute:   'Your Gesture Assist features are ready.',
    mixed:  'All assistive modes are available for you.',
};

const QUICK_LINKS = [
    { to: '/emergency', icon: AlertTriangle, label: 'Emergency SOS', color: 'var(--color-danger)' },
    { to: '/logs', icon: Activity, label: 'View Logs', color: 'var(--color-accent)' },
    { to: '/settings', icon: Zap, label: 'Settings', color: 'var(--color-primary)' },
];

const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
};

const DashboardPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Admins see all modes; others see only role-relevant ones
    const visibleModes = user?.isAdmin
        ? ALL_MODES
        : ALL_MODES.filter(m => m.roles.includes(user?.role));

    return (
        <AppLayout>
            {/* Header */}
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    Good {getGreeting()}, {user?.name?.split(' ')[0]} 👋
                    {user?.isAdmin && (
                        <span style={{ fontSize: '0.9rem', background: 'rgba(255,198,0,0.15)', color: '#FFC600', padding: '3px 12px', borderRadius: 20, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Crown size={13} /> Admin
                        </span>
                    )}
                </h1>
                <p style={{ color: 'var(--text-muted)' }}>
                    {user?.isAdmin ? 'Admin view — all features visible.' : (ROLE_SUBTITLE[user?.role] || 'SenseBridge is ready.')}
                </p>
            </div>

            {/* Mode Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                {visibleModes.map(({ to, icon: Icon, title, desc, gradient, stats, roles }) => {
                    const isRecommended = roles?.includes(user?.role);
                    return (
                        <button key={to}
                            onClick={() => navigate(to)}
                            style={{
                                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                borderRadius: 20, padding: '1.5rem', cursor: 'pointer', textAlign: 'left',
                                transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column', gap: '1rem',
                                position: 'relative', overflow: 'hidden',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.2)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                        >
                            {/* Gradient strip */}
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: gradient, borderRadius: '20px 20px 0 0' }} />
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ width: 52, height: 52, borderRadius: 14, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                    <Icon size={24} />
                                </div>
                                {isRecommended && (
                                    <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>Recommended</span>
                                )}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 6 }}>{title}</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>{desc}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                <Activity size={12} /> {stats}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Quick links */}
            <div style={{ marginBottom: '0.75rem', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Quick Actions
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {QUICK_LINKS.map(({ to, icon: Icon, label, color }) => (
                    <button key={to} onClick={() => navigate(to)} className="btn btn-ghost" style={{ gap: '0.5rem', color }}>
                        <Icon size={16} /> {label}
                    </button>
                ))}
                {user?.isAdmin && (
                    <button onClick={() => navigate('/admin')} className="btn btn-ghost" style={{ gap: '0.5rem', color: '#FFC600' }}>
                        <Crown size={16} /> Admin Panel
                    </button>
                )}
            </div>
        </AppLayout>
    );
};

export default DashboardPage;
