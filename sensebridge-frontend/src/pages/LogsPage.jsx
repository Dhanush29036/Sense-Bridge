import { useState, useEffect, useCallback } from 'react';
import AppLayout from '../layouts/AppLayout';
import { logService } from '../services/api';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { ScrollText, Trash2, RefreshCw, Filter } from 'lucide-react';

const EVENT_TYPES = ['', 'object_detection', 'gesture', 'speech_to_text', 'text_to_speech', 'navigation_alert', 'system'];
const SEVERITIES = ['', 'info', 'warning', 'critical'];

const SEVERITY_BADGE = {
    info: 'badge-info',
    warning: 'badge-warning',
    critical: 'badge-danger',
};

const LogsPage = () => {
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState({ eventType: '', severity: '' });

    const fetchLogs = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const params = { page: p, limit: 20, ...(filter.eventType && { eventType: filter.eventType }), ...(filter.severity && { severity: filter.severity }) };
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ScrollText size={24} style={{ color: 'var(--color-primary)' }} /> Activity Logs
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{total} AI events recorded</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => fetchLogs(1)} className="btn btn-ghost">
                            <RefreshCw size={15} /> Refresh
                        </button>
                        {logs.length > 0 && (
                            <button onClick={handleClear} className="btn btn-ghost" style={{ color: 'var(--color-danger)' }}>
                                <Trash2 size={15} /> Clear All
                            </button>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.85rem 1.25rem' }}>
                    <Filter size={15} style={{ color: 'var(--text-muted)' }} />
                    <select className="form-input" style={{ width: 'auto', padding: '0.4rem 0.75rem' }}
                        value={filter.eventType} onChange={(e) => setFilter((f) => ({ ...f, eventType: e.target.value }))}>
                        {EVENT_TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
                    </select>
                    <select className="form-input" style={{ width: 'auto', padding: '0.4rem 0.75rem' }}
                        value={filter.severity} onChange={(e) => setFilter((f) => ({ ...f, severity: e.target.value }))}>
                        {SEVERITIES.map((s) => <option key={s} value={s}>{s || 'All severities'}</option>)}
                    </select>
                </div>

                {/* Log list */}
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><LoadingSpinner size={32} /></div>
                ) : logs.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                        No logs found. Use the AI assist modes to generate events.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {logs.map((log) => (
                            <div key={log._id} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                <div>
                                    <span className={`badge ${SEVERITY_BADGE[log.severity] || 'badge-info'}`} style={{ marginRight: 8 }}>{log.severity}</span>
                                    <span className="badge badge-info" style={{ opacity: 0.7, fontSize: '0.65rem' }}>{log.eventType}</span>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: 2 }}>{log.message}</div>
                                    {log.confidence != null && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Confidence: {(log.confidence * 100).toFixed(0)}%</div>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
                                    {new Date(log.createdAt).toLocaleString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {pages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                            <button key={p} onClick={() => fetchLogs(p)} className="btn btn-ghost"
                                style={{
                                    padding: '0.4rem 0.85rem', fontSize: '0.875rem',
                                    borderColor: page === p ? 'var(--color-primary)' : 'var(--border-color)',
                                    background: page === p ? 'rgba(108,99,255,0.1)' : 'transparent',
                                    color: page === p ? 'var(--color-primary)' : 'var(--text-secondary)',
                                }}>
                                {p}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </AppLayout>
    );
};

export default LogsPage;
