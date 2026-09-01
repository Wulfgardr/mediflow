/* @Codex */
import { types } from 'node:util';

export const HEADLESS_CHECKUP_STATUS_OPERATION_V1 = 'mediflow.patient.checkup.status.transition.v1' as const;
export const HEADLESS_CHECKUP_STATUS_PREVIEW_TTL_MS_V1 = 120_000 as const;

export type HeadlessCheckupStatusTransitionV1ErrorCode = 'invalid_input' | 'operation_unavailable'
    | 'resource_unavailable' | 'scope_changed' | 'session_unavailable' | 'role_unavailable'
    | 'preview_expired' | 'confirmation_required' | 'proof_unavailable' | 'proof_replayed'
    | 'revision_conflict' | 'transition_unavailable' | 'idempotency_conflict'
    | 'audit_unavailable' | 'commit_unavailable' | 'restart_changed';

export class HeadlessCheckupStatusTransitionV1Error extends Error {
    constructor(public readonly code: HeadlessCheckupStatusTransitionV1ErrorCode) {
        super(`Headless checkup status transition rejected: ${code}`);
        this.name = 'HeadlessCheckupStatusTransitionV1Error';
    }
}

export type HeadlessCheckupStatusPreviewV1 = Readonly<{
    schemaVersion: 'mediflow.patient.checkup.status.transition.preview.v1';
    operationId: typeof HEADLESS_CHECKUP_STATUS_OPERATION_V1;
    outcome: 'preview_required'; proposalRef: string; expiresAt: number }>;
export type HeadlessCheckupStatusReceiptV1 = Readonly<{
    schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1';
    operationId: typeof HEADLESS_CHECKUP_STATUS_OPERATION_V1;
    capabilityId: typeof HEADLESS_CHECKUP_STATUS_OPERATION_V1;
    outcome: 'status_transitioned'; denialCode: null; fromStatus: 'pending'; toStatus: 'completed' | 'cancelled';
    previousRevision: number; newRevision: number;
    ownerRefHash: string; resourceRefHash: string; proofRefHash: string; receiptRefHash: string;
    generation: number; revocationGeneration: number; selectionEpoch: number; timestamp: number }>;

type TargetStatus = 'completed' | 'cancelled';
type Input = Readonly<{ schemaVersion: string; operationId: string; checkupRef: string;
    targetStatus: TargetStatus; expectedRevision: number }>;
type Snapshot = Readonly<{ ownerIdentity: object; resourceIdentity: object;
    fromStatus: 'pending' | 'completed' | 'cancelled'; revision: number; generation: number;
    revocationGeneration: number; selectionEpoch: number }>;
type Proposal = { input: Input; snapshot: Snapshot; digest: string; proposalRef: string;
    idempotencyKey: string; expiresAt: number; preview: HeadlessCheckupStatusPreviewV1;
    state: 'current' | 'pending' | 'committed' | 'terminal'; receipt: HeadlessCheckupStatusReceiptV1 | null };

const SOURCE_KEYS = ['now', 'nextRef', 'digestCommand', 'readSnapshot', 'consumeConfirmation', 'commit'] as const;
const INPUT_KEYS = ['schemaVersion', 'operationId', 'checkupRef', 'targetStatus', 'expectedRevision'] as const;
const SNAPSHOT_KEYS = ['status', 'ownerIdentity', 'resourceIdentity', 'fromStatus', 'revision',
    'generation', 'revocationGeneration', 'selectionEpoch'] as const;
const DENIED_KEYS = ['status', 'code'] as const;
const PROOF_KEYS = ['proofRefHash', 'confirmedAt'] as const;
const COMMIT_RESULT_KEYS = ['status', 'receipt'] as const;
const COMMIT_DENIED_KEYS = ['status', 'code'] as const;
const RECEIPT_KEYS = ['schemaVersion', 'operationId', 'capabilityId', 'outcome', 'denialCode',
    'fromStatus', 'toStatus', 'previousRevision', 'newRevision', 'ownerRefHash', 'resourceRefHash',
    'proofRefHash', 'receiptRefHash', 'generation', 'revocationGeneration', 'selectionEpoch', 'timestamp'] as const;
