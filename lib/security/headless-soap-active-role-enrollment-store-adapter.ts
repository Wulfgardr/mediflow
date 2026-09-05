/* @Codex */
import 'server-only';

import type { HeadlessSoapActiveRoleEnrollmentLifecycleResult } from './headless-soap-active-role-enrollment';

export type HeadlessSoapActiveRoleEnrollmentStoreErrorCode =
    | 'actor_invalid'
    | 'actor_missing'
    | 'attestation_conflict'
    | 'attestation_missing'
    | 'schema_incompatible'
    | 'storage_unavailable'
    | 'stored_state_invalid';
export type HeadlessSoapActiveRoleEnrollmentStoreError = Error & Readonly<{ code: HeadlessSoapActiveRoleEnrollmentStoreErrorCode }>;
export type HeadlessSoapActiveRoleEnrollmentStore = Readonly<{
    read(actorRef: unknown): unknown;
    createInactive(actorRef: unknown): unknown;
    activate(actorRef: unknown): unknown;
}>;
export type HeadlessSoapActiveRoleEnrollmentStoreErrorPredicate = (value: unknown) => value is HeadlessSoapActiveRoleEnrollmentStoreError;

const missing = Object.freeze({ kind: 'missing' as const });
const conflict = Object.freeze({ kind: 'conflict' as const });
const denied = Object.freeze({ kind: 'denied' as const });
const unavailable = Object.freeze({ kind: 'unavailable' as const });

function mapFailure(
    error: unknown,
    allowMissing: boolean,
    isStoreError: HeadlessSoapActiveRoleEnrollmentStoreErrorPredicate,
): HeadlessSoapActiveRoleEnrollmentLifecycleResult {
    try {
        if (!isStoreError(error)) return unavailable;
        switch (error.code) {
            case 'attestation_missing': return allowMissing ? missing : denied;
            case 'attestation_conflict': return conflict;
            case 'actor_invalid':
            case 'actor_missing': return denied;
            case 'schema_incompatible':
            case 'storage_unavailable':
            case 'stored_state_invalid': return unavailable;
            default: return unavailable;
        }
    } catch { return unavailable; }
}

/** Converts only branded SOAP-store failures into the enrollment lifecycle vocabulary. */
export function createHeadlessSoapActiveRoleEnrollmentStoreAdapter(
    store: HeadlessSoapActiveRoleEnrollmentStore,
    isStoreError: HeadlessSoapActiveRoleEnrollmentStoreErrorPredicate,
) {
    function invoke(call: () => unknown, allowMissing: boolean): HeadlessSoapActiveRoleEnrollmentLifecycleResult {
        try { return Object.freeze({ kind: 'ok' as const, value: call() }); }
        catch (error) { return mapFailure(error, allowMissing, isStoreError); }
    }
    return Object.freeze({
        readAttestation(actorRef: string) { return invoke(() => store.read(actorRef), true); },
        createInactive(actorRef: string) { return invoke(() => store.createInactive(actorRef), false); },
        activate(actorRef: string) { return invoke(() => store.activate(actorRef), false); },
    });
}
