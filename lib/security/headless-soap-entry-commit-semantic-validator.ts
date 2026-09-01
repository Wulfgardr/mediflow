/* @Codex */
import { createHash } from 'node:crypto';

import {
    ATTACHMENTS_ABSENT,
    ENTRY_SETTING,
    ENTRY_TYPE,
    frame,
    parseSeal,
    PAYLOAD_DIGEST_CODEC,
    SEAL_DIGEST_CODEC,
    SEAL_SCHEMA,
} from '../headless/clinician-soap-entry-seal-codec-internal';

const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1';
const BINDING_SCHEMA = 'mediflow.headless.soap-entry-commit-binding.v1';
const ENTRY_SCHEMA = 'mediflow.headless.soap-entry-record.v1';
const RECEIPT_SCHEMA = 'mediflow.headless.soap-entry-commit-receipt.v1';
const AUDIT_METADATA_SCHEMA = 'mediflow.headless.soap-entry-commit-audit-metadata.v1';
const ACTIVE_ROLE_POLICY = 'clinician_confirmed_single_use.v1';
const POLICY_DIGEST = '1175ad0f063ac03d73f71afce252a7922e359882c9c1f7313a5cbc445e3a5f17';
const BINDING_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-binding-digest.v1';
const ENTRY_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-entry-digest.v1';
const AUDIT_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-audit-digest.v1';
const RECEIPT_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-receipt-digest.v1';
const ENTRY_ID_DOMAIN = 'mediflow.headless.soap-entry-id.v1';
const AUDIT_ID_DOMAIN = 'mediflow.headless.soap-entry-audit-id.v1';
const RECEIPT_ID_DOMAIN = 'mediflow.headless.soap-entry-receipt-ref.v1';
const PATIENT_ID_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-patient-id-digest.v1';
const AMBULATORY_ID_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-ambulatory-id-digest.v1';
const ACTOR_REF_DIGEST_DOMAIN = 'mediflow.headless.soap-entry-commit-actor-ref.v1';

const BINDING_KEYS = ['schema', 'operationId', 'commandId', 'approvalRef', 'idempotencyKey',
    'authorizationProofDigest', 'webSessionId', 'webSessionCreatedAt', 'webSessionExpiresAt', 'principalRef', 'actorRef',
    'attestationRef', 'attestationVersion', 'activeRoleRevocationGeneration', 'activeRolePolicyVersion',
    'parentContractVersion', 'parentGeneration', 'parentRevocationGeneration', 'childContractVersion', 'childGeneration',
    'childRevocationGeneration', 'childExpiresAt', 'leaseContractVersion', 'leaseGeneration', 'leaseRevocationGeneration',
    'sessionRef', 'patientRef', 'ambulatoryRef', 'leaseRef', 'selectionEpoch', 'selectionExpiresAt', 'patientVersion',
    'action', 'purpose', 'proposalRevision', 'proposalExpiresAt', 'payloadDigest', 'sealDigest', 'policyDigest',
    'patientIdDigest', 'ambulatoryIdDigest'] as const;
const ENTRY_KEYS = ['schema', 'entryId', 'patientIdDigest', 'type', 'title', 'date', 'content', 'setting', 'metadata',
    'attachments', 'deletedAt', 'deletionReason', 'version', 'createdAt', 'updatedAt'] as const;
const AUDIT_KEYS = ['eventId', 'schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata', 'createdAt'] as const;
const AUDIT_METADATA_KEYS = ['schema', 'operationId', 'commandRef', 'bindingDigest', 'entryDigest'] as const;
const RECEIPT_KEYS = ['schema', 'receiptRef', 'operationId', 'outcome', 'commandId', 'entryRef', 'auditEventRef',
    'patientVersion', 'entryVersion', 'committedAt', 'bindingDigest', 'entryDigest', 'auditDigest'] as const;

