/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { getTableName } from 'drizzle-orm';

import {
    dbServer,
    hasCanonicalHeadlessSoapEntryCommitSchema,
    runDbServerImmediateTransaction,
} from '../db-server';
import {
    auditEvents,
    entries,
    headlessSoapEntryCommits,
} from '../schema';
import {
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN as RECEIPT_DIGEST_DOMAIN,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS as RECEIPT_KEYS,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID as OPERATION_ID,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME as RECEIPT_OUTCOME,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA as RECEIPT_SCHEMA,
    snapshotClinicianSoapEntryCommitReceipt,
    type ClinicianSoapEntryCommitReceiptV1,
} from '../headless/clinician-soap-entry-commit-receipt';
import { parseSeal, type ParsedSeal } from '../headless/clinician-soap-entry-seal-codec-internal';
import {
    createHeadlessSoapAuthorizationLineage,
    type HeadlessSoapAuthorizationLineageV1,
} from './headless-soap-authorization-lineage';
import {
    HeadlessSoapEntryCommitOwnerError,
    type HeadlessSoapEntryCommitLookupResultV1,
    type HeadlessSoapEntryCommitOwnerV1,
    type HeadlessSoapEntryCommitPortDenialCode,
    type HeadlessSoapEntryCommitPortResultV1,
    type HeadlessSoapEntryReplayKeyV1,
} from './headless-soap-entry-commit-application-service';
import type { HeadlessSoapBoundCommandV1 } from './headless-soap-command-binding-lifecycle';
import { validateHeadlessSoapEntryCommitSemanticChain } from './headless-soap-entry-commit-semantic-validator';
import type { ServerSessionSelectionCommitBindingV1 } from './server-session-projection-owner';

const BINDING_SCHEMA = 'mediflow.headless.soap-entry-commit-binding.v1' as const;
const ENTRY_SNAPSHOT_SCHEMA = 'mediflow.headless.soap-entry-record.v1' as const;
const AUDIT_METADATA_SCHEMA = 'mediflow.headless.soap-entry-commit-audit-metadata.v1' as const;
const BINDING_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-binding-digest.v1';
const ENTRY_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-entry-digest.v1';
const AUDIT_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-audit-digest.v1';
const ENTRY_ID_DOMAIN = 'mediflow.headless.soap-entry-id.v1';
const AUDIT_ID_DOMAIN = 'mediflow.headless.soap-entry-audit-id.v1';
const RECEIPT_REF_DOMAIN = 'mediflow.headless.soap-entry-receipt-ref.v1';
const PATIENT_ID_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-patient-id-digest.v1';
const AMBULATORY_ID_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-ambulatory-id-digest.v1';
const ACTOR_REF_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-actor-ref.v1';

const COMMAND_KEYS = ['schema', 'commandId', 'approvalRef', 'idempotencyKey', 'authorizationProofDigest',
    'lineage', 'sealBundle'] as const;
const BINDING_KEYS = ['patientId', 'ambulatoryId', 'patientVersion'] as const;
const REPLAY_KEYS = ['approvalRef', 'idempotencyKey', 'authorizationProofDigest'] as const;
const BINDING_SNAPSHOT_KEYS = ['schema', 'operationId', 'commandId', 'approvalRef', 'idempotencyKey',
    'authorizationProofDigest', 'webSessionId', 'webSessionCreatedAt', 'webSessionExpiresAt', 'principalRef', 'actorRef',
    'attestationRef', 'attestationVersion', 'activeRoleRevocationGeneration', 'activeRolePolicyVersion',
    'parentContractVersion', 'parentGeneration', 'parentRevocationGeneration', 'childContractVersion', 'childGeneration',
    'childRevocationGeneration', 'childExpiresAt', 'leaseContractVersion', 'leaseGeneration', 'leaseRevocationGeneration',
    'sessionRef', 'patientRef', 'ambulatoryRef', 'leaseRef', 'selectionEpoch', 'selectionExpiresAt', 'patientVersion',
    'action', 'purpose', 'proposalRevision', 'proposalExpiresAt', 'payloadDigest', 'sealDigest', 'policyDigest',
    'patientIdDigest', 'ambulatoryIdDigest'] as const;
