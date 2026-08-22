/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';

import { apiFailure, apiInternalError } from '../api-error-response';
import type { PatientSmartImportHostCapabilityResult } from '../domain/documents/patient-smart-import-host-capability';
import {
    AuthenticatedSmartImportPreviewError,
    type AuthenticatedSmartImportPreviewErrorCode,
} from './server-session-authenticated-smart-import-preview';

type PreviewInput = Readonly<{ handle: string; requestId: string }>;
type Sources = Readonly<{ preview(input: PreviewInput): Promise<PatientSmartImportHostCapabilityResult> }>;

const MESSAGE = 'Preview Smart Import non disponibile.';
const DENIED_CODES = new Set(['input_invalid', 'kill_switch_disabled', 'kill_switch_unavailable', 'projection_unavailable',
    'lifecycle_missing', 'lifecycle_corrupt', 'lifecycle_unavailable', 'provider_binding_denied', 'provider_unready',
    'model_unavailable', 'fabric_denied', 'source_invalid']);
const FAILED_CODES = new Set(['provider_failed', 'proposal_invalid']);

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

function plainData(value: unknown, seen = new Set<object>()): boolean {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    try {
        seen.add(value);
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false;
            return value.every((item) => plainData(item, seen));
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) return false;
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== 'string') return false;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !plainData(descriptor.value, seen)) return false;
        }
        return true;
    } catch { return false; }
}

function input(value: unknown): PreviewInput | null {
    const record = exact(value, ['handle', 'requestId']);
    if (!record || typeof record.handle !== 'string' || !/^prj_[0-9a-f]{32}$/u.test(record.handle)
        || typeof record.requestId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(record.requestId)) return null;
    return Object.freeze({ handle: record.handle, requestId: record.requestId });
}

function capabilityResult(value: unknown): PatientSmartImportHostCapabilityResult | null {
    const record = exact(value, ['writesPerformed', 'apply', 'status', 'code', 'proposal', 'receipt', 'provenance', 'reviewRef']);
    if (!record || record.writesPerformed !== 0 || record.apply !== 'denied') return null;
    if (record.status === 'available') {
        if (record.code !== null || typeof record.reviewRef !== 'string' || !record.proposal || !record.receipt || !record.provenance
            || !plainData(record.proposal) || !plainData(record.receipt) || !plainData(record.provenance)) return null;
        return value as PatientSmartImportHostCapabilityResult;
    }
    if (record.status === 'denied') {
        if (typeof record.code !== 'string' || !DENIED_CODES.has(record.code) || record.proposal !== null || record.receipt !== null
            || record.provenance !== null || record.reviewRef !== null) return null;
        return value as PatientSmartImportHostCapabilityResult;
    }
    if (record.status === 'failed') {
        if (typeof record.code !== 'string' || !FAILED_CODES.has(record.code) || record.proposal !== null || record.reviewRef !== null
            || !record.receipt || !record.provenance || !plainData(record.receipt) || !plainData(record.provenance)) return null;
        return value as PatientSmartImportHostCapabilityResult;
    }
    return null;
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
            const preview = capabilityResult(result);
            if (!preview) return apiInternalError('POST Smart Import preview', result);
            const response = NextResponse.json({ preview }); response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            if (error instanceof AuthenticatedSmartImportPreviewError) return typedFailure(error.code) ?? apiInternalError('POST Smart Import preview', error);
            return apiInternalError('POST Smart Import preview', error);
        }
    };
}
