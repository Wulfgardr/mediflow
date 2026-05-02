'use client';

/* @Codex */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
/* @Codex */
import { db } from '@/lib/db';
/* @Codex */
import {
    normalizeAccessibilityPreference,
    UI_REDUCE_MOTION_SETTING_KEY,
    UI_REDUCE_MOTION_STORAGE_KEY,
    UI_REDUCE_TRANSPARENCY_SETTING_KEY,
    UI_REDUCE_TRANSPARENCY_STORAGE_KEY,
} from '@/lib/ui-accessibility-preferences';

/* @Codex */
interface UIAccessibilityProviderProps {
    children: ReactNode;
}

/* @Codex */
interface UIAccessibilityState {
    reduceMotion: boolean;
    reduceTransparency: boolean;
    setReduceMotion: (enabled: boolean) => void;
    setReduceTransparency: (enabled: boolean) => void;
}

/* @Codex */
const UIAccessibilityContext = createContext<UIAccessibilityState | undefined>(undefined);

/* @Codex */
function readStoredPreference(storageKey: string): boolean {
    if (typeof window === 'undefined') return false;

    try {
        return normalizeAccessibilityPreference(localStorage.getItem(storageKey), false);
    } catch {
        return false;
    }
}

/* @Codex */
function applyPreferenceToDocument(key: 'uiReduceMotion' | 'uiReduceTransparency', enabled: boolean) {
    window.document.documentElement.dataset[key] = enabled ? 'true' : 'false';
}

/* @Codex */
export function UIAccessibilityProvider({ children }: UIAccessibilityProviderProps) {
    const [reduceMotion, setReduceMotionState] = useState<boolean>(() => readStoredPreference(UI_REDUCE_MOTION_STORAGE_KEY));
    const [reduceTransparency, setReduceTransparencyState] = useState<boolean>(() => readStoredPreference(UI_REDUCE_TRANSPARENCY_STORAGE_KEY));

    useEffect(() => {
        applyPreferenceToDocument('uiReduceMotion', reduceMotion);
        try {
            localStorage.setItem(UI_REDUCE_MOTION_STORAGE_KEY, String(reduceMotion));
        } catch {
            // No-op: best effort persistence.
        }
    }, [reduceMotion]);

    useEffect(() => {
        applyPreferenceToDocument('uiReduceTransparency', reduceTransparency);
        try {
            localStorage.setItem(UI_REDUCE_TRANSPARENCY_STORAGE_KEY, String(reduceTransparency));
        } catch {
            // No-op: best effort persistence.
        }
    }, [reduceTransparency]);

    useEffect(() => {
        let cancelled = false;

        const syncPersistedPreferences = async () => {
            try {
                const [storedReduceMotion, storedReduceTransparency] = await Promise.all([
                    db.settings.get(UI_REDUCE_MOTION_SETTING_KEY),
                    db.settings.get(UI_REDUCE_TRANSPARENCY_SETTING_KEY),
                ]);

                const nextReduceMotion = normalizeAccessibilityPreference(storedReduceMotion?.value, reduceMotion);
                const nextReduceTransparency = normalizeAccessibilityPreference(storedReduceTransparency?.value, reduceTransparency);

                if (!cancelled && storedReduceMotion?.value !== undefined && nextReduceMotion !== reduceMotion) {
                    setReduceMotionState(nextReduceMotion);
                }

                if (!cancelled && storedReduceTransparency?.value !== undefined && nextReduceTransparency !== reduceTransparency) {
                    setReduceTransparencyState(nextReduceTransparency);
                }

                await Promise.all([
                    storedReduceMotion?.value === undefined
                        ? db.settings.put({ key: UI_REDUCE_MOTION_SETTING_KEY, value: reduceMotion }, { suppressNotify: true })
                        : Promise.resolve(),
                    storedReduceTransparency?.value === undefined
                        ? db.settings.put({ key: UI_REDUCE_TRANSPARENCY_SETTING_KEY, value: reduceTransparency }, { suppressNotify: true })
                        : Promise.resolve(),
                ]);
            } catch {
                // No-op: rendering shouldn't block on settings availability.
            }
        };

        void syncPersistedPreferences();

        return () => {
            cancelled = true;
        };
    }, [reduceMotion, reduceTransparency]);

    const value = useMemo<UIAccessibilityState>(() => ({
        reduceMotion,
        reduceTransparency,
        setReduceMotion: (enabled: boolean) => {
            setReduceMotionState(enabled);
            void db.settings.put({ key: UI_REDUCE_MOTION_SETTING_KEY, value: enabled }, { suppressNotify: true }).catch(() => {
                // No-op.
            });
        },
        setReduceTransparency: (enabled: boolean) => {
            setReduceTransparencyState(enabled);
            void db.settings.put({ key: UI_REDUCE_TRANSPARENCY_SETTING_KEY, value: enabled }, { suppressNotify: true }).catch(() => {
                // No-op.
            });
        },
    }), [reduceMotion, reduceTransparency]);

    return (
        <UIAccessibilityContext.Provider value={value}>
            {children}
        </UIAccessibilityContext.Provider>
    );
}

/* @Codex */
export function useUIAccessibility(): UIAccessibilityState {
    const context = useContext(UIAccessibilityContext);

    if (!context) {
        throw new Error('useUIAccessibility must be used within a UIAccessibilityProvider');
    }

    return context;
}
