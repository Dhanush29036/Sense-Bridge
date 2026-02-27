import axios from 'axios';

/**
 * Axios instance pointed at the backend API.
 * Base URL uses Vite proxy in dev (/api → http://localhost:5000/api)
 * In production set VITE_API_URL in .env
 */
const api = axios.create({
    baseURL: `${import.meta.env.VITE_API_URL || ''}/api`,
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
});

// ─── Request interceptor: attach JWT token ─────────────────────────────────
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('sb_token');
        if (token) config.headers.Authorization = `Bearer ${token}`;
        return config;
    },
    (error) => Promise.reject(error)
);

// ─── Response interceptor: handle 401 (token expired) ─────────────────────
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Clear stale token and redirect to login
            localStorage.removeItem('sb_token');
            // Avoid circular import — use window location
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

export const contactService = {
    getAll: () => api.get('/emergency-contacts'),
    add: (payload) => api.post('/emergency-contacts', payload),
    update: (id, payload) => api.put(`/emergency-contacts/${id}`, payload),
    remove: (id) => api.delete(`/emergency-contacts/${id}`),
};

export const logService = {
    getAll: (params) => api.get('/logs', { params }),
    create: (payload) => api.post('/logs', payload),
    clear: () => api.delete('/logs'),
};

export default api;
