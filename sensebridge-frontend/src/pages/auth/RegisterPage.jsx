import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../layouts/AuthLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import ServerConfigModal from '../../components/ServerConfigModal';
import { getBackendBaseURL } from '../../services/networkConfig';
import { toast } from 'react-hot-toast';
import { User, Mail, Lock, Server, Zap } from 'lucide-react';

const ROLES = [
    { value: 'blind',  label: '👁️ Vision Impaired',  desc: 'Object detection & audio alerts' },
    { value: 'deaf',   label: '👂 Hearing Impaired',  desc: 'Live captions & visual alerts' },
    { value: 'mute',   label: '🤲 Speech Impaired',   desc: 'Gesture-based communication' },
    { value: 'mixed',  label: '⚡ Multiple Needs',    desc: 'All assistive modes enabled' },
];

const RegisterPage = () => {
    const { register, loginAsGuest } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({ name: '', email: '', password: '', role: '' });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const [showServerModal, setShowServerModal] = useState(false);

    const validate = () => {
        const e = {};
        if (!form.name) e.name = 'Name is required';
        if (!form.email) e.email = 'Email is required';
        if (form.password.length < 8) e.password = 'At least 8 characters';
        else if (!/[A-Z]/.test(form.password)) e.password = 'Must include an uppercase letter';
        else if (!/[0-9]/.test(form.password)) e.password = 'Must include a number';
        if (!form.role) e.role = 'Select your primary need';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        setLoading(true);
        try {
            await register(form);
            toast.success('Account created! Welcome to SenseBridge 🎉');
            navigate('/dashboard');
        } catch (err) {
            console.error('Registration error:', err);
            const msg = !err.response
                ? 'Cannot connect to server. Check Wi-Fi or tap Server Settings below.'
                : (err.response?.data?.message || 'Registration failed.');
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="auth-card">
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 4 }}>Create Account</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem' }}>
                    Set up your assistive profile
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Name */}
                    <div className="form-group">
                        <label className="form-label"><User size={12} style={{ marginRight: 5 }} />Full Name</label>
                        <input className="form-input" type="text" placeholder="Alex Sharma"
                            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                        {errors.name && <span className="form-error">{errors.name}</span>}
                    </div>

                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label"><Mail size={12} style={{ marginRight: 5 }} />Email</label>
                        <input className="form-input" type="email" placeholder="you@example.com"
                            value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                        {errors.email && <span className="form-error">{errors.email}</span>}
                    </div>

                    {/* Password */}
                    <div className="form-group">
                        <label className="form-label"><Lock size={12} style={{ marginRight: 5 }} />Password</label>
                        <input className="form-input" type="password" placeholder="Min 8 chars, 1 uppercase, 1 number"
                            value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                        {errors.password && <span className="form-error">{errors.password}</span>}
                    </div>

                    {/* Role selector */}
                    <div className="form-group">
                        <label className="form-label">Primary Assistive Need</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {ROLES.map(({ value, label, desc }) => (
                                <button key={value} type="button"
                                    onClick={() => setForm({ ...form, role: value })}
                                    style={{
                                        padding: '0.7rem 0.75rem', borderRadius: 12,
                                        textAlign: 'left', cursor: 'pointer',
                                        border: `2px solid ${form.role === value ? 'var(--color-primary)' : 'var(--border-card)'}`,
                                        background: form.role === value ? 'rgba(108,99,255,0.12)' : 'var(--bg-card2)',
                                        transition: 'all 0.15s ease',
                                    }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{desc}</div>
                                </button>
                            ))}
                        </div>
                        {errors.role && <span className="form-error">{errors.role}</span>}
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                        style={{ marginTop: 8, width: '100%', borderRadius: 14, padding: '0.875rem' }}
                    >
                        {loading ? <LoadingSpinner size={18} color="#fff" /> : 'Create Account'}
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
                        loginAsGuest(form.role || 'mixed');
                        toast.success('Welcome! Using offline assistive mode.');
                        navigate('/dashboard');
                    }}
                    className="btn btn-secondary"
                    style={{ width: '100%', borderRadius: 14, padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.85rem' }}
                >
                    <Zap size={15} color="var(--blue)" />
                    <span>Quick Start (Offline / Anywhere)</span>
                </button>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--blue)', fontWeight: 700 }}>Sign in</Link>
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

export default RegisterPage;
