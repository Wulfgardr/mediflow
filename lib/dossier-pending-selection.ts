import type { DossierInputFile } from './document-dossier-session';

/**
 * Selezione scelta in un'altra pagina e letta dall'import Dossier della stessa scheda.
 * Vive solo in memoria, contiene riferimenti ai file e non i loro byte, e cade al blocco della sessione.
 */
export interface DossierPendingSelection {
    patientId: string;
    files: readonly DossierInputFile[];
    declaredTaxCode: string;
    unread: number;
}

let pending: DossierPendingSelection | null = null;

export function stageDossierSelection(selection: DossierPendingSelection, sessionSignal: AbortSignal): void {
    pending = selection;
    sessionSignal.addEventListener('abort', () => settleDossierSelection(selection), { once: true });
}

export function stagedDossierSelection(patientId: string): DossierPendingSelection | null {
    return pending?.patientId === patientId ? pending : null;
}

export function settleDossierSelection(selection: DossierPendingSelection): void {
    if (pending === selection) pending = null;
}