const ENTRY_SNAPSHOT_KEYS = ['schema', 'entryId', 'patientIdDigest', 'type', 'title', 'date', 'content', 'setting',
    'metadata', 'attachments', 'deletedAt', 'deletionReason', 'version', 'createdAt', 'updatedAt'] as const;
const AUDIT_SNAPSHOT_KEYS = ['eventId', 'schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata', 'createdAt'] as const;
const LEDGER_ROW_KEYS = ['idempotencyKey', 'approvalRef', 'authorizationProofDigest', 'commandId', 'entryId',
    'auditEventId', 'receiptRef', 'bindingSnapshot', 'bindingDigest', 'entryDigest', 'auditSnapshot', 'auditDigest',
    'receiptSnapshot', 'receiptDigest', 'committedAt'] as const;
const ENTRY_ROW_KEYS = ['id', 'patientId', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'attachments',
    'deletedAt', 'deletionReason', 'version', 'createdAt', 'updatedAt'] as const;
const AUDIT_ROW_KEYS = AUDIT_SNAPSHOT_KEYS;

const COMMAND_ID = /^hsac_[0-9a-f]{64}$/u;
const APPROVAL_REF = /^hsaa_[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^hsai_[0-9a-f]{64}$/u;
const ENTRY_REF = /^hsei_[0-9a-f]{64}$/u;
const AUDIT_REF = /^hsea_[0-9a-f]{64}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const ACTOR_REF = /^hsa_[0-9a-f]{64}$/u;
const isProxy = types.isProxy;
const client = dbServer.$client;
const prepare = client.prepare.bind(client);
const entryTable = getTableName(entries);
const auditTable = getTableName(auditEvents);
const ledgerTable = getTableName(headlessSoapEntryCommits);

export type HeadlessSoapEntryCommitReceiptV1 = ClinicianSoapEntryCommitReceiptV1;

type ParsedCommand = Readonly<{
    value: HeadlessSoapBoundCommandV1;
    lineage: HeadlessSoapAuthorizationLineageV1;
    seal: ParsedSeal;
}>;
type LedgerRow = Record<(typeof LEDGER_ROW_KEYS)[number], unknown>;

class CommitAbort extends Error {
    constructor(readonly code: HeadlessSoapEntryCommitPortDenialCode) {
        super(code);
        this.name = 'CommitAbort';
    }
}

function record<T extends object>(source: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), source)) as Readonly<T>;
}

function exactFrozen(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)
            || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length) return null;
        const output = Object.create(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (ownKeys[index] !== key) return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
                || descriptor.writable || descriptor.configurable) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function exactRow(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || isProxy(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length) return null;
        const output = Object.create(null) as Record<string, unknown>;
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            if (ownKeys[index] !== key) return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function exactSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value) as unknown;
        const exact = exactRow(parsed, keys);
        return exact && JSON.stringify(parsed) === value ? exact : null;
    } catch { return null; }
}

function safeInteger(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.test(value);
}

function digest(domain: string, payload: string): string {
    return createHash('sha256').update(domain, 'utf8').update('\0', 'utf8').update(payload, 'utf8').digest('hex');
}

function identifier(prefix: 'hsei_' | 'hsea_' | 'hser_', domain: string, commandId: string): string {
    return `${prefix}${digest(domain, commandId)}`;
}

function canonicalJSON(value: object): string { return JSON.stringify(value); }

