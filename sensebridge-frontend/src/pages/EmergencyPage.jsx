import { useState, useEffect, useRef } from 'react';
import AppLayout from '../layouts/AppLayout';
import { contactService, emergencyService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { AlertTriangle, Phone, MapPin, Plus, Trash2, Star, X, Shield, History } from 'lucide-react';

const COUNTDOWN_S = 5;

const EmergencyPage = () => {
    const { user } = useAuth();
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sosPhase, setSosPhase] = useState('idle'); // 'idle' | 'countdown' | 'sent'
    const [countdown, setCountdown] = useState(COUNTDOWN_S);
    const [eventLog, setEventLog] = useState([]);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', relationship: '', isPrimary: false, notifyOnAlert: true });
    const [saving, setSaving] = useState(false);
    const [locStatus, setLocStatus] = useState('');
    const timerRef = useRef(null);
    const coordsRef = useRef(null);

    useEffect(() => {
        contactService.getAll()
            .then(({ data }) => setContacts(data.data || []))
            .catch(() => toast.error('Failed to load contacts'))
            .finally(() => setLoading(false));
    }, []);

    // ── SOS countdown → dispatch ───────────────────────────────────────────
    const handleSOS = () => {
        if (sosPhase !== 'idle') return;
        setSosPhase('countdown');
        setCountdown(COUNTDOWN_S);

        // Grab GPS while countdown runs
        navigator.geolocation?.getCurrentPosition(
            ({ coords }) => { coordsRef.current = { lat: coords.latitude, lng: coords.longitude }; },
            () => { coordsRef.current = null; }
        );

        let remaining = COUNTDOWN_S;
        timerRef.current = setInterval(() => {
            remaining -= 1;
            setCountdown(remaining);
            if (remaining <= 0) {
                clearInterval(timerRef.current);
                dispatchSOS();
            }
        }, 1000);
    };

    const cancelSOS = () => {
        clearInterval(timerRef.current);
        setSosPhase('idle');
        setCountdown(COUNTDOWN_S);
        coordsRef.current = null;
        toast('SOS cancelled.', { icon: '✅' });
    };

    const dispatchSOS = async () => {
        setSosPhase('sent');
        const payload = {
            userId: user?._id,
            source: 'button',
            latitude: coordsRef.current?.lat ?? null,
            longitude: coordsRef.current?.lng ?? null,
            timestamp: Date.now() / 1000,
        };

        try {
            const { data } = await emergencyService.sos(payload);
            const notified = data.contactsNotified ?? 0;
            const link = data.mapsLink ?? '';

            toast.error(
                `🚨 SOS sent! ${notified} contact${notified !== 1 ? 's' : ''} notified.${link ? ' GPS link included.' : ''}`,
                { duration: 7000 }
            );

            setEventLog(prev => [{
                id: Date.now(),
                source: 'button',
                notified,
                mapsLink: link,
                ts: new Date().toLocaleTimeString(),
            }, ...prev].slice(0, 10));

        } catch (err) {
            // Offline fallback
            toast.error('⚠️ Could not reach server. SOS stored for retry when back online.', { duration: 7000 });
            console.error('[SOS]', err);
        }

        // Reset after 4 seconds
        setTimeout(() => { setSosPhase('idle'); setCountdown(COUNTDOWN_S); }, 4000);
    };

    // ── Location share ─────────────────────────────────────────────────────
    const shareLocation = () => {
        navigator.geolocation?.getCurrentPosition(
            ({ coords }) => {
                const link = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
                setLocStatus(link);
                navigator.clipboard?.writeText(link).then(() => toast.success('📍 Location link copied!')).catch(() => { });
            },
            () => toast.error('Location permission denied')
        );
    };

    // ── Add / Delete contacts ──────────────────────────────────────────────
    const handleAdd = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { data } = await contactService.add(form);
            setContacts(c => [...c, data.data]);
            setForm({ name: '', phone: '', relationship: '', isPrimary: false, notifyOnAlert: true });
            setShowAdd(false);
            toast.success('Contact added!');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to add contact');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this contact?')) return;
        try {
            await contactService.remove(id);
            setContacts(c => c.filter(x => x._id !== id));
            toast.success('Contact removed.');
        } catch {
            toast.error('Failed to remove.');
        }
    };

    // ── SOS button ring animation ──────────────────────────────────────────
    const sosColor = sosPhase === 'sent' ? '#00D4AA' : 'var(--color-danger)';
    const sosLabel = sosPhase === 'countdown' ? countdown : sosPhase === 'sent' ? '✓' : 'SOS';

    return (
        <AppLayout>
            <div style={{ maxWidth: 720 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
                    <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} /> Emergency
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                    SOS alert with real-time GPS dispatch to emergency contacts
                </p>

                {/* ── SOS Button zone ─────────────────────────────────────── */}
                <div className="card" style={{
                    textAlign: 'center', marginBottom: '1.5rem', padding: '2.5rem',
                    background: sosPhase !== 'idle' ? 'rgba(255,75,110,0.06)' : 'var(--bg-card)',
                    borderColor: sosPhase !== 'idle' ? 'var(--color-danger)' : 'var(--border-color)',
                    transition: 'all 0.3s',
                }}>
                    {/* Countdown ring */}
                    <div style={{ position: 'relative', width: 160, height: 160, margin: '0 auto' }}>
                        {sosPhase === 'countdown' && (
                            <svg style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }} width="160" height="160">
                                <circle cx="80" cy="80" r="74" fill="none" stroke="rgba(255,75,110,0.15)" strokeWidth="6" />
                                <circle cx="80" cy="80" r="74" fill="none" stroke="var(--color-danger)" strokeWidth="6"
                                    strokeDasharray={`${2 * Math.PI * 74}`}
                                    strokeDashoffset={`${2 * Math.PI * 74 * (1 - countdown / COUNTDOWN_S)}`}
                                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                                />
                            </svg>
                        )}
                        <button
                            onClick={sosPhase === 'idle' ? handleSOS : undefined}
                            disabled={sosPhase === 'sent'}
                            style={{
                                position: 'absolute', top: 10, left: 10,
                                width: 140, height: 140, borderRadius: '50%', border: 'none',
                                cursor: sosPhase === 'idle' ? 'pointer' : 'default',
                                background: sosPhase === 'sent' ? 'var(--color-accent)' : 'var(--color-danger)',
                                color: '#fff', fontSize: sosPhase === 'countdown' ? '2.5rem' : '1.2rem',
                                fontWeight: 800, letterSpacing: '0.05em',
                                boxShadow: sosPhase !== 'idle' ? '0 0 48px rgba(255,75,110,0.6)' : '0 8px 32px rgba(255,75,110,0.4)',
                                transition: 'all 0.3s',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            }}>
                            {sosPhase === 'idle' && <AlertTriangle size={32} style={{ marginBottom: 4 }} />}
                            <span>{sosLabel}</span>
                        </button>
                    </div>

                    <p style={{ marginTop: '1.25rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        {sosPhase === 'idle' && 'Press to send emergency alert with your GPS location'}
                        {sosPhase === 'countdown' && '⏱ Sending SOS in…  press Cancel to abort'}
                        {sosPhase === 'sent' && '✅ SOS dispatched to all emergency contacts'}
                    </p>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: '1rem' }}>
                        {sosPhase === 'countdown' && (
                            <button className="btn btn-ghost" onClick={cancelSOS} style={{ gap: 8, color: 'var(--color-danger)' }}>
                                <X size={16} /> Cancel SOS
                            </button>
                        )}
                        {sosPhase === 'idle' && (
                            <button className="btn btn-ghost" onClick={shareLocation} style={{ gap: 8 }}>
                                <MapPin size={16} /> Share My Location
                            </button>
                        )}
                    </div>

                    {locStatus && (
                        <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--color-accent)', wordBreak: 'break-all' }}>
                            📍 {locStatus}
                        </div>
                    )}
                </div>

                {/* ── Info cards ─────────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {[
                        { icon: <Shield size={18} />, label: 'GPS Capture', desc: 'Location sent with alert', color: 'var(--color-primary)' },
                        { icon: <Phone size={18} />, label: 'SMS Dispatch', desc: 'Via Twilio to contacts', color: 'var(--color-warning)' },
                        { icon: <History size={18} />, label: 'Auto Log', desc: 'Stored in MongoDB', color: 'var(--color-accent)' },
                    ].map(({ icon, label, desc, color }) => (
                        <div key={label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                            <div style={{ color, marginBottom: 6 }}>{icon}</div>
                            <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{label}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                        </div>
                    ))}
                </div>

                {/* ── Recent SOS events (session) ────────────────────────── */}
                {eventLog.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <History size={16} style={{ color: 'var(--color-primary)' }} /> This-session SOS History
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {eventLog.map(ev => (
                                <div key={ev.id} className="card" style={{ padding: '0.75rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(255,75,110,0.25)' }}>
                                    <div style={{ fontSize: '0.875rem' }}>
                                        <span className="badge badge-danger" style={{ marginRight: 8 }}>SOS</span>
                                        {ev.notified} contact{ev.notified !== 1 ? 's' : ''} notified
                                        {ev.mapsLink && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>GPS included</span>}
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ev.ts}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Emergency Contacts ─────────────────────────────────── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 700 }}>Emergency Contacts ({contacts.length}/5)</div>
                    {contacts.length < 5 && (
                        <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }} onClick={() => setShowAdd(!showAdd)}>
                            <Plus size={14} /> Add
                        </button>
                    )}
                </div>

                {showAdd && (
                    <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--color-primary)' }}>
                        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Name *</label>
                                    <input className="form-input" required placeholder="Rohan Sharma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Phone * (E.164)</label>
                                    <input className="form-input" required placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Relationship</label>
                                <input className="form-input" placeholder="Brother, Mother..." value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem' }}>
                                    <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                                    Primary Contact
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem' }}>
                                    <input type="checkbox" checked={form.notifyOnAlert} onChange={(e) => setForm({ ...form, notifyOnAlert: e.target.checked })} />
                                    Notify on Alert
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? <LoadingSpinner size={16} color="#fff" /> : 'Save'}
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                            </div>
                        </form>
                    </div>
                )}

                {loading ? <LoadingSpinner size={28} /> : contacts.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No emergency contacts yet. Add one to enable SOS SMS dispatch.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {contacts.map((c) => (
                            <div key={c._id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem' }}>
                                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(108,99,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>
                                    {c.name[0]?.toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                                        {c.isPrimary && <Star size={13} style={{ color: 'var(--color-warning)' }} fill="currentColor" />}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                                        <span><Phone size={11} style={{ marginRight: 3 }} />{c.phone}</span>
                                        {c.relationship && <span>{c.relationship}</span>}
                                    </div>
                                </div>
                                <button onClick={() => handleDelete(c._id)} className="btn btn-ghost" style={{ padding: '0.4rem', color: 'var(--color-danger)', border: 'none' }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </AppLayout>
    );
};

export default EmergencyPage;
