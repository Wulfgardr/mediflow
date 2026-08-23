/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';

import { apiFailure, apiInternalError } from '../api-error-response';
import type { PatientSmartImportHostCapabilityResult } from '../domain/documents/patient-smart-import-host-capability';
import { serializeSmartImportPreviewWireRoot } from '../smart-import-preview-wire';
import {
    AuthenticatedSmartImportPreviewError,
    type AuthenticatedSmartImportPreviewErrorCode,
} from './server-session-authenticated-smart-import-preview';

type PreviewInput = Readonly<{ handle: string; requestId: string }>;
type Sources = Readonly<{ preview(input: PreviewInput): Promise<PatientSmartImportHostCapabilityResult> }>;

const MESSAGE = 'Preview Smart Import non disponibile.';

function failure(code: string, status: number): NextResponse { return apiFailure(code, MESSAGE, status); }
function exhaustiveCode(code: never): null { void code; return null; }

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const record: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) return null;
            record[key] = descriptor.value;
        }
        return record;
    } catch { return null; }
}

function input(value: unknown): PreviewInput | null {
    const record = exact(value, ['handle', 'requestId']);
    if (!record || typeof record.handle !== 'string' || !/^prj_[0-9a-f]{32}$/u.test(record.handle)
        || typeof record.requestId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(record.requestId)) return null;
    return Object.freeze({ handle: record.handle, requestId: record.requestId });
}

function typedFailure(code: AuthenticatedSmartImportPreviewErrorCode): NextResponse | null {
    switch (code) {
        case 'session_unavailable': return failure(code, 401);
        case 'preview_unavailable': return failure(code, 503);
        default: return exhaustiveCode(code);
    }
}

export function createSmartImportPreviewHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        let value: unknown;
        try { value = await request.json(); } catch { return failure('input_invalid', 400); }
        const parsed = input(value);
        if (!parsed) return failure('input_invalid', 400);
        try {
            const result = await sources.preview(parsed);
            const snapshot = serializeSmartImportPreviewWireRoot({ preview: result });
            if (!snapshot) return apiInternalError('POST Smart Import preview', result);
            const response = NextResponse.json(snapshot); response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            if (error instanceof AuthenticatedSmartImportPreviewError) return typedFailure(error.code) ?? apiInternalError('POST Smart Import preview', error);
            return apiInternalError('POST Smart Import preview', error);
        }
    };
}
