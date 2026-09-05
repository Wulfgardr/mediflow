/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';
import { apiFailure, apiInternalError } from '../api-error-response';
import {
    AuthenticatedWebSessionSelectionError,
    type AuthenticatedWebSessionSelectionOperation,
} from './server-session-authenticated-selection';
import { isTrustedWebMutationRequest } from './request-transport';
import { ServerSessionProjectionOwnerError } from './server-session-projection-owner';

type SelectionInput = Readonly<{ expectedEpoch: number; patientId: string; ambulatoryId: string }>;
type Sources = Readonly<{ acquireSelection(): Promise<AuthenticatedWebSessionSelectionOperation> }>;
type EpochSources = Readonly<{ readEpoch(): Promise<number> }>;

const MESSAGE = 'Selezione Smart Import non disponibile.';

function input(value: unknown): SelectionInput | null {
    try {
        if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        if (Reflect.ownKeys(value).length !== 3) return null;
        const expectedEpoch = Object.getOwnPropertyDescriptor(value, 'expectedEpoch');
        const patientId = Object.getOwnPropertyDescriptor(value, 'patientId');
        const ambulatoryId = Object.getOwnPropertyDescriptor(value, 'ambulatoryId');
        if (!expectedEpoch || !('value' in expectedEpoch) || !Number.isSafeInteger(expectedEpoch.value) || expectedEpoch.value < 0
            || !patientId || !('value' in patientId) || typeof patientId.value !== 'string'
            || !ambulatoryId || !('value' in ambulatoryId) || typeof ambulatoryId.value !== 'string') return null;
        return Object.freeze({ expectedEpoch: expectedEpoch.value, patientId: patientId.value, ambulatoryId: ambulatoryId.value });
    } catch { return null; }
}

function failure(code: string, status: number): NextResponse {
    return apiFailure(code, MESSAGE, status);
}

function typedFailure(error: unknown): NextResponse | null {
    const code = error instanceof ServerSessionProjectionOwnerError || error instanceof AuthenticatedWebSessionSelectionError
        ? error.code : null;
    if (code === 'input_invalid') return failure(code, 400);
    if (code === 'session_unavailable' || code === 'session_ineligible') return failure(code, 401);
    if (['epoch_conflict', 'selection_busy', 'selection_unavailable', 'stale_selection', 'owner_disposed', 'owner_acquiring', 'owner_exists'].includes(code ?? '')) {
        return failure(code as string, 409);
    }
    if (code === 'lease_expired') return failure(code, 410);
    if (code === 'reference_unavailable') return failure(code, 503);
    return null;
}

export function createSmartImportSelectionHttpHandler(sources: Sources) {
    return async (request: Request): Promise<NextResponse> => {
        let operation: AuthenticatedWebSessionSelectionOperation;
        try { operation = await sources.acquireSelection(); } catch (error) {
            return typedFailure(error) ?? apiInternalError('POST Smart Import selection', error);
        }
        if (!isTrustedWebMutationRequest(request)) return failure('request_transport_invalid', 403);
        let value: unknown;
        try { value = await request.json(); } catch { return failure('input_invalid', 400); }
        const parsed = input(value);
        if (!parsed) return failure('input_invalid', 400);
        try {
            const lease = await operation.issueSelection(parsed);
            const response = NextResponse.json({ selection: {
                sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
                ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef, expiresAt: lease.expiresAt,
            } });
            response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            return typedFailure(error) ?? apiInternalError('POST Smart Import selection', error);
        }
    };
}

/* @Codex */
export function createSmartImportSelectionEpochHttpHandler(sources: EpochSources) {
    return async (): Promise<NextResponse> => {
        try {
            const selectionEpoch = await sources.readEpoch();
            if (!Number.isSafeInteger(selectionEpoch) || selectionEpoch < 0) {
                return apiInternalError('GET Smart Import selection epoch', selectionEpoch);
            }
            const response = NextResponse.json({ selectionEpoch });
            response.headers.set('Cache-Control', 'no-store');
            return response;
        } catch (error) {
            if (error instanceof AuthenticatedWebSessionSelectionError && error.code === 'session_unavailable') {
                return failure('session_unavailable', 401);
            }
            if (error instanceof ServerSessionProjectionOwnerError && (error.code === 'session_unavailable' || error.code === 'session_ineligible')) {
                return failure('session_unavailable', 401);
            }
            return apiInternalError('GET Smart Import selection epoch', error);
        }
    };
}
