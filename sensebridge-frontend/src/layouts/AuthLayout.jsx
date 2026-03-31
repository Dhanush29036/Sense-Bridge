import { useTheme } from '../context/ThemeContext';

/** Dark-themed centered layout for auth pages */
const AuthLayout = ({ children }) => {
    const { theme } = useTheme();
    return (
        <div data-theme={theme} style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-base)',
            padding: '1.5rem',
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Glow blobs */}
            <div aria-hidden style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
                <div style={{
                    position: 'absolute', top: '-15%', right: '-15%',
                    width: 420, height: 420, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(108,99,255,0.15) 0%, transparent 70%)',
                }} />
                <div style={{
                    position: 'absolute', bottom: '-15%', left: '-10%',
                    width: 360, height: 360, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(0,212,170,0.10) 0%, transparent 70%)',
                }} />
            </div>

            <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400 }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        display: 'inline-flex', width: 60, height: 60, borderRadius: 18,
                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.6rem', fontWeight: 900, color: '#fff',
                        marginBottom: '0.875rem',
                        boxShadow: '0 8px 32px rgba(108,99,255,0.4)',
                    }}>S</div>
                    <div style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--text-primary)' }}>SenseBridge</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>AI-Powered Assistive Technology</div>
                </div>
                {children}
            </div>
        </div>
    );
};

export default AuthLayout;
