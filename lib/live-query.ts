'use client';

import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { createDbChangeBus } from './live-query-scope';
import type { DbChangeScope } from './live-query-scope';

/* @Codex */
const dbChangeBus = createDbChangeBus();

/* @Codex */
export const notifyDbChange = dbChangeBus.notify;

/* @Codex: Full document navigation does not unmount React before pending
   fetches reject. Retire that document's reads at pagehide, including results,
   errors and loading updates. A bfcache restoration needs a new query; the
   previous generation must never become current again. beforeunload can be
   cancelled and visibilitychange also means switching tabs, so neither retires
   reads belonging to an otherwise active document. */
function useLiveQueryDocument() {
    const readDocument = useRef({ active: true, generation: 0 });
    const [documentRevision, setDocumentRevision] = useState(0);

    useEffect(() => {
        const lifecycle = readDocument.current;
        lifecycle.active = true;
        const retire = () => {
            lifecycle.active = false;
            lifecycle.generation += 1;
        };
        const restore = () => {
            if (lifecycle.active) return;
            lifecycle.active = true;
            setDocumentRevision(previous => previous + 1);
        };
        window.addEventListener('pagehide', retire);
        window.addEventListener('pageshow', restore);
        return () => {
            retire();
            window.removeEventListener('pagehide', retire);
            window.removeEventListener('pageshow', restore);
        };
    }, []);

    return { readDocument, documentRevision };
}

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
    const { readDocument, documentRevision } = useLiveQueryDocument();
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
        const lifecycle = readDocument.current;
        if (!lifecycle.active) return;
        const generation = lifecycle.generation;
        let cancelled = false;
        const isCurrent = () => !cancelled && lifecycle.active && lifecycle.generation === generation;

        const runQuery = async () => {
            try {
                const value = await querierRef.current();
                if (isCurrent()) setResult(value);
            } catch (error) {
                if (isCurrent()) console.error('useLiveQuery failed', error);
            }
        };

        void runQuery();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision, documentRevision, ...(deps ?? [])]);

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
    const { readDocument, documentRevision } = useLiveQueryDocument();
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
        const lifecycle = readDocument.current;
        if (!lifecycle.active) return;
        const generation = lifecycle.generation;
        let cancelled = false;
        const isCurrent = () => !cancelled && lifecycle.active && lifecycle.generation === generation;
        setLoading(true);

        const runQuery = async () => {
            try {
                const value = await querierRef.current();
                if (isCurrent()) {
                    setData(value);
                    setError(null);
                }
            } catch (err) {
                if (isCurrent()) {
                    setError(err);
                    console.error('useLiveQueryState failed', err);
                }
            } finally {
                if (isCurrent()) setLoading(false);
            }
        };

        void runQuery();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision, documentRevision, ...(deps ?? [])]);

    return { data, error, loading, refresh };
}
