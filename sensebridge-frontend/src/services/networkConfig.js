/**
 * networkConfig.js — SenseBridge Network Configuration
 * ════════════════════════════════════════════════════
 * Automatically resolves backend (Node:5000) and AI engine (Flask:8000) URLs
 * based on whether the app runs in web browser or native Android APK.
 */

export const DEFAULT_HOST_IP = '192.168.0.108';

export const isNativePlatform = () => {
    if (typeof window === 'undefined') return false;
    const isCap = !!window.Capacitor?.isNativePlatform?.();
    const isCapScheme = window.location.protocol === 'capacitor:';
    const isLocalhostNoPort = window.location.hostname === 'localhost' && !window.location.port;
    const isAndroidHttps = window.location.protocol === 'https:' && window.location.hostname === 'localhost';
    return isCap || isCapScheme || isLocalhostNoPort || isAndroidHttps;
};

export const getBackendBaseURL = () => {
    const saved = localStorage.getItem('sb_backend_url');
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');

    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/+$/, '');

    if (isNativePlatform()) {
        return `http://${DEFAULT_HOST_IP}:5000`;
    }

    return '';
};

export const getAIBaseURL = () => {
    const saved = localStorage.getItem('sb_ai_url');
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');

    if (import.meta.env.VITE_AI_API_URL) return import.meta.env.VITE_AI_API_URL.replace(/\/+$/, '');

    if (isNativePlatform()) {
        return `http://${DEFAULT_HOST_IP}:8000`;
    }

    return '';
};

export const setBackendBaseURL = (url) => {
    if (!url || !url.trim()) {
        localStorage.removeItem('sb_backend_url');
    } else {
        localStorage.setItem('sb_backend_url', url.trim().replace(/\/+$/, ''));
    }
};

export const setAIBaseURL = (url) => {
    if (!url || !url.trim()) {
        localStorage.removeItem('sb_ai_url');
    } else {
        localStorage.setItem('sb_ai_url', url.trim().replace(/\/+$/, ''));
    }
};
