/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';

import { apiFailure } from '../../api-error-response';
import { TreatmentReasoningAuthenticatedProjectionError } from './treatment-reasoning-authenticated-projection';
import type { TreatmentReasoningProductionResult } from './treatment-reasoning-production-operation';

type IngestOperation = Readonly<{ ingest(input: unknown): string }>;
type PreviewOperation = Readonly<{ preview(input: unknown): Promise<TreatmentReasoningProductionResult> }>;
type IngestSources = Readonly<{ acquireIngest(): Promise<IngestOperation | null> }>;
type PreviewSources = Readonly<{ acquirePreview(): Promise<PreviewOperation | null> }>;

const MESSAGE = 'Treatment Reasoning non disponibile.';
const HANDLE = /^trp_[0-9a-f]{32}$/u;
const REQUEST = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;

function failure(code: string, status: number): NextResponse {
    return apiFailure(code, MESSAGE, status);
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const item = Object.getOwnPropertyDescriptor(value, key);
            if (!item?.enumerable || !('value' in item)) return null;
            output[key] = item.value;
        }
        return output;
    } catch { return null; }
}

function ingestInput(value: unknown): Readonly<{ projection: object; requestId: string }> | null {
    const input = exact(value, ['projection', 'requestId']);
    return input && typeof input.projection === 'object' && input.projection !== null && !Array.isArray(input.projection)
        && typeof input.requestId === 'string' && REQUEST.test(input.requestId)
        ? Object.freeze({ projection: input.projection, requestId: input.requestId }) : null;
}

function previewInput(value: unknown): Readonly<{ handle: string; requestId: string }> | null {
    const input = exact(value, ['handle', 'requestId']);
    return input && typeof input.handle === 'string' && HANDLE.test(input.handle)
        && typeof input.requestId === 'string' && REQUEST.test(input.requestId)
        ? Object.freeze({ handle: input.handle, requestId: input.requestId }) : null;
}

async function body(request: Request): Promise<unknown | null> {
    try { return await request.json(); } catch { return null; }
}

function typedError(error: unknown): NextResponse {
    if (!(error instanceof TreatmentReasoningAuthenticatedProjectionError)) return failure('operation_unavailable', 503);
    if (error.code === 'session_unavailable') return failure(error.code, 401);
    if (error.code === 'input_invalid') return failure(error.code, 400);
    if (error.code === 'handle_missing') return failure(error.code, 410);
    if (error.code === 'request_replayed' || error.code === 'selection_changed' || error.code === 'projection_stale'
        || error.code === 'lease_unavailable') return failure(error.code, 409);
    return failure(error.code, 503);
}

function denied(result: Extract<TreatmentReasoningProductionResult, { status: 'denied' }>): NextResponse {
    if (result.code === 'input_invalid') return failure(result.code, 400);
    if (result.code === 'lane_disabled') return failure(result.code, 403);
    if (result.code === 'source_stale') return failure(result.code, 409);
    if (result.code === 'execution_timeout') return failure(result.code, 504);
    return failure(result.code, 503);
}

function json(value: unknown): NextResponse {
    const response = NextResponse.json(value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

/** Acquires session authority before reading the projection-bearing request body. */
export function createTreatmentReasoningIngestHttpHandler(sources: IngestSources) {
    return async (request: Request): Promise<NextResponse> => {
        let operation: IngestOperation | null;
        try { operation = await sources.acquireIngest(); }
        catch (error) { return typedError(error); }
        if (!operation) return failure('session_unavailable', 401);
        const input = ingestInput(await body(request));
        if (!input) return failure('input_invalid', 400);
        try {
            const handle = operation.ingest(input);
            return HANDLE.test(handle) ? json({ handle }) : failure('operation_unavailable', 503);
        } catch (error) { return typedError(error); }
    };
}

/** Acquires session authority before reading the opaque one-shot preview handle. */
export function createTreatmentReasoningPreviewHttpHandler(sources: PreviewSources) {
    return async (request: Request): Promise<NextResponse> => {
        let operation: PreviewOperation | null;
        try { operation = await sources.acquirePreview(); }
        catch (error) { return typedError(error); }
        if (!operation) return failure('session_unavailable', 401);
        const input = previewInput(await body(request));
        if (!input) return failure('input_invalid', 400);
        try {
            const result = await operation.preview(input);
            return result.status === 'available' ? json(result.publication) : denied(result);
        } catch (error) { return typedError(error); }
    };
}
