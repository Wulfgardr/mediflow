/* @Codex */
'use client';

import { parseDocumentSynthesisPreviewWire, type DocumentSynthesisPreviewWire } from './document-synthesis-preview-wire';

type Sources = Readonly<{
    fetch?: typeof fetch;
}>;

export type DocumentSynthesisBrowserOrchestratorErrorCode = 'input_invalid' | 'capture_unavailable'
    | 'capture_outcome_unknown' | 'unsupported_local_extraction' | 'ingest_unavailable'
    | 'ingest_outcome_unknown' | 'preview_unavailable' | 'preview_outcome_unknown'
    | 'response_invalid' | 'operation_superseded';

export class DocumentSynthesisBrowserOrchestratorError extends Error {
    constructor(readonly code: DocumentSynthesisBrowserOrchestratorErrorCode) {
        super('Document Synthesis preview non disponibile.');
        this.name = 'DocumentSynthesisBrowserOrchestratorError';
    }
}

const CAPTURE = /^dsc_[0-9a-f]{32}$/u;
const PREVIEW = /^dsp_[0-9a-f]{32}$/u;

function fail(code: DocumentSynthesisBrowserOrchestratorErrorCode): never {
    throw new DocumentSynthesisBrowserOrchestratorError(code);
}

function exact(value: unknown, key: string, pattern: RegExp): string | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
            || Reflect.ownKeys(value).length !== 1) return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
            && typeof descriptor.value === 'string' && pattern.test(descriptor.value) ? descriptor.value : null;
    } catch { return null; }
}

async function post(request: typeof fetch, url: string, body: unknown, unknownCode: DocumentSynthesisBrowserOrchestratorErrorCode, unavailableCode: DocumentSynthesisBrowserOrchestratorErrorCode): Promise<unknown> {
    let response: Response;
    try {
        response = await request(url, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch { return fail(unknownCode); }
    if (!response.ok) {
        let unsupported = false;
        try {
            const value = await response.json();
            if (typeof value === 'object' && value !== null && !Array.isArray(value)
                && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 2
                && Object.hasOwn(value, 'error') && Object.hasOwn(value, 'code')
                && (value as { code?: unknown }).code === 'unsupported_local_extraction') {
                unsupported = true;
            }
        } catch { /* stable unavailable code below */ }
        if (unsupported) return fail('unsupported_local_extraction');
        return fail(unavailableCode);
    }
    try { return await response.json(); } catch { return fail('response_invalid'); }
}

/** Browser adapter for the fixed capture -> AnyDoc -> ingest -> preview sequence. */
export function createDocumentSynthesisBrowserOrchestrator(sources: Sources = {}) {
    const request = sources.fetch ?? globalThis.fetch;
    let generation = 0;
    const reset = () => { generation += 1; };
    return Object.freeze({
        reset,
        async run(attachmentId: unknown): Promise<DocumentSynthesisPreviewWire> {
            if (typeof attachmentId !== 'string' || attachmentId.length < 1 || attachmentId.length > 200
                || /[\u0000-\u001f\u007f]/u.test(attachmentId)) return fail('input_invalid');
            const token = generation;
            const current = () => { if (token !== generation) return fail('operation_superseded'); };
            const captured = await post(request, '/api/ai/document-synthesis/capture', { attachmentId }, 'capture_outcome_unknown', 'capture_unavailable');
            current();
            const captureHandle = exact(captured, 'captureHandle', CAPTURE);
            if (!captureHandle) return fail('response_invalid');
            const ingested = await post(request, '/api/ai/document-synthesis/ingest', { captureHandle }, 'ingest_outcome_unknown', 'ingest_unavailable');
            current();
            const previewHandle = exact(ingested, 'previewHandle', PREVIEW);
            if (!previewHandle) return fail('response_invalid');
            const rawPreview = await post(request, '/api/ai/document-synthesis/preview', { previewHandle }, 'preview_outcome_unknown', 'preview_unavailable');
            current();
            const preview = parseDocumentSynthesisPreviewWire(rawPreview);
            if (!preview) return fail('response_invalid');
            current();
            return preview;
        },
    });
}
