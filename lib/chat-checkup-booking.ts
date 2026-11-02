import 'server-only';
/* C-9b: confirmed chat booking of an internal checkup. Same one-shot native approval, PIN and selection
   binding as the chat therapy command; the shared checkup writer owns admission, insert and audit.
   The durable receipt is the audit row keyed by the commandId, so backup and restore carry it with the agenda. */
import { and, eq, sql } from 'drizzle-orm';
import { createNativeChatWriteApprovals } from './native-chat-write-approval';
import { dbServer } from './db-server';
import { auditEvents, checkups, patientsToAmbulatories } from './schema';
import type { NetworkWriteContext } from './network-write-context';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import { nativeProfileSelectionOwner } from './security/native-profile-selection-owner';
import { confirmNativeChatAccessPin } from './security/native-chat-access-confirmation';
import { archiveGenerationForSession } from './security/archive-session-generation';
import type { PairedNativeSession } from './security/paired-native-session';
import { writeAuditEventInTransaction } from './security/audit';
import { createCheckupOperation } from './checkup-write-operation';
import { COMMAND_UUID } from './therapy-status-command-contract';

export const CHECKUP_BOOKING_PROTOCOL = 'checkup.booking.v1' as const;
export const CHECKUP_BOOKING_TITLE = 'Controllo';
const FLAGS = ['auth:paired-client', 'chat:checkup-booking'];
const CAPABILITIES = ['network.replica.readonly-checkups', 'network.replica.write-checkups', 'network.replica.readonly-patients'] as const;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/u;
const DAY = 86_400_000;

export type CheckupBookingCommand = {
    commandId: string; protocol: typeof CHECKUP_BOOKING_PROTOCOL; archiveGeneration: string;
    patientId: string; expectedAgendaRevision: number; date: string; title: string;
};
export type CheckupBookingReceipt = {
    commandId: string; protocol: typeof CHECKUP_BOOKING_PROTOCOL; actorRef: string;
    outcome: 'applied' | 'rejected'; reason: 'version_conflict' | null; committedAt: number;
    checkupId: string | null; resultVersion: 1 | null; auditEventId: string;
};
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
export class CheckupBookingDenied extends Error { constructor() { super('Checkup booking denied'); } }
const deny = (): never => { throw new CheckupBookingDenied(); };

/* Closed shape: the model supplies nothing; date and title come from the native window. */
export function parseCheckupBookingCommand(value: unknown, now: number): CheckupBookingCommand | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const v = value as Record<string, unknown>;
    const keys = ['commandId', 'protocol', 'archiveGeneration', 'patientId', 'expectedAgendaRevision', 'date', 'title'];
    if (Object.keys(v).length !== keys.length || !keys.every(key => Object.hasOwn(v, key))
        || v.protocol !== CHECKUP_BOOKING_PROTOCOL
        || typeof v.commandId !== 'string' || !COMMAND_UUID.test(v.commandId)
        || typeof v.archiveGeneration !== 'string' || !COMMAND_UUID.test(v.archiveGeneration)
        || typeof v.patientId !== 'string' || v.patientId.length < 1 || v.patientId.length > 256 || v.patientId !== v.patientId.trim()
        || !Number.isSafeInteger(v.expectedAgendaRevision) || (v.expectedAgendaRevision as number) < 0
        || v.title !== CHECKUP_BOOKING_TITLE
        || typeof v.date !== 'string' || !RFC3339.test(v.date)) return null;
    const at = Date.parse(v.date);
    // A booking is for today or later, within two years; the native window shows the same bounds.
    if (!Number.isFinite(at) || at < now - DAY || at > now + 731 * DAY) return null;
    return v as CheckupBookingCommand;
}

/* Every create adds a version-1 row and every update bumps a version, so any agenda write changes the revision. */
export function agendaRevision(tx: Tx, patientId: string): number {
    const row = tx.get<{ revision: number }>(sql`SELECT count(*) + coalesce(sum(version), 0) AS revision FROM checkups WHERE patient_id = ${patientId}`);
    return Number(row?.revision ?? 0);
}