const HASH = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^hsac_[0-9a-f]{64}$/u;
const APPROVAL_REF = /^hsaa_[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY = /^hsai_[0-9a-f]{64}$/u;
const ENTRY_REF = /^hsei_[0-9a-f]{64}$/u;
const AUDIT_REF = /^hsea_[0-9a-f]{64}$/u;
const RECEIPT_REF = /^hser_[0-9a-f]{64}$/u;
const ATTESTATION_REF = /^hsar_[0-9a-f]{32}$/u;
const SESSION_REF = /^ssr_[0-9a-f]{32}$/u;
const PATIENT_REF = /^ptr_[0-9a-f]{32}$/u;
const AMBULATORY_REF = /^abr_[0-9a-f]{32}$/u;
const LEASE_REF = /^lsr_[0-9a-f]{32}$/u;
const ACTOR_REF = /^hsa_[0-9a-f]{64}$/u;
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;

export type HeadlessSoapEntryCommitSemanticChainV1 = Readonly<{
    idempotencyKey: unknown;
    approvalRef: unknown;
    authorizationProofDigest: unknown;
    commandId: unknown;
    entryId: unknown;
    auditEventId: unknown;
    receiptRef: unknown;
    bindingSnapshot: unknown;
    bindingDigest: unknown;
    entrySnapshot: unknown;
    entryDigest: unknown;
    auditSnapshot: unknown;
    auditDigest: unknown;
    receiptSnapshot: unknown;
    receiptDigest: unknown;
    committedAtSeconds: unknown;
    patientId: unknown;
    ambulatoryIds: unknown;
}>;

function digest(domain: string, payload: string | Uint8Array): string {
    return createHash('sha256').update(domain, 'utf8').update('\0', 'utf8').update(payload).digest('hex');
}

function exactSnapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
            || Object.getPrototypeOf(parsed) !== Object.prototype || JSON.stringify(parsed) !== value) return null;
        const ownKeys = Reflect.ownKeys(parsed);
        if (ownKeys.length !== keys.length || keys.some((key, index) => ownKeys[index] !== key)) return null;
        const descriptors = Object.getOwnPropertyDescriptors(parsed);
        if (keys.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]!))) return null;
        return parsed as Record<string, unknown>;
    } catch { return null; }
}

