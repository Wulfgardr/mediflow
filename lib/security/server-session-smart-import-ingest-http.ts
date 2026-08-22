/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';

import { apiFailure, apiInternalError } from '../api-error-response';
import { ProjectionBrokerError, type ProjectionBrokerErrorCode } from '../typed-projection-broker';
import {
    SmartImportProjectionAttachmentHostError,
    type SmartImportProjectionAttachmentHostErrorCode,
} from '../smart-import-projection-attachment-host';
import { SmartImportProjectionError, type SmartImportProjectionErrorCode } from '../smart-import-projection';
import {
    ServerSessionSmartImportAttachmentIngestError,
    type ServerSessionSmartImportAttachmentIngestErrorCode,
} from './server-session-smart-import-attachment-ingest';
import { ServerSessionProjectionOwnerError, type ServerSessionProjectionOwnerErrorCode } from './server-session-projection-owner';

type Sources = Readonly<{ ingest(input: unknown): Promise<string> }>;

const MESSAGE = 'Ingest Smart Import non disponibile.';

function failure(code: string, status: number): NextResponse {
    return apiFailure(code, MESSAGE, status);
}

function exhaustiveCode(code: never): null {
    void code;
    return null;
}

function attachmentFailure(code: ServerSessionSmartImportAttachmentIngestErrorCode): NextResponse | null {
    switch (code) {
        case 'input_invalid': return failure(code, 400);
        case 'session_unavailable': return failure(code, 401);
        case 'owner_unavailable': return failure(code, 409);
        default: return exhaustiveCode(code);
    }
}

function brokerFailure(code: ProjectionBrokerErrorCode): NextResponse | null {
    switch (code) {
        case 'input_invalid': case 'projection_invalid': case 'capability_mismatch': case 'patient_mismatch': return failure(code, 400);
        case 'broker_locked': case 'broker_revoked': case 'request_replayed': case 'selection_changed': return failure(code, 409);
        case 'lease_expired': case 'projection_stale': return failure(code, 410);
        case 'handle_collision': case 'handle_missing': case 'source_invalid': return null;
        default: return exhaustiveCode(code);
    }
}

function ownerFailure(code: ServerSessionProjectionOwnerErrorCode): NextResponse | null {
    switch (code) {
        case 'input_invalid': return failure(code, 400);
        case 'session_unavailable': case 'session_ineligible': return failure(code, 401);
        case 'broker_unavailable': case 'epoch_conflict': case 'owner_disposed': case 'owner_acquiring': case 'owner_exists':
        case 'selection_busy': case 'stale_selection': return failure(code, 409);
        case 'lease_expired': return failure(code, 410);
        case 'reference_unavailable': return failure(code, 503);
        case 'broker_factory_failed': case 'selection_unavailable': return null;
        default: return exhaustiveCode(code);
    }
}

function projectionFailure(code: SmartImportProjectionErrorCode): NextResponse | null {
    switch (code) {
        case 'projection_invalid': return failure(code, 400);
        case 'projection_stale': return failure(code, 410);
        default: return exhaustiveCode(code);
    }
}

function attachmentHostFailure(code: SmartImportProjectionAttachmentHostErrorCode): NextResponse | null {
    switch (code) {
        case 'authority_invalid': return null;
        case 'source_invalid': return null;
        default: return exhaustiveCode(code);
    }
}

function typedFailure(error: unknown): NextResponse | null {
    if (error instanceof ServerSessionSmartImportAttachmentIngestError) return attachmentFailure(error.code);
    if (error instanceof ProjectionBrokerError) return brokerFailure(error.code);
    if (error instanceof ServerSessionProjectionOwnerError) return ownerFailure(error.code);
    if (error instanceof SmartImportProjectionError) return projectionFailure(error.code);
    if (error instanceof SmartImportProjectionAttachmentHostError) return attachmentHostFailure(error.code);
    return null;
}

function transportObject(value: unknown): boolean {
    try {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            && Object.getPrototypeOf(value) === Object.prototype;
    } catch { return false; }
}

export function createSmartImportIngestHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        let input: unknown;
        try { input = await request.json(); } catch { return failure('input_invalid', 400); }
        if (!transportObject(input)) return failure('input_invalid', 400);
        try {
            const handle = await sources.ingest(input);
            const response = NextResponse.json({ handle });
            response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            return typedFailure(error) ?? apiInternalError('POST Smart Import ingest', error);
        }
    };
}
