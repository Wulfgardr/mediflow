'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '@/lib/db';
import {
    normalizeAccessibilityPreference,
    UI_REDUCE_MOTION_SETTING_KEY,
    UI_REDUCE_MOTION_STORAGE_KEY,
    UI_REDUCE_TRANSPARENCY_SETTING_KEY,
    UI_REDUCE_TRANSPARENCY_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

interface UIAccessibilityProviderProps {
    children: ReactNode;
}

interface UIAccessibilityState {
    reduceMotion: boolean;
    setReduceMotion: (enabled: boolean) => void;
}

const UIAccessibilityContext = createContext<UIAccessibilityState | undefined>(undefined);

function readStoredPreference(storageKey: string): boolean {
    if (typeof window === 'undefined') return false;

    try {
        return normalizeAccessibilityPreference(localStorage.getItem(storageKey), false);
    } catch {
        return false;
    }
}

function applyPreferenceToDocument(key: 'uiReduceMotion' | 'uiReduceTransparency', enabled: boolean) {
    window.document.documentElement.dataset[key] = enabled ? 'true' : 'false';
}

export function UIAccessibilityProvider({ children }: UIAccessibilityProviderProps) {
    const [reduceMotion, setReduceMotionState] = useState<boolean>(() => readStoredPreference(UI_REDUCE_MOTION_STORAGE_KEY));

    const explicitMotionChoice = useRef(false);

    useEffect(() => {
        applyPreferenceToDocument('uiReduceMotion', reduceMotion);
        try {
            const stored = localStorage.getItem(UI_REDUCE_MOTION_STORAGE_KEY);
            if (stored !== String(reduceMotion) && (stored !== null || reduceMotion)) {
                localStorage.setItem(UI_REDUCE_MOTION_STORAGE_KEY, String(reduceMotion));
            }
        } catch {}
    }, [reduceMotion]);

    useEffect(() => {
        applyPreferenceToDocument('uiReduceTransparency', false);
        try {
            if (localStorage.getItem(UI_REDUCE_TRANSPARENCY_STORAGE_KEY) !== null) {
                localStorage.removeItem(UI_REDUCE_TRANSPARENCY_STORAGE_KEY);
            }
        } catch {}

        let cancelled = false;
        const migrateTransparency = async () => {
            const stored = await db.settings.get(UI_REDUCE_TRANSPARENCY_SETTING_KEY);
            if (!cancelled && normalizeAccessibilityPreference(stored?.value)) {
                await db.settings.update(UI_REDUCE_TRANSPARENCY_SETTING_KEY,
                    { value: false, expectedValue: stored.value }, { suppressNotify: true });
            }
        };
        void migrateTransparency().catch(() => {});
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const syncReduceMotion = async () => {
            const stored = await db.settings.get(UI_REDUCE_MOTION_SETTING_KEY);
            if (cancelled || explicitMotionChoice.current || !stored) return;
            const cached = readStoredPreference(UI_REDUCE_MOTION_STORAGE_KEY);
            if (stored.value != null) {
                setReduceMotionState(normalizeAccessibilityPreference(stored.value, cached));
            } else if (cached) {
                await db.settings.update(UI_REDUCE_MOTION_SETTING_KEY,
                    { value: true, expectedValue: null }, { suppressNotify: true });
            }
        };
        void syncReduceMotion().catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const value = useMemo<UIAccessibilityState>(() => ({
        reduceMotion,
        setReduceMotion: (enabled: boolean) => {
            explicitMotionChoice.current = true;
            setReduceMotionState(enabled);
            void db.settings.put({ key: UI_REDUCE_MOTION_SETTING_KEY, value: enabled }, { suppressNotify: true }).catch(() => {
                // No-op.
            });
        },
    }), [reduceMotion]);

    return (
        <UIAccessibilityContext.Provider value={value}>
            {children}
        </UIAccessibilityContext.Provider>
    );
}

export function useUIAccessibility(): UIAccessibilityState {
    const context = useContext(UIAccessibilityContext);

    if (!context) {
        throw new Error('useUIAccessibility must be used within a UIAccessibilityProvider');
    }

    return context;
}