function safeInteger(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function text(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
}

function pattern(value: unknown, expression: RegExp): value is string {
    return typeof value === 'string' && expression.test(value);
}

function hashRecord(codec: string, hex: string) {
    const bytes = Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    return { codec, sha256: { bytes, hex } };
}

function canonicalSecond(value: number): string | null {
    try {
        const iso = new Date(value * 1000).toISOString();
        return ISO_SECONDS.test(iso) ? iso : null;
    } catch { return null; }
}

function validBinding(binding: Record<string, unknown>, chain: HeadlessSoapEntryCommitSemanticChainV1): boolean {
    if (binding.schema !== BINDING_SCHEMA || binding.operationId !== OPERATION_ID
        || !pattern(binding.commandId, COMMAND_ID) || binding.commandId !== chain.commandId
        || !pattern(binding.approvalRef, APPROVAL_REF) || binding.approvalRef !== chain.approvalRef
        || !pattern(binding.idempotencyKey, IDEMPOTENCY_KEY) || binding.idempotencyKey !== chain.idempotencyKey
        || !pattern(binding.authorizationProofDigest, HASH)
        || binding.authorizationProofDigest !== chain.authorizationProofDigest
        || !pattern(binding.webSessionId, HASH)
        || !safeInteger(binding.webSessionCreatedAt) || !safeInteger(binding.webSessionExpiresAt)
        || binding.webSessionCreatedAt >= binding.webSessionExpiresAt
        || !text(binding.principalRef) || !text(binding.actorRef) || binding.principalRef !== binding.actorRef
        || !pattern(binding.attestationRef, ATTESTATION_REF) || binding.attestationVersion !== 1
        || binding.activeRoleRevocationGeneration !== 0 || binding.activeRolePolicyVersion !== ACTIVE_ROLE_POLICY
        || binding.parentContractVersion !== 1 || binding.parentGeneration !== 1
        || binding.parentRevocationGeneration !== 0 || binding.childContractVersion !== 1
        || binding.childGeneration !== 1 || binding.childRevocationGeneration !== 0
        || !safeInteger(binding.childExpiresAt)
        || binding.leaseContractVersion !== 1 || binding.leaseGeneration !== 1
        || binding.leaseRevocationGeneration !== 0 || !pattern(binding.sessionRef, SESSION_REF)
        || !pattern(binding.patientRef, PATIENT_REF) || !pattern(binding.ambulatoryRef, AMBULATORY_REF)
        || !pattern(binding.leaseRef, LEASE_REF) || !safeInteger(binding.selectionEpoch, 1)
        || !safeInteger(binding.selectionExpiresAt) || binding.selectionExpiresAt !== binding.webSessionExpiresAt
        || !safeInteger(binding.patientVersion, 1) || binding.action !== 'append'
        || binding.purpose !== 'clinician_requested_documentation' || binding.proposalRevision !== 1
        || !safeInteger(binding.proposalExpiresAt)
        || !pattern(binding.payloadDigest, HASH) || !pattern(binding.sealDigest, HASH)
        || binding.policyDigest !== POLICY_DIGEST || !pattern(binding.patientIdDigest, HASH)
        || !pattern(binding.ambulatoryIdDigest, HASH)) return false;
    if (typeof chain.patientId !== 'string'
        || digest(PATIENT_ID_DIGEST_DOMAIN, chain.patientId) !== binding.patientIdDigest) return false;
    /* Replay has no raw ambulatory ID by design; backup can provide artifact-owned memberships for a stronger preflight. */
    if (chain.ambulatoryIds === null) return true;
    if (!Array.isArray(chain.ambulatoryIds) || chain.ambulatoryIds.length < 1) return false;
    const ambulatoryIds = new Set<string>();
    for (const value of chain.ambulatoryIds) {
        if (!text(value) || ambulatoryIds.has(value)) return false;
        ambulatoryIds.add(value);
    }
    return [...ambulatoryIds].some((value) =>
        digest(AMBULATORY_ID_DIGEST_DOMAIN, value) === binding.ambulatoryIdDigest);
}

function validEntry(entry: Record<string, unknown>, binding: Record<string, unknown>,
    chain: HeadlessSoapEntryCommitSemanticChainV1): boolean {
    if (entry.schema !== ENTRY_SCHEMA || entry.entryId !== chain.entryId
        || entry.patientIdDigest !== binding.patientIdDigest || entry.type !== ENTRY_TYPE
        || !safeInteger(entry.date) || entry.setting !== ENTRY_SETTING
        || typeof entry.title !== 'string' || typeof entry.content !== 'string' || typeof entry.metadata !== 'string'
        || entry.attachments !== null || entry.deletedAt !== null || entry.deletionReason !== null
        || entry.version !== 1 || entry.createdAt !== chain.committedAtSeconds
        || entry.updatedAt !== chain.committedAtSeconds) return false;
    const date = canonicalSecond(entry.date);
    if (!date) return false;
    const seal = parseSeal({
        schema: SEAL_SCHEMA,
        type: ENTRY_TYPE,
        date,
        setting: ENTRY_SETTING,
        title: entry.title,
        content: entry.content,
        metadata: entry.metadata,
        payloadDigest: hashRecord(PAYLOAD_DIGEST_CODEC, binding.payloadDigest as string),
        sealDigest: hashRecord(SEAL_DIGEST_CODEC, binding.sealDigest as string),
    });
    if (!seal) return false;
    const packet = frame([
        SEAL_DIGEST_CODEC,
        SEAL_SCHEMA,
        PAYLOAD_DIGEST_CODEC,
        binding.payloadDigest as string,
        ENTRY_TYPE,
        date,
        ENTRY_SETTING,
        entry.title,
        entry.content,
        entry.metadata,
        ATTACHMENTS_ABSENT,
    ]);
    return packet !== null && createHash('sha256').update(packet).digest('hex') === binding.sealDigest;
}

/** Validates the complete semantic chain shared by durable replay and backup preflight. */
export function validateHeadlessSoapEntryCommitSemanticChain(
    chain: HeadlessSoapEntryCommitSemanticChainV1,
): boolean {
    try {
        if (!pattern(chain.idempotencyKey, IDEMPOTENCY_KEY) || !pattern(chain.approvalRef, APPROVAL_REF)
            || !pattern(chain.authorizationProofDigest, HASH) || !pattern(chain.commandId, COMMAND_ID)
            || !pattern(chain.entryId, ENTRY_REF) || !pattern(chain.auditEventId, AUDIT_REF)
            || !pattern(chain.receiptRef, RECEIPT_REF) || !pattern(chain.bindingDigest, HASH)
            || !pattern(chain.entryDigest, HASH) || !pattern(chain.auditDigest, HASH)
            || !pattern(chain.receiptDigest, HASH) || !safeInteger(chain.committedAtSeconds)) return false;
        const binding = exactSnapshot(chain.bindingSnapshot, BINDING_KEYS);
        const entry = exactSnapshot(chain.entrySnapshot, ENTRY_KEYS);
        const audit = exactSnapshot(chain.auditSnapshot, AUDIT_KEYS);
        const receipt = exactSnapshot(chain.receiptSnapshot, RECEIPT_KEYS);
        if (!binding || !entry || !audit || !receipt || !validBinding(binding, chain)
            || !validEntry(entry, binding, chain)
            || digest(BINDING_DIGEST_DOMAIN, chain.bindingSnapshot as string) !== chain.bindingDigest
            || digest(ENTRY_DIGEST_DOMAIN, chain.entrySnapshot as string) !== chain.entryDigest
            || digest(AUDIT_DIGEST_DOMAIN, chain.auditSnapshot as string) !== chain.auditDigest
            || digest(RECEIPT_DIGEST_DOMAIN, chain.receiptSnapshot as string) !== chain.receiptDigest
            || chain.entryId !== `hsei_${digest(ENTRY_ID_DOMAIN, chain.commandId as string)}`
            || chain.auditEventId !== `hsea_${digest(AUDIT_ID_DOMAIN, chain.commandId as string)}`
            || chain.receiptRef !== `hser_${digest(RECEIPT_ID_DOMAIN, chain.commandId as string)}`) return false;
        const auditMetadata = exactSnapshot(audit.redactedMetadata, AUDIT_METADATA_KEYS);
        const expectedActorRef = `hsa_${digest(ACTOR_REF_DIGEST_DOMAIN, binding.actorRef as string)}`;
        if (!auditMetadata || audit.eventId !== chain.auditEventId || audit.schemaVersion !== 1
            || audit.eventType !== 'entry.created' || audit.occurredAt !== chain.committedAtSeconds
            || audit.outcome !== 'success' || audit.actorType !== 'user'
            || !pattern(audit.actorRef, ACTOR_REF) || audit.actorRef !== expectedActorRef
            || audit.subjectType !== 'entry' || audit.subjectRef !== chain.entryId
            || audit.sourceSurface !== 'web' || audit.requestId !== null
            || audit.createdAt !== chain.committedAtSeconds || auditMetadata.schema !== AUDIT_METADATA_SCHEMA
            || auditMetadata.operationId !== OPERATION_ID || auditMetadata.commandRef !== chain.commandId
            || auditMetadata.bindingDigest !== chain.bindingDigest || auditMetadata.entryDigest !== chain.entryDigest) {
            return false;
        }
        const committedAt = canonicalSecond(chain.committedAtSeconds as number);
        return committedAt !== null && receipt.schema === RECEIPT_SCHEMA && receipt.receiptRef === chain.receiptRef
            && receipt.operationId === OPERATION_ID && receipt.outcome === 'entry_committed'
            && receipt.commandId === chain.commandId && receipt.entryRef === chain.entryId
            && receipt.auditEventRef === chain.auditEventId && receipt.patientVersion === binding.patientVersion
            && receipt.entryVersion === 1 && receipt.committedAt === committedAt
            && receipt.bindingDigest === chain.bindingDigest && receipt.entryDigest === chain.entryDigest
            && receipt.auditDigest === chain.auditDigest;
    } catch { return false; }
}