function parseCommand(value: unknown): ParsedCommand | null {
    const source = exactFrozen(value, COMMAND_KEYS);
    if (!source || source.schema !== 'mediflow.headless.soap-bound-command.v1'
        || !matches(source.commandId, COMMAND_ID) || !matches(source.approvalRef, APPROVAL_REF)
        || !matches(source.idempotencyKey, IDEMPOTENCY_KEY)
        || !matches(source.authorizationProofDigest, HASH)) return null;
    const lineage = createHeadlessSoapAuthorizationLineage(source.lineage);
    const seal = parseSeal(source.sealBundle);
    if (!lineage || !seal || lineage.payloadDigest.sha256.hex !== seal.payloadDigest.sha256.hex
        || lineage.sealDigest.sha256.hex !== seal.sealDigest.sha256.hex) return null;
    return record({ value: value as HeadlessSoapBoundCommandV1, lineage, seal });
}

function parseBinding(value: unknown, patientVersion: number): ServerSessionSelectionCommitBindingV1 | null {
    const source = exactFrozen(value, BINDING_KEYS);
    if (!source || !text(source.patientId) || !text(source.ambulatoryId)
        || source.patientVersion !== patientVersion) return null;
    return value as ServerSessionSelectionCommitBindingV1;
}

function parseReplayKey(value: unknown): HeadlessSoapEntryReplayKeyV1 | null {
    const source = exactFrozen(value, REPLAY_KEYS);
    if (!source || !matches(source.approvalRef, APPROVAL_REF) || !matches(source.idempotencyKey, IDEMPOTENCY_KEY)
        || !matches(source.authorizationProofDigest, HASH)) return null;
    return value as HeadlessSoapEntryReplayKeyV1;
}

const snapshotReceipt = snapshotClinicianSoapEntryCommitReceipt;

function ownerError(code: 'receipt_unavailable' | 'storage_unavailable'): never {
    throw new HeadlessSoapEntryCommitOwnerError(code);
}

function missing<Receipt extends object>(): HeadlessSoapEntryCommitLookupResultV1<Receipt> {
    return record({ status: 'missing' as const });
}

function conflict<Receipt extends object>(): HeadlessSoapEntryCommitLookupResultV1<Receipt> {
    return record({ status: 'conflict' as const });
}

function exactReceipt(receipt: HeadlessSoapEntryCommitReceiptV1):
HeadlessSoapEntryCommitLookupResultV1<HeadlessSoapEntryCommitReceiptV1> {
    return record({ status: 'exact' as const, receipt });
}

function denied(code: HeadlessSoapEntryCommitPortDenialCode):
HeadlessSoapEntryCommitPortResultV1<HeadlessSoapEntryCommitReceiptV1> {
    return record({ status: 'denied' as const, code });
}

function committed(receipt: HeadlessSoapEntryCommitReceiptV1):
HeadlessSoapEntryCommitPortResultV1<HeadlessSoapEntryCommitReceiptV1> {
    return record({ status: 'committed' as const, receipt });
}

const SELECT_LEDGER = `SELECT idempotency_key AS idempotencyKey, approval_ref AS approvalRef,
 authorization_proof_digest AS authorizationProofDigest, command_id AS commandId, entry_id AS entryId,
 audit_event_id AS auditEventId, receipt_ref AS receiptRef, binding_snapshot AS bindingSnapshot,
 binding_digest AS bindingDigest, entry_digest AS entryDigest, audit_snapshot AS auditSnapshot,
 audit_digest AS auditDigest, receipt_snapshot AS receiptSnapshot, receipt_digest AS receiptDigest,
 committed_at AS committedAt FROM ${ledgerTable} WHERE idempotency_key = ? LIMIT 1`;
const SELECT_ENTRY = `SELECT id, patient_id AS patientId, type, title, date, content, setting, metadata, attachments,
 deleted_at AS deletedAt, deletion_reason AS deletionReason, version, created_at AS createdAt,
 updated_at AS updatedAt FROM ${entryTable} WHERE id = ? LIMIT 1`;
