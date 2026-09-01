/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { apiFailure, apiInternalError } from '../../api-error-response';
import type { ServerSession } from '../../security/server-session';
import type { ServerSessionProjectionOwner } from '../../security/server-session-projection-owner';
import { createPatientInsightAtomicLease } from './patient-insight-atomic-lease';
import { consumePatientInsightProjection, createPatientInsightBroker, type PatientInsightBrokerCurrentness } from './patient-insight-broker';
import { createPatientInsightHostBoundary } from './patient-insight-host-boundary';
import type { PatientInsightHostCapabilityResult } from './patient-insight-host-capability';
import { createPatientInsightHostProjectionResolver } from './patient-insight-host-projection';
import {
    parsePatientInsightPreviewRequest,
    serializePatientInsightPreviewWireRoot,
    type PatientInsightPreviewRequest,
} from './patient-insight-preview-contract';

type SelectionOwner = Pick<ServerSessionProjectionOwner,
    'snapshotSelectionEpoch' | 'issueSelection' | 'dereferenceSelection' | 'mintPatientInsightLeaseCommitPort'>;
type Context = Readonly<{ session: ServerSession; owner: SelectionOwner }>;
type CurrentnessVerifier = Readonly<{ verify(): boolean }>;
type Capability = Readonly<{ preview(input: unknown): Promise<PatientInsightHostCapabilityResult> }>;
type Sources = Readonly<{
    acquireContext(): Promise<Context | null>;
    readPatientRevision(patientId: string): number | null;
    createCapability(currentness: CurrentnessVerifier): Capability;
    clock(): unknown;
    entropy(): unknown;
}>;
export type AuthenticatedPatientInsightPreviewOperation = Readonly<{ preview(input: unknown): Promise<PatientInsightHostCapabilityResult> }>;

export type AuthenticatedPatientInsightPreviewErrorCode = 'preview_unavailable' | 'session_unavailable';
export class AuthenticatedPatientInsightPreviewError extends Error {
    constructor(readonly code: AuthenticatedPatientInsightPreviewErrorCode) {
        super(`Authenticated Patient Insight preview rejected: ${code}`);
        this.name = 'AuthenticatedPatientInsightPreviewError';
    }
}

const common = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const });
const deny = (code: 'input_invalid' | 'projection_unavailable' | 'source_stale'): PatientInsightHostCapabilityResult =>
    Object.freeze({ ...common, status: 'denied', code, proposal: null, receipt: null, provenance: null, reviewRef: null });
