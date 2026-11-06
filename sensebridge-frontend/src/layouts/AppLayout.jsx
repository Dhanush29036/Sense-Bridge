import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useVoiceCommands } from '../context/VoiceCommandContext';
import { useFusion } from '../context/MultimodalFusionContext';
import {
    Home,
    History,
    FlaskConical,
    Settings,
    ChevronLeft,
    Settings2,
    Mic,
    AlertTriangle,
} from 'lucide-react';

const TABS = [
    { to: '/dashboard', label: 'Home',        Icon: Home },
    { to: '/logs',      label: 'History',     Icon: History },
    { to: '/research',  label: 'Experiments', Icon: FlaskConical },
    { to: '/settings',  label: 'Settings',    Icon: Settings },
];

/**
 * AppLayout — iOS-style shell with sticky top bar + bottom tab bar.
 *
 * Props:
 *   title       — page title shown in top bar
 *   showBack    — show a back chevron (navigates to -1)
 *   backLabel   — label for back button (default "Back")
 *   rightAction — JSX element on the right side of top bar
 *   noPad       — if true, remove inner padding (for full-bleed camera pages)
 *   hideTabs    — hide the bottom tab bar
 *   noScroll    — don't add overflow scroll to main area
 */
const AppLayout = ({
    children,
    title        = 'SenseBridge',
    showBack     = false,
    backLabel    = 'Back',
    rightAction  = null,
    noPad        = false,
    hideTabs     = false,
    noScroll     = false,
}) => {
    const { user }  = useAuth();
    const { theme } = useTheme();
    const { enabled: vcEnabled, setEnabled: setVcEnabled, feedback } = useVoiceCommands();
    const location  = useLocation();
    const navigate  = useNavigate();

    const activeTab = TABS.find(t => location.pathname.startsWith(t.to));

    return (
        <div data-theme={theme} className="app-shell" style={{ fontFamily: 'var(--font-sans)' }}>

            {/* ── Voice feedback toast ─────────────────────────────────── */}
            {feedback && (
                <div style={{
                    position: 'fixed', top: 72, left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(30,30,46,0.92)',
                    backdropFilter: 'blur(12px)',
                    color: '#E0E7FF',
                    padding: '8px 18px',
                    borderRadius: 9999,
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                    zIndex: 999,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    animation: 'fadeIn 0.2s ease forwards',
                    whiteSpace: 'nowrap',
                }}>
                    <Mic size={13} color="#818CF8" />
                    <span>{feedback}</span>
                </div>
            )}

            {/* ── Top Bar ──────────────────────────────────────────────── */}
            <header className="top-bar">
                {/* Left: back or voice mic */}
                <div style={{ width: 80, display: 'flex', alignItems: 'center' }}>
                    {showBack ? (
                        <button className="top-bar-back" onClick={() => navigate(-1)}>
                            <ChevronLeft size={20} />
                            <span>{backLabel}</span>
                        </button>
                    ) : (
                        <button
                            className="top-bar-action"
                            onClick={() => setVcEnabled(!vcEnabled)}
                            title={vcEnabled ? 'Disable voice commands' : 'Enable voice commands'}
                        >
                            <Mic size={19} color={vcEnabled ? 'var(--blue)' : 'var(--text-dim)'} />
                        </button>
                    )}
                </div>

                {/* Center: title */}
                <div className="top-bar-title">{title}</div>

                {/* Right: action or settings */}
                <div style={{ minWidth: 80, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {location.pathname !== '/emergency' && (
                        <button
                            onClick={() => navigate('/emergency')}
                            style={{
                                background: 'linear-gradient(135deg, #FF4B6E, #E03131)',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: 14,
                                padding: '4px 9px',
                                fontSize: '0.73rem',
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(255, 75, 110, 0.45)',
                                letterSpacing: '0.04em',
                                flexShrink: 0,
                            }}
                            title="Emergency SOS"
                        >
                            <AlertTriangle size={13} strokeWidth={2.6} />
                            <span>SOS</span>
                        </button>
                    )}
                    {rightAction ?? (
                        <button
                            className="top-bar-action"
                            onClick={() => navigate('/settings')}
                            title="Settings"
                        >
                            <Settings2 size={19} color="var(--text-muted)" />
                        </button>
                    )}
                </div>
            </header>

            {/* ── Page Content ─────────────────────────────────────────── */}
            <main
                className={noPad ? 'page-scroll-noPad' : 'page-scroll'}
                style={noScroll ? { overflow: 'hidden' } : {}}
            >
                {children}
            </main>

            {/* ── Bottom Tab Bar ───────────────────────────────────────── */}
            {!hideTabs && (
                <nav className="bottom-tab-bar">
                    {TABS.map(({ to, label, Icon }) => {
                        const isActive = location.pathname === to ||
                            (to === '/dashboard' && location.pathname === '/');
                        return (
                            <NavLink
                                key={to}
                                to={to}
                                className={`tab-item${isActive ? ' active' : ''}`}
                            >
                                <Icon
                                    size={24}
                                    strokeWidth={isActive ? 2.2 : 1.8}
                                    color={isActive ? 'var(--blue)' : 'var(--text-dim)'}
                                />
                                <span>{label}</span>
                            </NavLink>
                        );
                    })}
                </nav>
            )}
        </div>
    );
};

export default AppLayout;
