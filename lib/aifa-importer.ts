import type { AifaDownloadProgress } from './aifa-catalog-download';
import {
    type AifaCatalogManifest,
    type AifaCatalogManifestInput,
} from './aifa-catalog';

export type AifaCatalogClientStatus = {
    count: number;
    manifest: AifaCatalogManifest | null;
    state: 'ready' | 'unverified' | 'not-imported';
};

export type AifaImportClientResult = AifaCatalogClientStatus & {
    rejectedRecords: number;
    totalRecords: number;
    notModified?: boolean;
};

/* @Codex */
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

export async function clearDrugDatabase(): Promise<void> {
    const response = await fetch('/api/drugs', { method: 'DELETE' });
    if (!response.ok) throw new Error('Svuotamento catalogo AIFA non riuscito');
}

export async function getDrugCatalogStatus(): Promise<AifaCatalogClientStatus> {
    const response = await fetch('/api/drugs?count=1', { cache: 'no-store' });
    if (!response.ok) throw new Error('Lettura stato catalogo AIFA non riuscita');
    return response.json() as Promise<AifaCatalogClientStatus>;
}

export async function getDrugStats(): Promise<number> {
    return (await getDrugCatalogStatus()).count;
}

/* @Codex */
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
