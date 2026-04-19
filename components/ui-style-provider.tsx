'use client';

/* @Codex */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
/* @Codex */
import { db } from '@/lib/db';
/* @Codex */
import {
    normalizeUIStyleMode,
    type UIStyleMode,
    UI_STYLE_SETTING_KEY,
    UI_STYLE_STORAGE_KEY,
} from '@/lib/ui-style-mode';

/* @Codex */
interface UIStyleProviderProps {
    children: React.ReactNode;
    defaultStyle?: UIStyleMode;
}

/* @Codex */
interface UIStyleProviderState {
    uiStyleMode: UIStyleMode;
    setUIStyleMode: (mode: UIStyleMode) => void;
}

/* @Codex */
const UIStyleContext = createContext<UIStyleProviderState | undefined>(undefined);

/* @Codex */
function applyUIStyleModeToDocument(mode: UIStyleMode) {
    window.document.documentElement.dataset.uiStyle = mode;
}

/* @Codex */
function readStoredUIStyleMode(defaultStyle: UIStyleMode): UIStyleMode {
    if (typeof window === 'undefined') return defaultStyle;

    try {
        return normalizeUIStyleMode(localStorage.getItem(UI_STYLE_STORAGE_KEY), defaultStyle);
    } catch {
        return defaultStyle;
    }
}

/* @Codex */
export function UIStyleProvider({
    children,
    defaultStyle = 'clinical',
}: UIStyleProviderProps) {
    const [uiStyleMode, setUIStyleModeState] = useState<UIStyleMode>(() => readStoredUIStyleMode(defaultStyle));

    useEffect(() => {
        applyUIStyleModeToDocument(uiStyleMode);
        try {
            localStorage.setItem(UI_STYLE_STORAGE_KEY, uiStyleMode);
        } catch {
            // No-op: local bootstrap remains best-effort only.
        }
    }, [uiStyleMode]);

    useEffect(() => {
        let cancelled = false;

        const syncPersistedStyle = async () => {
            try {
                const stored = await db.settings.get(UI_STYLE_SETTING_KEY) as { value?: unknown } | undefined;
                const resolved = normalizeUIStyleMode(stored?.value, uiStyleMode);

                if (!cancelled && stored?.value && resolved !== uiStyleMode) {
                    setUIStyleModeState(resolved);
                    return;
                }

                if (!stored?.value) {
                    await db.settings.put({ key: UI_STYLE_SETTING_KEY, value: uiStyleMode }, { suppressNotify: true });
                }
            } catch {
                // No-op: unauthenticated or unavailable settings should not block rendering.
            }
        };

        void syncPersistedStyle();

        return () => {
            cancelled = true;
        };
    }, [uiStyleMode]);

    const value = useMemo<UIStyleProviderState>(() => ({
        uiStyleMode,
        setUIStyleMode: (mode: UIStyleMode) => {
            setUIStyleModeState(mode);
            void db.settings.put({ key: UI_STYLE_SETTING_KEY, value: mode }, { suppressNotify: true }).catch(() => {
                // No-op: localStorage keeps the style sticky even if settings sync fails.
            });
        },
    }), [uiStyleMode]);

    return (
        <UIStyleContext.Provider value={value}>
            {children}
        </UIStyleContext.Provider>
    );
}

/* @Codex */
export function useUIStyle(): UIStyleProviderState {
    const context = useContext(UIStyleContext);

    if (!context) {
        throw new Error('useUIStyle must be used within a UIStyleProvider');
    }

    return context;
}
