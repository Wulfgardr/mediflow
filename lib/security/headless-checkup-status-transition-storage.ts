/* @Codex */
import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';

import {
    HEADLESS_CHECKUP_STATUS_OPERATION_V1 as OPERATION_ID,
    type HeadlessCheckupStatusReceiptV1,
} from '../../packages/aip/src/checkup-status-transition';
import { dbServer, runDbServerImmediateTransaction } from '../db-server';

const SOURCE_KEYS = ['readBrokerScope'] as const;
const SCOPE_KEYS = ['status', 'actorRef', 'patientId', 'ambulatoryId', 'checkupId', 'generation',
    'revocationGeneration', 'selectionEpoch'] as const;
const SCOPE_DENIED_KEYS = ['status', 'code'] as const;
const COMMAND_KEYS = ['operationId', 'capabilityId', 'idempotencyKey', 'commandDigest', 'ownerIdentity',
    'resourceIdentity', 'fromStatus', 'targetStatus', 'expectedRevision', 'generation', 'revocationGeneration',
    'selectionEpoch', 'proofRefHash', 'confirmedAt'] as const;
const RECEIPT_KEYS = ['schemaVersion', 'operationId', 'capabilityId', 'outcome', 'denialCode', 'fromStatus',
    'toStatus', 'previousRevision', 'newRevision', 'ownerRefHash', 'resourceRefHash', 'proofRefHash',
    'receiptRefHash', 'generation', 'revocationGeneration', 'selectionEpoch', 'timestamp'] as const;
