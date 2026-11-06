/**
 * SettingsPage.jsx — matches reference "Settings" screen
 * iOS-style grouped rows: General | AI | Accessibility tabs
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { preferenceService } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import ServerConfigModal from '../components/ServerConfigModal';
import { getBackendBaseURL } from '../services/networkConfig';
import {
    Volume2, Bell, Globe, Monitor, Shield,
    ChevronRight, LogOut, FlaskConical, Sliders,
    Cpu, Eye, Mic, Hand, Server, Check, X,
} from 'lucide-react';
import haptics from '../services/haptics';
import { getConfig, updateConfig } from '../config/config';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English', native: 'English', flag: '🇺🇸' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
    { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்', flag: '🇮🇳' },
    { code: 'te', name: 'Telugu', native: 'తెలుగు', flag: '🇮🇳' },
    { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', flag: '🇮🇳' },
    { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇮🇳' },
    { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
    { code: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳' },
    { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵' },
];

/* ── iOS-style toggle ─────────────────────────────────────────────────────── */
const Toggle = ({ checked, onChange, color = 'var(--green)' }) => (
    <div
        onClick={onChange}
        style={{
            width: 51, height: 31, borderRadius: 31,
            background: checked ? color : 'var(--border)',
            position: 'relative', cursor: 'pointer',
            transition: 'background 0.2s',
            flexShrink: 0,
        }}
    >
        <div style={{
            position: 'absolute',
            top: 2, left: checked ? 22 : 2,
            width: 27, height: 27, borderRadius: '50%',
            background: 'white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            transition: 'left 0.2s',
        }} />
    </div>
);

/* ── Grouped card wrapper ─────────────────────────────────────────────────── */
const SettingGroup = ({ children }) => (
    <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        marginBottom: 16,
    }}>
        {children}
    </div>
);

/* ── Row inside a group ───────────────────────────────────────────────────── */
const SettingRow = ({ icon: Icon, iconBg, iconColor, label, subtitle, right, onPress, divider = true }) => (
    <div
        onClick={onPress}
        style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '13px 16px',
            cursor: onPress ? 'pointer' : 'default',
            position: 'relative',
        }}
    >
        {Icon && (
            <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: iconBg || 'var(--bg-inset)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
            }}>
                <Icon size={16} color={iconColor || 'var(--text-muted)'} />
            </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {label}
            </div>
            {subtitle && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</div>
            )}
        </div>
        {right}
        {divider && (
            <div style={{
                position: 'absolute', bottom: 0, left: 60, right: 0,
                height: 1, background: 'var(--separator)',
            }} />
        )}
    </div>
);

const TABS = ['General', 'AI', 'Accessibility'];