const SELECT_AUDIT = `SELECT event_id AS eventId, schema_version AS schemaVersion, event_type AS eventType,
 occurred_at AS occurredAt, outcome, actor_type AS actorType, actor_ref AS actorRef, subject_type AS subjectType,
 subject_ref AS subjectRef, source_surface AS sourceSurface, request_id AS requestId,
 redacted_metadata AS redactedMetadata, created_at AS createdAt FROM ${auditTable} WHERE event_id = ? LIMIT 1`;
const SELECT_ENTRY_COLLISION = `SELECT id FROM ${entryTable} WHERE id = ? LIMIT 1`;
const SELECT_AUDIT_COLLISION = `SELECT event_id AS eventId FROM ${auditTable} WHERE event_id = ? LIMIT 1`;
const LEDGER_COLLISION_KEYS = ['idempotencyKey', 'commandId', 'entryId', 'auditEventId', 'receiptRef'] as const;
const SELECT_LEDGER_COLLISION = `SELECT idempotency_key AS idempotencyKey, command_id AS commandId,
 entry_id AS entryId, audit_event_id AS auditEventId, receipt_ref AS receiptRef FROM ${ledgerTable}
 WHERE command_id = ? OR entry_id = ? OR audit_event_id = ? OR receipt_ref = ? ORDER BY idempotency_key`;

function readLedger(idempotencyKey: string): LedgerRow | null {
    const value = prepare(SELECT_LEDGER).get(idempotencyKey);
    if (value === undefined) return null;
    const row = exactRow(value, LEDGER_ROW_KEYS);
    return row as LedgerRow | null;
}

/* @Codex Ledger collisions are durable corruption; only orphan identifiers are fresh idempotency conflicts. */
function deterministicIdentifierDenial(commandId: string, entryId: string, auditEventId: string, receiptRef: string):
'receipt_unavailable' | 'idempotency_conflict' | null {
    const ledgerValues = prepare(SELECT_LEDGER_COLLISION).all(commandId, entryId, auditEventId, receiptRef);
    if (!Array.isArray(ledgerValues)) throw new CommitAbort('storage_unavailable');
    for (const value of ledgerValues) {
        const row = exactRow(value, LEDGER_COLLISION_KEYS);
        if (!row || (row.commandId !== commandId && row.entryId !== entryId
                && row.auditEventId !== auditEventId && row.receiptRef !== receiptRef)) {
            throw new CommitAbort('storage_unavailable');
        }
    }
    if (ledgerValues.length > 0) return 'receipt_unavailable';
    const probes = [
        [prepare(SELECT_ENTRY_COLLISION).get(entryId), 'id', entryId],
        [prepare(SELECT_AUDIT_COLLISION).get(auditEventId), 'eventId', auditEventId],
    ] as const;
    for (const [value, key, expected] of probes) {
        if (value === undefined) continue;
        const row = exactRow(value, [key]);
        if (!row || row[key] !== expected) throw new CommitAbort('storage_unavailable');
        return 'idempotency_conflict';
    }
    return null;
}

