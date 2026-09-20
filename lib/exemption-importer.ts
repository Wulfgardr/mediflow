/* @Codex */
import { EXEMPTION_MAX_BYTES, type ExemptionCatalogStatus, type ExemptionImportPreview, type ExemptionImportReceipt } from './exemption-import-contract';

export type ExemptionImportSource = { sourceName: string; base64: string };
export class ExemptionImportClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
async function readResponse<T>(response: Response): Promise<T> {
    const body = await response.json();
    if (!response.ok) throw new ExemptionImportClientError(body.error ?? 'IMPORT_FAILED', body.message ?? 'Operazione non riuscita. Rileggi lo stato e riprova.');
    return body as T;
}
export async function readExemptionImportSource(file: File): Promise<ExemptionImportSource> {
    if (!file.size || file.size > EXEMPTION_MAX_BYTES) throw new Error('Seleziona un file non vuoto, massimo 2 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { sourceName: file.name, base64: btoa(binary) };
}
export async function previewExemptionFile(source: ExemptionImportSource): Promise<ExemptionImportPreview> {
    return readResponse(await fetch('/api/exemptions/import/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source),
    }));
}
export async function commitExemptionFile(source: ExemptionImportSource, proof: string): Promise<{ receipt: ExemptionImportReceipt; replayed: boolean }> {
    return readResponse(await fetch('/api/exemptions/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...source, proof, acceptSubset: true }),
    }));
}
export async function getExemptionImportStatus(): Promise<ExemptionCatalogStatus> {
    return readResponse(await fetch('/api/exemptions/import/status', { cache: 'no-store' }));
}
/** Retired batch entrypoint: retained as an explicit failure for old callers. */
export async function importExemptionFiles(_files: File[], _onProgress?: (processed: number, total: number) => void): Promise<never> {
    void _files; void _onProgress;
    throw new Error('EXEMPTION_IMPORT_PREVIEW_REQUIRED');
}
export async function clearExemptionDatabase() {
    return readResponse(await fetch('/api/exemptions', { method: 'DELETE' }));
}
export async function getExemptionStats(): Promise<number> {
    const payload = await readResponse<{ count: number }>(await fetch('/api/exemptions?count=1', { cache: 'no-store' }));
    return payload.count;
}
