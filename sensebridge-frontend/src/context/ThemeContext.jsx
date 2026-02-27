import { createContext, useContext, useState, useEffect } from 'react';

/**
 * Supported themes: 'light' | 'dark' | 'high-contrast'
 * fontScale: 1 | 1.2 | 1.4
 */
const ThemeContext = createContext(null);

const PREF_KEY = 'sb_theme_prefs';

const defaults = { theme: 'dark', fontScale: 1 };

export const ThemeProvider = ({ children }) => {
    const [prefs, setPrefs] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(PREF_KEY)) || defaults;
        } catch {
            return defaults;
        }
    });

    // Apply theme to document root
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', prefs.theme);
        document.documentElement.style.setProperty('--font-scale', prefs.fontScale);
        localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    }, [prefs]);

    const setTheme = (theme) => setPrefs((p) => ({ ...p, theme }));
    const setFontScale = (scale) => setPrefs((p) => ({ ...p, fontScale: scale }));
    const toggleDark = () =>
        setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }));

    return (
        <ThemeContext.Provider value={{ ...prefs, setTheme, setFontScale, toggleDark }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
    return ctx;
};