function validateStoredReceipt(row: LedgerRow): HeadlessSoapEntryCommitReceiptV1 {
    const binding = exactSnapshot(row.bindingSnapshot, BINDING_SNAPSHOT_KEYS);
    if (!binding || canonicalJSON(binding) !== row.bindingSnapshot || digest(BINDING_DIGEST_DOMAIN, row.bindingSnapshot as string) !== row.bindingDigest
        || binding.idempotencyKey !== row.idempotencyKey || binding.approvalRef !== row.approvalRef
        || binding.authorizationProofDigest !== row.authorizationProofDigest || binding.commandId !== row.commandId
        || !matches(binding.patientIdDigest, HASH) || !matches(binding.ambulatoryIdDigest, HASH)) return ownerError('receipt_unavailable');

    const entryRow = exactRow(prepare(SELECT_ENTRY).get(row.entryId), ENTRY_ROW_KEYS);
    if (!entryRow || digest(PATIENT_ID_DIGEST_DOMAIN, String(entryRow.patientId)) !== binding.patientIdDigest) {
        return ownerError('receipt_unavailable');
    }
    const entrySnapshot = record({
        schema: ENTRY_SNAPSHOT_SCHEMA,
        entryId: entryRow.id,
        patientIdDigest: binding.patientIdDigest,
        type: entryRow.type,
        title: entryRow.title,
        date: entryRow.date,
        content: entryRow.content,
        setting: entryRow.setting,
        metadata: entryRow.metadata,
        attachments: entryRow.attachments,
        deletedAt: entryRow.deletedAt,
        deletionReason: entryRow.deletionReason,
        version: entryRow.version,
        createdAt: entryRow.createdAt,
        updatedAt: entryRow.updatedAt,
    });
    const entrySnapshotText = canonicalJSON(entrySnapshot);
    if (Reflect.ownKeys(entrySnapshot).some((key, index) => key !== ENTRY_SNAPSHOT_KEYS[index])
        || digest(ENTRY_DIGEST_DOMAIN, entrySnapshotText) !== row.entryDigest) return ownerError('receipt_unavailable');

    const auditRow = exactRow(prepare(SELECT_AUDIT).get(row.auditEventId), AUDIT_ROW_KEYS);
    const storedAudit = exactSnapshot(row.auditSnapshot, AUDIT_SNAPSHOT_KEYS);
    if (!auditRow || !storedAudit || canonicalJSON(storedAudit) !== row.auditSnapshot
        || canonicalJSON(auditRow) !== row.auditSnapshot
        || digest(AUDIT_DIGEST_DOMAIN, row.auditSnapshot as string) !== row.auditDigest) return ownerError('receipt_unavailable');

    const receiptRecord = exactSnapshot(row.receiptSnapshot, RECEIPT_KEYS);
    const receipt = receiptRecord && snapshotReceipt(record(receiptRecord));
    if (!receipt || canonicalJSON(receiptRecord!) !== row.receiptSnapshot
        || digest(RECEIPT_DIGEST_DOMAIN, row.receiptSnapshot as string) !== row.receiptDigest
        || receipt.receiptRef !== row.receiptRef || receipt.commandId !== row.commandId
        || receipt.entryRef !== row.entryId || receipt.auditEventRef !== row.auditEventId
        || receipt.bindingDigest !== row.bindingDigest || receipt.entryDigest !== row.entryDigest
        || receipt.auditDigest !== row.auditDigest || receipt.patientVersion !== binding.patientVersion
        || receipt.entryVersion !== entryRow.version || Date.parse(receipt.committedAt) / 1000 !== row.committedAt
        || row.entryId !== identifier('hsei_', ENTRY_ID_DOMAIN, String(row.commandId))
        || row.auditEventId !== identifier('hsea_', AUDIT_ID_DOMAIN, String(row.commandId))
        || row.receiptRef !== identifier('hser_', RECEIPT_REF_DOMAIN, String(row.commandId))) return ownerError('receipt_unavailable');
    if (!validateHeadlessSoapEntryCommitSemanticChain({
        idempotencyKey: row.idempotencyKey,
        approvalRef: row.approvalRef,
        authorizationProofDigest: row.authorizationProofDigest,
        commandId: row.commandId,
        entryId: row.entryId,
        auditEventId: row.auditEventId,
        receiptRef: row.receiptRef,
        bindingSnapshot: row.bindingSnapshot,
        bindingDigest: row.bindingDigest,
        entrySnapshot: entrySnapshotText,
        entryDigest: row.entryDigest,
        auditSnapshot: row.auditSnapshot,
        auditDigest: row.auditDigest,
        receiptSnapshot: row.receiptSnapshot,
        receiptDigest: row.receiptDigest,
        committedAtSeconds: row.committedAt,
        patientId: entryRow.patientId,
        /* Durable replay must not depend on mutable post-commit ambulatory membership. */
        ambulatoryIds: null,
    })) return ownerError('receipt_unavailable');
    return receipt;
}

