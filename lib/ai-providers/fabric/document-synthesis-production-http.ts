/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';
import { apiFailure } from '@/lib/api-error-response';
import { serializeDocumentSynthesisPreviewWire, type DocumentSynthesisPreviewWire } from './document-synthesis-preview-wire';

type CaptureResult = Readonly<{ status: 'available'; code: null; captureHandle: string }> | Readonly<{ status: 'denied'; code: string; captureHandle: null }>;
type IngestResult = Readonly<{ status: 'available'; code: null; previewHandle: string }> | Readonly<{ status: 'denied'; code: string; previewHandle: null }>;
type PreviewResult = Readonly<{ status: 'available'; code: null; publication: unknown }> | Readonly<{ status: 'denied'; code: string; publication: null }>;
type Operation = Readonly<{
    capture(input: unknown): Promise<CaptureResult> | CaptureResult;
    ingest(input: unknown): Promise<IngestResult> | IngestResult;
    preview(input: unknown): Promise<PreviewResult> | PreviewResult;
}>;
type Sources = Readonly<{
    acquireOperation(): Promise<Operation | null>;
    serialize?: (publication: unknown) => DocumentSynthesisPreviewWire | null;
}>;

const MESSAGE = 'Document Synthesis non disponibile.';
const CAPTURE = /^dsc_[0-9a-f]{32}$/u;
const PREVIEW = /^dsp_[0-9a-f]{32}$/u;

function failure(code: string, status: number): NextResponse { return apiFailure(code, MESSAGE, status); }

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function captureInput(value: unknown): unknown | null {
    const input = exact(value, ['attachmentId']);
    return input && typeof input.attachmentId === 'string' && input.attachmentId.length > 0 && input.attachmentId.length <= 200
        && !/[\u0000-\u001f\u007f]/u.test(input.attachmentId) ? { attachmentId: input.attachmentId } : null;
}

function ingestInput(value: unknown): unknown | null {
    const input = exact(value, ['captureHandle']);
    return input && typeof input.captureHandle === 'string' && CAPTURE.test(input.captureHandle)
        ? { captureHandle: input.captureHandle } : null;
}

function previewInput(value: unknown): unknown | null {
    const input = exact(value, ['previewHandle']);
    return input && typeof input.previewHandle === 'string' && PREVIEW.test(input.previewHandle) ? { previewHandle: input.previewHandle } : null;
}

async function acquire(sources: Sources): Promise<Operation | null> {
    try { return await sources.acquireOperation(); } catch { return null; }
}

async function body(request: Request): Promise<unknown | null> {
    try { return await request.json(); } catch { return null; }
}

function denied(code: string): NextResponse {
    if (code === 'input_invalid') return failure(code, 400);
    if (code === 'session_unavailable') return failure(code, 401);
    if (code === 'capture_consumed' || code === 'preview_consumed' || code === 'selection_changed' || code === 'currentness_mismatch'
        || code === 'lane_disabled' || code === 'unsupported_local_extraction') return failure(code, 409);
    if (code === 'capture_expired' || code === 'preview_expired') return failure(code, 410);
    return failure('operation_unavailable', 503);
}

function json(value: unknown): NextResponse {
    const response = NextResponse.json(value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export function createDocumentSynthesisCaptureHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        const operation = await acquire(sources);
        if (!operation) return failure('session_unavailable', 401);
        const input = captureInput(await body(request));
        if (!input) return failure('input_invalid', 400);
        let result: CaptureResult;
        try { result = await operation.capture(input); } catch { return failure('operation_unavailable', 503); }
        return result.status === 'available' ? json({ captureHandle: result.captureHandle }) : denied(result.code);
    };
}

export function createDocumentSynthesisIngestHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        const operation = await acquire(sources);
        if (!operation) return failure('session_unavailable', 401);
        const input = ingestInput(await body(request));
        if (!input) return failure('input_invalid', 400);
        let result: IngestResult;
        try { result = await operation.ingest(input); } catch { return failure('operation_unavailable', 503); }
        return result.status === 'available' ? json({ previewHandle: result.previewHandle }) : denied(result.code);
    };
}

export function createDocumentSynthesisPreviewHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        const operation = await acquire(sources);
        if (!operation) return failure('session_unavailable', 401);
        const input = previewInput(await body(request));
        if (!input) return failure('input_invalid', 400);
        let result: PreviewResult;
        try { result = await operation.preview(input); } catch { return failure('operation_unavailable', 503); }
        if (result.status !== 'available') return denied(result.code);
        const wire = (sources.serialize ?? serializeDocumentSynthesisPreviewWire)(result.publication);
        return wire ? json(wire) : failure('operation_unavailable', 503);
    };
}
