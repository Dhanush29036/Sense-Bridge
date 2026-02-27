/** Minimal centered layout for auth pages (login / register) */
const AuthLayout = ({ children }) => (
    <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        padding: '1.5rem',
    }}>
        {/* Decorative background blobs */}
        <div aria-hidden style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
            <div style={{
                position: 'absolute', top: '-20%', right: '-10%',
                width: 500, height: 500, borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(108,99,255,0.12) 0%, transparent 70%)',
            }} />
            <div style={{
                position: 'absolute', bottom: '-15%', left: '-10%',
                width: 400, height: 400, borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(0,212,170,0.10) 0%, transparent 70%)',
            }} />
        </div>

        <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 440 }}>
            {/* Logo */}
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <div style={{
                    display: 'inline-flex', width: 56, height: 56, borderRadius: 16,
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.5rem', fontWeight: 800, color: '#fff',
                    marginBottom: '0.75rem',
                }}>S</div>
                <div style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>SenseBridge</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>AI-Powered Assistive Technology</div>
            </div>
            {children}
        </div>
    </div>
);

export default AuthLayout;
