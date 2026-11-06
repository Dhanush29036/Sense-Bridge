import { useState, useEffect } from 'react';
import {
    getBackendBaseURL,
    getAIBaseURL,
    setBackendBaseURL,
    setAIBaseURL,
    DEFAULT_HOST_IP
} from '../services/networkConfig';
import { Server, CheckCircle2, XCircle, RefreshCw, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

const ServerConfigModal = ({ isOpen, onClose }) => {
    const [hostIp, setHostIp] = useState('');
    const [testStatus, setTestStatus] = useState(null); // 'testing' | 'success' | 'failed'
    const [testMsg, setTestMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            const current = getBackendBaseURL();
            if (current) {
                try {
                    const u = new URL(current);
                    setHostIp(u.hostname);
                } catch {
                    setHostIp(current);
                }
            } else {
                setHostIp(DEFAULT_HOST_IP);
            }
            setTestStatus(null);
            setTestMsg('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleTest = async () => {
        const ip = hostIp.trim() || DEFAULT_HOST_IP;
        const testUrl = ip.startsWith('http') ? ip : `http://${ip}:5000`;
        setTestStatus('testing');
        setTestMsg('Pinging backend server...');
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 4000);
            const res = await fetch(`${testUrl}/api/auth/me`, {
                method: 'GET',
                signal: ctrl.signal,
            });
            clearTimeout(timer);
            // 401 means server is active and responding with auth check!
            if (res.status === 401 || res.status === 200) {
                setTestStatus('success');
                setTestMsg(`Connected to ${testUrl}!`);
            } else {
                setTestStatus('failed');
                setTestMsg(`Server returned status ${res.status}`);
            }
        } catch (err) {
            setTestStatus('failed');
            setTestMsg(`Could not connect to ${testUrl}. Check if your phone is on the same Wi-Fi.`);
        }
    };

    const handleSave = () => {
        const ip = hostIp.trim();
        if (!ip) {
            setBackendBaseURL('');
            setAIBaseURL('');
            toast.success('Reset to defaults');
        } else {
            const backend = ip.startsWith('http') ? ip : `http://${ip}:5000`;
            const ai = ip.startsWith('http') ? ip.replace(':5000', ':8000') : `http://${ip}:8000`;
            setBackendBaseURL(backend);
            setAIBaseURL(ai);
            toast.success(`Server updated: ${backend}`);
        }
        onClose();
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, zIndex: 10000,
        }}>
            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xl)',
                width: '100%', maxWidth: 380,
                padding: '20px 22px',
                boxShadow: 'var(--shadow-modal)',
                color: 'var(--text-primary)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Server size={18} color="var(--blue)" />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>Server Connection</span>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                    Enter your computer's Wi-Fi IP address so your mobile device can reach the SenseBridge backend and AI engine.
                </p>

                <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                        Server Host IP or Domain
                    </label>
                    <input
                        type="text"
                        value={hostIp}
                        onChange={(e) => setHostIp(e.target.value)}
                        placeholder={`e.g. ${DEFAULT_HOST_IP}`}
                        className="form-input"
                        style={{ width: '100%' }}
                    />
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 4 }}>
                        Backend will connect to <code>http://{hostIp || DEFAULT_HOST_IP}:5000</code>
                    </div>
                </div>

                {testStatus && (
                    <div style={{
                        padding: '8px 12px', borderRadius: 8,
                        fontSize: '0.78rem', marginBottom: 14,
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: testStatus === 'success' ? 'rgba(52,199,89,0.12)' : testStatus === 'failed' ? 'rgba(255,59,48,0.12)' : 'var(--bg-card-subtle)',
                        color: testStatus === 'success' ? 'var(--green)' : testStatus === 'failed' ? 'var(--red)' : 'var(--text-secondary)',
                    }}>
                        {testStatus === 'testing' && <RefreshCw size={14} className="spin" />}
                        {testStatus === 'success' && <CheckCircle2 size={14} />}
                        {testStatus === 'failed' && <XCircle size={14} />}
                        <span>{testMsg}</span>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button
                        type="button"
                        onClick={handleTest}
                        className="btn btn-secondary"
                        style={{ flex: 1, padding: '9px 12px', fontSize: '0.82rem' }}
                        disabled={testStatus === 'testing'}
                    >
                        Test Connection
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '9px 12px', fontSize: '0.82rem' }}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ServerConfigModal;
