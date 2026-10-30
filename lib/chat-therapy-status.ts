import 'server-only';
import { createNativeChatWriteApprovals } from './native-chat-write-approval';
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { therapies, therapyStatusCommands, patientsToAmbulatories } from './schema';
import type { NetworkWriteContext } from './network-write-context';
import { prepareNetworkPatientCommitGuard } from './network-patient-commit-authority';
import { nativeProfileSelectionOwner } from './security/native-profile-selection-owner';
import { confirmNativeChatAccessPin } from './security/native-chat-access-confirmation';
import { archiveGenerationForSession } from './security/archive-session-generation';
import type { PairedNativeSession } from './security/paired-native-session';
import { executeTherapyStatusInTransaction, TherapyStatusCommandDenied } from './therapy-status-command-service';
import { COMMAND_UUID, parseTherapyStatusCommand, type TherapyStatusExecute } from './therapy-status-command-contract';

const CAPABILITIES = ['network.replica.readonly-therapies', 'network.replica.write-therapies', 'network.replica.readonly-patients'] as const;
const deny = (): never => { throw new TherapyStatusCommandDenied('denied'); };
export function createChatTherapyStatusService(clock: () => number = Date.now) {
    const approvals = createNativeChatWriteApprovals<TherapyStatusExecute>(clock);
    const binding = (context: NetworkWriteContext, epoch: number, resource: string) => ({ session: context.session, scope: context.scopeAmbulatoryId, selection: epoch, resource });
    async function authority(context: NetworkWriteContext) {
        if (context.session.authChannel !== 'native' || context.session.role !== 'admin') return deny();
        const guard = await prepareNetworkPatientCommitGuard(context, CAPABILITIES);
        return (tx: Parameters<typeof guard>[0]) => { if (guard(tx)) deny(); };
    }
    function selected(context: NetworkWriteContext, command: Pick<TherapyStatusExecute, 'patientId'>, epoch: number) {
        const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
        if (owner.snapshotSelectionEpoch(context.session) !== epoch) return deny();
        owner.withLeaseCriticalSection(context.session, selection => {
            if (selection.patientId !== command.patientId || selection.ambulatoryId !== context.scopeAmbulatoryId) deny();
        });
    }
    return {
        async open(context: NetworkWriteContext, patientId: string, epoch: number) {
            if (typeof patientId !== 'string' || !patientId || !Number.isSafeInteger(epoch) || epoch < 0) return deny();
            const guard = await authority(context);
            dbServer.transaction(tx => { guard(tx); selected(context, { patientId }, epoch); }, { behavior: 'immediate' });
            const viewId = approvals.open(binding(context, epoch, patientId));
            return { viewId };
        },
        async preview(context: NetworkWriteContext, value: unknown, epoch: number, viewId: string) {
            if (!parseTherapyStatusCommand(value, true) || !Number.isSafeInteger(epoch) || epoch < 0) return deny();
            const command = Object.freeze({ ...value as TherapyStatusExecute });
            const guard = await authority(context);
            approvals.preview(viewId, binding(context, epoch, command.patientId), command.commandId, command, () => dbServer.transaction(tx => {
                guard(tx); selected(context, command, epoch);
                if (command.archiveGeneration !== archiveGenerationForSession(context.session)) deny();
                const row = tx.select().from(therapies).where(and(eq(therapies.id, command.therapyId), eq(therapies.patientId, command.patientId))).get();
                if (!row || row.deletedAt || row.version !== command.expectedVersion || row.status === command.target
                    || tx.select().from(therapyStatusCommands).where(eq(therapyStatusCommands.commandId, command.commandId)).get()) deny();
            }, { behavior: 'immediate' }));
            return { commandId: command.commandId, status: 'preview' as const };
        },
        async execute(context: NetworkWriteContext, commandId: string, pin: string) {
            const preview = approvals.consume(commandId, { session: context.session, scope: context.scopeAmbulatoryId });
            try {
                approvals.check(preview);
                const guard = await authority(context);
                if (await confirmNativeChatAccessPin(context.session as PairedNativeSession, pin) !== 'confirmed') return deny();
                return dbServer.transaction(tx => {
                    guard(tx); selected(context, preview.command, preview.selection);
                    approvals.check(preview);
                    return executeTherapyStatusInTransaction(tx, preview.command, context.session.userId, context.scopeAmbulatoryId);
                }, { behavior: 'immediate' });
            } finally { approvals.finish(commandId); }
        },
        async revoke(context: NetworkWriteContext, commandId: string) {
            if (!COMMAND_UUID.test(commandId)) return deny();
            const guard = await authority(context);
            return dbServer.transaction(tx => {
                guard(tx);
                const row = tx.select().from(therapyStatusCommands).where(eq(therapyStatusCommands.commandId, commandId)).get();
                if (row) {
                    if (row.actorRef !== context.session.userId || row.archiveGeneration !== archiveGenerationForSession(context.session)
                        || !tx.select().from(patientsToAmbulatories).where(and(eq(patientsToAmbulatories.patientId, row.patientId), eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId))).get()) return deny();
                    return { outcome: row.outcome };
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
                const row = tx.select().from(therapyStatusCommands).where(eq(therapyStatusCommands.commandId, commandId)).get();
                if (!row) return { outcome: 'unknown' as const };
                if (row.actorRef !== context.session.userId || row.archiveGeneration !== archiveGenerationForSession(context.session)) return deny();
                selected(context, row as TherapyStatusExecute, nativeProfileSelectionOwner.registry.acquire(context.session).snapshotSelectionEpoch(context.session));
                const { auditSnapshot: _, ...receipt } = row;
                const current = tx.select({ version: therapies.version, status: therapies.status }).from(therapies).where(eq(therapies.id, row.therapyId)).get();
                return { outcome: 'terminal' as const, receipt, current };
            }, { behavior: 'immediate' });
        },
    };
}
export const chatTherapyStatusService = createChatTherapyStatusService();
