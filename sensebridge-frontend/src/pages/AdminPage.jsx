/**
 * AdminPage.jsx — SenseBridge Admin Dashboard
 * Only accessible when user.isAdmin === true (enforced on backend + frontend)
 * Tabs: Overview | Users | SOS Events | Monitoring (Grafana)
 */
import { useState, useEffect, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { adminService } from '../services/api';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import {
    Users, AlertTriangle, Activity, Shield,
    RefreshCw, Crown, UserX, UserCheck, ExternalLink,
} from 'lucide-react';

const GRAFANA_URL   = 'http://localhost:3000';
const DASHBOARD_UID = 'sensebridge-api';
const DASH_SLUG     = 'sensebridge-api-monitoring';

// Build panel embed URL using the exact format Grafana generates (Grafana 11 scene mode)
const panelUrl = (panelId, height = 220) =>
    `${GRAFANA_URL}/d-solo/${DASHBOARD_UID}/${DASH_SLUG}?orgId=1&from=now-1h&to=now&timezone=browser&refresh=10s&panelId=${panelId}&__feature.dashboardSceneSolo`;

const ROLE_CFG = {
    blind:  { emoji: '👁️',  label: 'Vision Impaired',  color: '#6c63ff', bg: 'rgba(108,99,255,0.12)' },
    deaf:   { emoji: '👂',  label: 'Hearing Impaired', color: '#00D4AA', bg: 'rgba(0,212,170,0.12)'   },
    mute:   { emoji: '🤲',  label: 'Speech Impaired',  color: '#FFA94D', bg: 'rgba(255,169,77,0.12)'  },
    mixed:  { emoji: '⚡',  label: 'Multiple Needs',   color: '#FF6B9D', bg: 'rgba(255,107,157,0.12)' },
};

const Stat = ({ icon: Icon, label, value, color }) => (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={20} style={{ color }} />
        </div>
        <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, lineHeight: 1 }}>{value ?? '—'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
        </div>
    </div>
);

