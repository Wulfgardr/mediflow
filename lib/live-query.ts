'use client';

import { DependencyList, useEffect, useRef, useState } from 'react';

/* @Codex */
type DbChangeListener = () => void;

/* @Codex */
const dbChangeListeners = new Set<DbChangeListener>();

/* @Codex */
function subscribeDbChanges(listener: DbChangeListener) {
    dbChangeListeners.add(listener);
    return () => {
        dbChangeListeners.delete(listener);
    };
}

/* @Codex */
export function notifyDbChange() {
    dbChangeListeners.forEach((listener) => listener());
}

/* @Codex */
export function useLiveQuery<T, TDefault = undefined>(
    querier: () => Promise<T> | T,
    deps?: DependencyList,
    defaultResult?: TDefault
): T | TDefault | undefined {
    const querierRef = useRef(querier);
    const [result, setResult] = useState<T | TDefault | undefined>(defaultResult);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        querierRef.current = querier;
    }, [querier]);

    useEffect(() => subscribeDbChanges(() => {
        setRevision((previous) => previous + 1);
    }), []);

    useEffect(() => {
        let cancelled = false;

        const runQuery = async () => {
            try {
                const value = await querierRef.current();
                if (!cancelled) setResult(value);
            } catch (error) {
                console.error('useLiveQuery failed', error);
            }
        };

        void runQuery();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision, ...(deps ?? [])]);

    return result;
}

/* @Codex WUL-UIUX: variante che espone anche errore e stato di caricamento, cosi
   le superfici possono distinguere "in caricamento" da "errore" (useLiveQuery
   inghiotte gli errori e resta su undefined per sempre). Additiva: i chiamanti
   esistenti non cambiano. */
export type LiveQueryState<T, TDefault = undefined> = {
    data: T | TDefault | undefined;
    error: unknown;
    loading: boolean;
};

export function useLiveQueryState<T, TDefault = undefined>(
    querier: () => Promise<T> | T,
    deps?: DependencyList,
    defaultResult?: TDefault,
): LiveQueryState<T, TDefault> {
    const querierRef = useRef(querier);
    const [data, setData] = useState<T | TDefault | undefined>(defaultResult);
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        querierRef.current = querier;
    }, [querier]);

    useEffect(() => subscribeDbChanges(() => {
        setRevision((previous) => previous + 1);
    }), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const runQuery = async () => {
            try {
                const value = await querierRef.current();
                if (!cancelled) {
                    setData(value);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) setError(err);
                console.error('useLiveQueryState failed', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void runQuery();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision, ...(deps ?? [])]);

    return { data, error, loading };
}
