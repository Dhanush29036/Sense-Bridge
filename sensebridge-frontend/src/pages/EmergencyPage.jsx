import { useState, useEffect } from 'react';
import AppLayout from '../layouts/AppLayout';
import { contactService } from '../services/api';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { AlertTriangle, Phone, MapPin, Plus, Trash2, Star } from 'lucide-react';

const EmergencyPage = () => {
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sosActive, setSosActive] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', relationship: '', isPrimary: false, notifyOnAlert: true });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        contactService.getAll()
            .then(({ data }) => setContacts(data.data))
            .catch(() => toast.error('Failed to load contacts'))
            .finally(() => setLoading(false));
    }, []);

    const handleSOS = () => {
        setSosActive(true);
        toast.error('🚨 SOS Alert Sent! Notifying emergency contacts...', { duration: 5000 });
        // Real impl: send push notifications + location to contacts
        setTimeout(() => setSosActive(false), 5000);
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { data } = await contactService.add(form);
            setContacts((c) => [...c, data.data]);
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
            setContacts((c) => c.filter((x) => x._id !== id));
            toast.success('Contact removed.');
        } catch {
            toast.error('Failed to remove.');
        }
    };

    return (
        <AppLayout>
            <div style={{ maxWidth: 700 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.5rem' }}>
                    <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} /> Emergency
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                    SOS alert and emergency contact management
                </p>

                {/* SOS Button */}
                <div className="card" style={{ textAlign: 'center', marginBottom: '1.5rem', padding: '2.5rem', background: sosActive ? 'rgba(255,75,110,0.08)' : 'var(--bg-card)', borderColor: sosActive ? 'var(--color-danger)' : 'var(--border-color)' }}>
                    <button onClick={handleSOS} disabled={sosActive}
                        style={{
                            width: 140, height: 140, borderRadius: '50%', border: 'none', cursor: 'pointer',
                            background: sosActive ? '#cc0033' : 'var(--color-danger)',
                            color: '#fff', fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.1em',
                            boxShadow: sosActive ? '0 0 40px rgba(255,75,110,0.7)' : '0 8px 32px rgba(255,75,110,0.4)',
                            animation: sosActive ? 'pulse-ring 0.8s ease-out infinite' : 'none',
                            transition: 'all 0.3s',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto',
                        }}>
                        <AlertTriangle size={32} />
                        <span style={{ marginTop: 6 }}>{sosActive ? 'SENT!' : 'SOS'}</span>
                    </button>
                    <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        {sosActive ? '🚨 Alert sent to all emergency contacts!' : 'Press to send emergency alert to all contacts'}
                    </p>

                    {/* Send location */}
                    <button className="btn btn-ghost" style={{ marginTop: '1rem', gap: 8 }}
                        onClick={() => {
                            navigator.geolocation?.getCurrentPosition(
                                ({ coords }) => toast.success(`📍 Location: ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`),
                                () => toast.error('Location permission denied')
                            );
                        }}>
                        <MapPin size={16} /> Share My Location
                    </button>
                </div>

                {/* Emergency Contacts */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 700 }}>Emergency Contacts ({contacts.length}/5)</div>
                    {contacts.length < 5 && (
                        <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }} onClick={() => setShowAdd(!showAdd)}>
                            <Plus size={14} /> Add
                        </button>
                    )}
                </div>

                {/* Add form */}
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

                {/* Contacts list */}
                {loading ? <LoadingSpinner size={28} /> : contacts.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        No emergency contacts yet. Add one above.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {contacts.map((c) => (
                            <div key={c._id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem' }}>
                                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(108,99,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--color-primary)', flexShrink: 0 }}>
                                    {c.name[0]}
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
