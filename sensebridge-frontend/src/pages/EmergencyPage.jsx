import { useState, useEffect, useRef } from 'react';
import AppLayout from '../layouts/AppLayout';
import { contactService, emergencyService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import {
    AlertTriangle, Phone, Mail, MapPin, Plus, Trash2, Star,
    X, Shield, History, MessageCircle, Copy, Check, Navigation,
} from 'lucide-react';

const COUNTDOWN_S = 5;

// ── Build the SOS text message ───────────────────────────────────────────────
const buildSOSText = (userName, mapsLink) =>
    `🚨 EMERGENCY SOS from ${userName || 'SenseBridge user'}\n` +
    `Location: ${mapsLink || 'Not available — check on me immediately!'}\n` +
    `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
    `Sent via SenseBridge Assistive System`;

// ── Open a WhatsApp link (wa.me) ─────────────────────────────────────────────
const openWhatsApp = (phone, text) => {
    // Strip everything except digits (wa.me does not want the + sign)
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return false;
    const url = `https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
};

// ── Build a mailto: link ─────────────────────────────────────────────────────
const mailtoLink = (email, subject, body) =>
    `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const EmergencyPage = () => {
    const { user } = useAuth();
    const [contacts,  setContacts]  = useState([]);
    const [loading,   setLoading]   = useState(true);
    const [sosPhase,  setSosPhase]  = useState('idle');   // 'idle'|'countdown'|'sent'
    const [countdown, setCountdown] = useState(COUNTDOWN_S);
    const [eventLog,  setEventLog]  = useState([]);
    const [showAdd,   setShowAdd]   = useState(false);
    const [form,      setForm]      = useState({ name: '', phone: '', email: '', relationship: '', isPrimary: false, notifyOnAlert: true });
    const [saving,    setSaving]    = useState(false);
    const [locStatus, setLocStatus] = useState('');
    const [copied,    setCopied]    = useState(false);
    const timerRef   = useRef(null);
    const coordsRef  = useRef(null);
    const sosTextRef = useRef('');

    useEffect(() => {
        contactService.getAll()
            .then(({ data }) => setContacts(data.data || []))
            .catch(() => toast.error('Failed to load contacts'))
            .finally(() => setLoading(false));
    }, []);

    // ── SOS countdown ────────────────────────────────────────────────────────
    const handleSOS = () => {
        if (sosPhase !== 'idle') return;
        setSosPhase('countdown');
        setCountdown(COUNTDOWN_S);

        // Start getting GPS immediately while countdown ticks
        navigator.geolocation?.getCurrentPosition(
            ({ coords }) => { coordsRef.current = { lat: coords.latitude, lng: coords.longitude }; },
            () => { coordsRef.current = null; },
            { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false }
        );

        let remaining = COUNTDOWN_S;
        timerRef.current = setInterval(() => {
            remaining -= 1;
            setCountdown(remaining);
            if (remaining <= 0) { clearInterval(timerRef.current); dispatchSOS(); }
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

        // ── 1. Build location + message ─────────────────────────────────
        const lat = coordsRef.current?.lat;
        const lng = coordsRef.current?.lng;
        const mapsLink = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
        const sosText  = buildSOSText(user?.name, mapsLink);
        sosTextRef.current = sosText;

        // ── 2. Copy SOS message to clipboard (works offline, always) ────
        try { await navigator.clipboard.writeText(sosText); } catch {}

        // ── 3. Try backend (SMS/email) — don't block on this ────────────
        let backendResult = null;
        try {
            const { data } = await emergencyService.sos({
                userId: user?._id,
                source: 'button',
                latitude:  lat ?? null,
                longitude: lng ?? null,
                timestamp: Date.now() / 1000,
                message:   sosText,
            });
            backendResult = data;
        } catch (err) {
            console.warn('[SOS] Backend unavailable:', err.message);
        }

        // ── 4. Build per-contact action list ────────────────────────────
        const actionList = contacts.map(c => {
            const smsSent   = backendResult?.contacts?.find(r => r.name === c.name)?.smsSent  ?? false;
            const emailSent = backendResult?.contacts?.find(r => r.name === c.name)?.emailSent ?? false;
            return { ...c, smsSent, emailSent };
        });

        // ── 5. Add to event log ─────────────────────────────────────────
        const entry = {
            id: Date.now(),
            ts: new Date().toLocaleTimeString(),
            mapsLink,
            sosText,
            contacts: actionList,
            smsSentCount:   backendResult?.smsSentCount   ?? 0,
            emailSentCount: backendResult?.emailSentCount ?? 0,
            twilioConfigured: backendResult?.twilioConfigured ?? false,
            emailConfigured:  backendResult?.emailConfigured  ?? false,
        };
        setEventLog(prev => [entry, ...prev].slice(0, 10));

        toast.error(
            backendResult?.contactsNotified > 0
                ? `🚨 SOS sent! ${backendResult.contactsNotified} contact(s) notified automatically.`
                : '🚨 SOS logged. Use the buttons below to alert your contacts.',
            { duration: 8000 }
        );

        setTimeout(() => { setSosPhase('idle'); setCountdown(COUNTDOWN_S); }, 5000);
    };

    // ── Copy SOS text ────────────────────────────────────────────────────────
    const copySOSText = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            toast.success('📋 SOS message copied!');
            setTimeout(() => setCopied(false), 2000);
        } catch { toast.error('Could not copy.'); }
    };

    // ── Share current location ───────────────────────────────────────────────
    const shareLocation = () => {
        navigator.geolocation?.getCurrentPosition(
            ({ coords }) => {
                const link = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
                setLocStatus(link);
                navigator.clipboard?.writeText(link)
                    .then(() => toast.success('📍 Location link copied!'))
                    .catch(() => {});
            },
            () => toast.error('Location permission denied')
        );
    };

    // ── Add / Delete contacts ─────────────────────────────────────────────────
    const handleAdd = async (e) => {
        e.preventDefault();
        if (!form.phone && !form.email) {
            toast.error('Enter at least a phone number or email address.');
            return;
        }
        setSaving(true);
        try {
            const { data } = await contactService.add(form);
            setContacts(c => [...c, data.data]);
            setForm({ name: '', phone: '', email: '', relationship: '', isPrimary: false, notifyOnAlert: true });
            setShowAdd(false);
            toast.success('Contact added!');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to add contact');
        } finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this contact?')) return;
        try {
            await contactService.remove(id);
            setContacts(c => c.filter(x => x._id !== id));
            toast.success('Contact removed.');
        } catch { toast.error('Failed to remove.'); }
    };

    // ── Derived ──────────────────────────────────────────────────────────────
    const sosColor = sosPhase === 'sent' ? '#00D4AA' : 'var(--color-danger)';
    const sosLabel = sosPhase === 'countdown' ? countdown : sosPhase === 'sent' ? '✓' : 'SOS';

    return (
        <AppLayout>
            <div style={{ maxWidth: 720 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
                    <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} /> Emergency
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                    SOS alert with GPS — sends via WhatsApp, Email &amp; SMS to your emergency contacts
                </p>

                {/* ── SOS Button zone ─────────────────────────────────────────── */}
                <div className="card" style={{
                    textAlign: 'center', marginBottom: '1.5rem', padding: '2.5rem',
                    background: sosPhase !== 'idle' ? 'rgba(255,75,110,0.06)' : 'var(--bg-card)',
                    borderColor: sosPhase !== 'idle' ? 'var(--color-danger)' : 'var(--border-color)',
                    transition: 'all 0.3s',
                }}>
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
                        {sosPhase === 'idle'      && 'Press to send emergency alert with your GPS location'}
                        {sosPhase === 'countdown' && '⏱ Sending SOS in…  press Cancel to abort'}
                        {sosPhase === 'sent'      && '✅ SOS triggered — use the contact buttons below to notify people'}
                    </p>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
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

                {/* ── Dispatch Log + Contact Action Buttons ────────────────── */}
                {eventLog.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <History size={16} style={{ color: 'var(--color-primary)' }} /> SOS Dispatch — Send Now
                        </div>

                        {eventLog.map(ev => (
                            <div key={ev.id} className="card" style={{ borderColor: 'rgba(255,75,110,0.4)', marginBottom: 10, padding: '1.25rem' }}>
                                {/* Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                    <div>
                                        <span className="badge badge-danger" style={{ marginRight: 8 }}>🚨 SOS</span>
                                        {ev.smsSentCount > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', marginRight: 6 }}>📱 {ev.smsSentCount} SMS sent</span>}
                                        {ev.emailSentCount > 0 && <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>📧 {ev.emailSentCount} email sent</span>}
                                    </div>
                                    <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{ev.ts}</span>
                                </div>

                                {/* GPS link */}
                                {ev.mapsLink && (
                                    <a href={ev.mapsLink} target="_blank" rel="noreferrer"
                                       style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--color-accent)', marginBottom: 12, textDecoration: 'none' }}>
                                        <Navigation size={12} /> {ev.mapsLink}
                                    </a>
                                )}

                                {/* Copy message button */}
                                <button
                                    onClick={() => copySOSText(ev.sosText)}
                                    className="btn btn-ghost"
                                    style={{ width: '100%', justifyContent: 'center', marginBottom: 12, gap: 6, fontSize: '0.8rem' }}>
                                    {copied ? <Check size={14} style={{ color: 'var(--color-accent)' }} /> : <Copy size={14} />}
                                    {copied ? 'Copied!' : 'Copy SOS Message to Clipboard'}
                                </button>

                                {/* Per-contact action buttons */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {ev.contacts.map((c, i) => (
                                        <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-base)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(108,99,255,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                                    {c.name?.[0]?.toUpperCase()}
                                                </span>
                                                {c.name}
                                                {c.relationship && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>• {c.relationship}</span>}
                                                {c.smsSent   && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--color-accent)', background: 'rgba(0,212,170,0.1)', padding: '1px 7px', borderRadius: 4 }}>SMS ✓</span>}
                                                {c.emailSent && <span style={{ marginLeft: c.smsSent ? 4 : 'auto', fontSize: '0.7rem', color: 'var(--color-primary)', background: 'rgba(108,99,255,0.1)', padding: '1px 7px', borderRadius: 4 }}>Email ✓</span>}
                                            </div>

                                            {/* Action buttons for this contact */}
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {/* WhatsApp */}
                                                {c.phone && (
                                                    <button
                                                        onClick={() => openWhatsApp(c.phone, ev.sosText)}
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#25D366', color: '#fff', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        <MessageCircle size={13} /> WhatsApp
                                                    </button>
                                                )}
                                                {/* Email */}
                                                {c.email && (
                                                    <a href={mailtoLink(c.email, `🚨 Emergency SOS from ${user?.name || 'SenseBridge'}`, ev.sosText)}
                                                       style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, textDecoration: 'none', background: 'rgba(108,99,255,0.15)', color: 'var(--color-primary)', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        <Mail size={13} /> Send Email
                                                    </a>
                                                )}
                                                {/* Phone call */}
                                                {c.phone && (
                                                    <a href={`tel:${c.phone}`}
                                                       style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, textDecoration: 'none', background: 'rgba(255,75,110,0.1)', color: 'var(--color-danger)', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        <Phone size={13} /> Call
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {ev.contacts.length === 0 && (
                                    <div style={{ fontSize: '0.82rem', color: 'var(--color-warning)', padding: '8px 12px', background: 'rgba(255,169,77,0.08)', borderRadius: 8 }}>
                                        ⚠️ No emergency contacts saved. Add contacts below so they appear here during SOS.
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Info cards ──────────────────────────────────────────── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {[
                        { icon: <MessageCircle size={18} />, label: 'WhatsApp', desc: 'Pre-filled message sent', color: '#25D366' },
                        { icon: <Mail size={18} />,          label: 'Email',    desc: 'Opens your email app',   color: 'var(--color-primary)' },
                        { icon: <Phone size={18} />,         label: 'Call',     desc: 'Direct phone call link', color: 'var(--color-danger)' },
                    ].map(({ icon, label, desc, color }) => (
                        <div key={label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                            <div style={{ color, marginBottom: 6 }}>{icon}</div>
                            <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{label}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                        </div>
                    ))}
                </div>

                {/* ── Emergency Contacts ──────────────────────────────────── */}
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
                                    <label className="form-label">Relationship</label>
                                    <input className="form-input" placeholder="Brother, Mother…" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                <div className="form-group">
                                    <label className="form-label">📱 Phone (E.164 format)</label>
                                    <input className="form-input" placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">📧 Email address</label>
                                    <input className="form-input" type="email" placeholder="contact@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem' }}>
                                    <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                                    Primary Contact
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? <LoadingSpinner size={16} color="#fff" /> : 'Save Contact'}
                                </button>
                                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                            </div>
                        </form>
                    </div>
                )}

                {loading ? <LoadingSpinner size={28} /> : contacts.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No emergency contacts yet. Add at least one contact with a phone or email.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {contacts.map((c) => (
                            <div key={c._id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem' }}>
                                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(108,99,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>
                                    {c.name[0]?.toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                                        {c.isPrimary && <Star size={13} style={{ color: 'var(--color-warning)' }} fill="currentColor" />}
                                        {c.relationship && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.relationship}</span>}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                                        {c.phone && <span><Phone size={11} style={{ marginRight: 3 }} />{c.phone}</span>}
                                        {c.email && <span><Mail size={11} style={{ marginRight: 3 }} />{c.email}</span>}
                                    </div>
                                    {/* Quick action buttons on the contact card */}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                                        {c.phone && (
                                            <a href={`https://api.whatsapp.com/send?phone=${c.phone.replace(/\D/g,'')}&text=${encodeURIComponent('Hi, this is a test SOS message from SenseBridge.')}`}
                                               target="_blank" rel="noreferrer"
                                               style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6, background:'#25D366', color:'#fff', fontSize:'0.72rem', fontWeight:600, textDecoration:'none' }}>
                                                <MessageCircle size={11}/> WhatsApp
                                            </a>
                                        )}
                                        {c.phone && (
                                            <a href={`tel:${c.phone}`}
                                               style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6, background:'rgba(255,75,110,0.1)', color:'var(--color-danger)', fontSize:'0.72rem', fontWeight:600, textDecoration:'none' }}>
                                                <Phone size={11}/> Call
                                            </a>
                                        )}
                                        {c.email && (
                                            <a href={`mailto:${c.email}`}
                                               style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6, background:'rgba(108,99,255,0.1)', color:'var(--color-primary)', fontSize:'0.72rem', fontWeight:600, textDecoration:'none' }}>
                                                <Mail size={11}/> Email
                                            </a>
                                        )}
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
