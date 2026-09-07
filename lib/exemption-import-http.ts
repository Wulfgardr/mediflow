/* @Codex */
import 'server-only';
import { EXEMPTION_MAX_BYTES } from './exemption-import-contract';
import { ExemptionImportError } from './exemption-catalog-import';

const MAX_REQUEST_BYTES = Math.ceil(EXEMPTION_MAX_BYTES / 3) * 4 + 8192;
export async function readExemptionImportRequest(request: Request, commit: boolean) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new ExemptionImportError('INVALID_CONTENT_TYPE', 'È richiesto application/json.', 415);
    }
    const reader = request.body?.getReader();
    if (!reader) throw new ExemptionImportError('INVALID_REQUEST', 'Richiesta vuota.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_REQUEST_BYTES) {
                await reader.cancel();
                throw new ExemptionImportError('FILE_TOO_LARGE', 'File superiore a 2 MiB.', 413);
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new ExemptionImportError('INVALID_REQUEST', 'Richiesta JSON non valida.'); }
    const keys = commit ? ['sourceName', 'base64', 'proof', 'acceptSubset'] : ['sourceName', 'base64'];
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== keys.length
        || keys.some((key) => !Object.hasOwn(body, key)) || typeof body.sourceName !== 'string'
        || typeof body.base64 !== 'string' || /[^A-Za-z0-9+/=]/u.test(body.base64)
        || (commit && (typeof body.proof !== 'string' || body.acceptSubset !== true))) {
        throw new ExemptionImportError('INVALID_REQUEST', 'Campi richiesta non validi.');
    }
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.byteLength > EXEMPTION_MAX_BYTES) throw new ExemptionImportError('FILE_TOO_LARGE', 'File superiore a 2 MiB.', 413);
    if (bytes.toString('base64') !== body.base64) throw new ExemptionImportError('INVALID_REQUEST', 'Base64 non canonico.');
    return { bytes, sourceName: body.sourceName, proof: body.proof as string, acceptSubset: body.acceptSubset === true };
}

export function exemptionImportErrorResponse(error: unknown): Response {
    if (error instanceof ExemptionImportError) return Response.json({ error: error.code, message: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    // Never log source records, filenames or raw database errors.
    return Response.json({ error: 'EXEMPTION_IMPORT_FAILED', message: 'Operazione non riuscita. Rileggi lo stato del repertorio prima di riprovare.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}
