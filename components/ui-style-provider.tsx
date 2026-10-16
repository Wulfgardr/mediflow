'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { UIStyleMode } from '@/lib/ui-style-mode';

interface UIStyleProviderProps {
    children: React.ReactNode;
}

interface UIStyleProviderState {
    uiStyleMode: UIStyleMode;
    setUIStyleMode: (mode: UIStyleMode) => void;
}

const UIStyleContext = createContext<UIStyleProviderState | undefined>(undefined);

/* redesign is the only official runtime */
const OFFICIAL_UI_STYLE_MODE: UIStyleMode = 'redesign';

export function UIStyleProvider({ children }: UIStyleProviderProps) {
    useEffect(() => {
        window.document.documentElement.dataset.uiStyle = OFFICIAL_UI_STYLE_MODE;
    }, []);

    const value = useMemo<UIStyleProviderState>(() => ({
        uiStyleMode: OFFICIAL_UI_STYLE_MODE,
        setUIStyleMode: () => {
            // No-op: the redesign shell is the only runtime.
        },
    }), []);

    return (
        <UIStyleContext.Provider value={value}>
            {children}
        </UIStyleContext.Provider>
    );
}

export function useUIStyle(): UIStyleProviderState {
    const context = useContext(UIStyleContext);

    if (!context) {
        throw new Error('useUIStyle must be used within a UIStyleProvider');
    }

    return context;
}
