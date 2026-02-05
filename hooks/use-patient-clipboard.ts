import { useState, useCallback, useEffect } from 'react';
// import { toast } from '@/components/ui/use-toast'; // Assuming toast exists, or use console for now

export type ClipboardOperation = 'copy' | 'cut';

export interface ClipboardState {
    patientIds: string[];
    operation: ClipboardOperation | null;
    sourceAmbulatoryId: string | null;
}

export function usePatientClipboard() {
    const [clipboard, setClipboard] = useState<ClipboardState>({
        patientIds: [],
        operation: null,
        sourceAmbulatoryId: null
    });

    const copy = useCallback((patientIds: string[], sourceAmbulatoryId: string) => {
        setClipboard({ patientIds, operation: 'copy', sourceAmbulatoryId });
        console.log(`Copied ${patientIds.length} patients`);
    }, []);

    const cut = useCallback((patientIds: string[], sourceAmbulatoryId: string) => {
        setClipboard({ patientIds, operation: 'cut', sourceAmbulatoryId });
        console.log(`Cut ${patientIds.length} patients`);
    }, []);

    const clear = useCallback(() => {
        setClipboard({ patientIds: [], operation: null, sourceAmbulatoryId: null });
    }, []);

    const paste = useCallback(async (targetAmbulatoryId: string, isTestEnvironment: boolean) => {
        if (!clipboard.patientIds.length || !clipboard.operation) return;

        try {
            // Logic:
            // 1. If Target is Test -> ALWAYS CLONE (Duplicate API)
            // 2. If Target is Live:
            //    a. If Operation is COPY -> LINK (Assign API)
            //    b. If Operation is CUT -> LINK (Assign API) + UNLINK OLD (Unassign API)

            let endpoint = '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let body: any = { patientIds: clipboard.patientIds, targetAmbulatoryId };

            if (isTestEnvironment) {
                // CLONE
                endpoint = '/api/patients/duplicate';
            } else {
                // LINK
                endpoint = '/api/patients/assign';
            }

            // Execute Primary Action
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error("Paste action failed");

            // Execute Secondary Action (for CUT in Live environment)
            if (!isTestEnvironment && clipboard.operation === 'cut' && clipboard.sourceAmbulatoryId) {
                await fetch('/api/patients/unassign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        patientIds: clipboard.patientIds,
                        ambulatoryId: clipboard.sourceAmbulatoryId
                    })
                });
            }

            // Success
            // toast({ title: "Incollato con successo", description: `${clipboard.patientIds.length} pazienti processati.` });
            clear();
            return true;
        } catch (error) {
            console.error("Paste error", error);
            // toast({ title: "Errore", description: "Impossibile incollare i pazienti.", variant: "destructive" });
            return false;
        }
    }, [clipboard, clear]);

    return {
        clipboard,
        copy,
        cut,
        paste,
        clear,
        hasContent: clipboard.patientIds.length > 0
    };
}