const fail = (code: AuthenticatedPatientInsightPreviewErrorCode): never => { throw new AuthenticatedPatientInsightPreviewError(code); };
function iso(value: unknown): string | null {
    return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value ? value : null;
}
function freshCapture(capturedAt: string, verifiedAt: string): boolean {
    const age = Date.parse(verifiedAt) - Date.parse(capturedAt);
    return Number.isFinite(age) && age >= -5 * 60_000 && age <= 30 * 60_000;
}
function digest(value: unknown): string {
    return `sha256_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function references(entropy: () => unknown): Readonly<{ receipt: string; provenance: string }> | null {
    try {
        const value = entropy(); if (!(value instanceof Uint8Array) || value.byteLength < 32) return null;
        const hex = Array.from(value.slice(0, 32), (byte) => byte.toString(16).padStart(2, '0')).join('');
        return Object.freeze({ receipt: `receipt_${hex.slice(0, 32)}`, provenance: `provenance_${hex.slice(32)}` });
    } catch { return null; }
}
function dereferenceInput(lease: ReturnType<SelectionOwner['issueSelection']>) {
    return Object.freeze({ sessionRef: lease.sessionRef, selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
        ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef });
}

/** Acquires session authority before accepting input and composes the one-time PI broker/lease boundary. */
export function createAuthenticatedPatientInsightPreviewService(sources: Sources) {
    const acquire = async (): Promise<AuthenticatedPatientInsightPreviewOperation> => {
        let context: Context | null;
        try { context = await sources.acquireContext(); } catch { return fail('session_unavailable'); }
        if (!context) return fail('session_unavailable');
        return Object.freeze({
            async preview(value: unknown): Promise<PatientInsightHostCapabilityResult> {
                const request = parsePatientInsightPreviewRequest(value); if (!request) return deny('input_invalid');
                const verifiedAt = iso(sources.clock());
                if (!verifiedAt || !freshCapture(request.capturedAt, verifiedAt)) return deny('source_stale');
                let revision: number | null;
                try { revision = sources.readPatientRevision(request.patientId); } catch { revision = null; }
                if (revision !== request.patientRevision) return deny('source_stale');
                const projection = createPatientInsightHostProjectionResolver().resolve(request.sources);
                if (!projection) return deny('projection_unavailable');
                const projectionDigest = digest(projection); const refs = references(sources.entropy);
                if (!refs) return deny('projection_unavailable');
                let selection: ReturnType<SelectionOwner['issueSelection']>;
                try {
                    const expectedEpoch = context.owner.snapshotSelectionEpoch(context.session);
                    selection = context.owner.issueSelection({ expectedEpoch, patientId: request.patientId, ambulatoryId: request.ambulatoryId });
                } catch { return deny('source_stale'); }
                const live = (): boolean => {
                    try {
                        const pair = context.owner.dereferenceSelection(context.session, dereferenceInput(selection));
                        return pair.patientId === request.patientId && pair.ambulatoryId === request.ambulatoryId
                            && sources.readPatientRevision(request.patientId) === request.patientRevision;
                    } catch { return false; }
                };
                const currentness = Object.freeze({ verify: live });
                const brokerCurrentness = (): PatientInsightBrokerCurrentness => Object.freeze({
                    selectionEpoch: selection.selectionEpoch, revision: request.patientRevision, freshnessToken: projectionDigest,
                    isRevoked: () => !live(),
                });
                let atomic: ReturnType<typeof createPatientInsightAtomicLease> | null = null;
                try {
                    const boundary = createPatientInsightHostBoundary({
                        binding: { leaseRef: selection.leaseRef, patientRef: selection.patientRef, selectionEpoch: selection.selectionEpoch },
                        receipt: { schemaVersion: 'mediflow.patient-insight.host-receipt.v1', reference: refs.receipt,
                            capability: 'patient_insight', authority: 'host_service', writesPerformed: 0, applyPolicy: 'none' },
                        provenance: { schemaVersion: 'mediflow.patient-insight.host-provenance.v1', reference: refs.provenance,
                            capability: 'patient_insight', receiptRef: refs.receipt },
                    });
                    const broker = createPatientInsightBroker(Object.freeze({ readCurrentness: brokerCurrentness,
                        readSources: () => request.sources, boundary, clock: () => verifiedAt, entropy: sources.entropy as () => Uint8Array }));
                    atomic = createPatientInsightAtomicLease(Object.freeze({ port: context.owner.mintPatientInsightLeaseCommitPort(context.session), broker }));
                    const handle = atomic.commit();
                    const hostProjection = consumePatientInsightProjection(broker, Object.freeze({ handle }));
                    const capability = sources.createCapability(currentness);
                    return await capability.preview(Object.freeze({ requestId: request.requestId, projection: hostProjection,
                        currentness: Object.freeze({ selectionEpoch: selection.selectionEpoch, patientRevision: request.patientRevision,
                            projectionDigest, capturedAt: request.capturedAt, verifiedAt }) }));
                } catch { return deny(live() ? 'projection_unavailable' : 'source_stale'); }
                finally { try { atomic?.dispose(); } catch { /* host authority already closed */ } }
            },
        });
    };
    return Object.freeze({ acquire, async preview(input: unknown) { return (await acquire()).preview(input); } });
}

type HttpSources = Readonly<{ acquirePreview(): Promise<AuthenticatedPatientInsightPreviewOperation> }>;
const MESSAGE = 'Patient Insight non disponibile.';
const failure = (code: string, status: number) => apiFailure(code, MESSAGE, status);
function typedFailure(code: AuthenticatedPatientInsightPreviewErrorCode): NextResponse {
    return code === 'session_unavailable' ? failure(code, 401) : failure(code, 503);
}

export function createPatientInsightPreviewHttpHandler(sources: HttpSources) {
    return async (request: Request): Promise<NextResponse> => {
        let operation: AuthenticatedPatientInsightPreviewOperation;
        try { operation = await sources.acquirePreview(); }
        catch (error) {
            return error instanceof AuthenticatedPatientInsightPreviewError
                ? typedFailure(error.code) : apiInternalError('POST Patient Insight preview', new Error('Authentication boundary unavailable.'));
        }
        let input: unknown;
        try { input = await request.json(); } catch { return failure('input_invalid', 400); }
        if (!parsePatientInsightPreviewRequest(input)) return failure('input_invalid', 400);
        try {
            const result = await operation.preview(input);
            const snapshot = serializePatientInsightPreviewWireRoot({ preview: result });
            if (!snapshot) return apiInternalError('POST Patient Insight preview', new Error('Wire snapshot unavailable.'));
            const response = NextResponse.json(snapshot); response.headers.set('Cache-Control', 'no-store'); return response;
        } catch (error) {
            return error instanceof AuthenticatedPatientInsightPreviewError
                ? typedFailure(error.code) : apiInternalError('POST Patient Insight preview', new Error('Preview boundary unavailable.'));
        }
    };
}

export type { PatientInsightPreviewRequest };
