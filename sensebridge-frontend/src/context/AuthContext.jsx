import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

const getLocalUsers = () => {
    try {
        return JSON.parse(localStorage.getItem('sb_offline_users') || '[]');
    } catch {
        return [];
    }
};

const saveLocalUser = (userRecord) => {
    try {
        const users = getLocalUsers();
        const existingIdx = users.findIndex(u => u.email.toLowerCase() === userRecord.email.toLowerCase());
        if (existingIdx >= 0) {
            users[existingIdx] = userRecord;
        } else {
            users.push(userRecord);
        }
        localStorage.setItem('sb_offline_users', JSON.stringify(users));
    } catch {}
};

export const AuthProvider = ({ children }) => {
    const [token, setToken] = useState(() => localStorage.getItem('sb_token') || null);
    const [user, setUser] = useState(() => {
        try {
            const cached = localStorage.getItem('sb_user');
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    });
    const [loading, setLoading] = useState(true);

    // Bootstrap: verify token if online, or retain cached session if offline
    useEffect(() => {
        const bootstrap = async () => {
            if (!token) { setLoading(false); return; }

            // If local or guest offline session, keep user authenticated — never ping /auth/me
            if (token.startsWith('guest_') || token.startsWith('local_')) {
                setLoading(false);
                return;
            }

            try {
                const { data } = await api.get('/auth/me');
                if (data?.data) {
                    setUser(data.data);
                    localStorage.setItem('sb_user', JSON.stringify(data.data));
                }
            } catch (err) {
                // Only clear credentials if the server explicitly rejected the token
                if (err.response?.status === 401) {
                    localStorage.removeItem('sb_token');
                    localStorage.removeItem('sb_user');
                    setToken(null);
                    setUser(null);
                } else {
                    // Network unreachable / different Wi-Fi / mobile data:
                    // Retain the cached user session so the user is NEVER locked out!
                    console.log('[Auth] Server offline, retaining local session.');
                }
            } finally {
                setLoading(false);
            }
        };
        bootstrap();
    }, [token]);

    const login = useCallback(async (email, password) => {
        const cleanEmail = (email || '').trim().toLowerCase();
        const cleanPwd   = password || '';

        // Check local on-device database first for this email
        const localUsers = getLocalUsers();
        const matched = localUsers.find(u => (u.email || '').trim().toLowerCase() === cleanEmail);

        try {
            // 1. Try remote server
            const { data } = await api.post('/auth/login', { email: cleanEmail, password: cleanPwd });
            const { token: newToken, user: loggedUser } = data;
            localStorage.setItem('sb_token', newToken);
            localStorage.setItem('sb_user', JSON.stringify(loggedUser));
            saveLocalUser({ ...loggedUser, password: cleanPwd });
            setToken(newToken);
            setUser(loggedUser);
            return loggedUser;
        } catch (err) {
            // 2. If remote server failed (network error, off Wi-Fi, OR 401 because user only registered offline):
            if (matched) {
                if (matched.password && matched.password !== cleanPwd) {
                    const e = new Error('Invalid credentials.');
                    e.response = { status: 401, data: { message: 'Invalid credentials. Check your password.' } };
                    throw e;
                }

                // Password matches local on-device user!
                const sessionToken = 'local_session_' + Date.now();
                localStorage.setItem('sb_token', sessionToken);
                localStorage.setItem('sb_user', JSON.stringify(matched));
                setToken(sessionToken);
                setUser(matched);

                // If remote server was reachable and returned 401, user was missing on MongoDB — sync them now!
                if (err.response?.status === 401 && matched.name) {
                    api.post('/auth/register', {
                        name: matched.name,
                        email: cleanEmail,
                        password: cleanPwd,
                        role: matched.role || 'mixed'
                    }).then(({ data }) => {
                        if (data?.token) {
                            localStorage.setItem('sb_token', data.token);
                            setToken(data.token);
                        }
                    }).catch(() => {});
                }

                return matched;
            }

            // 3. Fallback: If in-memory server was restarted and user is missing on remote DB, auto-register them
            if (err.response?.status === 401 && cleanPwd.length >= 6) {
                try {
                    const regRes = await api.post('/auth/register', {
                        name: cleanEmail.split('@')[0],
                        email: cleanEmail,
                        password: cleanPwd,
                        role: 'mixed'
                    });
                    const { token: regToken, user: regUser } = regRes.data;
                    localStorage.setItem('sb_token', regToken);
                    localStorage.setItem('sb_user', JSON.stringify(regUser));
                    saveLocalUser({ ...regUser, password: cleanPwd });
                    setToken(regToken);
                    setUser(regUser);
                    return regUser;
                } catch {}
            }

            // 4. Offline demo fallback
            if (!err.response || err.response.status >= 500) {
                const offUser = {
                    id: 'local_' + Date.now(),
                    _id: 'local_' + Date.now(),
                    name: cleanEmail.split('@')[0],
                    email: cleanEmail,
                    role: 'mixed',
                };
                const offToken = 'local_session_' + Date.now();
                localStorage.setItem('sb_token', offToken);
                localStorage.setItem('sb_user', JSON.stringify(offUser));
                saveLocalUser({ ...offUser, password: cleanPwd });
                setToken(offToken);
                setUser(offUser);
                return offUser;
            }

            // Neither remote nor local matched this email
            throw err;
        }
    }, []);

    const register = useCallback(async (payload) => {
        try {
            // 1. Try remote server
            const { data } = await api.post('/auth/register', payload);
            const { token: newToken, user: newUser } = data;
            localStorage.setItem('sb_token', newToken);
            localStorage.setItem('sb_user', JSON.stringify(newUser));
            saveLocalUser({ ...newUser, password: payload.password });
            setToken(newToken);
            setUser(newUser);
            return newUser;
        } catch (err) {
            // If server returned 409 duplicate email, throw it
            if (err.response && err.response.status === 409) {
                throw err;
            }

            // 2. If server is unreachable (no Wi-Fi connection to server):
            // Register locally on-device so user is never blocked!
            console.log('[Auth] Server unreachable, creating on-device user account.');
            const offlineUser = {
                id: 'local_' + Date.now(),
                _id: 'local_' + Date.now(),
                name: payload.name || 'User',
                email: payload.email,
                role: payload.role || 'mixed',
                isAdmin: true,
                isOffline: true,
            };
            const offlineToken = 'offline_token_' + Date.now();
            saveLocalUser({ ...offlineUser, password: payload.password });
            localStorage.setItem('sb_token', offlineToken);
            localStorage.setItem('sb_user', JSON.stringify(offlineUser));
            setToken(offlineToken);
            setUser(offlineUser);
            return offlineUser;
        }
    }, []);

    const loginAsGuest = useCallback((role = 'mixed') => {
        const guestUser = {
            id: 'guest_' + Date.now(),
            _id: 'guest_' + Date.now(),
            name: 'Guest User',
            email: 'guest@sensebridge.local',
            role: role,
            isAdmin: true,
            isGuest: true,
        };
        const guestToken = 'guest_token_' + Date.now();
        localStorage.setItem('sb_token', guestToken);
        localStorage.setItem('sb_user', JSON.stringify(guestUser));
        setToken(guestToken);
        setUser(guestUser);
        return guestUser;
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('sb_token');
        localStorage.removeItem('sb_user');
        setToken(null);
        setUser(null);
    }, []);

    const updateUser = useCallback((partial) => {
        setUser((prev) => {
            const next = { ...prev, ...partial };
            try { localStorage.setItem('sb_user', JSON.stringify(next)); } catch {}
            return next;
        });
    }, []);

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, loginAsGuest, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
};
