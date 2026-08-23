/* @Codex */
'use client';

import { parseSmartImportPreviewWireRoot, type SmartImportPreviewWireRoot } from '../smart-import-preview-wire';

type Sources = Readonly<{ fetch?: typeof fetch; requestId?: () => unknown; isCurrent: (snapshot: unknown) => boolean }>;
type Tuple = Readonly<{ sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string; leaseRef: string }>;
export type SmartImportBrowserOrchestratorErrorCode = 'input_invalid' | 'selection_invalid' | 'operation_superseded'
    | 'ingest_unavailable' | 'ingest_outcome_unknown' | 'preview_unavailable' | 'preview_outcome_unknown' | 'response_invalid';
export class SmartImportBrowserOrchestratorError extends Error {
    constructor(readonly code: SmartImportBrowserOrchestratorErrorCode) { super('Smart Import browser operation unavailable.'); this.name = 'SmartImportBrowserOrchestratorError'; }
}

const REF = Object.freeze({ sessionRef: /^ssr_[0-9a-f]{32}$/u, patientRef: /^ptr_[0-9a-f]{32}$/u, ambulatoryRef: /^abr_[0-9a-f]{32}$/u, leaseRef: /^lsr_[0-9a-f]{32}$/u });
const REQUEST_ID = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const RAW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function fail(code: SmartImportBrowserOrchestratorErrorCode): never { throw new SmartImportBrowserOrchestratorError(code); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {}; for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}
function context(value: unknown, keys: readonly string[]): Readonly<{ record: Record<string, unknown>; context: object }> | null {
    const record = exact(value, keys); let descriptor: PropertyDescriptor | undefined;
    try { descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'selectionContext') : undefined; } catch { return null; }
    return !record || !descriptor || descriptor.enumerable || !('value' in descriptor) || !descriptor.value || typeof descriptor.value !== 'object' || !Object.isFrozen(descriptor.value) ? null : Object.freeze({ record, context: descriptor.value });
}
function tuple(value: unknown): Readonly<{ tuple: Tuple; context: object }> | null {
    const selected = context(value, ['selectionEpoch', 'lease', 'selectionContext']); const lease = selected && exact(selected.record.lease, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef', 'expiresAt']);
    if (!selected || !lease || lease.selectionEpoch !== selected.record.selectionEpoch || !Number.isSafeInteger(lease.selectionEpoch) || (lease.selectionEpoch as number) < 1 || !Number.isSafeInteger(lease.expiresAt) || (lease.expiresAt as number) < 0 || !Object.entries(REF).every(([key, pattern]) => typeof lease[key] === 'string' && pattern.test(lease[key] as string))) return null;
    return Object.freeze({ tuple: Object.freeze({ sessionRef: lease.sessionRef as string, selectionEpoch: lease.selectionEpoch as number, patientRef: lease.patientRef as string, ambulatoryRef: lease.ambulatoryRef as string, leaseRef: lease.leaseRef as string }), context: selected.context });
}
function boundAttachment(value: unknown): Readonly<{ attachment: object; context: object }> | null {
    const bound = context(value, ['attachment', 'selectionContext']);
    try { return !bound || !bound.record.attachment || typeof bound.record.attachment !== 'object' || Array.isArray(bound.record.attachment) || Object.getPrototypeOf(bound.record.attachment) !== Object.prototype || !Object.isFrozen(bound.record.attachment) || Reflect.ownKeys(bound.record.attachment).includes('selectionContext') ? null : Object.freeze({ attachment: bound.record.attachment, context: bound.context }); } catch { return null; }
}
function requestId(): string {
    const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Runs one selection-bound ingest and then one review-only preview; it has no persistence or retry path. */
export function createSmartImportBrowserOrchestrator(sources: Sources) {
    const request = sources.fetch ?? globalThis.fetch; const identifier = sources.requestId ?? requestId; let generation = 0; let operation = 0;
    const reset = () => { generation += 1; operation += 1; };
    return Object.freeze({
        reset,
        async run(selection: unknown, attachment: unknown): Promise<SmartImportPreviewWireRoot> {
            const selected = tuple(selection); const bound = boundAttachment(attachment);
            if (!selected || !bound || selected.context !== bound.context) return fail('selection_invalid');
            const token = generation; const currentOperation = ++operation;
            const current = () => {
                if (token !== generation || currentOperation !== operation) return fail('operation_superseded');
                try { if (sources.isCurrent(selection) !== true) return fail('selection_invalid'); } catch { return fail('selection_invalid'); }
            };
            current(); let ingestId: unknown; let previewId: unknown;
            try { ingestId = identifier(); previewId = identifier(); } catch { return fail('input_invalid'); }
            if (typeof ingestId !== 'string' || typeof previewId !== 'string' || ingestId === previewId || RAW_UUID.test(ingestId) || RAW_UUID.test(previewId) || !REQUEST_ID.test(ingestId) || !REQUEST_ID.test(previewId)) return fail('input_invalid');
            let ingestResponse: Response;
            try { ingestResponse = await request('/api/ai/smart-import/ingest', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tuple: selected.tuple, attachment: bound.attachment, requestId: ingestId }) }); } catch { current(); return fail('ingest_outcome_unknown'); }
            current(); if (!ingestResponse.ok) return fail('ingest_unavailable'); let ingestBody: unknown;
            try { ingestBody = await ingestResponse.json(); } catch { current(); return fail('response_invalid'); }
            current(); const ingested = exact(ingestBody, ['handle']);
            if (!ingested || typeof ingested.handle !== 'string' || !/^prj_[0-9a-f]{32}$/u.test(ingested.handle)) return fail('response_invalid'); current();
            let previewResponse: Response;
            try { previewResponse = await request('/api/ai/smart-import/preview', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: ingested.handle, requestId: previewId }) }); } catch { current(); return fail('preview_outcome_unknown'); }
            current(); if (!previewResponse.ok) return fail('preview_unavailable'); let previewBody: unknown;
            try { previewBody = await previewResponse.json(); } catch { current(); return fail('response_invalid'); }
            current(); const parsed = parseSmartImportPreviewWireRoot(previewBody); current();
            if (!parsed) return fail('response_invalid'); current(); return parsed;
        },
    });
}