function receiptFor(tx: Tx, commandId: string): CheckupBookingReceipt | null {
    const rows = tx.select().from(auditEvents).where(and(eq(auditEvents.requestId, commandId), eq(auditEvents.eventType, 'checkup.created'),
        eq(auditEvents.subjectType, 'checkup'), eq(auditEvents.subjectRef, commandId))).all();
    if (rows.length === 0) return null;
    const metadata = rows.length === 1 && rows[0]!.redactedMetadata ? JSON.parse(rows[0]!.redactedMetadata) as { flags?: unknown; reasonCode?: unknown } : null;
    const row = rows[0]!;
    if (!metadata || !Array.isArray(metadata.flags) || !metadata.flags.includes('chat:checkup-booking') || row.sourceSurface !== 'native' || row.actorType !== 'user') {
        throw new Error('Checkup booking receipt is divergent');
    }
    const committedAt = Math.floor(row.occurredAt.getTime() / 1000);
    if (row.outcome === 'success') return { commandId, protocol: CHECKUP_BOOKING_PROTOCOL, actorRef: row.actorRef, outcome: 'applied', reason: null,
        committedAt, checkupId: commandId, resultVersion: 1, auditEventId: row.eventId };
    if (row.outcome === 'denied' && metadata.reasonCode === 'version_conflict') return { commandId, protocol: CHECKUP_BOOKING_PROTOCOL, actorRef: row.actorRef,
        outcome: 'rejected', reason: 'version_conflict', committedAt, checkupId: null, resultVersion: null, auditEventId: row.eventId };
    throw new Error('Checkup booking receipt is divergent');
}

/* The shared checkup writer owns the IMMEDIATE transaction, row insert and required audit. Admission, the idempotent
   receipt and the agenda CAS run first inside that same transaction as its commit guard; a settled outcome stops the
   writer before it inserts, and the rejection audit commits with it. */
function executeBooking(command: CheckupBookingCommand, actorRef: string, scopeAmbulatoryId: string, admit: (tx: Tx) => void): CheckupBookingReceipt {
    let settled: CheckupBookingReceipt | null = null;
    const stop = { status: 403 as const, value: { status: 'settled' } };
    const date = new Date(command.date), now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const result = createCheckupOperation({
        patientId: command.patientId, checkupId: command.commandId,
        values: { id: command.commandId, patientId: command.patientId, date, title: command.title, notes: null, status: 'pending', source: 'manual',
            version: 1, createdAt: now, updatedAt: now, deletedAt: null, deletionReason: null },
        changedFields: ['date', 'title'], mode: 'network', scopeAmbulatoryId,
        audit: { archiveGeneration: command.archiveGeneration, actorType: 'user', actorRef, sourceSurface: 'native', requestId: command.commandId, flags: FLAGS },
        authorizeCommit: tx => {
            admit(tx);
            const existing = receiptFor(tx, command.commandId);
            if (existing) {
                if (existing.actorRef !== actorRef) deny();
                settled = existing;
                return stop;
            }
            if (agendaRevision(tx, command.patientId) === command.expectedAgendaRevision) return null;
            // The rejection is durable: a lost response reads the same outcome after a restart.
            writeAuditEventInTransaction(tx, { eventType: 'checkup.created', outcome: 'denied', archiveGeneration: command.archiveGeneration,
                actorType: 'user', actorRef, subjectType: 'checkup', subjectRef: command.commandId, sourceSurface: 'native', requestId: command.commandId,
                redactedMetadata: { reasonCode: 'version_conflict', flags: FLAGS } });
            settled = receiptFor(tx, command.commandId);
            return stop;
        },
    });
    if (settled) return settled;
    if (result.status !== 201) return deny();
    return dbServer.transaction(tx => receiptFor(tx, command.commandId), { behavior: 'immediate' }) ?? deny();
}

