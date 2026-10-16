/* @Codex */
import 'server-only';
import { PROSTHETICS_MAX_BYTES } from './prosthetics-catalog-contract';
import { z } from 'zod';
import { ProstheticsCatalogError } from './prosthetics-catalog-service';
import { readBoundedJsonBody } from '../bounded-request-body';

import { normalizeProstheticsImportOptions } from './prosthetics-import-options';
const documentSchema = z.object({ sourceId: z.string().max(1024), revision: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1).max(200), base64: z.string(), page: z.string().max(100).nullable() }).strict();
export async function readProstheticsRequest(request: Request, action: 'preview' | 'commit' | 'documents', authoritySignal?: AbortSignal, timeoutMs = 30_000) {
    const commit = action === 'commit';
    const maxBytes = action === 'documents' ? 25 * 1024 * 1024 : PROSTHETICS_MAX_BYTES;
    const MAX_REQUEST_BYTES = Math.ceil(maxBytes / 3) * 4 + 16384;
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new ProstheticsCatalogError('INVALID_CONTENT_TYPE', 'È richiesto application/json.', 415);
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
            throw new ProstheticsCatalogError(cancelled ? 'IMPORT_BODY_ABORTED' : 'IMPORT_BODY_TIMEOUT',
                cancelled ? 'Lettura interrotta.' : 'Tempo di lettura scaduto.', cancelled ? 400 : 408);
        }
        if (!result.ok) throw new ProstheticsCatalogError(result.status === 413 ? 'FILE_TOO_LARGE' : 'INVALID_REQUEST',
            result.status === 413 ? 'File superiore al limite consentito.' : 'Richiesta JSON non valida.', result.status);
        value = result.value;
    } finally {
        clearTimeout(timer);
        for (const signal of signals) signal.removeEventListener('abort', abort);
    }
    const body = value as Record<string, unknown>;
    if (action === 'documents') {
        const doc = documentSchema.safeParse(body);
        if (!doc.success) throw new ProstheticsCatalogError('INVALID_REQUEST', 'Campi documento non validi.');
        return { ...doc.data, bytes: Buffer.alloc(0), sourceName: '', proof: '', acceptSubset: false, options: undefined };
    }
    const keys = commit ? ['sourceName', 'base64', 'proof', 'acceptSubset'] : ['sourceName', 'base64'];
    const extra = body && Object.hasOwn(body, 'options') ? ['options'] : [];
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== keys.length + extra.length
        || keys.some((key) => !Object.hasOwn(body, key)) || typeof body.sourceName !== 'string'
        || typeof body.base64 !== 'string' || /[^A-Za-z0-9+/=]/u.test(body.base64)
        || (commit && (typeof body.proof !== 'string' || body.acceptSubset !== true))) {
        throw new ProstheticsCatalogError('INVALID_REQUEST', 'Campi richiesta non validi.');
    }
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.byteLength > PROSTHETICS_MAX_BYTES) throw new ProstheticsCatalogError('FILE_TOO_LARGE', 'File superiore a 2 MiB.', 413);
    if (bytes.toString('base64') !== body.base64) throw new ProstheticsCatalogError('INVALID_REQUEST', 'Base64 non canonico.');
    const parsedOptions = body.options === undefined ? undefined : normalizeProstheticsImportOptions(body.options);
    if (body.options !== undefined && !parsedOptions) throw new ProstheticsCatalogError('INVALID_REQUEST', 'Mappatura o metadati non validi.');
    return { sourceId: '', revision: '', name: '', base64: '', page: null as string | null, options: parsedOptions ?? undefined, bytes, sourceName: body.sourceName, proof: body.proof as string, acceptSubset: body.acceptSubset === true };
}
