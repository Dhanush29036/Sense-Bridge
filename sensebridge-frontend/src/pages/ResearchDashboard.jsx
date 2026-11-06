/**
 * ResearchDashboard.jsx — Hidden Research & Experiment Mode
 * ==========================================================
 * Accessible only when researcher mode is enabled in Settings.
 * Hidden from normal users.
 *
 * Features:
 *   1. Performance Dashboard (real inference statistics)
 *   2. Experiment Session Management
 *   3. Ground-truth label entry for accuracy measurement
 *   4. Ablation study configuration
 *   5. Environmental metadata entry
 *   6. Export to CSV / JSON
 *   7. Live metrics calculation from actual data
 *
 * All metrics displayed are computed from actual recorded inferences.
 * No fabricated values are displayed.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import {
    ChevronLeft, Play, Square, Download, RefreshCw,
    FlaskConical, BarChart3, Settings2, FileJson, FileText,
    CheckCircle, XCircle, Clock, Cpu, AlertTriangle,
} from 'lucide-react';
import {
    startExperimentSession, endExperimentSession, listSessions,
    getSession, logInferenceRecord, getSessionMetrics,
    downloadSessionJson, downloadSessionCsv,
    getDashboard, resetDashboard, ABLATION_CONFIGS, validateEnvironment,
} from '../services/experimentService';
import { getConfig, updateConfig, setAblationConfig } from '../config/config';
import { getAIBaseURL } from '../services/networkConfig';
import { toast } from 'react-hot-toast';

// ─── Default ablation state ───────────────────────────────────────────────────
const DEFAULT_ABLATION = { vision: true, ocr: true, speech: true, gesture: true, fusion: true };
const DEFAULT_ENV = {
    lighting: 'normal', noise: 'quiet', camera: 'medium',
    motion: 'static', text: 'clear', gesture: 'simple', notes: '',
};

const ResearchDashboard = () => {
    const navigate = useNavigate();

    // ── State ──────────────────────────────────────────────────────────────────
    const [tab, setTab] = useState('dashboard');  // 'dashboard' | 'sessions' | 'experiment' | 'ablation'
    const [dashboard, setDashboard] = useState(null);
    const [dashLoading, setDashLoading] = useState(false);

    const [sessions, setSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessionMetrics, setSessionMetrics] = useState(null);

    // Active experiment session
    const [activeSession, setActiveSession] = useState(null);
    const [sessionName, setSessionName] = useState('');
    const [ablation, setAblation] = useState(DEFAULT_ABLATION);
    const [environment, setEnvironment] = useState(DEFAULT_ENV);
    const [sessionRunning, setSessionRunning] = useState(false);

    // Ground-truth entry form
    const [gtForm, setGtForm] = useState({
        modality: 'vision',
        predictedLabel: '',
        expectedLabel: '',
        confidence: '',
        latencyMs: '',
    });
    const [gtResult, setGtResult] = useState(null);

    const [backendOnline, setBackendOnline] = useState(true);

    // ── Check backend availability ─────────────────────────────────────────────
    useEffect(() => {
        const aiUrl = getAIBaseURL() || 'http://localhost:8000';
        fetch(`${aiUrl}/health`)
            .then(r => setBackendOnline(r.ok))
            .catch(() => setBackendOnline(false));
    }, []);

    // ── Load dashboard ─────────────────────────────────────────────────────────
    const loadDashboard = useCallback(async () => {
        setDashLoading(true);
        try {
            const data = await getDashboard();
            setDashboard(data);
        } catch (e) {
            console.warn('[ResearchDashboard] Error loading dashboard:', e.message);
            setDashboard({
                total_inferences: 0,
                successful: 0,
                failed: 0,
                global_latency: { avg_ms: 0, p95_ms: 0 },
                per_modality: {},
                psutil_available: false,
            });
        } finally {
            setDashLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab === 'dashboard') loadDashboard();
    }, [tab, loadDashboard]);

    // ── Load sessions ──────────────────────────────────────────────────────────
    const loadSessions = useCallback(async () => {
        try {
            const data = await listSessions();
            setSessions(data || []);
        } catch (e) {
            console.warn('[ResearchDashboard] Sessions offline:', e.message);
            setSessions([]);
        }
    }, []);

    useEffect(() => {
        if (tab === 'sessions') loadSessions();
    }, [tab, loadSessions]);

    // ── Start / End Session ───────────────────────────────────────────────────
    const handleStartSession = async () => {
        if (!sessionName.trim()) { toast.error('Please enter a session name'); return; }
        const envError = validateEnvironment(environment);
        if (envError) { toast.error(envError); return; }

        try {
            const session = await startExperimentSession({
                name: sessionName.trim(),
                ablation,
                environment,
            });
            setActiveSession(session);
            setSessionRunning(true);
            setGtResult(null);
            setAblationConfig(ablation);  // persist to app config
            toast.success(`Session started: ${session.session_id.slice(0, 8)}`);
        } catch (e) {
            toast.error(`Failed to start session: ${e.message}`);
        }
    };

    const handleEndSession = async () => {
        if (!activeSession) return;
        try {
            await endExperimentSession(activeSession.session_id);
            toast.success('Session ended');
            setSessionRunning(false);
        } catch (e) {
            toast.error(`Failed to end session: ${e.message}`);
        }
    };

    // ── Log Ground-Truth Record ───────────────────────────────────────────────
    const handleLogRecord = async () => {
        if (!activeSession) { toast.error('No active session'); return; }
        if (!gtForm.predictedLabel.trim()) { toast.error('Predicted label is required'); return; }
        if (!gtForm.latencyMs || isNaN(Number(gtForm.latencyMs))) {
            toast.error('Latency (ms) is required and must be a number'); return;
        }

        try {
            const record = await logInferenceRecord({
                sessionId:      activeSession.session_id,
                modality:       gtForm.modality,
                predictedLabel: gtForm.predictedLabel.trim(),
                confidence:     gtForm.confidence ? Number(gtForm.confidence) : null,
                latencyMs:      Number(gtForm.latencyMs),
                expectedLabel:  gtForm.expectedLabel.trim() || null,
            });
            setGtResult(record);
            toast.success('Record logged');
            // Reset form
            setGtForm(f => ({ ...f, predictedLabel: '', expectedLabel: '', confidence: '', latencyMs: '' }));
        } catch (e) {
            toast.error(`Failed to log record: ${e.message}`);
        }
    };

    // ── Session details + metrics ─────────────────────────────────────────────
    const handleViewSession = async (sessionId) => {
        try {
            const [sess, metrics] = await Promise.all([
                getSession(sessionId),
                getSessionMetrics(sessionId),
            ]);
            setSelectedSession(sess);
            setSessionMetrics(metrics);
        } catch (e) {
            toast.error(`Cannot load session: ${e.message}`);
        }
    };

    // ─── Render Helpers ───────────────────────────────────────────────────────
    const renderStat = (label, value, unit = '') => (
        <div style={styles.statCard}>
            <div style={styles.statValue}>{value !== null && value !== undefined ? `${value}${unit}` : '—'}</div>
            <div style={styles.statLabel}>{label}</div>
        </div>
    );

    const renderModalityRow = (modality, stats) => (
        <tr key={modality} style={styles.tableRow}>
            <td style={styles.td}>{modality.toUpperCase()}</td>
            <td style={styles.td}>{stats?.samples ?? 0}</td>
            <td style={styles.td}>{stats?.successful ?? 0}</td>
            <td style={styles.td}>{stats?.failed ?? 0}</td>
            <td style={styles.td}>{stats?.avg_latency_ms ? `${stats.avg_latency_ms}ms` : '—'}</td>
            <td style={styles.td}>{stats?.p95_latency_ms ? `${stats.p95_latency_ms}ms` : '—'}</td>
            <td style={styles.td}>
                {stats?.avg_confidence !== null && stats?.avg_confidence !== undefined
                    ? `${(stats.avg_confidence * 100).toFixed(1)}%`
                    : <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>N/A</span>}
            </td>
        </tr>
    );

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <AppLayout title="Experiments">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
                <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>Research & Experiments</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Empirical evaluation & session logging</div>
                </div>
                <div style={{
                    ...styles.onlineBadge,
                    background: backendOnline ? 'rgba(52,199,89,0.15)' : 'rgba(108,99,255,0.15)',
                    color: backendOnline ? 'var(--green)' : '#6C63FF',
                }}>
                    {backendOnline ? '● Python Backend Online' : '● Local Offline Storage Ready'}
                </div>
            </div>

            {/* Tab bar */}
            <div style={styles.tabBar}>
                {[
                    { key: 'dashboard', label: '📊 Dashboard', icon: BarChart3 },
                    { key: 'experiment', label: '🧪 Run Experiment', icon: FlaskConical },
                    { key: 'sessions', label: '📋 Sessions', icon: FileText },
                    { key: 'ablation', label: '⚙️ Ablation', icon: Settings2 },
                ].map(({ key, label }) => (
                    <button
                        key={key}
                        style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}
                        onClick={() => setTab(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* ── Dashboard Tab ── */}
            {tab === 'dashboard' && (
                <div>
                    <div style={styles.sectionHeader}>
                        <span>Live Performance Statistics</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button style={styles.btnSecondary} onClick={loadDashboard} disabled={dashLoading}>
                                <RefreshCw size={14} /> Refresh
                            </button>
                            <button style={styles.btnDanger} onClick={async () => {
                                await resetDashboard();
                                toast.success('Monitor reset');
                                loadDashboard();
                            }}>Reset</button>
                        </div>
                    </div>

                    {dashLoading && <div style={styles.loading}>Loading statistics…</div>}

                    {!dashLoading && dashboard && (
                        <>
                            {/* Global stats */}
                            <div style={styles.statsRow}>
                                {renderStat('Total Inferences', dashboard.total_inferences)}
                                {renderStat('Successful', dashboard.successful)}
                                {renderStat('Failed', dashboard.failed)}
                                {renderStat('Avg Latency', dashboard.global_latency?.avg_ms, 'ms')}
                                {renderStat('P95 Latency', dashboard.global_latency?.p95_ms, 'ms')}
                            </div>

                            {/* Per-modality table */}
                            <div style={styles.card}>
                                <div style={styles.cardTitle}>Per-Modality Breakdown</div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={styles.table}>
                                        <thead>
                                            <tr>
                                                {['Modality', 'Samples', 'OK', 'Failed', 'Avg Lat', 'P95 Lat', 'Avg Conf'].map(h => (
                                                    <th key={h} style={styles.th}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(dashboard.per_modality || {}).map(([mod, stats]) =>
                                                renderModalityRow(mod, stats)
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {!dashboard.psutil_available && (
                                    <div style={styles.note}>
                                        ℹ️ CPU/Memory metrics unavailable (install psutil on Python backend)
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {!dashLoading && !dashboard && (
                        <div style={styles.emptyState}>
                            Python backend not connected. Start the AI server to see statistics.
                        </div>
                    )}
                </div>
            )}

            {/* ── Experiment Tab ── */}
            {tab === 'experiment' && (
                <div>
                    {/* Session control */}
                    <div style={styles.card}>
                        <div style={styles.cardTitle}>
                            <FlaskConical size={16} /> Experiment Session
                        </div>

                        {!sessionRunning ? (
                            <>
                                <input
                                    style={styles.input}
                                    placeholder="Session name (e.g. Gesture Eval — Low Light)"
                                    value={sessionName}
                                    onChange={e => setSessionName(e.target.value)}
                                />

                                {/* Environment metadata */}
                                <div style={styles.envGrid}>
                                    {[
                                        { key: 'lighting', opts: ['normal', 'low', 'high'] },
                                        { key: 'noise',    opts: ['quiet', 'moderate', 'high'] },
                                        { key: 'camera',   opts: ['near', 'medium', 'far'] },
                                        { key: 'motion',   opts: ['static', 'moderate', 'high'] },
                                        { key: 'text',     opts: ['clear', 'low_contrast', 'rotated'] },
                                        { key: 'gesture',  opts: ['simple', 'complex', 'fast'] },
                                    ].map(({ key, opts }) => (
                                        <div key={key} style={styles.envField}>
                                            <label style={styles.envLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</label>
                                            <select
                                                style={styles.select}
                                                value={environment[key]}
                                                onChange={e => setEnvironment(env => ({ ...env, [key]: e.target.value }))}
                                            >
                                                {opts.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>

                                <textarea
                                    style={{ ...styles.input, minHeight: '60px', resize: 'vertical' }}
                                    placeholder="Notes (optional)"
                                    value={environment.notes}
                                    onChange={e => setEnvironment(env => ({ ...env, notes: e.target.value }))}
                                />

                                <button style={styles.btnPrimary} onClick={handleStartSession}>
                                    <Play size={14} /> Start Session
                                </button>
                            </>
                        ) : (
                            <div>
                                <div style={styles.sessionActive}>
                                    ● Session Active: <strong>{activeSession?.session_id?.slice(0, 8)}</strong>
                                </div>
                                <button style={styles.btnDanger} onClick={handleEndSession}>
                                    <Square size={14} /> End Session
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Ground-truth record entry */}
                    {activeSession && (
                        <div style={styles.card}>
                            <div style={styles.cardTitle}>Log Inference Result</div>
                            <div style={styles.note}>
                                Enter ACTUAL inference results from the AI model.
                                Do not fabricate confidence or latency values.
                            </div>

                            <div style={styles.envGrid}>
                                <div style={styles.envField}>
                                    <label style={styles.envLabel}>Modality</label>
                                    <select style={styles.select} value={gtForm.modality}
                                        onChange={e => setGtForm(f => ({ ...f, modality: e.target.value }))}>
                                        {['vision', 'ocr', 'speech', 'gesture'].map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={styles.envField}>
                                    <label style={styles.envLabel}>Predicted Label *</label>
                                    <input style={styles.input} placeholder="e.g. person"
                                        value={gtForm.predictedLabel}
                                        onChange={e => setGtForm(f => ({ ...f, predictedLabel: e.target.value }))} />
                                </div>
                                <div style={styles.envField}>
                                    <label style={styles.envLabel}>Expected Label (GT)</label>
                                    <input style={styles.input} placeholder="Ground truth (optional)"
                                        value={gtForm.expectedLabel}
                                        onChange={e => setGtForm(f => ({ ...f, expectedLabel: e.target.value }))} />
                                </div>
                                <div style={styles.envField}>
                                    <label style={styles.envLabel}>Confidence (0–1)</label>
                                    <input style={styles.input} type="number" min="0" max="1" step="0.01"
                                        placeholder="e.g. 0.91 (null if unavailable)"
                                        value={gtForm.confidence}
                                        onChange={e => setGtForm(f => ({ ...f, confidence: e.target.value }))} />
                                </div>
                                <div style={styles.envField}>
                                    <label style={styles.envLabel}>Latency (ms) *</label>
                                    <input style={styles.input} type="number" min="0"
                                        placeholder="Actual measured latency"
                                        value={gtForm.latencyMs}
                                        onChange={e => setGtForm(f => ({ ...f, latencyMs: e.target.value }))} />
                                </div>
                            </div>

                            <button style={styles.btnPrimary} onClick={handleLogRecord}>Log Record</button>

                            {/* Last logged result */}
                            {gtResult && (
                                <div style={{
                                    ...styles.resultCard,
                                    borderColor: gtResult.is_correct === true ? '#00D4AA'
                                               : gtResult.is_correct === false ? '#FF4B6E'
                                               : '#6C63FF',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {gtResult.is_correct === true && <CheckCircle size={16} color="#00D4AA" />}
                                        {gtResult.is_correct === false && <XCircle size={16} color="#FF4B6E" />}
                                        {gtResult.is_correct === null && <Clock size={16} color="#6C63FF" />}
                                        <strong>
                                            {gtResult.is_correct === true ? 'Correct' :
                                             gtResult.is_correct === false ? 'Incorrect' : 'No GT provided'}
                                        </strong>
                                    </div>
                                    <div style={styles.resultDetails}>
                                        <span>Predicted: <strong>{gtResult.predicted_label}</strong></span>
                                        {gtResult.expected_label && <span>Expected: <strong>{gtResult.expected_label}</strong></span>}
                                        <span>Confidence: <strong>{gtResult.confidence !== null ? `${(gtResult.confidence * 100).toFixed(1)}%` : 'N/A'}</strong></span>
                                        <span>Latency: <strong>{gtResult.latency_ms}ms</strong></span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Sessions Tab ── */}
            {tab === 'sessions' && (
                <div>
                    <div style={styles.sectionHeader}>
                        <span>Experiment Sessions ({sessions.length})</span>
                        <button style={styles.btnSecondary} onClick={loadSessions}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                    </div>

                    {sessions.length === 0 && (
                        <div style={styles.emptyState}>No sessions yet. Run an experiment first.</div>
                    )}

                    {sessions.map(s => (
                        <div key={s.session_id} style={styles.sessionCard}>
                            <div style={styles.sessionCardHeader}>
                                <div>
                                    <div style={styles.sessionName}>{s.name}</div>
                                    <div style={styles.sessionMeta}>
                                        ID: {s.session_id?.slice(0, 8)} •
                                        {s.sample_count} samples •
                                        {s.ablation_label}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button style={styles.btnSmall}
                                        onClick={() => handleViewSession(s.session_id)}>
                                        Metrics
                                    </button>
                                    <button style={styles.btnSmall}
                                        onClick={() => downloadSessionJson(s.session_id)}>
                                        <FileJson size={12} /> JSON
                                    </button>
                                    <button style={styles.btnSmall}
                                        onClick={() => downloadSessionCsv(s.session_id)}>
                                        <FileText size={12} /> CSV
                                    </button>
                                </div>
                            </div>

                            {/* Expanded metrics */}
                            {selectedSession?.session_id === s.session_id && sessionMetrics && (
                                <div style={styles.metricsPanel}>
                                    <div style={styles.metricsPanelTitle}>Metrics (from {sessionMetrics.total_records} records)</div>
                                    {sessionMetrics.classification?.evaluated_samples > 0 ? (
                                        <div style={styles.metricsGrid}>
                                            <div>Accuracy: <strong>{(sessionMetrics.classification.accuracy * 100).toFixed(1)}%</strong></div>
                                            <div>Macro F1: <strong>{(sessionMetrics.classification.macro_f1 * 100).toFixed(1)}%</strong></div>
                                            <div>Precision: <strong>{(sessionMetrics.classification.macro_precision * 100).toFixed(1)}%</strong></div>
                                            <div>Recall: <strong>{(sessionMetrics.classification.macro_recall * 100).toFixed(1)}%</strong></div>
                                        </div>
                                    ) : (
                                        <div style={styles.note}>{sessionMetrics.classification?.note || 'No ground truth labels provided'}</div>
                                    )}
                                    {sessionMetrics.latency?.total_samples > 0 && (
                                        <div style={styles.metricsGrid}>
                                            <div>Avg Latency: <strong>{sessionMetrics.latency.avg_ms}ms</strong></div>
                                            <div>P95: <strong>{sessionMetrics.latency.p95_ms}ms</strong></div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Ablation Tab ── */}
            {tab === 'ablation' && (
                <div>
                    <div style={styles.card}>
                        <div style={styles.cardTitle}>⚙️ Ablation Study Configuration</div>
                        <div style={styles.note}>
                            Configure which modalities are active. Each combination creates
                            a different experimental condition for ablation analysis.
                        </div>

                        {/* Quick presets */}
                        <div style={styles.sectionLabel}>Quick Presets</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                            {Object.entries(ABLATION_CONFIGS).map(([key, { label, config }]) => (
                                <button key={key}
                                    style={styles.btnPreset}
                                    onClick={() => {
                                        setAblation(config);
                                        setAblationConfig(config);
                                        toast.success(`Preset: ${label}`);
                                    }}>
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Manual config */}
                        <div style={styles.sectionLabel}>Manual Configuration</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {Object.entries(ablation).map(([key, val]) => (
                                <label key={key} style={styles.toggleRow}>
                                    <span style={styles.toggleLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                                    <div
                                        style={{ ...styles.toggle, background: val ? '#6C63FF' : '#333' }}
                                        onClick={() => {
                                            const next = { ...ablation, [key]: !val };
                                            setAblation(next);
                                            setAblationConfig(next);
                                        }}
                                    >
                                        <div style={{ ...styles.toggleKnob, transform: val ? 'translateX(22px)' : 'translateX(2px)' }} />
                                    </div>
                                    <span style={{ color: val ? '#6C63FF' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                                        {val ? 'ACTIVE' : 'DISABLED'}
                                    </span>
                                </label>
                            ))}
                        </div>

                        <div style={{ ...styles.note, marginTop: '1rem' }}>
                            <strong>Current config label:</strong>{' '}
                            <code style={{ background: 'rgba(108,99,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>
                                {Object.entries(ablation).filter(([k, v]) => v && k !== 'fusion').map(([k]) => k).join('+') +
                                    (ablation.fusion ? '+fusion' : '-fusion')}
                            </code>
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
    header: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' },
    backBtn: { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' },
    title: { fontSize: '1.1rem', fontWeight: 800 },
    subtitle: { fontSize: '0.7rem', color: '#FF4B6E' },
    onlineBadge: { marginLeft: 'auto', padding: '4px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 },
    tabBar: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
    tab: { padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' },
    tabActive: { background: 'rgba(108,99,255,0.15)', color: '#6C63FF', borderColor: '#6C63FF' },
    card: { background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '1rem', marginBottom: '1rem' },
    cardTitle: { fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
    statsRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' },
    statCard: { flex: 1, minWidth: '100px', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', padding: '0.75rem', textAlign: 'center' },
    statValue: { fontSize: '1.3rem', fontWeight: 800, color: '#6C63FF' },
    statLabel: { fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' },
    th: { padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontWeight: 600 },
    tableRow: { borderBottom: '1px solid rgba(255,255,255,0.05)' },
    td: { padding: '6px 8px' },
    note: { fontSize: '0.72rem', color: 'var(--text-muted)', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', marginTop: '0.5rem' },
    input: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '0.5rem', boxSizing: 'border-box' },
    select: { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontSize: '0.85rem' },
    envGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' },
    envField: { display: 'flex', flexDirection: 'column', gap: '4px' },
    envLabel: { fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' },
    btnPrimary: { background: '#6C63FF', color: 'white', border: 'none', borderRadius: '8px', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' },
    btnSecondary: { background: 'rgba(108,99,255,0.1)', color: '#6C63FF', border: '1px solid #6C63FF', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
    btnDanger: { background: 'rgba(255,75,110,0.1)', color: '#FF4B6E', border: '1px solid #FF4B6E', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.75rem' },
    btnSmall: { background: 'rgba(108,99,255,0.1)', color: '#6C63FF', border: '1px solid rgba(108,99,255,0.3)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px' },
    btnPreset: { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-primary)' },
    loading: { textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' },
    emptyState: { textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: '12px' },
    sessionActive: { color: '#00D4AA', fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.85rem' },
    sessionCard: { background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', padding: '0.75rem', marginBottom: '0.75rem' },
    sessionCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' },
    sessionName: { fontWeight: 700, fontSize: '0.9rem' },
    sessionMeta: { fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' },
    metricsPanel: { borderTop: '1px solid var(--border-color)', marginTop: '0.75rem', paddingTop: '0.75rem' },
    metricsPanelTitle: { fontSize: '0.75rem', color: '#6C63FF', fontWeight: 700, marginBottom: '0.5rem' },
    metricsGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.75rem', marginBottom: '0.5rem' },
    resultCard: { border: '1px solid', borderRadius: '10px', padding: '0.75rem', marginTop: '0.75rem', background: 'rgba(255,255,255,0.03)' },
    resultDetails: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' },
    toggleRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' },
    toggleLabel: { flex: 1, fontSize: '0.85rem', textTransform: 'capitalize' },
    toggle: { width: '46px', height: '24px', borderRadius: '12px', position: 'relative', transition: 'background 0.2s', cursor: 'pointer' },
    toggleKnob: { position: 'absolute', top: '2px', width: '20px', height: '20px', background: 'white', borderRadius: '50%', transition: 'transform 0.2s' },
    sectionLabel: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' },
};

export default ResearchDashboard;
