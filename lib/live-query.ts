'use client';

import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { createDbChangeBus } from './live-query-scope';
import type { DbChangeScope } from './live-query-scope';

/* @Codex */
const dbChangeBus = createDbChangeBus();

/* @Codex */
export const notifyDbChange = dbChangeBus.notify;

/* @Codex */
export function useLiveQuery<T, TDefault = undefined>(
    querier: () => Promise<T> | T,
    deps?: DependencyList,
    defaultResult?: TDefault,
    tables?: DbChangeScope,
): T | TDefault | undefined {
    const querierRef = useRef(querier);
    const [result, setResult] = useState<T | TDefault | undefined>(defaultResult);
    const [revision, setRevision] = useState(0);
    /* @Codex */
    const tablesRef = useRef(tables);

    useEffect(() => {
        querierRef.current = querier;
    }, [querier]);

    useEffect(() => {
        tablesRef.current = tables;
    }, [tables]);

    useEffect(() => dbChangeBus.subscribeWithScopeResolver(() => {
        setRevision((previous) => previous + 1);
    }, () => tablesRef.current), []);

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
    /* @Codex WUL-UIUX: riesegue la query adesso (es. azione «Riprova» su errore).
       Additivo: i chiamanti che non lo destrutturano non cambiano. */
    refresh: () => void;
};

export function useLiveQueryState<T, TDefault = undefined>(
    querier: () => Promise<T> | T,
    deps?: DependencyList,
    defaultResult?: TDefault,
    tables?: DbChangeScope,
): LiveQueryState<T, TDefault> {
    const querierRef = useRef(querier);
    const [data, setData] = useState<T | TDefault | undefined>(defaultResult);
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision((previous) => previous + 1), []);
    /* @Codex */
    const tablesRef = useRef(tables);

    useEffect(() => {
        querierRef.current = querier;
    }, [querier]);

    useEffect(() => {
        tablesRef.current = tables;
    }, [tables]);

    useEffect(() => dbChangeBus.subscribeWithScopeResolver(() => {
        setRevision((previous) => previous + 1);
    }, () => tablesRef.current), []);

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

    return { data, error, loading, refresh };
}
