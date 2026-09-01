/* @Codex */
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';

import {
    createHeadlessCheckupStatusTransitionServiceV1,
    HEADLESS_CHECKUP_STATUS_OPERATION_V1 as OPERATION_ID,
    HeadlessCheckupStatusTransitionV1Error,
} from '../../packages/aip/src/checkup-status-transition';
import { createHeadlessCheckupStatusTransitionStorageV1 } from './headless-checkup-status-transition-storage';

const SOURCE_KEYS = ['now', 'readBrokerScope'] as const;
const BINDING_KEYS = ['operationId', 'proposalRef', 'commandDigest', 'ownerIdentity', 'resourceIdentity',
    'targetStatus', 'expectedRevision', 'generation', 'revocationGeneration', 'selectionEpoch', 'expiresAt'] as const;
const PROPOSAL_REF = /^hcsp_[0-9a-f]{64}$/u;
const PROOF_TTL_MS = 30_000;
const PROOF_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.confirmation-proof.v1';
const isProxy = types.isProxy, isPromise = types.isPromise;

type ProofRecord = { proposalRef: string; proofRefHash: string; confirmedAt: number; expiresAt: number; restartGeneration: number;
    state: 'available' | 'terminal' };

function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
}

function exact(value: unknown, keys: readonly string[], canonical: boolean): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if ((canonical && (prototype !== null || !Object.isFrozen(value)))
            || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length) return null;
        const output = Object.create(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (ownKeys[index] !== key) return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || (canonical && (descriptor.writable || descriptor.configurable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function digest(domain: string, value: string): string {
    return `sha256:${createHash('sha256').update(domain).update('\0').update(value).digest('hex')}`;
}

function safeClock(source: () => unknown) {
    let last = -1;
    return (): number => {
        let value: unknown;
        try { value = source(); } catch { throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable'); }
        if (isPromise(value) || !Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < last) {
            throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
        }
        last = value as number;
        return last;
    };
}

/** Composes AG-W1 with one broker-scoped SQLite owner and a distinct single-use confirmation proof owner. */
export function createHeadlessCheckupStatusTransitionProductionV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || typeof sources.now !== 'function' || typeof sources.readBrokerScope !== 'function') {
        throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
    }
    const now = safeClock(sources.now as () => unknown);
    const storage = createHeadlessCheckupStatusTransitionStorageV1(record({
        readBrokerScope: sources.readBrokerScope as () => unknown,
    }));
    const knownProposals = new Set<string>();
    const proofs = new WeakMap<object, ProofRecord>();
    let restartGeneration = 0, disposed = false;
    const nextRef = (kind: 'proposal' | 'idempotency'): string =>
        `${kind === 'proposal' ? 'hcsp_' : 'hcsi_'}${randomBytes(32).toString('hex')}`;
    const consumeConfirmation = (proofValue: unknown, bindingValue: unknown,
        operation: (proof: unknown) => unknown): unknown => {
        if (disposed || !proofValue || typeof proofValue !== 'object') return null;
        const proof = proofs.get(proofValue);
        if (!proof || proof.state !== 'available') return null;
        proof.state = 'terminal';
        const binding = exact(bindingValue, BINDING_KEYS, true);
        if (!binding || binding.operationId !== OPERATION_ID || binding.proposalRef !== proof.proposalRef
            || proof.restartGeneration !== restartGeneration || !knownProposals.has(proof.proposalRef)) return null;
        if (now() >= proof.expiresAt) return null;
        return operation(record({ proofRefHash: proof.proofRefHash, confirmedAt: proof.confirmedAt }));
    };
    const core = createHeadlessCheckupStatusTransitionServiceV1({
        now,
        nextRef,
        digestCommand: storage.digestCommand,
        readSnapshot: storage.readSnapshot,
        consumeConfirmation,
        commit: storage.commit,
    });
    const service = record({
        preview(input: unknown) {
            const preview = core.preview(input);
            knownProposals.add(preview.proposalRef);
            return preview;
        },
        confirm(proposalRef: unknown, proof: unknown) { return core.confirm(proposalRef, proof); },
        dispose() {
            if (disposed) return;
            disposed = true; knownProposals.clear(); storage.dispose(); core.dispose();
        },
    });
    const trustedController = record({
        issueSelectedCheckupRef(): string {
            if (disposed) throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
            try { return storage.issueSelectedCheckupRef(); } catch (error) {
                const code = error instanceof Error ? error.message : 'operation_unavailable';
                if (['resource_unavailable', 'session_unavailable', 'role_unavailable', 'restart_changed']
                    .includes(code)) throw new HeadlessCheckupStatusTransitionV1Error(code as 'resource_unavailable');
                throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
            }
        },
        issueConfirmationProof(proposalRef: unknown): object {
            if (disposed || typeof proposalRef !== 'string' || !PROPOSAL_REF.test(proposalRef)
                || !knownProposals.has(proposalRef)) throw new HeadlessCheckupStatusTransitionV1Error('confirmation_required');
            const issuedAt = now(), expiresAt = issuedAt + PROOF_TTL_MS;
            if (!Number.isSafeInteger(expiresAt)) throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
            const secret = randomBytes(32).toString('hex'), proof = Object.freeze(Object.create(null));
            proofs.set(proof, { proposalRef, proofRefHash: digest(PROOF_DIGEST_DOMAIN, secret), confirmedAt: issuedAt, expiresAt,
                restartGeneration, state: 'available' });
            return proof;
        },
        restart(): void {
            if (disposed || restartGeneration >= Number.MAX_SAFE_INTEGER) {
                throw new HeadlessCheckupStatusTransitionV1Error('operation_unavailable');
            }
            restartGeneration += 1; knownProposals.clear(); storage.restart();
        },
    });
    return record({ service, trustedController });
}