const SettingsPage = () => {
    const { theme, setTheme, fontScale, setFontScale } = useTheme();
    const { logout, user } = useAuth();
    const navigate = useNavigate();

    const [activeTab,    setActiveTab]    = useState('General');
    const [prefs,        setPrefs]        = useState(null);
    const [loading,      setLoading]      = useState(true);
    const [saving,       setSaving]       = useState(false);
    const [highContrast, setHighContrast] = useState(theme === 'high-contrast');
    const [darkMode,     setDarkMode]     = useState(theme === 'dark');
    const [showAIDetails, setShowAIDetails] = useState(() => {
        try { return !!getConfig().ui?.showAIDetails; } catch { return false; }
    });
    const [voiceFeedback, setVoiceFeedback] = useState(() => {
        try { return getConfig().ui?.voiceFeedback ?? true; } catch { return true; }
    });
    const [vibration, setVibration] = useState(() => {
        try { return getConfig().ui?.vibrationFeedback ?? true; } catch { return true; }
    });
    const [showServerModal, setShowServerModal] = useState(false);
    const [showLangModal,   setShowLangModal]   = useState(false);

    useEffect(() => {
        preferenceService.get()
            .then(({ data }) => setPrefs(data.data))
            .catch(() => {
                // Fallback defaults if server unavailable
                setPrefs({ voiceSpeed: 1.0, language: 'en', alertType: 'all', features: {} });
            })
            .finally(() => setLoading(false));
    }, []);

    const updatePref = (key, val) => setPrefs(p => ({ ...p, [key]: val }));

    const handleSelectLang = (code) => {
        updatePref('language', code);
        localStorage.setItem('sb_language', code);
        preferenceService.update({ ...prefs, language: code }).catch(() => {});
        haptics.success();
        const lObj = SUPPORTED_LANGUAGES.find(l => l.code === code);
        toast.success(`Language set to ${lObj?.name || code}`);
        setShowLangModal(false);
        window.dispatchEvent(new CustomEvent('sb:language-changed', { detail: { language: code } }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await preferenceService.update(prefs);
            haptics.success();
            toast.success('Preferences saved');
        } catch {
            toast.error('Failed to save preferences.');
        } finally {
            setSaving(false);
        }
    };

    const handleLogout = () => { logout(); navigate('/login'); };

    const toggleHighContrast = () => {
        const next = !highContrast;
        setHighContrast(next);
        setTheme(next ? 'high-contrast' : (darkMode ? 'dark' : 'light'));
        haptics.tap();
    };

    const toggleDark = () => {
        const next = !darkMode;
        setDarkMode(next);
        if (!highContrast) setTheme(next ? 'dark' : 'light');
        haptics.tap();
    };

    const toggleVoice = () => {
        const next = !voiceFeedback;
        setVoiceFeedback(next);
        updateConfig({ ui: { voiceFeedback: next } });
        localStorage.setItem('sb_voice_feedback', String(next));
        haptics.tap();
        toast.success(`Voice feedback: ${next ? 'Enabled' : 'Disabled'}`);
    };

    const toggleVibration = () => {
        const next = !vibration;
        setVibration(next);
        updateConfig({ ui: { vibrationFeedback: next } });
        localStorage.setItem('sb_vibration', String(next));
        if (next) haptics.success();
        else haptics.tap();
        toast.success(`Vibration feedback: ${next ? 'Enabled' : 'Disabled'}`);
    };

    const toggleAIDetails = () => {
        const next = !showAIDetails;
        setShowAIDetails(next);
        updateConfig({ ui: { showAIDetails: next } });
        haptics.tap();
    };

    if (loading) return (
        <AppLayout title="Settings">
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <LoadingSpinner size={32} />
            </div>
        </AppLayout>
    );

    return (
        <AppLayout title="Settings">
            {/* ── Tab selector ──────────────────────────────────────────── */}
            <div style={{
                display: 'flex',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-lg)',
                padding: 3,
                marginBottom: 20,
                gap: 2,
            }}>
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            flex: 1,
                            padding: '9px 0',
                            borderRadius: 'calc(var(--radius-lg) - 3px)',
                            background: activeTab === tab ? 'var(--bg-card)' : 'transparent',
                            border: 'none',
                            fontFamily: 'var(--font-sans)',
                            fontWeight: activeTab === tab ? 600 : 500,
                            fontSize: '0.85rem',
                            color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            boxShadow: activeTab === tab ? 'var(--shadow-sm)' : 'none',
                            transition: 'all 0.15s',
                        }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* ══ GENERAL TAB ══════════════════════════════════════════════ */}
            {activeTab === 'General' && (
                <>
                    {/* Confidence threshold */}
                    <SettingGroup>
                        <SettingRow
                            icon={Sliders}
                            iconBg="var(--blue-light)"
                            iconColor="var(--blue)"
                            label="Confidence Thresholds"
                            subtitle={`Detection: ${prefs?.detectionThreshold ?? 0.5}`}
                            right={<ChevronRight size={16} color="var(--text-dim)" />}
                        />
                        <SettingRow
                            icon={Volume2}
                            iconBg="var(--green-light)"
                            iconColor="var(--green)"
                            label="Voice Feedback"
                            right={<Toggle checked={voiceFeedback} onChange={toggleVoice} />}
                        />
                        <SettingRow
                            icon={Bell}
                            iconBg="var(--blue-light)"
                            iconColor="var(--blue)"
                            label="Vibration Feedback"
                            right={<Toggle checked={vibration} onChange={toggleVibration} />}
                        />
                        <SettingRow
                            icon={Eye}
                            iconBg="var(--purple-light)"
                            iconColor="var(--purple)"
                            label="Show AI Details"
                            right={<Toggle checked={showAIDetails} onChange={toggleAIDetails} />}
                        />
                        <SettingRow
                            icon={Monitor}
                            iconBg="var(--orange-light)"
                            iconColor="var(--orange)"
                            label="High Contrast Mode"
                            right={<Toggle checked={highContrast} onChange={toggleHighContrast} color="var(--orange)" />}
                            divider={false}
                        />
                    </SettingGroup>

                    {/* Font size */}
                    <SettingGroup>
                        <div style={{ padding: '13px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                                <div style={{
                                    width: 30, height: 30, borderRadius: 8,
                                    background: 'var(--blue-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--blue)' }}>A</span>
                                </div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>Font Size</span>
                                <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    {fontScale === 1 ? 'Medium (Default)' : fontScale === 1.2 ? 'Large' : 'X-Large'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {[
                                    { v: 1, l: 'Default', sz: '0.8rem' },
                                    { v: 1.2, l: 'Large', sz: '0.9rem' },
                                    { v: 1.4, l: 'X-Large', sz: '1.02rem' }
                                ].map(({ v, l, sz }) => (
                                    <button
                                        key={v}
                                        onClick={() => {
                                            setFontScale(v);
                                            updateConfig({ ui: { fontScale: v } });
                                            haptics.tap();
                                            toast.success(`Font size: ${l}`);
                                        }}
                                        style={{
                                            flex: 1, height: 42, borderRadius: 10,
                                            border: '1.5px solid',
                                            borderColor: fontScale === v ? 'var(--blue)' : 'var(--border)',
                                            background: fontScale === v ? 'var(--blue-light)' : 'var(--bg-inset)',
                                            color: fontScale === v ? 'var(--blue)' : 'var(--text-muted)',
                                            fontWeight: 700, fontSize: sz, cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {l}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </SettingGroup>

                    {/* Language */}
                    <SettingGroup>
                        <SettingRow
                            icon={Globe}
                            iconBg="var(--blue-light)"
                            iconColor="var(--blue)"
                            label="Language"
                            subtitle={SUPPORTED_LANGUAGES.find(l => l.code === (prefs?.language || 'en'))?.name || 'English'}
                            right={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--blue)', fontWeight: 600 }}>
                                        {SUPPORTED_LANGUAGES.find(l => l.code === (prefs?.language || 'en'))?.native || 'English'}
                                    </span>
                                    <ChevronRight size={16} color="var(--text-dim)" />
                                </div>
                            }
                            onPress={() => setShowLangModal(true)}
                            divider={false}
                        />
                    </SettingGroup>

                    {/* Research */}
                    <SettingGroup>
                        <SettingRow
                            icon={FlaskConical}
                            iconBg="var(--purple-light)"
                            iconColor="var(--purple)"
                            label="Research Dashboard"
                            subtitle="Telemetry, ablation & experiment metrics"
                            right={<ChevronRight size={16} color="var(--text-dim)" />}
                            onPress={() => navigate('/research')}
                        />
                        <SettingRow
                            icon={Shield}
                            iconBg="var(--green-light)"
                            iconColor="var(--green)"
                            label="Privacy & Data"
                            subtitle="All data processed on-device"
                            right={<ChevronRight size={16} color="var(--text-dim)" />}
                            divider={false}
                        />
                    </SettingGroup>

                    {/* Server Connection */}
                    <SettingGroup>
                        <SettingRow
                            icon={Server}
                            iconBg="var(--blue-light)"
                            iconColor="var(--blue)"
                            label="Server Connection"
                            subtitle={getBackendBaseURL() || 'Local Proxy'}
                            right={<ChevronRight size={16} color="var(--text-dim)" />}
                            onPress={() => setShowServerModal(true)}
                            divider={true}
                        />
                        <SettingRow
                            label="About SenseBridge"
                            subtitle="Version 2.0 · AI-Powered Assistive Tech"
                            right={<ChevronRight size={16} color="var(--text-dim)" />}
                            divider={false}
                        />
                    </SettingGroup>
                </>
            )}

            {/* ══ AI TAB ═══════════════════════════════════════════════════ */}
            {activeTab === 'AI' && (
                <>
                    <div className="section-header">AI Models</div>
                    <SettingGroup>
                        <SettingRow
                            icon={Eye}
                            iconBg="var(--blue-light)"
                            iconColor="var(--blue)"
                            label="Object Detection"
                            subtitle="YOLOv8 · Real-time"
                            right={<Toggle checked={prefs?.features?.objectDetection ?? true}
                                onChange={() => updatePref('features', { ...(prefs?.features || {}), objectDetection: !(prefs?.features?.objectDetection ?? true) })} />}
                        />
                        <SettingRow
                            icon={Mic}
                            iconBg="var(--purple-light)"
                            iconColor="var(--purple)"
                            label="Speech to Text"
                            subtitle="Web Speech API · Multilingual"
                            right={<Toggle checked={prefs?.features?.speechToText ?? true}
                                onChange={() => updatePref('features', { ...(prefs?.features || {}), speechToText: !(prefs?.features?.speechToText ?? true) })} />}
                        />
                        <SettingRow
                            icon={Hand}
                            iconBg="var(--orange-light)"
                            iconColor="var(--orange)"
                            label="Gesture Recognition"
                            subtitle="MediaPipe · 30+ signs"
                            right={<Toggle checked={prefs?.features?.gestureRecognition ?? true}
                                onChange={() => updatePref('features', { ...(prefs?.features || {}), gestureRecognition: !(prefs?.features?.gestureRecognition ?? true) })} />}
                        />
                        <SettingRow
                            icon={Cpu}
                            iconBg="var(--pink-light)"
                            iconColor="var(--pink)"
                            label="Multimodal Fusion"
                            subtitle="Cross-modal decision engine"
                            right={<Toggle checked={true} onChange={() => {}} color="var(--pink)" />}
                            divider={false}
                        />
                    </SettingGroup>

                    <div className="section-header">Detection Sensitivity</div>
                    <SettingGroup>
                        <div style={{ padding: '14px 16px' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
                                Confidence Threshold: {Math.round((prefs?.detectionThreshold ?? 0.5) * 100)}%
                            </div>
                            <input
                                type="range" min={0.1} max={0.9} step={0.05}
                                value={prefs?.detectionThreshold ?? 0.5}
                                onChange={e => updatePref('detectionThreshold', parseFloat(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--blue)', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                <span>Sensitive (10%)</span>
                                <span>Strict (90%)</span>
                            </div>
                        </div>
                    </SettingGroup>
                </>
            )}

            {/* ══ ACCESSIBILITY TAB ════════════════════════════════════════ */}
            {activeTab === 'Accessibility' && (
                <>
                    <div className="section-header">Visual</div>
                    <SettingGroup>
                        <SettingRow
                            icon={Monitor}
                            iconBg="var(--orange-light)"
                            iconColor="var(--orange)"
                            label="High Contrast Mode"
                            right={<Toggle checked={highContrast} onChange={toggleHighContrast} color="var(--orange)" />}
                        />
                        <SettingRow
                            icon={Monitor}
                            iconBg="var(--bg-inset)"
                            iconColor="var(--text-muted)"
                            label="Dark Mode"
                            right={<Toggle checked={darkMode} onChange={toggleDark} />}
                            divider={false}
                        />
                    </SettingGroup>

                    <div className="section-header">Audio</div>
                    <SettingGroup>
                        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--separator)' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                                Voice Speed: {prefs?.voiceSpeed ?? 1.0}×
                            </div>
                            <input
                                type="range" min={0.5} max={3} step={0.1}
                                value={prefs?.voiceSpeed ?? 1.0}
                                onChange={e => updatePref('voiceSpeed', parseFloat(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--green)', cursor: 'pointer' }}
                            />
                        </div>
                        <SettingRow
                            icon={Volume2}
                            iconBg="var(--green-light)"
                            iconColor="var(--green)"
                            label="Voice Feedback"
                            right={<Toggle checked={voiceFeedback} onChange={() => setVoiceFeedback(v => !v)} />}
                            divider={false}
                        />
                    </SettingGroup>
                </>
            )}

            {/* ── Save + Logout ─────────────────────────────────────────── */}
            <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
                style={{ marginBottom: 12 }}
            >
                {saving ? <LoadingSpinner size={18} color="#fff" /> : 'Save Preferences'}
            </button>

            <button
                onClick={handleLogout}
                style={{
                    width: '100%', padding: '14px', borderRadius: 'var(--radius-lg)',
                    background: 'var(--red-light)', border: '1px solid var(--color-rose-border)',
                    color: 'var(--red)', fontWeight: 700, fontSize: '0.95rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 8, fontFamily: 'var(--font-sans)',
                }}
            >
                <LogOut size={18} />
                Sign Out
            </button>

            <div style={{ height: 8 }} />

            <ServerConfigModal
                isOpen={showServerModal}
                onClose={() => setShowServerModal(false)}
            />

            {/* ── Language Selection Modal ─────────────────────────────── */}
            {showLangModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    animation: 'fadeIn 0.2s ease',
                }} onClick={() => setShowLangModal(false)}>
                    <div style={{
                        width: '100%', maxWidth: 480, maxHeight: '82vh',
                        background: 'var(--bg-card)',
                        borderRadius: '24px 24px 0 0',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden', boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
                        borderTop: '1px solid var(--border-card)',
                    }} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{
                            padding: '16px 20px', borderBottom: '1px solid var(--separator)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    Select Language
                                </h3>
                                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Speech, AI subtitles and voice feedback
                                </p>
                            </div>
                            <button
                                className="btn-icon"
                                onClick={() => setShowLangModal(false)}
                                style={{ width: 34, height: 34 }}
                            >
                                <X size={18} color="var(--text-secondary)" />
                            </button>
                        </div>

                        {/* List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 24px' }}>
                            {SUPPORTED_LANGUAGES.map(lang => {
                                const selected = (prefs?.language || 'en') === lang.code;
                                return (
                                    <div
                                        key={lang.code}
                                        onClick={() => handleSelectLang(lang.code)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 14,
                                            padding: '13px 16px', borderRadius: 14,
                                            cursor: 'pointer', margin: '4px 0',
                                            background: selected ? 'var(--blue-light)' : 'transparent',
                                            border: `1.5px solid ${selected ? 'var(--blue)' : 'transparent'}`,
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <span style={{ fontSize: '1.4rem' }}>{lang.flag}</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.95rem', fontWeight: selected ? 700 : 500, color: 'var(--text-primary)' }}>
                                                {lang.name}
                                            </div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                {lang.native}
                                            </div>
                                        </div>
                                        {selected && (
                                            <div style={{
                                                width: 24, height: 24, borderRadius: '50%',
                                                background: 'var(--blue)', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <Check size={14} color="#fff" strokeWidth={3} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
};

export default SettingsPage;