function lookup(keyValue: unknown): HeadlessSoapEntryCommitLookupResultV1<HeadlessSoapEntryCommitReceiptV1> {
    const key = parseReplayKey(keyValue);
    if (!key || !hasCanonicalHeadlessSoapEntryCommitSchema()) return ownerError('storage_unavailable');
    try {
        const row = readLedger(key.idempotencyKey);
        if (!row) return missing();
        if (row.approvalRef !== key.approvalRef || row.authorizationProofDigest !== key.authorizationProofDigest) {
            return conflict();
        }
        return exactReceipt(validateStoredReceipt(row));
    } catch (error) {
        if (error instanceof HeadlessSoapEntryCommitOwnerError) throw error;
        return ownerError('storage_unavailable');
    }
}

function commandBindingSnapshot(command: ParsedCommand, binding: ServerSessionSelectionCommitBindingV1): string {
    const lineage = command.lineage;
    return canonicalJSON(record({
        schema: BINDING_SCHEMA,
        operationId: OPERATION_ID,
        commandId: command.value.commandId,
        approvalRef: command.value.approvalRef,
        idempotencyKey: command.value.idempotencyKey,
        authorizationProofDigest: command.value.authorizationProofDigest,
        webSessionId: lineage.webSession.id,
        webSessionCreatedAt: lineage.webSession.createdAt,
        webSessionExpiresAt: lineage.webSession.expiresAt,
        principalRef: lineage.activeRole.principalRef,
        actorRef: lineage.activeRole.actorRef,
        attestationRef: lineage.activeRole.attestationRef,
        attestationVersion: lineage.activeRole.attestationVersion,
        activeRoleRevocationGeneration: lineage.activeRole.revocationGeneration,
        activeRolePolicyVersion: lineage.activeRole.policyVersion,
        parentContractVersion: lineage.childLease.parent.contractVersion,
        parentGeneration: lineage.childLease.parent.generation,
        parentRevocationGeneration: lineage.childLease.parent.revocationGeneration,
        childContractVersion: lineage.childLease.child.contractVersion,
        childGeneration: lineage.childLease.child.generation,
        childRevocationGeneration: lineage.childLease.child.revocationGeneration,
        childExpiresAt: lineage.childLease.child.expiresAt,
        leaseContractVersion: lineage.childLease.lease.contractVersion,
        leaseGeneration: lineage.childLease.lease.generation,
        leaseRevocationGeneration: lineage.childLease.lease.revocationGeneration,
        sessionRef: lineage.selection.sessionRef,
        patientRef: lineage.selection.patientRef,
        ambulatoryRef: lineage.selection.ambulatoryRef,
        leaseRef: lineage.selection.leaseRef,
        selectionEpoch: lineage.selection.selectionEpoch,
        selectionExpiresAt: lineage.selection.expiresAt,
        patientVersion: lineage.patientVersion,
        action: lineage.action,
        purpose: lineage.purpose,
        proposalRevision: lineage.proposal.revision,
        proposalExpiresAt: lineage.proposal.expiresAt,
        payloadDigest: lineage.payloadDigest.sha256.hex,
        sealDigest: lineage.sealDigest.sha256.hex,
        policyDigest: lineage.policyDigest.sha256.hex,
        patientIdDigest: digest(PATIENT_ID_DIGEST_DOMAIN, binding.patientId),
        ambulatoryIdDigest: digest(AMBULATORY_ID_DIGEST_DOMAIN, binding.ambulatoryId),
    }));
}

function currentPatient(binding: ServerSessionSelectionCommitBindingV1): boolean {
    const rows = prepare(`SELECT patient.id FROM patients AS patient
        INNER JOIN patients_to_ambulatories AS membership ON membership.patient_id = patient.id
            AND membership.ambulatory_id = ?
        INNER JOIN ambulatories AS ambulatory ON ambulatory.id = membership.ambulatory_id
        WHERE patient.id = ? AND patient.version = ? AND patient.is_archived = 0
            AND patient.deleted_at IS NULL AND ambulatory.id = ? LIMIT 2`)
        .all(binding.ambulatoryId, binding.patientId, binding.patientVersion, binding.ambulatoryId);
    return Array.isArray(rows) && rows.length === 1 && exactRow(rows[0], ['id'])?.id === binding.patientId;
}