const AdminPage = () => {
    const [stats,    setStats]    = useState(null);
    const [users,    setUsers]    = useState([]);
    const [sosLog,   setSosLog]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [tab,      setTab]      = useState('overview');
    const [togglingId, setToggling] = useState(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [sRes, uRes, sosRes] = await Promise.all([
                adminService.stats(),
                adminService.users(),
                adminService.sosEvents(),
            ]);
            setStats(sRes.data.stats);
            setUsers(uRes.data.users);
            setSosLog(sosRes.data.events);
        } catch (err) {
            toast.error('Failed to load admin data: ' + (err.response?.data?.message || err.message));
        } finally {
            setLoading(false);
        }
    }, []);



    useEffect(() => { loadAll(); }, [loadAll]);

    const toggleActive = async (u) => {
        setToggling(u._id + 'active');
        try {
            const { data } = await adminService.toggleActive(u._id);
            setUsers(prev => prev.map(x => x._id === u._id ? { ...x, isActive: data.isActive } : x));
            toast.success(`${u.name} ${data.isActive ? 'activated' : 'deactivated'}`);
        } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
        finally { setToggling(null); }
    };

    const toggleAdmin = async (u) => {
        setToggling(u._id + 'admin');
        try {
            const { data } = await adminService.toggleAdmin(u._id);
            setUsers(prev => prev.map(x => x._id === u._id ? { ...x, isAdmin: data.isAdmin } : x));
            toast.success(`${u.name} ${data.isAdmin ? 'granted' : 'revoked'} admin`);
        } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
        finally { setToggling(null); }
    };

    const s = stats;

    const TABS = [
        { id: 'overview',    label: '📊 Overview' },
        { id: 'users',       label: `👥 Users (${users.length})` },
        { id: 'sos',         label: `🚨 SOS (${sosLog.length})` },
        { id: 'monitoring',  label: '📈 Monitoring' },
    ];

    return (
        <AppLayout>
            <div style={{ maxWidth: 960 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <Crown size={24} style={{ color: 'var(--color-warning)' }} /> Admin Dashboard
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Monitor users, SOS events, traffic, and system health</p>
                    </div>
                    <button onClick={loadAll} className="btn btn-ghost" style={{ gap: 6 }}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 6, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)} style={{
                            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
                            background: tab === t.id ? 'var(--color-primary)' : 'var(--bg-base)',
                            color: tab === t.id ? '#fff' : 'var(--text-muted)',
                            transition: 'all 0.15s',
                        }}>{t.label}</button>
                    ))}
                </div>

                {loading && !s ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><LoadingSpinner size={40} /></div>
                ) : (
                    <>
                        {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
                        {tab === 'overview' && (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                    <Stat icon={Users}         label="Total Users"   value={s?.users?.total}  color="var(--color-primary)" />
                                    <Stat icon={Activity}      label="Active Users"  value={s?.users?.active} color="var(--color-accent)"  />
                                    <Stat icon={AlertTriangle} label="SOS Events"    value={s?.sos?.total}    color="var(--color-danger)"  />
                                    <Stat icon={Shield}        label="SOS (24h)"     value={s?.sos?.last24h}  color="var(--color-warning)" />
                                </div>

                                <div className="card" style={{ marginBottom: '1.5rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: 12, fontSize: '0.9rem' }}>Breakdown by Disability Profile</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                                        {Object.entries(ROLE_CFG).map(([role, cfg]) => (
                                            <div key={role} style={{ padding: '0.75rem', borderRadius: 10, background: cfg.bg, border: `1px solid ${cfg.color}33`, textAlign: 'center' }}>
                                                <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>{cfg.emoji}</div>
                                                <div style={{ fontWeight: 800, fontSize: '1.3rem', color: cfg.color }}>{s?.byRole?.[role] ?? 0}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{cfg.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="card">
                                    <div style={{ fontWeight: 700, marginBottom: 12, fontSize: '0.9rem' }}>Recent SOS Events</div>
                                    {sosLog.slice(0, 3).map((ev, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
                                            <span><span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>SOS</span> {ev.user?.name}</span>
                                            <span style={{ color: 'var(--text-muted)' }}>{new Date(ev.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                                        </div>
                                    ))}
                                    {sosLog.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No SOS events yet.</p>}
                                    {sosLog.length > 3 && (
                                        <button onClick={() => setTab('sos')} style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                            View all {sosLog.length} events →
                                        </button>
                                    )}
                                </div>
                            </>
                        )}

                        {/* ── USERS TAB ────────────────────────────────────────── */}
                        {tab === 'users' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {users.map(u => {
                                    const cfg = ROLE_CFG[u.role] || ROLE_CFG.mixed;
                                    return (
                                        <div key={u._id} className="card" style={{
                                            display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.25rem',
                                            opacity: u.isActive ? 1 : 0.5,
                                            borderColor: u.isAdmin ? 'rgba(255,198,0,0.4)' : 'var(--border-color)',
                                        }}>
                                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>
                                                {cfg.emoji}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{u.name}</span>
                                                    {u.isAdmin && <Crown size={13} style={{ color: 'var(--color-warning)' }} />}
                                                    {!u.isActive && <span style={{ fontSize: '0.68rem', color: 'var(--color-danger)', background: 'rgba(255,75,110,0.1)', padding: '1px 6px', borderRadius: 4 }}>Inactive</span>}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 1 }}>
                                                    <span>{u.email}</span>
                                                    <span style={{ color: cfg.color }}>{cfg.label}</span>
                                                    {u.sosCount > 0 && <span style={{ color: 'var(--color-danger)' }}>🚨 {u.sosCount} SOS</span>}
                                                    <span>Joined {new Date(u.createdAt).toLocaleDateString('en-IN')}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                <button onClick={() => toggleActive(u)} disabled={togglingId === u._id + 'active'}
                                                    style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                                                        background: u.isActive ? 'rgba(0,212,170,0.12)' : 'rgba(255,75,110,0.12)',
                                                        color: u.isActive ? 'var(--color-accent)' : 'var(--color-danger)' }}>
                                                    {u.isActive ? <UserCheck size={12} /> : <UserX size={12} />}
                                                    {u.isActive ? 'Active' : 'Inactive'}
                                                </button>
                                                <button onClick={() => toggleAdmin(u)} disabled={togglingId === u._id + 'admin'}
                                                    style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                                                        background: u.isAdmin ? 'rgba(255,198,0,0.15)' : 'var(--bg-base)',
                                                        color: u.isAdmin ? '#c8a200' : 'var(--text-muted)' }}>
                                                    <Crown size={12} />
                                                    {u.isAdmin ? 'Admin' : 'User'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {users.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No users found.</div>}
                            </div>
                        )}

                        {/* ── SOS EVENTS TAB ───────────────────────────────────── */}
                        {tab === 'sos' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {sosLog.map((ev, i) => (
                                    <div key={ev._id || i} className="card" style={{ padding: '0.9rem 1.25rem', borderColor: 'rgba(255,75,110,0.25)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <span className="badge badge-danger" style={{ marginRight: 8 }}>SOS</span>
                                                <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{ev.user?.name || 'Unknown'}</span>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>{ev.user?.email}</span>
                                            </div>
                                            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                                {new Date(ev.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                                            </span>
                                        </div>
                                        <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
                                            <span>Source: {ev.source}</span>
                                            <span>Status: <span style={{ color: ev.status === 'dispatched' ? 'var(--color-accent)' : 'var(--color-danger)' }}>{ev.status}</span></span>
                                            {ev.latitude && ev.longitude && (
                                                <a href={`https://maps.google.com/?q=${ev.latitude},${ev.longitude}`} target="_blank" rel="noreferrer"
                                                   style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>📍 View Location</a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {sosLog.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No SOS events yet.</div>}
                            </div>
                        )}

                        {/* ── MONITORING TAB (Grafana) ─────────────────────────── */}
                        {tab === 'monitoring' && (
                            <div>
                                {/* Status banner — always visible */}
                                <div className="card" style={{
                                    marginBottom: '1rem', padding: '0.75rem 1.25rem',
                                    borderColor: 'rgba(0,212,170,0.35)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', flexShrink: 0 }} />
                                        <span>Live Grafana dashboards — auto-refreshing every <strong>10s</strong>. Needs <strong>Prometheus</strong> running for data.</span>
                                    </div>
                                    <a href={GRAFANA_URL} target="_blank" rel="noreferrer"
                                       style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-primary)', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600, flexShrink: 0 }}>
                                        <ExternalLink size={13} /> Open Grafana
                                    </a>
                                </div>

                                {(
                                    <>
                                        {/* Row 1 — Time-series: Request Rate + Latency */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                            {[
                                                { panelId: 1, title: '📡 HTTP Request Rate (req/s)' },
                                                { panelId: 2, title: '⏱ Response Latency (p50 / p95 / p99)' },
                                            ].map(({ panelId, title }) => (
                                                <div key={panelId} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                                                        {title}
                                                    </div>
                                                    <iframe
                                                        src={panelUrl(panelId)}
                                                        width="100%" height="250"
                                                        frameBorder="0"
                                                        style={{ display: 'block', border: 'none', background: '#111827' }}
                                                        title={title}
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        {/* Row 2 — Error Rate + Active Connections */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                            {[
                                                { panelId: 3, title: '🔴 Error Rate (4xx / 5xx)' },
                                                { panelId: 4, title: '🔄 Active Connections' },
                                            ].map(({ panelId, title }) => (
                                                <div key={panelId} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                                                        {title}
                                                    </div>
                                                    <iframe
                                                        src={panelUrl(panelId)}
                                                        width="100%" height="250"
                                                        frameBorder="0"
                                                        style={{ display: 'block', border: 'none', background: '#111827' }}
                                                        title={title}
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        {/* Row 3 — Gauges: Registered Users + Active Users + SOS */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                                            {[
                                                { panelId: 5, title: '👥 Registered Users' },
                                                { panelId: 6, title: '✅ Active Users' },
                                                { panelId: 7, title: '🚨 SOS Events' },
                                            ].map(({ panelId, title }) => (
                                                <div key={panelId} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>{title}</div>
                                                    <iframe
                                                        src={panelUrl(panelId)}
                                                        width="100%" height="160"
                                                        frameBorder="0"
                                                        style={{ display: 'block', border: 'none', background: '#111827' }}
                                                        title={title}
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        {/* Row 4 — Process Memory (full width) */}
                                        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
                                            <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>💾 Process Memory Usage</div>
                                            <iframe
                                                src={panelUrl(8)}
                                                width="100%" height="220"
                                                frameBorder="0"
                                                style={{ display: 'block', border: 'none', background: '#111827' }}
                                                title="Process Memory"
                                            />
                                        </div>

                                        {/* Row 5 — Top Routes table (full width) */}
                                        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                            <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>🔝 Top Routes by Traffic</div>
                                            <iframe
                                                src={panelUrl(9)}
                                                width="100%" height="280"
                                                frameBorder="0"
                                                style={{ display: 'block', border: 'none', background: '#111827' }}
                                                title="Top Routes"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </AppLayout>
    );
};

export default AdminPage;
