import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../layouts/AuthLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import { toast } from 'react-hot-toast';
import { User, Mail, Lock } from 'lucide-react';

const ROLES = [
    { value: 'blind', label: '👁️  Vision Impaired', desc: 'Object detection & audio alerts' },
    { value: 'deaf', label: '👂 Hearing Impaired', desc: 'Live captions & visual alerts' },
    { value: 'mute', label: '🤲 Speech Impaired', desc: 'Gesture-based communication' },
    { value: 'mixed', label: '⚡ Multiple Needs', desc: 'All assistive modes enabled' },
];

const RegisterPage = () => {
    const { register } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({ name: '', email: '', password: '', role: '' });
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    const validate = () => {
        const e = {};
        if (!form.name) e.name = 'Name is required';
        if (!form.email) e.email = 'Email is required';
        if (form.password.length < 8) e.password = 'At least 8 characters';
        if (!/[A-Z]/.test(form.password)) e.password = 'Must include an uppercase letter';
        if (!/[0-9]/.test(form.password)) e.password = 'Must include a number';
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
            toast.error(err.response?.data?.message || 'Registration failed.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="card" style={{ borderRadius: 20 }}>
                <h1 style={{ fontSize: '1.375rem', fontWeight: 700, marginBottom: 6 }}>Create Account</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                    Set up your assistive profile
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Name */}
                    <div className="form-group">
                        <label className="form-label"><User size={13} style={{ marginRight: 4 }} />Full Name</label>
                        <input className="form-input" type="text" placeholder="Ananya Sharma"
                            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        {errors.name && <span className="form-error">{errors.name}</span>}
                    </div>

                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label"><Mail size={13} style={{ marginRight: 4 }} />Email</label>
                        <input className="form-input" type="email" placeholder="you@example.com"
                            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                        {errors.email && <span className="form-error">{errors.email}</span>}
                    </div>

                    {/* Password */}
                    <div className="form-group">
                        <label className="form-label"><Lock size={13} style={{ marginRight: 4 }} />Password</label>
                        <input className="form-input" type="password" placeholder="Min 8 chars, 1 uppercase, 1 number"
                            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
                                        padding: '0.65rem 0.75rem', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                                        border: `2px solid ${form.role === value ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                        background: form.role === value ? 'rgba(108,99,255,0.08)' : 'transparent',
                                        transition: 'all 0.15s ease',
                                    }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>{label}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                                </button>
                            ))}
                        </div>
                        {errors.role && <span className="form-error">{errors.role}</span>}
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 8 }}>
                        {loading ? <LoadingSpinner size={18} color="#fff" /> : 'Create Account'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Sign in</Link>
                </p>
            </div>
        </AuthLayout>
    );
};

export default RegisterPage;
