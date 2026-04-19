'use client';

import { useEffect, useRef } from 'react';

const DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart'] as const;

type UseInactivityLockOptions = {
    enabled: boolean;
    onTimeout: () => void;
    timeoutMs?: number;
};

/* @Codex */
export function useInactivityLock({
    enabled,
    onTimeout,
    timeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
}: UseInactivityLockOptions) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timeoutHandlerRef = useRef(onTimeout);

    useEffect(() => {
        timeoutHandlerRef.current = onTimeout;
    }, [onTimeout]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const clearTimer = () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };

        const resetTimer = () => {
            clearTimer();
            if (!enabled) return;
            timerRef.current = setTimeout(() => {
                timeoutHandlerRef.current();
            }, timeoutMs);
        };

        const handleActivity = () => {
            resetTimer();
        };

        for (const eventName of ACTIVITY_EVENTS) {
            window.addEventListener(eventName, handleActivity);
        }

        resetTimer();

        return () => {
            for (const eventName of ACTIVITY_EVENTS) {
                window.removeEventListener(eventName, handleActivity);
            }
            clearTimer();
        };
    }, [enabled, timeoutMs]);
}
