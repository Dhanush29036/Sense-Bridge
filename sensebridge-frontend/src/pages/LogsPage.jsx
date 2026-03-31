import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { logService } from '../services/api';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { ChevronLeft, ScrollText, Trash2, RefreshCw, Filter } from 'lucide-react';

const EVENT_TYPES = ['', 'object_detection', 'gesture', 'speech_to_text', 'text_to_speech', 'navigation_alert', 'system'];
const SEVERITIES  = ['', 'info', 'warning', 'critical'];

const SEV_COLOR = {
    info:     { bg: 'rgba(108,99,255,0.12)', color: 'var(--color-primary)',  border: 'rgba(108,99,255,0.3)' },
    warning:  { bg: 'rgba(255,169,77,0.12)', color: 'var(--color-warning)',  border: 'rgba(255,169,77,0.3)' },
    critical: { bg: 'rgba(255,75,110,0.12)', color: 'var(--color-danger)',   border: 'rgba(255,75,110,0.3)' },
};

const LogsPage = () => {
    const navigate = useNavigate();
    const [logs,    setLogs]    = useState([]);
    const [total,   setTotal]   = useState(0);
    const [page,    setPage]    = useState(1);
    const [pages,   setPages]   = useState(1);
    const [loading, setLoading] = useState(false);
    const [filter,  setFilter]  = useState({ eventType: '', severity: '' });

    const fetchLogs = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const params = {
                page: p, limit: 20,
                ...(filter.eventType && { eventType: filter.eventType }),
                ...(filter.severity  && { severity:  filter.severity }),
            };
            const { data } = await logService.getAll(params);
            setLogs(data.data);
            setTotal(data.total);
            setPages(data.pages);
            setPage(p);
        } catch {
            toast.error('Failed to load logs');
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { fetchLogs(1); }, [fetchLogs]);

    const handleClear = async () => {
        if (!window.confirm('Delete all logs? This cannot be undone.')) return;
        try {
            await logService.clear();
            setLogs([]); setTotal(0); setPages(1);
            toast.success('All logs cleared.');
        } catch {
            toast.error('Failed to clear logs.');
        }
    };

    return (
        <AppLayout>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="icon-btn" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft size={20} />
                </button>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ScrollText size={18} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>Activity Logs</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>{total} AI events recorded</div>
                </div>
                <button onClick={() => fetchLogs(1)} className="icon-btn" title="Refresh">
                    <RefreshCw size={16} />
                </button>
                {logs.length > 0 && (
                    <button onClick={handleClear} className="icon-btn" title="Clear all" style={{ color: 'var(--color-danger)' }}>
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <Filter size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <select
                    className="form-input"
                    style={{ flex: 1, minWidth: 130, padding: '0.45rem 0.75rem', fontSize: '0.78rem' }}
                    value={filter.eventType}
                    onChange={e => setFilter(f => ({ ...f, eventType: e.target.value }))}
                >
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t || 'All types'}</option>)}
                </select>
                <select
                    className="form-input"
                    style={{ flex: 1, minWidth: 120, padding: '0.45rem 0.75rem', fontSize: '0.78rem' }}
                    value={filter.severity}
                    onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))}
                >
                    {SEVERITIES.map(s => <option key={s} value={s}>{s || 'All severities'}</option>)}
                </select>
            </div>

            {/* Log list */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                    <LoadingSpinner size={32} />
                </div>
            ) : logs.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1.5rem', borderRadius: 18 }}>
                    <div style={{ fontSize: '2rem', marginBottom: 10 }}>📋</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No logs found</div>
                    <div style={{ fontSize: '0.78rem' }}>Use AI assist modes to generate events</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {logs.map(log => {
                        const sev = SEV_COLOR[log.severity] || SEV_COLOR.info;
                        return (
                            <div key={log._id} style={{
                                background: 'var(--bg-card)',
                                border: `1px solid ${sev.border}`,
                                borderLeft: `3px solid ${sev.color}`,
                                borderRadius: 14,
                                padding: '0.875rem 1rem',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <span style={{
                                        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em',
                                        padding: '2px 7px', borderRadius: 6,
                                        background: sev.bg, color: sev.color,
                                        textTransform: 'uppercase',
                                    }}>
                                        {log.severity}
                                    </span>
                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', background: 'var(--bg-card2)', padding: '2px 7px', borderRadius: 6 }}>
                                        {log.eventType}
                                    </span>
                                    <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                        {new Date(log.createdAt).toLocaleTimeString()}
                                    </span>
                                </div>
                                <div style={{ fontWeight: 500, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: log.confidence != null ? 4 : 0 }}>
                                    {log.message}
                                </div>
                                {log.confidence != null && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        Confidence: {(log.confidence * 100).toFixed(0)}%
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: '1.25rem' }}>
                    {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                        <button
                            key={p}
                            onClick={() => fetchLogs(p)}
                            style={{
                                width: 36, height: 36, borderRadius: 10, border: '1.5px solid',
                                borderColor: page === p ? 'var(--color-primary)' : 'var(--border-card)',
                                background: page === p ? 'rgba(108,99,255,0.15)' : 'var(--bg-card)',
                                color: page === p ? 'var(--color-primary)' : 'var(--text-muted)',
                                fontWeight: page === p ? 700 : 500,
                                fontSize: '0.82rem',
                                cursor: 'pointer',
                            }}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            )}
        </AppLayout>
    );
};

export default LogsPage;
