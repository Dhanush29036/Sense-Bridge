import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../layouts/AuthLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import ServerConfigModal from '../../components/ServerConfigModal';
import { getBackendBaseURL } from '../../services/networkConfig';
import { toast } from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, Server, Zap } from 'lucide-react';

const LoginPage = () => {
    const { login, loginAsGuest } = useAuth();
    const navigate  = useNavigate();
    const location  = useLocation();
    const from      = location.state?.from?.pathname || '/dashboard';

    const [form, setForm]       = useState({ email: '', password: '' });
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors]   = useState({});
    const [showServerModal, setShowServerModal] = useState(false);

    const validate = () => {
        const e = {};
        if (!form.email)    e.email    = 'Email is required';
        if (!form.password) e.password = 'Password is required';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        setLoading(true);
        try {
            const user = await login(form.email.trim(), form.password);
            toast.success(`Welcome back, ${user.name}!`);
            navigate(from, { replace: true });
        } catch (err) {
            console.error('Login error:', err);
            const msg = !err.response
                ? 'Cannot connect to server. Check Wi-Fi or tap Server Settings below.'
                : (err.response?.data?.message || 'Login failed. Check your credentials.');
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="auth-card">
                <h2 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: 4,
                    letterSpacing: '-0.02em',
                }}>Welcome back</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', marginBottom: 22 }}>
                    Sign in to access your assistive profile
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label">
                            <Mail size={13} /> Email
                        </label>
                        <input
                            className="form-input"
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={e => setForm({ ...form, email: e.target.value })}
                        />
                        {errors.email && <span className="form-error">{errors.email}</span>}
                    </div>

                    {/* Password */}
                    <div className="form-group">
                        <label className="form-label">
                            <Lock size={13} /> Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                className="form-input"
                                type={showPwd ? 'text' : 'password'}
                                autoComplete="current-password"
                                placeholder="Min 8 characters"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                style={{ paddingRight: 48 }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPwd(!showPwd)}
                                style={{
                                    position: 'absolute', right: 14, top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-dim)', padding: 0, display: 'flex',
                                }}
                            >
                                {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                            </button>
                        </div>
                        {errors.password && <span className="form-error">{errors.password}</span>}
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                        style={{ marginTop: 4 }}
                    >
                        {loading ? <LoadingSpinner size={18} color="#fff" /> : 'Sign In'}
                    </button>
                </form>

                <div style={{ display: 'flex', alignItems: 'center', margin: '14px 0', gap: 10 }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>or</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                <button
                    type="button"
                    onClick={() => {
                        loginAsGuest();
                        toast.success('Welcome! Using offline assistive mode.');
                        navigate(from, { replace: true });
                    }}
                    className="btn btn-secondary"
                    style={{ width: '100%', borderRadius: 14, padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.85rem' }}
                >
                    <Zap size={15} color="var(--blue)" />
                    <span>Quick Start (Offline / Anywhere)</span>
                </button>

                <p style={{ textAlign: 'center', marginTop: 18, fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                    Don't have an account?{' '}
                    <Link to="/register" style={{ color: 'var(--blue)', fontWeight: 700 }}>
                        Create one
                    </Link>
                </p>

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button
                        type="button"
                        onClick={() => setShowServerModal(true)}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.74rem', color: 'var(--text-muted)',
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '4px 8px', borderRadius: 8,
                        }}
                    >
                        <Server size={13} color="var(--blue)" />
                        <span>Server: <strong style={{ color: 'var(--text-secondary)' }}>{getBackendBaseURL() || 'Local Proxy'}</strong></span>
                    </button>
                </div>
            </div>

            <ServerConfigModal
                isOpen={showServerModal}
                onClose={() => setShowServerModal(false)}
            />
        </AuthLayout>
    );
};

export default LoginPage;
