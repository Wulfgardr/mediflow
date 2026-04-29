'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeProviderProps {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
}

interface ThemeProviderState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const initialState: ThemeProviderState = {
    theme: 'system',
    setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function readStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
    if (typeof window === 'undefined') return defaultTheme;
    try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
            return stored;
        }
    } catch {
        // localStorage may be unavailable (private mode, SSR fallback) — fall through
    }
    return defaultTheme;
}

function applyThemeClass(theme: Theme) {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        root.classList.add(systemTheme);
        root.style.colorScheme = systemTheme;
        return;
    }
    root.classList.add(theme);
    root.style.colorScheme = theme;
}

export function ThemeProvider({
    children,
    defaultTheme = 'system',
    storageKey = 'mediflow-theme',
    ...props
}: ThemeProviderProps) {
    /* @Codex: lazy initializer keeps the React state aligned with the inline
       theme bootstrap script in app/layout.tsx so the first render matches
       the painted html.dark/.light class — no FOUC, no class flicker. */
    const [theme, setTheme] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));

    useEffect(() => {
        applyThemeClass(theme);
    }, [theme]);

    useEffect(() => {
        if (theme !== 'system') return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handle = () => applyThemeClass('system');
        media.addEventListener('change', handle);
        return () => media.removeEventListener('change', handle);
    }, [theme]);

    const value: ThemeProviderState = {
        theme,
        setTheme: (next) => {
            try {
                window.localStorage.setItem(storageKey, next);
            } catch {
                // ignore quota / privacy errors — theme still applies for the session
            }
            setTheme(next);
        },
    };

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    );
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext);

    if (context === undefined)
        throw new Error('useTheme must be used within a ThemeProvider');

    return context;
};
