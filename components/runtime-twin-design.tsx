'use client';

/* @Codex WUL-676: presentation state only. The original clinical components
   stay mounted while the comparison changes their layout. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const DesignContext = createContext({ proposal: false, setProposal: (_value: boolean) => {} });
export const RuntimeTwinFolderContext = createContext<string | null>(null);
export const useRuntimeTwinDesign = () => useContext(DesignContext);
export const useRuntimeTwinFolder = () => useContext(RuntimeTwinFolderContext);

export function RuntimeTwinDesignProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
    const [proposal, setProposal] = useState(enabled);
    useEffect(() => {
        if (enabled) document.documentElement.dataset.runtimeTwinDesign = proposal ? 'proposal' : 'original';
    }, [enabled, proposal]);
    return <DesignContext.Provider value={{ proposal: enabled && proposal, setProposal }}>{children}</DesignContext.Provider>;
}
