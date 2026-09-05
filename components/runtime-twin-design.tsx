'use client';

/* @Codex WUL-676: presentation state only. The original clinical components
   stay mounted while the comparison changes their layout. */
import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';

export type TwinComposition = 'workbench' | 'stream';
const DesignContext = createContext({ enabled: false, proposal: false, setProposal: (_value: boolean) => {}, composition: 'workbench' as TwinComposition, setComposition: (_value: TwinComposition) => {}, pendingForms: false, registerPending: (_id: string, _pending: boolean) => {} });
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

export function RuntimeTwinDesignProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
    const [proposal, setProposal] = useState(enabled);
    const [composition, setComposition] = useState<TwinComposition>('workbench');
    const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
    const registerPending = useCallback((id: string, pending: boolean) => {
        setPendingIds(current => {
            if (current.has(id) === pending) return current;
            const next = new Set(current); if (pending) next.add(id); else next.delete(id);
            return next;
        });
    }, []);
    useEffect(() => {
        if (enabled) {
            document.documentElement.dataset.runtimeTwinDesign = proposal ? 'proposal' : 'original';
            document.documentElement.dataset.twinComposition = composition;
        }
    }, [enabled, proposal, composition]);
    return <DesignContext.Provider value={{ enabled, proposal: enabled && proposal, setProposal, composition, setComposition, pendingForms: pendingIds.size > 0, registerPending }}>{children}</DesignContext.Provider>;
}