export function createChatCheckupBookingService(clock: () => number = Date.now) {
    const approvals = createNativeChatWriteApprovals<CheckupBookingCommand>(clock);
    const binding = (context: NetworkWriteContext, epoch: number, resource: string) => ({ session: context.session, scope: context.scopeAmbulatoryId, selection: epoch, resource });
    async function authority(context: NetworkWriteContext) {
        if (context.session.authChannel !== 'native' || context.session.role !== 'admin') return deny();
        const guard = await prepareNetworkPatientCommitGuard(context, CAPABILITIES);
        return (tx: Tx) => { if (guard(tx)) deny(); };
    }
    function selected(context: NetworkWriteContext, patientId: string, epoch: number) {
        const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
        if (owner.snapshotSelectionEpoch(context.session) !== epoch) return deny();
        owner.withLeaseCriticalSection(context.session, selection => {
            if (selection.patientId !== patientId || selection.ambulatoryId !== context.scopeAmbulatoryId) deny();
        });
    }
    function inScope(tx: Tx, patientId: string, scope: string) {
        return Boolean(tx.select().from(patientsToAmbulatories).where(and(eq(patientsToAmbulatories.patientId, patientId), eq(patientsToAmbulatories.ambulatoryId, scope))).get());
    }
    return {
        async open(context: NetworkWriteContext, patientId: string, epoch: number) {
            if (typeof patientId !== 'string' || !patientId || !Number.isSafeInteger(epoch) || epoch < 0) return deny();
            const guard = await authority(context);
            const revision = dbServer.transaction(tx => {
                guard(tx); selected(context, patientId, epoch);
                if (!inScope(tx, patientId, context.scopeAmbulatoryId)) deny();
                return agendaRevision(tx, patientId);
            }, { behavior: 'immediate' });
            return { viewId: approvals.open(binding(context, epoch, patientId)), agendaRevision: revision };
        },
        async preview(context: NetworkWriteContext, value: unknown, epoch: number, viewId: string) {
            const parsed = parseCheckupBookingCommand(value, clock());
            if (!parsed || !Number.isSafeInteger(epoch) || epoch < 0) return deny();
            const command = Object.freeze({ ...parsed });
            const guard = await authority(context);
            approvals.preview(viewId, binding(context, epoch, command.patientId), command.commandId, command, () => dbServer.transaction(tx => {
                guard(tx); selected(context, command.patientId, epoch);
                if (command.archiveGeneration !== archiveGenerationForSession(context.session)
                    || !inScope(tx, command.patientId, context.scopeAmbulatoryId)
                    || agendaRevision(tx, command.patientId) !== command.expectedAgendaRevision
                    || receiptFor(tx, command.commandId)
                    || tx.select({ id: checkups.id }).from(checkups).where(eq(checkups.id, command.commandId)).get()) deny();
            }, { behavior: 'immediate' }));
            return { commandId: command.commandId, status: 'preview' as const };
        },
        async execute(context: NetworkWriteContext, commandId: string, pin: string) {
            const preview = approvals.consume(commandId, { session: context.session, scope: context.scopeAmbulatoryId });
            try {
                approvals.check(preview);
                const guard = await authority(context);
                if (await confirmNativeChatAccessPin(context.session as PairedNativeSession, pin) !== 'confirmed') return deny();
                return executeBooking(preview.command, context.session.userId, context.scopeAmbulatoryId, tx => {
                    guard(tx); selected(context, preview.command.patientId, preview.selection);
                    approvals.check(preview);
                    if (preview.command.archiveGeneration !== archiveGenerationForSession(context.session)) deny();
                });
            } finally { approvals.finish(commandId); }
        },
        async revoke(context: NetworkWriteContext, commandId: string) {
            if (!COMMAND_UUID.test(commandId)) return deny();
            const guard = await authority(context);
            return dbServer.transaction(tx => {
                guard(tx);
                const receipt = receiptFor(tx, commandId);
                if (receipt) {
                    const booked = receipt.checkupId ? tx.select({ patientId: checkups.patientId }).from(checkups).where(eq(checkups.id, receipt.checkupId)).get() : undefined;
                    if (receipt.actorRef !== context.session.userId || (receipt.checkupId && (!booked || !inScope(tx, booked.patientId, context.scopeAmbulatoryId)))) return deny();
                    return { outcome: receipt.outcome };
                }
                approvals.revoke(commandId, { session: context.session, scope: context.scopeAmbulatoryId });
                return { outcome: 'retired' as const };
            }, { behavior: 'immediate' });
        },
        async receipt(context: NetworkWriteContext, commandId: string) {
            if (!COMMAND_UUID.test(commandId)) return deny();
            const guard = await authority(context);
            return dbServer.transaction(tx => {
                guard(tx);
                const receipt = receiptFor(tx, commandId);
                if (!receipt) return { outcome: 'unknown' as const };
                if (receipt.actorRef !== context.session.userId) return deny();
                const current = receipt.checkupId ? tx.select({ version: checkups.version, status: checkups.status, patientId: checkups.patientId })
                    .from(checkups).where(eq(checkups.id, receipt.checkupId)).get() : undefined;
                // An applied booking is shown only to the selection and scope that own its patient.
                if (current) {
                    const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
                    selected(context, current.patientId, owner.snapshotSelectionEpoch(context.session));
                    if (!inScope(tx, current.patientId, context.scopeAmbulatoryId)) deny();
                }
                return { outcome: 'terminal' as const, receipt, current: current ? { version: current.version, status: current.status } : null };
            }, { behavior: 'immediate' });
        },
    };
}
export const chatCheckupBookingService = createChatCheckupBookingService();
