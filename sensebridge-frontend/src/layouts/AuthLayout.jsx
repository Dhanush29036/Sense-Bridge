import { useTheme } from '../context/ThemeContext';

/**
 * AuthLayout — Clean iOS-style centered auth form.
 * White card on light gray background.
 */
const AuthLayout = ({ children }) => {
    const { theme } = useTheme();

    return (
        <div
            data-theme={theme}
            style={{
                minHeight: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-app)',
                padding: '24px 20px',
                fontFamily: 'var(--font-sans)',
            }}
        >
            {/* Logo block */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{
                    display: 'inline-flex',
                    width: 72, height: 72,
                    borderRadius: 20,
                    background: 'linear-gradient(135deg, #3B7BF8, #5A5FD6)',
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 14,
                    boxShadow: '0 8px 32px rgba(59,123,248,0.35)',
                }}>
                    {/* Walking person SVG */}
                    <svg width="38" height="38" viewBox="0 0 90 90" fill="none">
                        <circle cx="45" cy="18" r="12" fill="white"/>
                        <path d="M25 42c0-11 8-18 20-18s20 7 20 18v8H25v-8z" fill="white"/>
                        <rect x="30" y="52" width="8" height="28" rx="4" fill="white"/>
                        <rect x="52" y="52" width="8" height="28" rx="4" fill="white"/>
                        <path d="M20 55 Q15 70 18 80" stroke="white" strokeWidth="7" strokeLinecap="round" fill="none"/>
                        <path d="M70 55 Q75 70 72 80" stroke="white" strokeWidth="7" strokeLinecap="round" fill="none"/>
                        <path d="M72 30 Q82 45 72 60" stroke="white" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.7"/>
                    </svg>
                </div>
                <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.6rem',
                    fontWeight: 800,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.03em',
                    marginBottom: 4,
                }}>SenseBridge</div>
                <div style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-muted)',
                }}>AI for a More Inclusive World</div>
            </div>

            {/* Form card */}
            <div style={{ width: '100%', maxWidth: 380 }}>
                {children}
            </div>
        </div>
    );
};

export default AuthLayout;
