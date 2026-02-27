import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(() => localStorage.getItem('sb_token') || null);
    const [loading, setLoading] = useState(true);

    // Bootstrap: fetch current user on mount if token exists
    useEffect(() => {
        const bootstrap = async () => {
            if (!token) { setLoading(false); return; }
            try {
                const { data } = await api.get('/auth/me');
                setUser(data.data);
            } catch {
                // Token invalid/expired — clear storage
                localStorage.removeItem('sb_token');
                setToken(null);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };
        bootstrap();
    }, [token]);

    const login = useCallback(async (email, password) => {
        const { data } = await api.post('/auth/login', { email, password });
        const { token: newToken, user: loggedUser } = data;
        localStorage.setItem('sb_token', newToken);
        setToken(newToken);
        setUser(loggedUser);
        return loggedUser;
    }, []);

    const register = useCallback(async (payload) => {
        const { data } = await api.post('/auth/register', payload);
        const { token: newToken, user: newUser } = data;
        localStorage.setItem('sb_token', newToken);
        setToken(newToken);
        setUser(newUser);
        return newUser;
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('sb_token');
        setToken(null);
        setUser(null);
    }, []);

    const updateUser = useCallback((partial) => {
        setUser((prev) => ({ ...prev, ...partial }));
    }, []);

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
};
