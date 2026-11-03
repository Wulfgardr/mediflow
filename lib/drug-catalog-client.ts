import { clientArchiveGeneration } from './security/client-auth-api';
import type { DrugCatalogMapping, DrugCatalogSourceInput } from './drug-catalog-import';
import type { DrugCatalogPreview } from './drug-catalog-server';

export type { DrugCatalogPreview };

export class DrugCatalogClientError extends Error {
    constructor(message: string, readonly code: string | null, readonly confirmation: string | null) { super(message); }
}

async function send<T>(form: FormData, signal: AbortSignal): Promise<T> {
    const response = await fetch('/api/drugs/catalog-import', { method: 'POST', body: form, signal, cache: 'no-store',
        credentials: 'same-origin', headers: { 'x-mediflow-archive-generation': clientArchiveGeneration() } });
    const payload = await response.json().catch(() => null) as (T & { error?: string; code?: string; confirmation?: string }) | null;
    if (!response.ok || !payload) {
        throw new DrugCatalogClientError(payload?.error ?? 'Richiesta non riuscita. Rileggi lo stato e riprova.',
            payload?.code ?? null, typeof payload?.confirmation === 'string' ? payload.confirmation : null);
    }
    return payload;
}

export function previewDrugCatalog(file: File, mapping: DrugCatalogMapping | undefined, signal: AbortSignal) {
    const form = new FormData();
    form.set('mode', 'preview');
    form.set('file', file);
    if (mapping) form.set('mapping', JSON.stringify(mapping));
    return send<DrugCatalogPreview>(form, signal);
}

export function commitDrugCatalog(input: { file: File; mapping: DrugCatalogMapping; source: DrugCatalogSourceInput;
    previewSha256: string; expectedSnapshot: string; reductionConfirmation?: string }, signal: AbortSignal) {
    const form = new FormData();
    form.set('mode', 'commit');
    form.set('file', input.file);
    form.set('mapping', JSON.stringify(input.mapping));
    form.set('source', JSON.stringify(input.source));
    form.set('previewSha256', input.previewSha256);
    form.set('expectedSnapshot', input.expectedSnapshot);
    form.set('confirmed', 'true');
    if (input.reductionConfirmation) form.set('reductionConfirmation', input.reductionConfirmation);
    return send<{ count: number; imported: { agency: string; codeSystem: string; version: string; rowCount: number } }>(form, signal);
}
