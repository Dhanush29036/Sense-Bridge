import { useState, useEffect } from 'react';
import AppLayout from '../layouts/AppLayout';
import { preferenceService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { Settings, Volume2, Bell, Globe, Type } from 'lucide-react';

const ALERT_OPTIONS = ['sound', 'vibration', 'visual', 'all'];
const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' }, { value: 'hi', label: 'हिंदी (Hindi)' },
    { value: 'ta', label: 'தமிழ் (Tamil)' }, { value: 'te', label: 'తెలుగు (Telugu)' },
    { value: 'bn', label: 'বাংলা (Bengali)' }, { value: 'mr', label: 'मराठी (Marathi)' },
];
const THEME_OPTIONS = ['light', 'dark', 'high-contrast'];
const FONT_OPTIONS = [{ value: 1, label: 'Normal (100%)' }, { value: 1.2, label: 'Large (120%)' }, { value: 1.4, label: 'Extra Large (140%)' }];

const SettingsPage = () => {
    const { theme, setTheme, fontScale, setFontScale } = useTheme();
    const [prefs, setPrefs] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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

    const updatePref = (key, val) => setPrefs((p) => ({ ...p, [key]: val }));

    if (loading) return <AppLayout><div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><LoadingSpinner size={32} /></div></AppLayout>;
    if (!prefs) return <AppLayout><div style={{ color: 'var(--color-danger)' }}>Could not load preferences.</div></AppLayout>;

    return (
        <AppLayout>
            <div style={{ maxWidth: 720 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.75rem' }}>
                    <Settings size={24} style={{ color: 'var(--color-primary)' }} /> Settings
                </h1>

                {/* Section: Language & Voice */}
                <section className="card" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Globe size={16} style={{ color: 'var(--color-primary)' }} /> Language &amp; Voice
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <div className="form-group">
                            <label className="form-label">Language</label>
                            <select className="form-input" value={prefs.language} onChange={(e) => updatePref('language', e.target.value)}>
                                {LANGUAGE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Voice Speed: {prefs.voiceSpeed}×</label>
                            <input type="range" min={0.5} max={3} step={0.1}
                                value={prefs.voiceSpeed}
                                onChange={(e) => updatePref('voiceSpeed', parseFloat(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                <span>0.5× Slow</span><span>3× Fast</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section: Alerts */}
                <section className="card" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bell size={16} style={{ color: 'var(--color-warning)' }} /> Alert Type
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {ALERT_OPTIONS.map((opt) => (
                            <button key={opt} onClick={() => updatePref('alertType', opt)}
                                className="btn btn-ghost"
                                style={{
                                    textTransform: 'capitalize',
                                    borderColor: prefs.alertType === opt ? 'var(--color-primary)' : 'var(--border-color)',
                                    background: prefs.alertType === opt ? 'rgba(108,99,255,0.1)' : 'transparent',
                                    color: prefs.alertType === opt ? 'var(--color-primary)' : 'var(--text-secondary)',
                                    fontWeight: prefs.alertType === opt ? 700 : 400,
                                }}>
                                {{ sound: '🔊', vibration: '📳', visual: '💡', all: '⚡ All' }[opt] || opt}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Section: Appearance */}
                <section className="card" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Volume2 size={16} style={{ color: 'var(--color-accent)' }} /> Appearance
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <div className="form-group">
                            <label className="form-label">Theme</label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {THEME_OPTIONS.map((t) => (
                                    <button key={t} onClick={() => setTheme(t)}
                                        className="btn btn-ghost"
                                        style={{
                                            textTransform: 'capitalize', fontSize: '0.8rem', padding: '0.5rem 0.85rem',
                                            borderColor: theme === t ? 'var(--color-primary)' : 'var(--border-color)',
                                            background: theme === t ? 'rgba(108,99,255,0.1)' : 'transparent',
                                            color: theme === t ? 'var(--color-primary)' : 'var(--text-secondary)',
                                        }}>
                                        {{ light: '☀️', dark: '🌙', 'high-contrast': '⬛' }[t]} {t.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label"><Type size={13} style={{ marginRight: 4 }} />Font Size</label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {FONT_OPTIONS.map(({ value, label }) => (
                                    <button key={value} onClick={() => setFontScale(value)}
                                        className="btn btn-ghost"
                                        style={{
                                            fontSize: '0.75rem', padding: '0.45rem 0.75rem',
                                            borderColor: fontScale === value ? 'var(--color-accent)' : 'var(--border-color)',
                                            background: fontScale === value ? 'rgba(0,212,170,0.1)' : 'transparent',
                                            color: fontScale === value ? 'var(--color-accent)' : 'var(--text-secondary)',
                                        }}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* AI Feature toggles */}
                <section className="card" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>⚡ AI Features</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {Object.entries(prefs.features || {}).map(([key, val]) => (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                                    {{ objectDetection: '👁️ Object Detection (YOLO)', gestureRecognition: '🤲 Gesture Recognition', speechToText: '🎙️ Speech to Text (Whisper)', textToSpeech: '🔊 Text to Speech' }[key] || key}
                                </span>
                                <button onClick={() => setPrefs((p) => ({ ...p, features: { ...p.features, [key]: !val } }))}
                                    style={{
                                        width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                                        background: val ? 'var(--color-primary)' : 'var(--border-color)',
                                        position: 'relative', transition: 'background 0.2s',
                                    }}>
                                    <div style={{
                                        width: 20, height: 20, borderRadius: '50%', background: '#fff',
                                        position: 'absolute', top: 3, left: val ? 23 : 3,
                                        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                                    }} />
                                </button>
                            </div>
                        ))}
                    </div>
                </section>

                <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%' }}>
                    {saving ? <LoadingSpinner size={18} color="#fff" /> : '💾 Save Preferences'}
                </button>
            </div>
        </AppLayout>
    );
};

export default SettingsPage;