const CHECKUP_REF = /^hcsr_[0-9a-f]{64}$/u;
const PROPOSAL_REF = /^hcsp_[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^hcsi_[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_DENIALS = new Set<HeadlessCheckupStatusTransitionV1ErrorCode>([
    'resource_unavailable', 'scope_changed', 'session_unavailable', 'role_unavailable', 'restart_changed',
]);
const COMMIT_DENIALS = new Set<HeadlessCheckupStatusTransitionV1ErrorCode>([
    'idempotency_conflict', 'audit_unavailable', 'commit_unavailable', 'revision_conflict',
    'transition_unavailable', 'scope_changed', 'preview_expired',
]);
const objectAssign = Object.assign, objectCreate = Object.create, objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf, objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys, reflectApply = Reflect.apply;
const regexpTest = RegExp.prototype.test;
const numberIsSafeInteger = Number.isSafeInteger, isProxy = types.isProxy, isPromise = types.isPromise;
const promiseThen = Promise.prototype.then;

function fail(code: HeadlessCheckupStatusTransitionV1ErrorCode): never { throw new HeadlessCheckupStatusTransitionV1Error(code); }
function record<T extends object>(value: T): Readonly<T> { return objectFreeze(objectAssign(objectCreate(null), value)) as Readonly<T>; }
function exact(value: unknown, keys: readonly string[], canonical = true): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)) return null;
        const prototype = objectGetPrototypeOf(value);
        if ((canonical && (prototype !== null || !objectIsFrozen(value)))
            || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
        const actual = reflectOwnKeys(value);
        if (actual.length !== keys.length) return null;
        const output = objectCreate(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (actual[index] !== key) return null;
            const descriptor = objectGetOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || (canonical && (descriptor.configurable || descriptor.writable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}
function integer(value: unknown, minimum = 0): value is number {
    return numberIsSafeInteger(value) && (value as number) >= minimum;
}
function opaque(value: unknown): value is object {
    try {
        return typeof value === 'object' && value !== null && !isProxy(value)
            && objectGetPrototypeOf(value) === null && objectIsFrozen(value) && reflectOwnKeys(value).length === 0;
    } catch { return false; }
}
function discardPromise(value: unknown): boolean {
    try {
        if (!isPromise(value)) return false;
        reflectApply(promiseThen, value, [() => undefined, () => undefined]);
        return true;
    } catch { return true; }
}
function matches(pattern: RegExp, value: unknown): value is string {
    return typeof value === 'string' && reflectApply(regexpTest, pattern, [value]);
}

/** Creates the DB-free, operation-specific preview and confirmation core from ADR 0116. */
export function createHeadlessCheckupStatusTransitionServiceV1(sourcesValue: unknown) {
    const source = exact(sourcesValue, SOURCE_KEYS, false);
    if (!source || SOURCE_KEYS.some((key) => typeof source[key] !== 'function')) return fail('operation_unavailable');
    const nowSource = source.now as () => unknown;
    const nextRefSource = source.nextRef as (kind: 'proposal' | 'idempotency') => unknown;
    const digestSource = source.digestCommand as (canonical: string) => unknown;
    const readSource = source.readSnapshot as (input: Input) => unknown;
    const proofSource = source.consumeConfirmation as (proof: object, binding: object,
        operation: (proofBinding: unknown) => unknown) => unknown;
    const commitSource = source.commit as (command: object) => unknown;
    const proposals = new Map<string, Proposal>(), issuedRefs = new Set<string>();
    const active = new WeakMap<object, WeakMap<object, Proposal>>();
    let disposed = false, lastNow = -1;

    const now = (): number => {
        let value: unknown;
        try { value = nowSource(); } catch { return fail('operation_unavailable'); }
        if (discardPromise(value) || !integer(value) || value < lastNow) return fail('operation_unavailable');
        lastNow = value;
        return value;
    };
    const nextRef = (kind: 'proposal' | 'idempotency'): string => {
        let value: unknown;
        try { value = nextRefSource(kind); } catch { return fail('operation_unavailable'); }
        const pattern = kind === 'proposal' ? PROPOSAL_REF : IDEMPOTENCY_KEY;
        if (discardPromise(value) || !matches(pattern, value) || issuedRefs.has(value)) return fail('operation_unavailable');
        issuedRefs.add(value);
        return value;
    };
    const parseInput = (candidate: unknown): Input => {
        const value = exact(candidate, INPUT_KEYS, false);
        if (!value || value.schemaVersion !== 'mediflow.patient.checkup.status.transition.input.v1'
            || value.operationId !== HEADLESS_CHECKUP_STATUS_OPERATION_V1 || !matches(CHECKUP_REF, value.checkupRef)
            || (value.targetStatus !== 'completed' && value.targetStatus !== 'cancelled')
            || !integer(value.expectedRevision, 1) || value.expectedRevision >= Number.MAX_SAFE_INTEGER) {
            return fail('invalid_input');
        }
        return record({ schemaVersion: value.schemaVersion, operationId: value.operationId,
            checkupRef: value.checkupRef, targetStatus: value.targetStatus, expectedRevision: value.expectedRevision }) as Input;
    };
    const read = (command: Input): Snapshot => {
        let candidate: unknown;
        try { candidate = readSource(command); } catch { return fail('operation_unavailable'); }
        if (discardPromise(candidate)) return fail('operation_unavailable');
        const denied = exact(candidate, DENIED_KEYS);
        if (denied?.status === 'denied' && typeof denied.code === 'string'
            && SNAPSHOT_DENIALS.has(denied.code as HeadlessCheckupStatusTransitionV1ErrorCode)) {
            return fail(denied.code as HeadlessCheckupStatusTransitionV1ErrorCode);
        }
        const value = exact(candidate, SNAPSHOT_KEYS);
        if (!value || value.status !== 'available' || !opaque(value.ownerIdentity) || !opaque(value.resourceIdentity)
            || !['pending', 'completed', 'cancelled'].includes(value.fromStatus as string)
            || !integer(value.revision, 1) || !integer(value.generation, 1)
            || !integer(value.revocationGeneration) || !integer(value.selectionEpoch)) return fail('operation_unavailable');
        return record({ ownerIdentity: value.ownerIdentity, resourceIdentity: value.resourceIdentity,
            fromStatus: value.fromStatus, revision: value.revision, generation: value.generation,
            revocationGeneration: value.revocationGeneration, selectionEpoch: value.selectionEpoch }) as Snapshot;
    };
    const digest = (command: Input, snapshot: Snapshot): string => {
        const canonical = [command.operationId, command.checkupRef, command.targetStatus, command.expectedRevision,
            snapshot.generation, snapshot.revocationGeneration, snapshot.selectionEpoch].join('\0');
        let value: unknown;
        try { value = digestSource(canonical); } catch { return fail('operation_unavailable'); }
        if (discardPromise(value) || !matches(DIGEST, value)) return fail('operation_unavailable');
        return value;
    };
    const detach = (proposal: Proposal): void => {
        const byResource = active.get(proposal.snapshot.ownerIdentity);
        if (byResource?.get(proposal.snapshot.resourceIdentity) === proposal) byResource.delete(proposal.snapshot.resourceIdentity);
    };
    const reject = (proposal: Proposal, code: HeadlessCheckupStatusTransitionV1ErrorCode): never => {
        proposal.state = 'terminal'; detach(proposal); return fail(code);
    };
    const parseReceipt = (candidate: unknown, proposal: Proposal, proofRefHash: string,
        confirmedAt: number): HeadlessCheckupStatusReceiptV1 => {
        const value = exact(candidate, RECEIPT_KEYS);
        if (!value || value.schemaVersion !== 'mediflow.patient.checkup.status.transition.receipt.v1'
            || value.operationId !== HEADLESS_CHECKUP_STATUS_OPERATION_V1
            || value.capabilityId !== HEADLESS_CHECKUP_STATUS_OPERATION_V1 || value.outcome !== 'status_transitioned'
            || value.denialCode !== null || value.fromStatus !== 'pending' || value.toStatus !== proposal.input.targetStatus
            || value.previousRevision !== proposal.input.expectedRevision || value.newRevision !== proposal.input.expectedRevision + 1
            || ![value.ownerRefHash, value.resourceRefHash, value.proofRefHash, value.receiptRefHash]
                .every((item) => matches(DIGEST, item)) || value.proofRefHash !== proofRefHash
            || value.generation !== proposal.snapshot.generation
            || value.revocationGeneration !== proposal.snapshot.revocationGeneration
            || value.selectionEpoch !== proposal.snapshot.selectionEpoch
            || !integer(value.timestamp, confirmedAt)) return reject(proposal, 'commit_unavailable');
        return candidate as HeadlessCheckupStatusReceiptV1;
    };

    const preview = (candidate: unknown): HeadlessCheckupStatusPreviewV1 => {
        if (disposed) return fail('operation_unavailable');
        const command = parseInput(candidate), timestamp = now(), snapshot = read(command);
        if (disposed) return fail('operation_unavailable');
        if (snapshot.fromStatus !== 'pending') return fail('transition_unavailable');
        if (snapshot.revision !== command.expectedRevision) return fail('revision_conflict');
        const commandDigest = digest(command, snapshot);
        if (disposed) return fail('operation_unavailable');
        let byResource = active.get(snapshot.ownerIdentity);
        if (!byResource) { byResource = new WeakMap(); active.set(snapshot.ownerIdentity, byResource); }
        const previous = byResource.get(snapshot.resourceIdentity);
        if (previous && previous.state === 'current' && timestamp >= previous.expiresAt) {
            previous.state = 'terminal'; byResource.delete(snapshot.resourceIdentity);
        } else if (previous) {
            if (previous.state === 'current' && previous.digest === commandDigest
                && previous.input.checkupRef === command.checkupRef
                && previous.input.targetStatus === command.targetStatus
                && previous.input.expectedRevision === command.expectedRevision) return previous.preview;
            return fail('operation_unavailable');
        }
        const expiresAt = timestamp + HEADLESS_CHECKUP_STATUS_PREVIEW_TTL_MS_V1;
        if (!integer(expiresAt, timestamp + 1)) return fail('operation_unavailable');
        const proposalRef = nextRef('proposal'), idempotencyKey = nextRef('idempotency');
        if (disposed) return fail('operation_unavailable');
        const result = record({ schemaVersion: 'mediflow.patient.checkup.status.transition.preview.v1' as const,
            operationId: HEADLESS_CHECKUP_STATUS_OPERATION_V1, outcome: 'preview_required' as const,
            proposalRef, expiresAt });
        const proposal: Proposal = { input: command, snapshot, digest: commandDigest, proposalRef,
            idempotencyKey, expiresAt, preview: result, state: 'current', receipt: null };
        proposals.set(proposalRef, proposal); byResource.set(snapshot.resourceIdentity, proposal);
        return result;
    };

    const confirm = (proposalRefValue: unknown, proofValue: unknown): HeadlessCheckupStatusReceiptV1 => {
        if (disposed) return fail('operation_unavailable');
        if (!matches(PROPOSAL_REF, proposalRefValue)) return fail('invalid_input');
        if (proofValue === null || proofValue === undefined) return fail('confirmation_required');
        if (!opaque(proofValue)) return fail('proof_unavailable');
        const proposal = proposals.get(proposalRefValue);
        if (!proposal) return fail('restart_changed');
        if (proposal.state === 'committed' && proposal.receipt) return proposal.receipt;
        if (proposal.state !== 'current') return fail('proof_replayed');
        const timestamp = now();
        if (timestamp >= proposal.expiresAt) return reject(proposal, 'preview_expired');
        let current: Snapshot;
        try { current = read(proposal.input); } catch (error) {
            return reject(proposal, error instanceof HeadlessCheckupStatusTransitionV1Error
                ? error.code : 'operation_unavailable');
        }
        if (current.ownerIdentity !== proposal.snapshot.ownerIdentity) return reject(proposal, 'scope_changed');
        if (current.resourceIdentity !== proposal.snapshot.resourceIdentity) return reject(proposal, 'resource_unavailable');
        if (current.generation !== proposal.snapshot.generation
            || current.revocationGeneration !== proposal.snapshot.revocationGeneration
            || current.selectionEpoch !== proposal.snapshot.selectionEpoch) return reject(proposal, 'scope_changed');
        if (current.revision !== proposal.input.expectedRevision) return reject(proposal, 'revision_conflict');
        if (current.fromStatus !== 'pending') return reject(proposal, 'transition_unavailable');
        proposal.state = 'pending';
        const binding = record({ operationId: HEADLESS_CHECKUP_STATUS_OPERATION_V1,
            proposalRef: proposal.proposalRef, commandDigest: proposal.digest,
            ownerIdentity: proposal.snapshot.ownerIdentity, resourceIdentity: proposal.snapshot.resourceIdentity,
            targetStatus: proposal.input.targetStatus, expectedRevision: proposal.input.expectedRevision,
            generation: proposal.snapshot.generation, revocationGeneration: proposal.snapshot.revocationGeneration,
            selectionEpoch: proposal.snapshot.selectionEpoch, expiresAt: proposal.expiresAt });
        const accepted = objectFreeze(objectCreate(null));
        let proofBinding: Record<string, unknown> | null = null, invoked = false, duplicated = false, closed = false;
        const operation = (candidate: unknown): unknown => {
            if (closed || invoked) { duplicated = true; return null; }
            invoked = true; proofBinding = exact(candidate, PROOF_KEYS); return proofBinding ? accepted : null;
        };
        let proofResult: unknown;
        try { proofResult = proofSource(proofValue, binding, operation); } catch { return reject(proposal, 'proof_unavailable'); }
        closed = true;
        const confirmed = proofBinding as Record<string, unknown> | null;
        if (disposed || proposal.state !== 'pending') return reject(proposal, 'operation_unavailable');
        if (discardPromise(proofResult) || !invoked || duplicated || proofResult !== accepted || !confirmed
            || !matches(DIGEST, confirmed.proofRefHash) || !integer(confirmed.confirmedAt)
            || confirmed.confirmedAt > timestamp) return reject(proposal, 'proof_unavailable');
        const command = record({ operationId: HEADLESS_CHECKUP_STATUS_OPERATION_V1,
            capabilityId: HEADLESS_CHECKUP_STATUS_OPERATION_V1, idempotencyKey: proposal.idempotencyKey,
            commandDigest: proposal.digest, ownerIdentity: proposal.snapshot.ownerIdentity,
            resourceIdentity: proposal.snapshot.resourceIdentity, fromStatus: 'pending' as const,
            targetStatus: proposal.input.targetStatus, expectedRevision: proposal.input.expectedRevision,
            generation: proposal.snapshot.generation, revocationGeneration: proposal.snapshot.revocationGeneration,
            selectionEpoch: proposal.snapshot.selectionEpoch, expiresAt: proposal.expiresAt,
            proofRefHash: confirmed.proofRefHash,
            confirmedAt: confirmed.confirmedAt });
        let candidate: unknown;
        try { candidate = commitSource(command); } catch { return reject(proposal, 'commit_unavailable'); }
        if (disposed || proposal.state !== 'pending') return reject(proposal, 'operation_unavailable');
        if (discardPromise(candidate)) return reject(proposal, 'commit_unavailable');
        const denied = exact(candidate, COMMIT_DENIED_KEYS);
        if (denied?.status === 'denied' && typeof denied.code === 'string'
            && COMMIT_DENIALS.has(denied.code as HeadlessCheckupStatusTransitionV1ErrorCode)) {
            return reject(proposal, denied.code as HeadlessCheckupStatusTransitionV1ErrorCode);
        }
        const committed = exact(candidate, COMMIT_RESULT_KEYS);
        if (committed?.status !== 'committed') return reject(proposal, 'commit_unavailable');
        const receipt = parseReceipt(committed.receipt, proposal, confirmed.proofRefHash as string,
            confirmed.confirmedAt as number);
        proposal.receipt = receipt; proposal.state = 'committed'; detach(proposal);
        return receipt;
    };
    const dispose = (): void => { disposed = true; for (const proposal of proposals.values()) proposal.state = 'terminal'; proposals.clear(); };
    return record({ preview, confirm, dispose });
}
