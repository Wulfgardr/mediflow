import { useState, useCallback } from 'react';
import { notifyDbChange } from '@/lib/live-query';
/* @Codex */
import {
    executePatientClipboardPaste,
    type ClipboardOperation,
    type PatientClipboardState,
} from '@/lib/patient-clipboard';
// import { toast } from '@/components/ui/use-toast'; // Assuming toast exists, or use console for now

export type { ClipboardOperation };
export type ClipboardState = PatientClipboardState;

export function usePatientClipboard() {
    const [clipboard, setClipboard] = useState<ClipboardState>({
        patientIds: [],
        patientVersions: {},
        operation: null,
        sourceAmbulatoryId: null
    });

    const copy = useCallback((patientIds: string[], sourceAmbulatoryId: string) => {
        setClipboard({ patientIds: [...patientIds], patientVersions: {}, operation: 'copy', sourceAmbulatoryId });
        console.log(`Copied ${patientIds.length} patients`);
    }, []);

    /* @Codex */
    const cut = useCallback((
        patientIds: string[],
        sourceAmbulatoryId: string,
        patientVersions: Record<string, number>,
    ) => {
        setClipboard({
            patientIds: [...patientIds],
            patientVersions: { ...patientVersions },
            operation: 'cut',
            sourceAmbulatoryId,
        });
        console.log(`Cut ${patientIds.length} patients`);
    }, []);

    const clear = useCallback(() => {
        setClipboard({ patientIds: [], patientVersions: {}, operation: null, sourceAmbulatoryId: null });
    }, []);

    const paste = useCallback(async (targetAmbulatoryId: string, isTestEnvironment: boolean) => {
        if (!clipboard.patientIds.length || !clipboard.operation) return false;

        try {
            return await executePatientClipboardPaste(
                clipboard,
                targetAmbulatoryId,
                isTestEnvironment,
                {
                    onSuccess: () => {
                        notifyDbChange();
                        clear();
                    },
                },
            );
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
