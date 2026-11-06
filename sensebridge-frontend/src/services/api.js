import axios from 'axios';
import { getBackendBaseURL } from './networkConfig';

/**
 * Axios instance pointed at the backend API.
 * Automatically resolves to local proxy in web dev, or host IP on mobile native APK.
 */
const rawApiBaseUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_BASE_URL = rawApiBaseUrl;
export const apiUrl = (path = '') => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${normalizedPath}`;
};

const api = axios.create({
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor: attach dynamic baseURL & JWT token ───────────────
api.interceptors.request.use(
    (config) => {
        const base = getBackendBaseURL();
        config.baseURL = base ? `${base}/api` : '/api';
        const token = localStorage.getItem('sb_token');
        // Only attach Bearer header if it's a real server JWT token (not a local/guest offline session)
        if (token && !token.startsWith('guest_') && !token.startsWith('local_')) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// ─── Response interceptor: handle 401 (token expired on protected routes) ──
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const url = error.config?.url || '';
        const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
        const token = localStorage.getItem('sb_token');
        const isOfflineSession = token && (token.startsWith('guest_') || token.startsWith('local_'));

        // Never kick the user out if they are using an offline/guest profile
        if (error.response?.status === 401 && !isAuthEndpoint && !isOfflineSession) {
            localStorage.removeItem('sb_token');
            localStorage.removeItem('sb_user');
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

// ─── Typed service helpers ─────────────────────────────────────────────────

export const authService = {
    register: (payload) => api.post('/auth/register', payload),
    login: (email, password) => api.post('/auth/login', { email, password }),
    getMe: () => api.get('/auth/me'),
};

export const preferenceService = {
    get: () => api.get('/preferences'),
    update: (payload) => api.put('/preferences', payload),
};

const LOCAL_CONTACTS_KEY = 'sb_emergency_contacts';

const getLocalContacts = () => {
    try {
        const raw = localStorage.getItem(LOCAL_CONTACTS_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
};

const saveLocalContacts = (list) => {
    try { localStorage.setItem(LOCAL_CONTACTS_KEY, JSON.stringify(list)); } catch {}
};

export const contactService = {
    getAll: async () => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await api.get('/emergency-contacts', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.data?.data) {
                saveLocalContacts(res.data.data);
            }
            return res;
        } catch {
            return { data: { data: getLocalContacts(), offline: true } };
        }
    },
    add: async (payload) => {
        const local = getLocalContacts();
        const entry = { _id: `c_${Date.now()}`, ...payload };
        saveLocalContacts([...local, entry]);
        try {
            return await api.post('/emergency-contacts', payload);
        } catch {
            return { data: { data: entry, offline: true } };
        }
    },
    update: async (id, payload) => {
        const local = getLocalContacts().map(c => c._id === id ? { ...c, ...payload } : c);
        saveLocalContacts(local);
        try {
            return await api.put(`/emergency-contacts/${id}`, payload);
        } catch {
            return { data: { success: true } };
        }
    },
    remove: async (id) => {
        const local = getLocalContacts().filter(c => c._id !== id);
        saveLocalContacts(local);
        try {
            return await api.delete(`/emergency-contacts/${id}`);
        } catch {
            return { data: { success: true } };
        }
    },
};

// ─── Offline-first log storage helpers ──────────────────────────────────────
const LOCAL_LOGS_KEY = 'sb_offline_logs';

const getStoredLocalLogs = () => {
    try {
        const raw = localStorage.getItem(LOCAL_LOGS_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* parse error */ }
    // Default initial logs so the history page is never blank
    const defaults = [
        {
            _id: 'init_1',
            eventType: 'system',
            severity: 'info',
            message: 'SenseBridge Multimodal Engine initialized',
            confidence: 1.0,
            createdAt: new Date().toISOString(),
        },
        {
            _id: 'init_2',
            eventType: 'gesture',
            severity: 'info',
            message: 'MediaPipe Gesture model loaded on device',
            confidence: 0.95,
            createdAt: new Date(Date.now() - 60000).toISOString(),
        }
    ];
    try { localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(defaults)); } catch {}
    return defaults;
};

const saveLocalLog = (payload) => {
    try {
        const logs = getStoredLocalLogs();
        const entry = {
            _id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            createdAt: new Date().toISOString(),
            severity: payload.severity || 'info',
            confidence: payload.confidence ?? 0.9,
            ...payload,
        };
        const updated = [entry, ...logs].slice(0, 100); // keep last 100
        localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(updated));
        return entry;
    } catch {
        return null;
    }
};

export const logService = {
    getAll: async (params = {}) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await api.get('/logs', { params, signal: controller.signal });
            clearTimeout(timeoutId);
            return res;
        } catch {
            // Offline fallback: serve and filter from localStorage
            let list = getStoredLocalLogs();
            if (params.eventType) {
                list = list.filter(l => l.eventType === params.eventType);
            }
            if (params.severity) {
                list = list.filter(l => l.severity === params.severity);
            }
            const page = parseInt(params.page, 10) || 1;
            const limit = parseInt(params.limit, 10) || 20;
            const start = (page - 1) * limit;
            const paged = list.slice(start, start + limit);
            return {
                data: {
                    data: paged,
                    total: list.length,
                    pages: Math.max(1, Math.ceil(list.length / limit)),
                    page,
                    offline: true,
                }
            };
        }
    },
    create: async (payload) => {
        saveLocalLog(payload);
        try {
            return await api.post('/logs', payload);
        } catch {
            // Silently succeeded locally
            return { data: { success: true, offline: true } };
        }
    },
    clear: async () => {
        try { localStorage.removeItem(LOCAL_LOGS_KEY); } catch {}
        try { return await api.delete('/logs'); } catch {
            return { data: { success: true } };
        }
    },
};

export const emergencyService = {
    /** Fire the SOS — sends SMS to saved contacts via backend */
    sos: (payload) => api.post('/emergency/sos', payload),
    /** Fetch this user's emergency event history */
    history: (userId) => api.get(`/emergency/history/${userId}`),
    /** Cancel a pending alert by event ID */
    cancel: (eventId) => api.put(`/emergency/cancel/${eventId}`),
};

export const adminService = {
    stats:        ()     => api.get('/admin/stats'),
    users:        ()     => api.get('/admin/users'),
    sosEvents:    ()     => api.get('/admin/sos-events'),
    toggleActive: (id)   => api.patch(`/admin/users/${id}/toggle-active`),
    toggleAdmin:  (id)   => api.patch(`/admin/users/${id}/toggle-admin`),
};

export const fusionService = {
    /** Run the multimodal fusion engine decision on all current signals */
    fuse: (payload) => api.post('/fuse', payload),
    /** Suppress a label for N seconds */
    dismiss: (label, duration_s = 30) => api.post('/fuse/dismiss', { label, duration_s }),
    /** Get last 5 fusion alerts */
    history: () => api.get('/fuse/history'),
    /** Reset fusion engine state (e.g. on mode change) */
    reset: () => api.post('/fuse/reset'),
};

export default api;
