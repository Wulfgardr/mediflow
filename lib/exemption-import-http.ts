/* @Codex */
import 'server-only';
import { EXEMPTION_MAX_BYTES } from './exemption-import-contract';
import { ExemptionImportError } from './exemption-catalog-import';
import { readBoundedJsonBody } from './bounded-request-body';

const MAX_REQUEST_BYTES = Math.ceil(EXEMPTION_MAX_BYTES / 3) * 4 + 8192;
export async function readExemptionImportRequest(request: Request, commit: boolean, authoritySignal?: AbortSignal, timeoutMs = 30_000) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new ExemptionImportError('INVALID_CONTENT_TYPE', 'È richiesto application/json.', 415);
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new RangeError('Invalid read deadline');
    const controller = new AbortController();
    const abort = () => controller.abort();
    const signals = [request.signal, ...(authoritySignal ? [authoritySignal] : [])];
    for (const signal of signals) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    const deadline = performance.now() + timeoutMs;
    const timer = setTimeout(abort, timeoutMs);
    let value: unknown;
    try {
        const result = await readBoundedJsonBody(request, MAX_REQUEST_BYTES, 'strict', { signal: controller.signal, deadline });
        if (controller.signal.aborted || performance.now() >= deadline) {
            const cancelled = signals.some((signal) => signal.aborted);
            throw new ExemptionImportError(cancelled ? 'IMPORT_BODY_ABORTED' : 'IMPORT_BODY_TIMEOUT',
                cancelled ? 'Lettura interrotta.' : 'Tempo di lettura scaduto.', cancelled ? 400 : 408);
        }
        if (!result.ok) throw new ExemptionImportError(result.status === 413 ? 'FILE_TOO_LARGE' : 'INVALID_REQUEST',
            result.status === 413 ? 'File superiore al limite consentito.' : 'Richiesta JSON non valida.', result.status);
        value = result.value;
    } finally {
        clearTimeout(timer);
        for (const signal of signals) signal.removeEventListener('abort', abort);
    }
    const body = value as Record<string, unknown>;
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
