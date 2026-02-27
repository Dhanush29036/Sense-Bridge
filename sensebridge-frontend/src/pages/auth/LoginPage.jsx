import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../layouts/AuthLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import { toast } from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

const LoginPage = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/dashboard';

    const [form, setForm] = useState({ email: '', password: '' });
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    const validate = () => {
        const e = {};
        if (!form.email) e.email = 'Email is required';
        if (!form.password) e.password = 'Password is required';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        setLoading(true);
        try {
            const user = await login(form.email, form.password);
            toast.success(`Welcome back, ${user.name}!`);
            navigate(from, { replace: true });
        } catch (err) {
            toast.error(err.response?.data?.message || 'Login failed. Check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="card" style={{ borderRadius: 20 }}>
                <h1 style={{ fontSize: '1.375rem', fontWeight: 700, marginBottom: 6 }}>Sign In</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.75rem' }}>
                    Access your assistive profile
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label"><Mail size={13} style={{ marginRight: 4 }} />Email</label>
                        <input
                            className="form-input"
                            type="email" autoComplete="email"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                        />
                        {errors.email && <span className="form-error">{errors.email}</span>}
                    </div>

                    {/* Password */}
                    <div className="form-group">
                        <label className="form-label"><Lock size={13} style={{ marginRight: 4 }} />Password</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                className="form-input"
                                type={showPwd ? 'text' : 'password'}
                                autoComplete="current-password"
                                placeholder="Min 8 characters"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                style={{ paddingRight: '3rem' }}
                            />
                            <button type="button" onClick={() => setShowPwd(!showPwd)}
                                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {errors.password && <span className="form-error">{errors.password}</span>}
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 8 }}>
                        {loading ? <LoadingSpinner size={18} color="#fff" /> : 'Sign In'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Don't have an account?{' '}
                    <Link to="/register" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create one</Link>
                </p>
            </div>
        </AuthLayout>
    );
};

export default LoginPage;
