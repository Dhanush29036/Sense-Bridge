import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { preferenceService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import {
    ChevronLeft, Volume2, Bell, Globe, Monitor, Shield,
    ChevronRight, LogOut,
} from 'lucide-react';

const SettingsPage = () => {
    const { theme, setTheme, fontScale, setFontScale } = useTheme();
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [prefs, setPrefs] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [highContrast, setHighContrast] = useState(theme === 'high-contrast');

    useEffect(() => {
        preferenceService.get()
            .then(({ data }) => setPrefs(data.data))
            .catch(() => toast.error('Could not load preferences'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await preferenceService.update(prefs);
            toast.success('Preferences saved!');
        } catch {
            toast.error('Failed to save preferences.');
        } finally {
            setSaving(false);
        }
    };

    const updatePref = (key, val) => setPrefs(p => ({ ...p, [key]: val }));

    const handleHighContrastToggle = () => {
        const next = !highContrast;
        setHighContrast(next);
        setTheme(next ? 'high-contrast' : 'dark');
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    if (loading) return (
        <AppLayout>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <LoadingSpinner size={32} />
            </div>
        </AppLayout>
    );

    if (!prefs) return (
        <AppLayout>
            <div style={{ color: 'var(--color-danger)' }}>Could not load preferences.</div>
        </AppLayout>
    );

    return (
        <AppLayout>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <button className="icon-btn" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft size={20} />
                </button>
                <div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>Settings</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Accessibility &amp; Preferences</div>
                </div>
            </div>

            {/* Voice Output */}
            <div className="settings-section" style={{ marginBottom: '0.75rem' }}>
                <div className="settings-section-label">
                    <Volume2 size={12} style={{ color: 'var(--color-accent)' }} />
                    VOICE OUTPUT
                </div>
                <div className="settings-row">
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }}>
                            Voice Speed
                        </div>
                        <input
                            type="range" min={0.5} max={3} step={0.1}
                            value={prefs.voiceSpeed}
                            onChange={e => updatePref('voiceSpeed', parseFloat(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--color-accent)', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            <span>0.5×</span>
                            <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{prefs.voiceSpeed}×</span>
                            <span>3×</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Language */}
            <div className="settings-section" style={{ marginBottom: '0.75rem' }}>
                <div className="settings-section-label">
                    <Globe size={12} style={{ color: 'var(--color-primary)' }} />
                    LANGUAGE
                </div>
                <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Display &amp; Voice Language</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {[
                            { value: 'en', label: 'English' },
                            { value: 'es', label: 'Spanish' },
                            { value: 'hi', label: 'हिंदी' },
                            { value: 'ta', label: 'தமிழ்' },
                        ].map(({ value, label }) => (
                            <button
                                key={value}
                                onClick={() => updatePref('language', value)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 10,
                                    border: '1.5px solid',
                                    borderColor: prefs.language === value ? 'var(--color-primary)' : 'var(--border-card)',
                                    background: prefs.language === value ? 'var(--color-primary)' : 'var(--bg-card2)',
                                    color: prefs.language === value ? '#fff' : 'var(--text-secondary)',
                                    fontWeight: prefs.language === value ? 700 : 500,
                                    fontSize: '0.82rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Alert Type */}
            <div className="settings-section" style={{ marginBottom: '0.75rem' }}>
                <div className="settings-section-label">
                    <Bell size={12} style={{ color: 'var(--color-warning)' }} />
                    ALERT TYPE
                </div>
                <div className="settings-row">
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>How you receive notifications</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {['sound', 'vibration', 'visual', 'all'].map(opt => (
                                <button
                                    key={opt}
                                    onClick={() => updatePref('alertType', opt)}
                                    style={{
                                        padding: '0.45rem 0.9rem',
                                        borderRadius: 8,
                                        border: '1.5px solid',
                                        borderColor: prefs.alertType === opt ? 'var(--color-warning)' : 'var(--border-card)',
                                        background: prefs.alertType === opt ? 'rgba(255,169,77,0.15)' : 'var(--bg-card2)',
                                        color: prefs.alertType === opt ? 'var(--color-warning)' : 'var(--text-muted)',
                                        fontWeight: prefs.alertType === opt ? 700 : 500,
                                        fontSize: '0.78rem',
                                        textTransform: 'capitalize',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {{ sound: '🔊 Sound', vibration: '📳 Vibrate', visual: '💡 Visual', all: '⚡ All' }[opt]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Display */}
            <div className="settings-section" style={{ marginBottom: '0.75rem' }}>
                <div className="settings-section-label">
                    <Monitor size={12} style={{ color: 'var(--color-primary)' }} />
                    DISPLAY
                </div>

                {/* High Contrast toggle */}
                <div className="settings-row">
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>High Contrast</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Increase color contrast for visibility</div>
                    </div>
                    <button
                        className="toggle"
                        onClick={handleHighContrastToggle}
                        style={{ background: highContrast ? 'var(--color-accent)' : 'var(--border-card)' }}
                    >
                        <div className="toggle-thumb" style={{ left: highContrast ? 23 : 3 }} />
                    </button>
                </div>

                {/* Font size row */}
                <div className="settings-row">
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Font Size</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Adjust text size for readability</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {[{ v: 1, l: 'A' }, { v: 1.2, l: 'A+' }, { v: 1.4, l: 'A++' }].map(({ v, l }) => (
                            <button
                                key={v}
                                onClick={() => setFontScale(v)}
                                style={{
                                    width: 34, height: 34, borderRadius: 8, border: '1.5px solid',
                                    borderColor: fontScale === v ? 'var(--color-accent)' : 'var(--border-card)',
                                    background: fontScale === v ? 'rgba(0,212,170,0.15)' : 'var(--bg-card2)',
                                    color: fontScale === v ? 'var(--color-accent)' : 'var(--text-muted)',
                                    fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
                                }}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* AI Feature toggles */}
            {prefs.features && (
                <div className="settings-section" style={{ marginBottom: '0.75rem' }}>
                    <div className="settings-section-label">⚡ AI FEATURES</div>
                    {Object.entries(prefs.features).map(([key, val]) => (
                        <div key={key} className="settings-row">
                            <span style={{ fontWeight: 500, fontSize: '0.88rem' }}>
                                {{ objectDetection: '👁️ Object Detection', gestureRecognition: '🤲 Gesture Recognition', speechToText: '🎙️ Speech to Text', textToSpeech: '🔊 Text to Speech' }[key] || key}
                            </span>
                            <button
                                className="toggle"
                                onClick={() => setPrefs(p => ({ ...p, features: { ...p.features, [key]: !val } }))}
                                style={{ background: val ? 'var(--color-primary)' : 'var(--border-card)' }}
                            >
                                <div className="toggle-thumb" style={{ left: val ? 23 : 3 }} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Privacy & Data */}
            <div className="settings-section" style={{ marginBottom: '1.25rem' }}>
                <div className="settings-row" style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(0,212,170,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shield size={16} style={{ color: 'var(--color-accent)' }} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Privacy &amp; Data</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>All data processed on-device</div>
                        </div>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                </div>
            </div>

            {/* Save button */}
            <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
                style={{ width: '100%', marginBottom: '0.75rem', borderRadius: 14 }}
            >
                {saving ? <LoadingSpinner size={18} color="#fff" /> : '💾 Save Preferences'}
            </button>

            {/* Sign out */}
            <button
                onClick={handleLogout}
                style={{
                    width: '100%', padding: '1rem', borderRadius: 14,
                    background: 'linear-gradient(135deg, #8B000033, #c0392b33)',
                    border: '1.5px solid #c0392b66',
                    color: '#FF6B6B', fontWeight: 700, fontSize: '0.95rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    marginBottom: '0.5rem',
                }}
            >
                <LogOut size={18} />
                Sign Out
            </button>
        </AppLayout>
    );
};

export default SettingsPage;
