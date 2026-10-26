import { mintResourcePort, releaseResourcePort } from './security/web-auth-lifecycle-owner-adapter';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { dbServer } from './db-server';
import { assertArchiveGeneration, readSqliteArchiveGeneration } from './archive-generation';
import { assertArchiveRequestInTransaction } from './security/archive-request-context';
import { activePatients } from './patient-lifecycle';
import { auditEvents, patients, therapies, therapyStatusCommands, users } from './schema';
import { snapshotBackupAudit } from './backup-audit';
import { updateTherapyOperationInTransaction } from './therapy-write-operation';
import type { ServerSession } from './security/server-session';
import { parseTherapyStatusCommand, type TherapyStatusCommand, type TherapyStatusExecute, type TherapyStatusReceipt } from './therapy-status-command-contract';

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Row = typeof therapyStatusCommands.$inferSelect;
export class TherapyStatusCommandDenied extends Error {
    constructor(readonly code: 'denied' | 'collision' | 'invalid') { super(`Therapy status command ${code}`); }
}
function admitActor(tx: Tx, session: ServerSession): string {
    if (!session || session.authChannel !== 'web' || session.role !== 'admin' || session.expiresAt <= Date.now()) throw new TherapyStatusCommandDenied('denied');
    const active = mintResourcePort(session);
    if (!active) throw new TherapyStatusCommandDenied('denied');
    releaseResourcePort(active);
    const user = tx.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user || user.role !== 'admin' || user.username !== session.username) throw new TherapyStatusCommandDenied('denied');
    const ref = createHash('sha256').update(session.id).digest('hex');
    const binding = tx.get<{ generation: string }>(sql`SELECT generation FROM archive_session_generations WHERE session_ref = ${ref}`);
    assertArchiveGeneration(tx, binding?.generation);
    assertArchiveRequestInTransaction(tx);
    return session.userId;
}
function admitResource(tx: Tx, command: TherapyStatusCommand): void {
    const resource = tx.select({ id: therapies.id }).from(therapies)
        .innerJoin(patients, eq(patients.id, therapies.patientId))
        .where(and(eq(therapies.id, command.therapyId), eq(therapies.patientId, command.patientId), activePatients())).get();
    if (!resource) throw new TherapyStatusCommandDenied('denied');
}
function existingReceipt(tx: Tx, command: TherapyStatusCommand, actorRef: string, target?: string): Row | undefined {
    const row = tx.select().from(therapyStatusCommands).where(eq(therapyStatusCommands.commandId, command.commandId)).get();
    if (!row) return undefined;
    if (row.actorRef !== actorRef) throw new TherapyStatusCommandDenied('denied');
    if (row.protocol !== command.protocol || row.archiveGeneration !== command.archiveGeneration
        || row.patientId !== command.patientId || row.therapyId !== command.therapyId || row.expectedVersion !== command.expectedVersion
        || (target !== undefined && row.outcome !== 'closed' && row.target !== target)) throw new TherapyStatusCommandDenied('collision');
    return row;
}
function receipt(row: Row): TherapyStatusReceipt {
    const { auditSnapshot: _, ...result } = row;
    return result as TherapyStatusReceipt;
}
function insert(tx: Tx, row: Row): TherapyStatusReceipt {
    if (tx.insert(therapyStatusCommands).values(row).run().changes !== 1) throw new Error('Therapy status receipt did not write exactly one row');
    return receipt(row);
}
function base(command: TherapyStatusCommand, actorRef: string): Row {
    return { commandId: command.commandId, protocol: command.protocol, archiveGeneration: command.archiveGeneration,
        actorRef, patientId: command.patientId, therapyId: command.therapyId, expectedVersion: command.expectedVersion,
        target: null, outcome: 'closed', reason: null, committedAt: Math.floor(Date.now() / 1000),
        resultVersion: null, resultEndDate: null, auditEventId: null, auditSnapshot: null };
}
export function executeTherapyStatusCommand(session: ServerSession, command: TherapyStatusExecute): TherapyStatusReceipt {
    if (!parseTherapyStatusCommand(command, true)) throw new TherapyStatusCommandDenied('invalid');
    return dbServer.transaction(tx => {
        const actorRef = admitActor(tx, session);
        assertArchiveGeneration(tx, command.archiveGeneration);
        const existing = existingReceipt(tx, command, actorRef, command.target);
        if (existing) return receipt(existing);
        admitResource(tx, command);
        const row = base(command, actorRef), now = new Date(row.committedAt * 1000);
        const therapy = tx.select().from(therapies).where(eq(therapies.id, command.therapyId)).get()!;
        const endDate = command.target === 'completed' ? now : command.target === 'active' ? null : therapy.endDate;
        const result = updateTherapyOperationInTransaction(tx, {
            patientId: command.patientId, therapyId: command.therapyId, expectedVersion: command.expectedVersion,
            values: { status: command.target, endDate, updatedAt: now }, changedFields: ['status', 'endDate'], mode: 'v1', occurredAt: now,
            audit: { archiveGeneration: command.archiveGeneration, actorType: 'user', actorRef, sourceSurface: 'web', requestId: command.commandId, flags: ['auth:web'] },
        });
        if (result.status === 404) throw new TherapyStatusCommandDenied('denied');
        if (result.status === 409) return insert(tx, { ...row, target: command.target, outcome: 'rejected', reason: 'version_conflict' });
        if (!result.auditEventId) throw new Error('Therapy status command audit missing');
        const audit = tx.select().from(auditEvents).where(eq(auditEvents.eventId, result.auditEventId)).get();
        if (!audit) throw new Error('Therapy status command audit missing');
        return insert(tx, { ...row, target: command.target, outcome: 'applied', resultVersion: command.expectedVersion + 1,
            resultEndDate: endDate ? endDate.getTime() / 1000 : null, auditEventId: result.auditEventId,
            auditSnapshot: JSON.stringify(snapshotBackupAudit(audit)) });
    }, { behavior: 'immediate' });
}
export function closeTherapyStatusCommand(session: ServerSession, command: TherapyStatusCommand): TherapyStatusReceipt {
    if (!parseTherapyStatusCommand(command, false)) throw new TherapyStatusCommandDenied('invalid');
    return dbServer.transaction(tx => {
        const actorRef = admitActor(tx, session);
        assertArchiveGeneration(tx, command.archiveGeneration);
        const existing = existingReceipt(tx, command, actorRef);
        if (existing) return receipt(existing);
        admitResource(tx, command);
        return insert(tx, base(command, actorRef));
    }, { behavior: 'immediate' });
}
export function readTherapyStatusReceipt(session: ServerSession, command: TherapyStatusCommand):
    { outcome: 'unknown' } | { outcome: 'terminal'; historical: boolean; receipt: TherapyStatusReceipt } {
    if (!parseTherapyStatusCommand(command, false)) throw new TherapyStatusCommandDenied('invalid');
    return dbServer.transaction(tx => {
        const actorRef = admitActor(tx, session);
        const existing = existingReceipt(tx, command, actorRef);
        if (existing) return { outcome: 'terminal' as const, historical: existing.archiveGeneration !== readSqliteArchiveGeneration(dbServer.$client), receipt: receipt(existing) };
        assertArchiveGeneration(tx, command.archiveGeneration);
        admitResource(tx, command);
        return { outcome: 'unknown' as const };
    }, { behavior: 'immediate' });
}
