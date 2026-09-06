'use client';

/* @Codex ADR 0123: one official UI, two navigation arrangements. The isolated
   comparison can still show Original without remounting clinical forms. */
import { createContext, useCallback, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';

export type TwinComposition = 'workbench' | 'stream';
const DesignContext = createContext({ enabled: false, proposal: false, setProposal: (_value: boolean) => {}, composition: 'stream' as TwinComposition, setComposition: (_value: TwinComposition) => {}, pendingForms: false, registerPending: (_id: string, _pending: boolean) => {} });
// @Codex: browser-local presentation preference only; no record identifiers.
const COMPOSITION_KEY = 'mediflow.runtime-twin.composition';
const COMPOSITION_EVENT = 'mediflow:twin-composition';
const defaultComposition = (): TwinComposition => 'stream';
let transientComposition: TwinComposition | null = null;
function readComposition(): TwinComposition {
    if (transientComposition) return transientComposition;
    try {
        return window.localStorage.getItem(COMPOSITION_KEY) === 'workbench' ? 'workbench' : 'stream';
    } catch { return defaultComposition(); }
}
function subscribeComposition(notify: () => void) {
    const onStorage = (event: StorageEvent) => {
        if (event.key === COMPOSITION_KEY || event.key === null) {
            transientComposition = null;
            notify();
        }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(COMPOSITION_EVENT, notify);
    return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(COMPOSITION_EVENT, notify);
    };
}
export const RuntimeTwinFolderContext = createContext<string | null>(null);
export const useRuntimeTwinDesign = () => useContext(DesignContext);
export const useRuntimeTwinFolder = () => useContext(RuntimeTwinFolderContext);

/* @Codex: form owners report only a pending bit, never clinical contents. */
export function useRuntimeTwinPendingForm(pending: boolean) {
    const { enabled, registerPending } = useRuntimeTwinDesign();
    const id = useId();
    useEffect(() => {
        if (!enabled) return;
        registerPending(id, pending);
        return () => registerPending(id, false);
    }, [enabled, id, pending, registerPending]);
}

export function RuntimeTwinDesignProvider({ comparisonEnabled = false, children }: { comparisonEnabled?: boolean; children: ReactNode }) {
    const [comparisonProposal, setComparisonProposal] = useState(true);
    // Original is a temporary comparison only; ordinary settings cannot select it.
    const proposal = !comparisonEnabled || comparisonProposal;
    const setProposal = useCallback((value: boolean) => {
        if (comparisonEnabled) setComparisonProposal(value);
    }, [comparisonEnabled]);
    const composition = useSyncExternalStore(subscribeComposition, readComposition, defaultComposition);
    const setComposition = useCallback((value: TwinComposition) => {
        try {
            window.localStorage.setItem(COMPOSITION_KEY, value);
            transientComposition = null;
        } catch { transientComposition = value; }
        window.dispatchEvent(new Event(COMPOSITION_EVENT));
    }, []);
    const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
    const registerPending = useCallback((id: string, pending: boolean) => {
        setPendingIds(current => {
            if (current.has(id) === pending) return current;
            const next = new Set(current); if (pending) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    useEffect(() => {
        document.documentElement.dataset.runtimeTwinDesign = proposal ? 'proposal' : 'original';
        document.documentElement.dataset.twinComposition = composition;
    }, [proposal, composition]);
    // enabled denotes the shared presentation/unsaved-form boundary, never a capability.
    return <DesignContext.Provider value={{ enabled: true, proposal, setProposal, composition, setComposition, pendingForms: pendingIds.size > 0, registerPending }}>{children}</DesignContext.Provider>;
}
