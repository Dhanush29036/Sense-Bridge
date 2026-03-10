import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useVoiceCommands } from '../context/VoiceCommandContext';
import {
    Eye, Mic, MicOff, Hand, LayoutDashboard, Settings,
    AlertTriangle, ScrollText, LogOut, Sun, Moon, Contrast, ChevronLeft, Menu, Navigation
} from 'lucide-react';

const NAV_ITEMS = [
    { to: '/dashboard', label: 'Dashboard',       icon: LayoutDashboard },
    { to: '/vision',    label: 'Vision Assist',   icon: Eye },
    { to: '/speech',    label: 'Speech Assist',   icon: Mic },
    { to: '/gesture',   label: 'Gesture Assist',  icon: Hand },
    { to: '/navigation',label: 'Navigation',      icon: Navigation },
    { to: '/logs',      label: 'Logs',            icon: ScrollText },
    { to: '/emergency', label: 'Emergency',       icon: AlertTriangle, danger: true },
    { to: '/settings',  label: 'Settings',        icon: Settings },
];

const AppLayout = ({ children }) => {
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const { enabled: vcEnabled, setEnabled: setVcEnabled, listening, feedback } = useVoiceCommands();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);

    const handleLogout = () => { logout(); navigate('/login'); };

    const cycleTheme = () => {
        const order = ['dark', 'light', 'high-contrast'];
        const next = order[(order.indexOf(theme) + 1) % order.length];
        setTheme(next);
    };

    const ThemeIcon = theme === 'dark' ? Sun : theme === 'light' ? Moon : Contrast;

    return (
        <div style={{ display: 'flex', minHeight: '100dvh' }}>
            {/* ── Sidebar ──────────────────────────────────────────────────── */}
            <aside style={{
                width: collapsed ? 68 : 240,
                background: 'var(--bg-sidebar)',
                display: 'flex', flexDirection: 'column',
                padding: '1.25rem 0',
                transition: 'width 0.25s ease',
                flexShrink: 0,
                position: 'relative',
                zIndex: 10,
            }}>
                {/* Brand */}
                <div style={{ padding: '0 1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, color: '#fff', fontSize: '1rem',
                    }}>S</div>
                    {!collapsed && (
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', whiteSpace: 'nowrap' }}>
                            SenseBridge
                        </span>
                    )}
                </div>

                {/* Nav Items */}
                <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 0.5rem' }}>
                    {NAV_ITEMS.map(({ to, label, icon: Icon, danger }) => (
                        <NavLink key={to} to={to} style={({ isActive }) => ({
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.65rem 0.85rem', borderRadius: 10,
                            textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden',
                            color: isActive ? '#fff' : danger ? 'var(--color-danger)' : 'rgba(255,255,255,0.6)',
                            background: isActive ? 'rgba(108,99,255,0.3)' : 'transparent',
                            fontWeight: isActive ? 600 : 400,
                            fontSize: '0.9rem',
                            transition: 'all 0.15s ease',
                        })}>
                            <Icon size={18} style={{ flexShrink: 0 }} />
                            {!collapsed && label}
                        </NavLink>
                    ))}
                </nav>

                {/* Bottom controls */}
                <div style={{ padding: '1rem 0.5rem 0', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button onClick={cycleTheme} className="btn btn-ghost" style={{ justifyContent: collapsed ? 'center' : 'flex-start', padding: '0.6rem 0.85rem', borderRadius: 10, border: 'none', color: 'rgba(255,255,255,0.6)', gap: '0.75rem' }}>
                        <ThemeIcon size={18} />
                        {!collapsed && <span style={{ fontSize: '0.875rem' }}>Theme: {theme}</span>}
                    </button>
                    <button onClick={handleLogout} className="btn btn-ghost" style={{ justifyContent: collapsed ? 'center' : 'flex-start', padding: '0.6rem 0.85rem', borderRadius: 10, border: 'none', color: 'var(--color-danger)', gap: '0.75rem' }}>
                        <LogOut size={18} />
                        {!collapsed && <span style={{ fontSize: '0.875rem' }}>Logout</span>}
                    </button>
                </div>

                {/* Collapse toggle */}
                <button
                    onClick={() => setCollapsed((c) => !c)}
                    style={{
                        position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)',
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'var(--color-primary)', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                    }}
                >
                    <ChevronLeft size={14} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }} />
                </button>
            </aside>

            {/* ── Main content ──────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Top bar */}
                <header style={{
                    height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 1.5rem', background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-color)', flexShrink: 0, position: 'relative',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Menu size={20} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setCollapsed(c => !c)} />
                    </div>

                    {/* Voice command feedback bubble */}
                    {feedback && (
                        <div style={{
                            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(108,99,255,0.95)', color: '#fff',
                            padding: '5px 16px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                            whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 200,
                            boxShadow: '0 4px 20px rgba(108,99,255,0.4)',
                            animation: 'fadeIn 0.15s ease',
                        }}>
                            🎙 {feedback}
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {/* Voice command toggle */}
                        <button
                            onClick={() => setVcEnabled(v => !v)}
                            title={`Voice Commands ${vcEnabled ? 'ON' : 'OFF'} (Alt+V)`}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                                background: vcEnabled ? 'rgba(0,212,170,0.15)' : 'var(--bg-base)',
                                color: vcEnabled ? 'var(--color-accent)' : 'var(--text-muted)',
                                fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.2s',
                                boxShadow: listening ? '0 0 0 2px var(--color-accent)' : 'none',
                            }}
                        >
                            {vcEnabled && listening
                                ? <Mic size={14} style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                                : vcEnabled
                                ? <Mic size={14} />
                                : <MicOff size={14} />}
                            {vcEnabled ? (listening ? 'Listening…' : 'Voice On') : 'Voice Off'}
                        </button>

                        <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                        }}>
                            {user?.name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{user?.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{user?.role}</div>
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
                    {children}
                </main>
            </div>
        </div>
    );
};

export default AppLayout;