function commit(commandValue: unknown, bindingValue: unknown):
HeadlessSoapEntryCommitPortResultV1<HeadlessSoapEntryCommitReceiptV1> {
    const command = parseCommand(commandValue);
    if (!command) return denied('lifecycle_unavailable');
    const binding = parseBinding(bindingValue, command.lineage.patientVersion);
    if (!binding) return denied('binding_unavailable');
    try {
        return runDbServerImmediateTransaction(() => {
            if (!hasCanonicalHeadlessSoapEntryCommitSchema()) throw new CommitAbort('storage_unavailable');
            let replay: HeadlessSoapEntryCommitLookupResultV1<HeadlessSoapEntryCommitReceiptV1>;
            try { replay = lookup(record({ approvalRef: command.value.approvalRef,
                idempotencyKey: command.value.idempotencyKey,
                authorizationProofDigest: command.value.authorizationProofDigest })); }
            catch (error) {
                if (error instanceof HeadlessSoapEntryCommitOwnerError) throw new CommitAbort(error.code);
                throw new CommitAbort('storage_unavailable');
            }
            if (replay.status === 'exact') return committed(replay.receipt);
            if (replay.status === 'conflict') throw new CommitAbort('idempotency_conflict');
            if (!currentPatient(binding)) throw new CommitAbort('binding_unavailable');

            const clockRow = exactRow(prepare('SELECT unixepoch() AS seconds').get(), ['seconds']);
            if (!clockRow || !safeInteger(clockRow.seconds)) throw new CommitAbort('storage_unavailable');
            const committedAt = clockRow.seconds;
            const committedAtISO = new Date(committedAt * 1000).toISOString();
            const entryDate = Date.parse(command.seal.date) / 1000;
            if (!safeInteger(entryDate)) throw new CommitAbort('lifecycle_unavailable');
            const entryId = identifier('hsei_', ENTRY_ID_DOMAIN, command.value.commandId);
            const auditEventId = identifier('hsea_', AUDIT_ID_DOMAIN, command.value.commandId);
            const receiptRef = identifier('hser_', RECEIPT_REF_DOMAIN, command.value.commandId);
            const identifierDenial = deterministicIdentifierDenial(
                command.value.commandId, entryId, auditEventId, receiptRef,
            );
            if (identifierDenial) throw new CommitAbort(identifierDenial);
            const bindingSnapshot = commandBindingSnapshot(command, binding);
            const bindingDigest = digest(BINDING_DIGEST_DOMAIN, bindingSnapshot);

            prepare(`INSERT INTO ${entryTable} (id, patient_id, type, title, date, content, setting, metadata,
                attachments, deleted_at, deletion_reason, version, created_at, updated_at)
                VALUES (?, ?, 'visit', ?, ?, ?, 'ambulatory', ?, NULL, NULL, NULL, 1, ?, ?)`)
                .run(entryId, binding.patientId, command.seal.title, entryDate, command.seal.content,
                    command.seal.metadata, committedAt, committedAt);
            const entrySnapshot = record({
                schema: ENTRY_SNAPSHOT_SCHEMA,
                entryId,
                patientIdDigest: digest(PATIENT_ID_DIGEST_DOMAIN, binding.patientId),
                type: 'visit',
                title: command.seal.title,
                date: entryDate,
                content: command.seal.content,
                setting: 'ambulatory',
                metadata: command.seal.metadata,
                attachments: null,
                deletedAt: null,
                deletionReason: null,
                version: 1,
                createdAt: committedAt,
                updatedAt: committedAt,
            });
            const entryDigest = digest(ENTRY_DIGEST_DOMAIN, canonicalJSON(entrySnapshot));
            const auditMetadata = canonicalJSON(record({
                schema: AUDIT_METADATA_SCHEMA,
                operationId: OPERATION_ID,
                commandRef: command.value.commandId,
                bindingDigest,
                entryDigest,
            }));
            const auditSnapshot = canonicalJSON(record({
                eventId: auditEventId,
                schemaVersion: 1,
                eventType: 'entry.created',
                occurredAt: committedAt,
                outcome: 'success',
                actorType: 'user',
                actorRef: `hsa_${digest(ACTOR_REF_DIGEST_DOMAIN, command.lineage.activeRole.actorRef)}`,
                subjectType: 'entry',
                subjectRef: entryId,
                sourceSurface: 'web',
                requestId: null,
                redactedMetadata: auditMetadata,
                createdAt: committedAt,
            }));
            const auditDigest = digest(AUDIT_DIGEST_DOMAIN, auditSnapshot);
            const audit = exactSnapshot(auditSnapshot, AUDIT_SNAPSHOT_KEYS);
            if (!audit || !matches(audit.actorRef, ACTOR_REF)) throw new CommitAbort('lifecycle_unavailable');
            prepare(`INSERT INTO ${auditTable} (event_id, schema_version, event_type, occurred_at, outcome,
                actor_type, actor_ref, subject_type, subject_ref, source_surface, request_id, redacted_metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(...AUDIT_SNAPSHOT_KEYS.map((key) => audit[key]));

            const receipt = snapshotReceipt(record({
                schema: RECEIPT_SCHEMA,
                receiptRef,
                operationId: OPERATION_ID,
                outcome: RECEIPT_OUTCOME,
                commandId: command.value.commandId,
                entryRef: entryId,
                auditEventRef: auditEventId,
                patientVersion: binding.patientVersion,
                entryVersion: 1,
                committedAt: committedAtISO,
                bindingDigest,
                entryDigest,
                auditDigest,
            }));
            if (!receipt) throw new CommitAbort('lifecycle_unavailable');
            const receiptSnapshot = canonicalJSON(receipt);
            const receiptDigest = digest(RECEIPT_DIGEST_DOMAIN, receiptSnapshot);
            dbServer.insert(headlessSoapEntryCommits).values({
                idempotencyKey: command.value.idempotencyKey,
                approvalRef: command.value.approvalRef,
                authorizationProofDigest: command.value.authorizationProofDigest,
                commandId: command.value.commandId,
                entryId,
                auditEventId,
                receiptRef,
                bindingSnapshot,
                bindingDigest,
                entryDigest,
                auditSnapshot,
                auditDigest,
                receiptSnapshot,
                receiptDigest,
                committedAt: new Date(committedAt * 1000),
            }).run();
            let reread: HeadlessSoapEntryCommitLookupResultV1<HeadlessSoapEntryCommitReceiptV1>;
            try {
                reread = lookup(record({ approvalRef: command.value.approvalRef,
                    idempotencyKey: command.value.idempotencyKey,
                    authorizationProofDigest: command.value.authorizationProofDigest }));
            } catch (error) {
                if (error instanceof HeadlessSoapEntryCommitOwnerError) throw new CommitAbort(error.code);
                throw new CommitAbort('storage_unavailable');
            }
            if (reread.status !== 'exact') throw new CommitAbort('receipt_unavailable');
            return committed(reread.receipt);
        });
    } catch (error) {
        if (error instanceof CommitAbort) return denied(error.code);
        return denied('storage_unavailable');
    }
}

/** Owns the synchronous H7b SQLite transaction, durable replay and receipt verification. */
export function createHeadlessSoapEntryCommitOwner():
HeadlessSoapEntryCommitOwnerV1<HeadlessSoapEntryCommitReceiptV1> {
    return record({ snapshotReceipt, lookup, commit });
}
