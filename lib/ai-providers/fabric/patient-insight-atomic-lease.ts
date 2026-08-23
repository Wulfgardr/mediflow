/* @Codex */
import 'server-only';

import type { ServerSessionProjectionOwner } from '../../security/server-session-projection-owner.ts';
import type { ServerSession } from '../../security/server-session.ts';

type Owner = Pick<ServerSessionProjectionOwner,
    'snapshotSelectionEpoch' | 'snapshotReviewContextEpoch' | 'withLeaseCriticalSection'>;
type Currentness = Readonly<{ capabilityEpoch: number; revision: number; freshnessToken: string; revoked: boolean }>;
type RecordState = { readonly currentness: Currentness; spent: boolean };

export type PatientInsightAtomicLeaseErrorCode =
    | 'disposed' | 'epoch_aba' | 'epoch_regressed' | 'input_invalid' | 'record_spent' | 'revoked'
    | 'stale_currentness' | 'stale_selection';

export class PatientInsightAtomicLeaseError extends Error {
    constructor(readonly code: PatientInsightAtomicLeaseErrorCode) {
        super(`Patient Insight atomic lease rejected: ${code}`);
        this.name = 'PatientInsightAtomicLeaseError';
    }
}

export type PatientInsightAtomicCurrentness = object;

export type PatientInsightAtomicLease = Readonly<{
    replaceCurrentness(capabilityEpoch: number, revision: number, freshnessToken: string, revoked: boolean): PatientInsightAtomicCurrentness;
    consume<T>(record: PatientInsightAtomicCurrentness, stage: () => T): T;
    dispose(): void;
}>;

export function createPatientInsightAtomicLease(input: Readonly<{
    owner: Owner; session: ServerSession; entropy?: () => Uint8Array; clock?: () => number;
}>): PatientInsightAtomicLease {
    const owner = input.owner;
    const session = input.session;
    const entropy = input.entropy ?? (() => new Uint8Array(16));
    const clock = input.clock ?? (() => Date.now());
    const records = new WeakMap<object, RecordState>();
    const fingerprints = new Set<string>();
    let current: object | null = null;
    let last: Currentness | null = null;
    let revoked = false;
    let disposed = false;

    const fail = (code: PatientInsightAtomicLeaseErrorCode): never => { throw new PatientInsightAtomicLeaseError(code); };
    const insideP4 = <T>(callback: () => T): T => owner.withLeaseCriticalSection(session, callback);
    const snapshot = () => Object.freeze({ selectionEpoch: owner.snapshotSelectionEpoch(session),
        reviewContextEpoch: owner.snapshotReviewContextEpoch(session) });
    const assertFiniteClock = () => {
        const now = clock();
        if (!Number.isFinite(now)) fail('input_invalid');
    };
    const assertEntropy = () => {
        const value = entropy();
        if (!(value instanceof Uint8Array) || value.byteLength < 16) fail('input_invalid');
    };
    const fingerprint = (value: Currentness) => `${value.revision}\u0000${value.freshnessToken}\u0000${value.revoked}`;
    const assertStable = (record: object, boundary: Readonly<{ selectionEpoch: number; reviewContextEpoch: number }>) => {
        const next = snapshot();
        if (next.selectionEpoch !== boundary.selectionEpoch || next.reviewContextEpoch !== boundary.reviewContextEpoch) fail('stale_selection');
        if (current !== record) fail('stale_currentness');
        assertFiniteClock();
    };

    return Object.freeze({
        replaceCurrentness(capabilityEpoch, revision, freshnessToken, isRevoked) {
            return insideP4(() => {
                if (disposed) fail('disposed');
                if (!Number.isSafeInteger(capabilityEpoch) || capabilityEpoch < 1 || !Number.isSafeInteger(revision)
                    || revision < 0 || typeof freshnessToken !== 'string' || freshnessToken.length === 0 || typeof isRevoked !== 'boolean') {
                    fail('input_invalid');
                }
                if (revoked) fail('revoked');
                const next = Object.freeze({ capabilityEpoch, revision, freshnessToken, revoked: isRevoked });
                if (last && capabilityEpoch <= last.capabilityEpoch) fail('epoch_regressed');
                const key = fingerprint(next);
                if (fingerprints.has(key)) fail('epoch_aba');
                const record = Object.freeze(Object.create(null));
                records.set(record, { currentness: next, spent: false });
                fingerprints.add(key); last = next; current = record;
                if (isRevoked) revoked = true;
                return record;
            });
        },
        consume(record, stage) {
            if (disposed) fail('disposed');
            if (typeof record !== 'object' || record === null) fail('input_invalid');
            const captured = records.get(record);
            if (!captured) throw new PatientInsightAtomicLeaseError('input_invalid');
            if (captured.spent) fail('record_spent');
            captured.spent = true;
            if (typeof stage !== 'function') fail('input_invalid');
            let staged: unknown;
            insideP4(() => {
                const boundary = snapshot();
                if (current !== record) fail('stale_currentness');
                if (revoked || captured.currentness.revoked) fail('revoked');
                assertEntropy(); assertFiniteClock(); assertStable(record, boundary);
                staged = stage();
                if (staged !== null && (typeof staged === 'object' || typeof staged === 'function')) fail('input_invalid');
                assertStable(record, boundary);
                return undefined;
            });
            return staged as never;
        },
        dispose() {
            insideP4(() => { disposed = true; current = null; return undefined; });
        },
    });
}
