import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useVoiceCommands } from '../context/VoiceCommandContext';
import { Home, Eye, MessageSquare, Hand, ScrollText, Settings, Mic, MicOff } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/dashboard', label: 'Home',    icon: Home },
    { to: '/vision',    label: 'Vision',  icon: Eye,            roles: ['blind', 'mixed'] },
    { to: '/speech',    label: 'Speech',  icon: MessageSquare,  roles: ['deaf', 'mixed'] },
    { to: '/gesture',   label: 'Gesture', icon: Hand,           roles: ['mute', 'deaf', 'mixed'] },
    { to: '/logs',      label: 'Logs',    icon: ScrollText },
    { to: '/settings',  label: 'Settings', icon: Settings },
];

const AppLayout = ({ children, noPad = false }) => {
    const { user } = useAuth();
    const { theme } = useTheme();
    const { enabled: vcEnabled, setEnabled: setVcEnabled, listening, feedback } = useVoiceCommands();

    const visibleItems = NAV_ITEMS.filter(
        item => !item.roles || user?.isAdmin || item.roles.includes(user?.role)
    );

    return (
        <div data-theme={theme} className="mobile-shell">
            {/* Voice feedback toast */}
            {feedback && (
                <div style={{
                    position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(108,99,255,0.95)', color: '#fff',
                    padding: '6px 18px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                    whiteSpace: 'nowrap', zIndex: 300,
                    boxShadow: '0 4px 20px rgba(108,99,255,0.4)',
                    animation: 'fadeIn 0.15s ease',
                }}>
                    🎙 {feedback}
                </div>
            )}

            {/* Page content */}
            {noPad
                ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingBottom: 'var(--nav-height)', overflow: 'hidden' }}>{children}</div>
                : <div className="page-content">{children}</div>
            }

            {/* Bottom navigation */}
            <nav className="bottom-nav">
                {/* Voice toggle - compact */}
                <button
                    onClick={() => setVcEnabled(v => !v)}
                    title={`Voice ${vcEnabled ? 'ON' : 'OFF'}`}
                    style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 4, flex: 0.6, border: 'none', background: 'none', cursor: 'pointer', padding: 0,
                        color: vcEnabled ? 'var(--color-accent)' : 'var(--text-muted)',
                        fontSize: '0.6rem', fontWeight: 600,
                        position: 'relative',
                    }}
                >
                    {vcEnabled && listening
                        ? <Mic size={20} style={{ animation: 'pulse-ring 1.6s ease-out infinite' }} />
                        : vcEnabled
                        ? <Mic size={20} />
                        : <MicOff size={20} />
                    }
                    {listening ? 'Live' : vcEnabled ? 'Voice' : 'Muted'}
                </button>

                {visibleItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                        <Icon size={22} strokeWidth={1.75} />
                        <span>{label}</span>
                    </NavLink>
                ))}
            </nav>
        </div>
    );
};

export default AppLayout;
