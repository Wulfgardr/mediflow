import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { dbServer } from '../db-server';
import { assertArchiveGeneration } from '../archive-generation';
import { auditEvents } from '../schema';
import { PATIENT_PROFILE_UPDATE_OPERATION, type PatientProfileUpdateEnvelope } from '../patient-profile-update-contract';
import { PROFILE_NOTES_COMMIT_POLICY, parseProfileNotesCommitJournal,
    type ProfileNotesCommitJournal, type ProfileNotesCommitReceipt } from '../patient-profile-notes-commit-contract';
import type { RequiredAuditContext } from './audit';

type Transaction = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
export type ProfileNotesCommitPermit = Readonly<{
    policy: typeof PROFILE_NOTES_COMMIT_POLICY; reference: string; digest: string; ambulatoryId: string;
    // Private host composition: current admission AND terminal review, synchronously inside the writer.
    authorizeCommit: (tx: Transaction) => true;
}>;
export type ProfileNotesCommitKey = Readonly<{
    reference: string; digest: string; commandDigest: string; scopeDigest: string;
    previousRevision: number; normalizedAt: number;
}>;
export class ProfileNotesCommitError extends Error {
    constructor(readonly code: 'commit_denied' | 'idempotency_conflict' | 'receipt_unavailable') { super(code); }
}

function digest(domain: string, value: string): string {
    return createHash('sha256').update(`mediflow.patient-profile.notes.${domain}.v1\0`).update(value).digest('hex');
}
export function profileNotesCommitReference(idempotencyKey: string): string {
    return `ppr_${digest('idempotency', idempotencyKey)}`;
}
function scopeDigest(actorRef: string, patientId: string, ambulatoryId: string): string {
    if (!actorRef || !patientId || !ambulatoryId) throw new ProfileNotesCommitError('commit_denied');
    return digest('scope', JSON.stringify([actorRef, patientId, ambulatoryId]));
}

/** The receipt identity is derived from the retained canonical command, never a new payload. */
export function profileNotesCommitKey(command: PatientProfileUpdateEnvelope, permit: ProfileNotesCommitPermit,
    audit: RequiredAuditContext): ProfileNotesCommitKey {
    if (permit.policy !== PROFILE_NOTES_COMMIT_POLICY || typeof permit.authorizeCommit !== 'function'
        || !/^[0-9a-f]{64}$/u.test(permit.digest) || permit.reference !== profileNotesCommitReference(command.idempotencyKey)
        || command.operationId !== PATIENT_PROFILE_UPDATE_OPERATION.id || command.contractVersion !== 1
        || command.executor !== 'legacy-node' || command.purpose !== 'patient-profile-update'
        || command.confirmation !== 'legacy-not-attested' || command.authorization.kind !== 'existing-host-admission'
        || command.authorization.commitGuard !== 'archive-audit' || command.scope.kind !== 'local' || command.setPrimaryAmbulatory
        || command.author.kind !== 'user' || command.author.surface !== 'web'
        || command.author.ref !== audit.actorRef || audit.actorType !== 'user' || audit.sourceSurface !== 'web'
        || command.correlationId !== (audit.requestId ?? null) || !audit.flags.includes('auth:session') || !audit.archiveGeneration
        || Object.keys(command.payload).length !== 1 || !Object.hasOwn(command.payload, 'notes')
        || !(command.payload.notes === null || (typeof command.payload.notes === 'string'
            && /^ENC:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/u.test(command.payload.notes)))
        || !Number.isSafeInteger(command.target.expectedVersion) || command.target.expectedVersion < 1
        || command.target.expectedVersion >= Number.MAX_SAFE_INTEGER || !Number.isFinite(Date.parse(command.normalizedAt))) {
        throw new ProfileNotesCommitError('commit_denied');
    }
    return Object.freeze({ reference: permit.reference, digest: permit.digest,
        commandDigest: digest('command', JSON.stringify(command)),
        scopeDigest: scopeDigest(audit.actorRef, command.target.patientId, permit.ambulatoryId),
        previousRevision: command.target.expectedVersion, normalizedAt: Date.parse(command.normalizedAt) });
}

function receiptRef(journal: Omit<ProfileNotesCommitJournal, 'receipt'>,
    receipt: Omit<ProfileNotesCommitReceipt, 'receiptRef'>): string {
    return `ppnr_${digest('receipt', JSON.stringify([journal.schemaVersion, journal.commandDigest, journal.scopeDigest,
        receipt.reference, receipt.digest, receipt.previousRevision, receipt.revision, receipt.committedAt]))}`;
}
export function createProfileNotesCommitJournal(key: ProfileNotesCommitKey, now: number): ProfileNotesCommitJournal {
    if (!Number.isSafeInteger(now) || now < key.normalizedAt) throw new ProfileNotesCommitError('receipt_unavailable');
    const journal = { schemaVersion: 1 as const, commandDigest: key.commandDigest, scopeDigest: key.scopeDigest };
    const receipt = { kind: 'committed' as const, policy: PROFILE_NOTES_COMMIT_POLICY,
        reference: key.reference, digest: key.digest, previousRevision: key.previousRevision,
        revision: key.previousRevision + 1, committedAt: now };
    return Object.freeze({ ...journal, receipt: Object.freeze({ ...receipt, receiptRef: receiptRef(journal, receipt) }) });
}

/** Read-only replay. A client receipt, expired proof or old session is never restored. */
export function readProfileNotesCommitReceipt(database: Pick<Transaction, 'select' | 'get'>, expected: Readonly<{
    reference: string; digest: string; actorRef: string; patientId: string; ambulatoryId: string;
    archiveGeneration: string | undefined; commandDigest?: string;
}>): ProfileNotesCommitReceipt | null {
    // Recovery keeps the historical identity, while admission belongs to this archive transaction.
    assertArchiveGeneration(database, expected.archiveGeneration);
    const row = database.select().from(auditEvents).where(eq(auditEvents.eventId, expected.reference)).get();
    if (!row) return null;
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(row.redactedMetadata ?? 'null') as Record<string, unknown>; }
    catch { throw new ProfileNotesCommitError('idempotency_conflict'); }
    const journal = metadata && parseProfileNotesCommitJournal(metadata.profileNotesCommit);
    if (!journal || Object.keys(metadata).length !== 4 || row.schemaVersion !== 1 || row.eventType !== 'patient.updated'
        || row.outcome !== 'success' || row.actorType !== 'user' || row.actorRef !== expected.actorRef
        || row.subjectType !== 'patient' || row.subjectRef !== expected.patientId || row.sourceSurface !== 'web'
        || !Array.isArray(metadata.changedFields) || metadata.changedFields.length !== 1 || metadata.changedFields[0] !== 'notes'
        || !Array.isArray(metadata.flags) || !metadata.flags.includes('auth:session')
        || journal.scopeDigest !== scopeDigest(expected.actorRef, expected.patientId, expected.ambulatoryId)
        || (expected.commandDigest !== undefined && journal.commandDigest !== expected.commandDigest)
        || journal.receipt.reference !== expected.reference || journal.receipt.digest !== expected.digest
        || metadata.resourceVersion !== journal.receipt.revision
        || journal.receipt.receiptRef !== receiptRef(journal, journal.receipt)
        || row.occurredAt.getTime() !== Math.floor(journal.receipt.committedAt / 1000) * 1000
        || row.createdAt?.getTime() !== row.occurredAt.getTime()) throw new ProfileNotesCommitError('idempotency_conflict');
    return journal.receipt;
}
