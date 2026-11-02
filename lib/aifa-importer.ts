import type { AifaDownloadProgress } from './aifa-catalog-download';
import {
    AIFA_CLEAR_CONFIRMATION,
    type AifaCatalogManifest,
    type AifaCatalogManifestInput,
} from './aifa-catalog';

export type AifaCatalogClientStatus = {
    count: number;
    manifest: AifaCatalogManifest | null;
    state: 'ready' | 'unverified' | 'not-imported';
    /** Present on the versioned status read; required to clear. */
    snapshot?: string;
};

export type AifaImportClientResult = AifaCatalogClientStatus & {
    rejectedRecords: number;
    totalRecords: number;
    notModified?: boolean;
};

export async function importAifaCsv(
    file: File,
    manifest: AifaCatalogManifestInput,
    confirmation?: string,
): Promise<AifaImportClientResult> {
    const form = new FormData();
    form.set('file', file);
    form.set('sourceUrl', manifest.sourceUrl);
    form.set('downloadedAt', manifest.downloadedAt);
    form.set('version', manifest.version);
    if (confirmation) form.set('reductionConfirmation', confirmation);
    const response = await fetch('/api/drugs', { method: 'POST', body: form });
    const payload = await response.json().catch(() => null) as AifaImportClientResult | { error?: string } | null;
    if (!response.ok) {
        const reduction = payload as { code?: string; confirmation?: string; error?: string } | null;
        if (response.status === 409 && reduction?.code === 'AIFA_REDUCTION_CONFIRMATION_REQUIRED' && reduction.confirmation
            && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(reduction.confirmation)) {
            throw new AifaReductionConfirmationRequired(reduction.error ?? 'Riduzione del catalogo AIFA', reduction.confirmation);
        }
        throw new Error(payload && 'error' in payload && payload.error
            ? payload.error
            : 'Importazione AIFA non riuscita');
    }
    return payload as AifaImportClientResult;
}

export class AifaCatalogChangedBeforeClear extends Error {}

export type AifaClearClientResult = AifaCatalogClientStatus & {
    receipt: { operation: 'aifa-catalog-clear'; auditEventId: string; previousCount: number; clearedAt: string };
};

/** Sends one administrative clear bound to the snapshot the user saw; never retried. */
export async function clearDrugDatabase(expectedSnapshot: string): Promise<AifaClearClientResult> {
    const response = await fetch('/api/drugs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedSnapshot, confirmation: AIFA_CLEAR_CONFIRMATION }),
    });
    const payload = await response.json().catch(() => null) as (AifaClearClientResult & { code?: string; error?: string }) | null;
    if (response.status === 409 && payload?.code === 'AIFA_CATALOG_CHANGED') {
        throw new AifaCatalogChangedBeforeClear(payload.error ?? 'Catalogo AIFA modificato dopo l’ultima lettura; nessuna voce rimossa');
    }
    if (response.status === 403) throw new Error('Svuotamento catalogo AIFA non riuscito: è riservato all’amministratore. Nessuna voce rimossa.');
    if (!response.ok) throw new Error('Svuotamento catalogo AIFA non riuscito');
    if (!payload || payload.state !== 'not-imported' || payload.count !== 0 || payload.receipt?.operation !== 'aifa-catalog-clear'
        || typeof payload.receipt.auditEventId !== 'string') {
        throw new Error('Ricevuta dello svuotamento non leggibile. Rileggi stato.');
    }
    return payload;
}

export async function getDrugCatalogStatus(): Promise<AifaCatalogClientStatus> {
    const response = await fetch('/api/drugs?count=1', { cache: 'no-store' });
    if (!response.ok) throw new Error('Lettura stato catalogo AIFA non riuscita');
    return response.json() as Promise<AifaCatalogClientStatus>;
}

export async function getDrugStats(): Promise<number> {
    return (await getDrugCatalogStatus()).count;
}

export class AifaReductionConfirmationRequired extends Error {
    constructor(message: string, public confirmation: string) { super(message); }
}

export async function updateAifaCatalog(signal: AbortSignal, confirmation?: string, onProgress?: (progress: AifaDownloadProgress | null) => void): Promise<AifaImportClientResult> {
    let reading = false;
    let done = false;
    const poll = async () => {
        if (reading || done || signal.aborted) return;
        reading = true;
        try {
            const response = await fetch('/api/drugs/update', { signal, cache: 'no-store' });
            if (response.ok && !done) {
                const body = await response.json();
                if (!done) onProgress?.(body.progress);
            }
        } catch { /* Progress is observational; the POST result remains authoritative. */ }
        finally { reading = false; }
    };
    const timer = onProgress ? setInterval(() => { void poll(); }, 1_000) : undefined;
    try {
        const response = await fetch('/api/drugs/update', { method: 'POST', signal,
            ...(confirmation ? { headers: { 'x-mediflow-aifa-confirm-reduction': confirmation } } : {}) });
        const payload = await response.json();
        if (!response.ok) {
            if (response.status === 409 && payload?.code === 'AIFA_REDUCTION_CONFIRMATION_REQUIRED'
                && typeof payload.confirmation === 'string' && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(payload.confirmation)) {
                throw new AifaReductionConfirmationRequired(payload.error, payload.confirmation);
            }
            throw new Error(payload?.error || 'Aggiornamento AIFA non riuscito');
        }
        return payload as AifaImportClientResult;
    } finally { done = true; clearInterval(timer); onProgress?.(null); }
}