const AUDIT_KEYS = ['schemaVersion', 'commandDigest', 'idempotencyKeyHash', 'receipt'] as const;
const AUDIT_ROW_KEYS = ['schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'metadata', 'createdAt'] as const;
const CHECKUP_REF = /^hcsr_[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^hcsi_[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SCOPE_DENIALS = new Set(['scope_changed', 'session_unavailable', 'role_unavailable', 'restart_changed']);
const COMMAND_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.command-digest.v1';
const OWNER_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.owner-ref.v1';
const RESOURCE_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.resource-ref.v1';
const IDEMPOTENCY_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.idempotency-ref.v1';
const AUDIT_ID_DOMAIN = 'mediflow.headless.checkup-status.audit-id.v1';
const RECEIPT_DIGEST_DOMAIN = 'mediflow.headless.checkup-status.receipt-ref.v1';
const isProxy = types.isProxy, isPromise = types.isPromise;

type TargetStatus = 'completed' | 'cancelled';
type Scope = Readonly<{ actorRef: string; patientId: string; ambulatoryId: string; checkupId: string;
    generation: number; revocationGeneration: number; selectionEpoch: number }>;
type Resource = { ref: string; identity: object; scope: Scope; ownerRefHash: string; resourceRefHash: string };
type Command = Record<(typeof COMMAND_KEYS)[number], unknown>;

class CommitAbort extends Error {
    constructor(readonly code: 'scope_changed' | 'revision_conflict' | 'transition_unavailable'
        | 'idempotency_conflict' | 'audit_unavailable' | 'commit_unavailable') { super(code); }
}

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
                || (canonical && (descriptor.configurable || descriptor.writable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function integer(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function digest(domain: string, value: string): string {
    return `sha256:${createHash('sha256').update(domain).update('\0').update(value).digest('hex')}`;
}

function commandDigest(canonical: string): string { return digest(COMMAND_DIGEST_DOMAIN, canonical); }

function denied(code: CommitAbort['code'] | 'resource_unavailable' | 'session_unavailable'
    | 'role_unavailable' | 'restart_changed') { return record({ status: 'denied' as const, code }); }

function readCheckup(scope: Scope): { status: string; revision: number } | null {
    const row = dbServer.$client.prepare(`SELECT checkup.status, checkup.version AS revision
        FROM checkups AS checkup
        INNER JOIN patients_to_ambulatories AS membership ON membership.patient_id = checkup.patient_id
            AND membership.ambulatory_id = ?
        INNER JOIN patients AS patient ON patient.id = checkup.patient_id
        INNER JOIN ambulatories AS ambulatory ON ambulatory.id = membership.ambulatory_id
        WHERE checkup.id = ? AND checkup.patient_id = ? AND checkup.deleted_at IS NULL
            AND patient.deleted_at IS NULL AND patient.is_archived = 0 AND ambulatory.id = ? LIMIT 2`)
        .all(scope.ambulatoryId, scope.checkupId, scope.patientId, scope.ambulatoryId) as unknown[];
    if (rowsLength(row) !== 1) return null;
    const value = exactRow(row[0], ['status', 'revision']);
    return value && typeof value.status === 'string' && integer(value.revision, 1)
        ? { status: value.status, revision: value.revision } : null;
}

function rowsLength(value: unknown): number { return Array.isArray(value) ? value.length : -1; }
function exactRow(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== keys.length) return null;
    return keys.every((key, index) => Reflect.ownKeys(value)[index] === key)
        ? Object.assign(Object.create(null), value) as Record<string, unknown> : null;
}

function parseReceipt(value: unknown, command: Command, resource: Resource,
    eventId: string): HeadlessCheckupStatusReceiptV1 | null {
    const receipt = exact(value, RECEIPT_KEYS, false);
    if (!receipt || receipt.schemaVersion !== 'mediflow.patient.checkup.status.transition.receipt.v1'
        || receipt.operationId !== OPERATION_ID || receipt.capabilityId !== OPERATION_ID
        || receipt.outcome !== 'status_transitioned' || receipt.denialCode !== null || receipt.fromStatus !== 'pending'
        || receipt.toStatus !== command.targetStatus || receipt.previousRevision !== command.expectedRevision
        || receipt.newRevision !== (command.expectedRevision as number) + 1
        || receipt.ownerRefHash !== resource.ownerRefHash || receipt.resourceRefHash !== resource.resourceRefHash
        || receipt.proofRefHash !== command.proofRefHash
        || receipt.receiptRefHash !== digest(RECEIPT_DIGEST_DOMAIN, `${eventId}\0${command.commandDigest}`)
        || receipt.generation !== command.generation || receipt.revocationGeneration !== command.revocationGeneration
        || receipt.selectionEpoch !== command.selectionEpoch || !integer(receipt.timestamp, command.confirmedAt as number)) return null;
    return record(Object.fromEntries(RECEIPT_KEYS.map((key) => [key, receipt[key]]))) as HeadlessCheckupStatusReceiptV1;
}

/** Owns the synchronous SQLite CAS and persists the receipt inside its append-only audit event. */
export function createHeadlessCheckupStatusTransitionStorageV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || typeof sources.readBrokerScope !== 'function') throw new Error('checkup status storage unavailable');
    const readBrokerScope = sources.readBrokerScope as () => unknown;
    const ownerIdentity = Object.freeze(Object.create(null));
    const ownerSecret = randomBytes(32).toString('hex');
    const resourcesByRef = new Map<string, Resource>(), resourcesByIdentity = new WeakMap<object, Resource>();
    let currentResource: Resource | null = null, restartGeneration = 0, disposed = false;

    const readScope = (): Scope | ReturnType<typeof denied> => {
        let candidate: unknown;
        try { candidate = readBrokerScope(); } catch { return denied('session_unavailable'); }
        if (isPromise(candidate)) return denied('session_unavailable');
        const unavailable = exact(candidate, SCOPE_DENIED_KEYS, true);
        if (unavailable?.status === 'denied' && SCOPE_DENIALS.has(String(unavailable.code))) {
            return denied(unavailable.code as 'scope_changed' | 'session_unavailable' | 'role_unavailable' | 'restart_changed');
        }
        const value = exact(candidate, SCOPE_KEYS, true);
        if (!value || value.status !== 'available' || ![value.actorRef, value.patientId, value.ambulatoryId,
            value.checkupId].every(text) || !integer(value.generation, 1) || !integer(value.revocationGeneration)
            || !integer(value.selectionEpoch)) return denied('session_unavailable');
        return record({ actorRef: value.actorRef, patientId: value.patientId, ambulatoryId: value.ambulatoryId,
            checkupId: value.checkupId, generation: value.generation, revocationGeneration: value.revocationGeneration,
            selectionEpoch: value.selectionEpoch }) as Scope;
    };
    const scopeEquals = (left: Scope, right: Scope): boolean => SCOPE_KEYS.slice(1).every((key) => left[key as keyof Scope] === right[key as keyof Scope]);
    const issueSelectedCheckupRef = (): string => {
        if (disposed) throw new Error('checkup status storage unavailable');
        const scope = readScope();
        if ('status' in scope) throw new Error(String(scope.code));
        if (!readCheckup(scope)) throw new Error('resource_unavailable');
        if (currentResource && scopeEquals(currentResource.scope, scope)) return currentResource.ref;
        const secret = randomBytes(32).toString('hex'), ref = `hcsr_${randomBytes(32).toString('hex')}`;
        const resource: Resource = { ref, identity: Object.freeze(Object.create(null)), scope,
            ownerRefHash: digest(OWNER_DIGEST_DOMAIN, `${ownerSecret}\0${scope.actorRef}`),
            resourceRefHash: digest(RESOURCE_DIGEST_DOMAIN, secret) };
        resourcesByRef.set(ref, resource); resourcesByIdentity.set(resource.identity, resource); currentResource = resource;
        return ref;
    };
    const resolveCurrent = (resource: Resource): Scope | ReturnType<typeof denied> => {
        if (disposed) return denied('restart_changed');
        const scope = readScope();
        if ('status' in scope) return scope;
        return scopeEquals(resource.scope, scope) ? scope : denied('scope_changed');
    };
    const readSnapshot = (inputValue: unknown) => {
        const input = exact(inputValue, ['schemaVersion', 'operationId', 'checkupRef', 'targetStatus', 'expectedRevision'], true);
        const resource = input && typeof input.checkupRef === 'string' && CHECKUP_REF.test(input.checkupRef)
            ? resourcesByRef.get(input.checkupRef) : undefined;
        if (!resource) return denied(restartGeneration > 0 ? 'restart_changed' : 'resource_unavailable');
        const scope = resolveCurrent(resource); if ('status' in scope) return scope;
        const row = readCheckup(scope);
        if (!row || !['pending', 'completed', 'cancelled'].includes(row.status)) return denied('resource_unavailable');
        return record({ status: 'available' as const, ownerIdentity, resourceIdentity: resource.identity,
            fromStatus: row.status, revision: row.revision, generation: scope.generation,
            revocationGeneration: scope.revocationGeneration, selectionEpoch: scope.selectionEpoch });
    };

    const lookupReplay = (eventId: string, command: Command, resource: Resource): HeadlessCheckupStatusReceiptV1 | null | false => {
        const row = dbServer.$client.prepare(`SELECT schema_version AS schemaVersion, event_type AS eventType,
            occurred_at AS occurredAt, outcome, actor_type AS actorType, actor_ref AS actorRef,
            subject_type AS subjectType, subject_ref AS subjectRef, source_surface AS sourceSurface,
            request_id AS requestId, redacted_metadata AS metadata, created_at AS createdAt
            FROM audit_events WHERE event_id = ?`).get(eventId);
        if (!row) return null;
        const auditRow = exactRow(row, AUDIT_ROW_KEYS);
        if (!auditRow || typeof auditRow.metadata !== 'string') return false;
        let parsed: unknown; try { parsed = JSON.parse(auditRow.metadata); } catch { return false; }
        const metadata = exact(parsed, AUDIT_KEYS, false);
        if (!metadata || metadata.schemaVersion !== 'mediflow.patient.checkup.status.transition.audit.v1'
            || metadata.commandDigest !== command.commandDigest
            || metadata.idempotencyKeyHash !== digest(IDEMPOTENCY_DIGEST_DOMAIN, command.idempotencyKey as string)) return false;
        const receipt = parseReceipt(metadata.receipt, command, resource, eventId);
        const seconds = receipt ? Math.floor(receipt.timestamp / 1_000) : -1;
        if (!receipt || auditRow.schemaVersion !== 1 || auditRow.eventType !== 'checkup.updated'
            || auditRow.occurredAt !== seconds || auditRow.outcome !== 'success' || auditRow.actorType !== 'user'
            || auditRow.actorRef !== resource.ownerRefHash || auditRow.subjectType !== 'checkup'
            || auditRow.subjectRef !== resource.resourceRefHash || auditRow.sourceSurface !== 'api'
            || auditRow.requestId !== null || auditRow.createdAt !== seconds) return false;
        return receipt;
    };
    const commit = (commandValue: unknown) => {
        const command = exact(commandValue, COMMAND_KEYS, true);
        const resource = command && typeof command.resourceIdentity === 'object' && command.resourceIdentity
            ? resourcesByIdentity.get(command.resourceIdentity) : undefined;
        if (!command || !resource || command.ownerIdentity !== ownerIdentity || command.operationId !== OPERATION_ID
            || command.capabilityId !== OPERATION_ID || command.fromStatus !== 'pending'
            || (command.targetStatus !== 'completed' && command.targetStatus !== 'cancelled')
            || !integer(command.expectedRevision, 1) || command.expectedRevision >= Number.MAX_SAFE_INTEGER
            || !integer(command.generation, 1)
            || !integer(command.revocationGeneration) || !integer(command.selectionEpoch)
            || !integer(command.confirmedAt) || typeof command.idempotencyKey !== 'string'
            || !IDEMPOTENCY_KEY.test(command.idempotencyKey) || typeof command.commandDigest !== 'string'
            || !DIGEST.test(command.commandDigest) || typeof command.proofRefHash !== 'string'
            || !DIGEST.test(command.proofRefHash)) return denied('commit_unavailable');
        const canonical = [OPERATION_ID, resource.ref, command.targetStatus, command.expectedRevision,
            command.generation, command.revocationGeneration, command.selectionEpoch].join('\0');
        if (command.commandDigest !== commandDigest(canonical)) return denied('commit_unavailable');
        const eventId = `hcsa_${digest(AUDIT_ID_DOMAIN, command.idempotencyKey).slice(7)}`;
        try {
            return runDbServerImmediateTransaction(() => {
                const replay = lookupReplay(eventId, command as Command, resource);
                if (replay === false) throw new CommitAbort('idempotency_conflict');
                if (replay) return record({ status: 'committed' as const, receipt: replay });
                const scope = resolveCurrent(resource); if ('status' in scope) throw new CommitAbort('scope_changed');
                const row = readCheckup(scope); if (!row) throw new CommitAbort('scope_changed');
                if (row.revision !== command.expectedRevision) throw new CommitAbort('revision_conflict');
                if (row.status !== 'pending') throw new CommitAbort('transition_unavailable');
                const receipt = record({ schemaVersion: 'mediflow.patient.checkup.status.transition.receipt.v1' as const,
                    operationId: OPERATION_ID, capabilityId: OPERATION_ID, outcome: 'status_transitioned' as const,
                    denialCode: null, fromStatus: 'pending' as const, toStatus: command.targetStatus as TargetStatus,
                    previousRevision: command.expectedRevision as number, newRevision: (command.expectedRevision as number) + 1,
                    ownerRefHash: resource.ownerRefHash, resourceRefHash: resource.resourceRefHash,
                    proofRefHash: command.proofRefHash as string,
                    receiptRefHash: digest(RECEIPT_DIGEST_DOMAIN, `${eventId}\0${command.commandDigest}`),
                    generation: command.generation as number, revocationGeneration: command.revocationGeneration as number,
                    selectionEpoch: command.selectionEpoch as number, timestamp: command.confirmedAt as number });
                const seconds = Math.floor((command.confirmedAt as number) / 1_000);
                const updated = dbServer.$client.prepare(`UPDATE checkups SET status = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND patient_id = ? AND status = 'pending' AND version = ? AND deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM patients_to_ambulatories WHERE patient_id = ? AND ambulatory_id = ?)`)
                    .run(command.targetStatus, seconds, scope.checkupId, scope.patientId, command.expectedRevision,
                        scope.patientId, scope.ambulatoryId);
                if (updated.changes !== 1) throw new CommitAbort('revision_conflict');
                const metadata = JSON.stringify({ schemaVersion: 'mediflow.patient.checkup.status.transition.audit.v1',
                    commandDigest: command.commandDigest,
                    idempotencyKeyHash: digest(IDEMPOTENCY_DIGEST_DOMAIN, command.idempotencyKey as string), receipt });
                try {
                    dbServer.$client.prepare(`INSERT INTO audit_events (event_id, schema_version, event_type, occurred_at,
                        outcome, actor_type, actor_ref, subject_type, subject_ref, source_surface, request_id,
                        redacted_metadata, created_at) VALUES (?, 1, 'checkup.updated', ?, 'success', 'user', ?,
                        'checkup', ?, 'api', NULL, ?, ?)`).run(eventId, seconds, resource.ownerRefHash,
                        resource.resourceRefHash, metadata, seconds);
                } catch { throw new CommitAbort('audit_unavailable'); }
                const reread = lookupReplay(eventId, command as Command, resource);
                if (!reread) throw new CommitAbort('commit_unavailable');
                return record({ status: 'committed' as const, receipt: reread });
            });
        } catch (error) { return denied(error instanceof CommitAbort ? error.code : 'commit_unavailable'); }
    };
    const restart = (): void => { restartGeneration += 1; resourcesByRef.clear(); currentResource = null; };
    const dispose = (): void => { disposed = true; resourcesByRef.clear(); currentResource = null; };
    return record({ issueSelectedCheckupRef, digestCommand: commandDigest, readSnapshot, commit, restart, dispose });
}
