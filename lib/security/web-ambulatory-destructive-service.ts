import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { auditEvents, users } from '../schema';
import { assertArchiveGeneration } from '../archive-generation';
import { clearAmbulatoryInTransaction, deleteAmbulatoryInTransaction } from '../ambulatory-write';
import { inspectAmbulatoryDestructivePlan, type AmbulatoryPlanBinding } from '../ambulatory-destructive-command-plan';
import { AMBULATORY_COMMAND_PROTOCOL, commandObject, commandOpaqueId, commandOperation, commandVersion } from '../ambulatory-destructive-command-contract';
import { isCurrentServerSession } from './current-session-authority';
import { verifyHostCredentials } from './host-credential-verification';
import { isValidConfirmationPin } from './pin-input';
import type { WebSessionProjection } from './web-auth-lifecycle-owner-adapter';

export const WEB_AMBULATORY_COMMAND_CAPACITY = 32;
export const WEB_AMBULATORY_PREPARATION_MS = 300_000;
export type WebAmbulatoryAccess = Readonly<{ session: WebSessionProjection; generation: string }>;
type Reply = { status: number; value: Record<string, unknown> };
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Prepared = { sessionId: string; userId: string; binding: AmbulatoryPlanBinding; planDigest: string;
    counts: ReturnType<typeof inspectAmbulatoryDestructivePlan>['counts']; expiresAt: number; verifying: boolean };

const reply = (status: number, code: string, extra: Record<string, unknown> = {}): Reply => ({ status, value: { code, ...extra } });
const blockedPlan: Record<string, Reply> = {
    target_missing: reply(404, 'AMBULATORY_NOT_FOUND'),
    version_conflict: reply(409, 'VERSION_CONFLICT'),
    linked_patients: reply(409, 'AMBULATORY_HAS_PATIENTS'),
    child_ambulatories: reply(409, 'AMBULATORY_HAS_CHILDREN'),
    last_default: reply(409, 'LAST_AMBULATORY'),
    fallback_ambiguous: reply(409, 'SET_ANOTHER_DEFAULT_FIRST'),
    test_only: reply(409, 'AMBULATORY_NOT_TEST'),
    version_exhausted: reply(409, 'VERSION_EXHAUSTED'),
};

/** ADR 0201: the host Web reaches ADR 0169 delete and clear only through a shown plan and a fresh PIN. */
export function createWebAmbulatoryDestructiveService(options: {
    now?: () => number; verifyPin?: typeof verifyHostCredentials;
} = {}) {
    const now = options.now ?? Date.now;
    const verifyPin = options.verifyPin ?? verifyHostCredentials;
    const prepared = new Map<string, Prepared>();

    function adminStillCurrent(tx: Tx, session: WebSessionProjection, generation: string): boolean {
        assertArchiveGeneration(tx, generation);
        if (session.role !== 'admin' || !isCurrentServerSession(session)) return false;
        const user = tx.select({ role: users.role, username: users.username }).from(users).where(eq(users.id, session.userId)).get();
        return user?.role === 'admin' && user.username === session.username;
    }
    function prune(): void {
        for (const [reference, entry] of prepared) if (!entry.verifying && now() >= entry.expiresAt) prepared.delete(reference);
    }

    return {
        prepare(access: WebAmbulatoryAccess, input: unknown): Reply {
            if (!commandObject(input, ['operation', 'ambulatoryId', 'expectedVersion']) || !commandOperation(input.operation)
                || !commandOpaqueId(input.ambulatoryId) || !commandVersion(input.expectedVersion)) return reply(400, 'AMBULATORY_COMMAND_INPUT_INVALID');
            const { session, generation } = access;
            prune();
            if (prepared.size >= WEB_AMBULATORY_COMMAND_CAPACITY) return reply(503, 'AMBULATORY_COMMAND_CAPACITY');
            const binding: AmbulatoryPlanBinding = {
                protocol: AMBULATORY_COMMAND_PROTOCOL, commandId: randomUUID(), originalArchiveGeneration: generation,
                originalScopeId: input.ambulatoryId, ambulatoryId: input.ambulatoryId, expectedVersion: input.expectedVersion,
                operation: input.operation, actorRef: session.userId, deviceId: 'host-web', devicePlatform: 'web',
                deviceTokenHash: createHash('sha256').update(session.id).digest('hex'),
            };
            return dbServer.transaction((tx): Reply => {
                if (!adminStillCurrent(tx, session, generation)) return reply(403, 'LOCAL_ADMIN_REQUIRED');
                const plan = inspectAmbulatoryDestructivePlan(tx, binding);
                if (plan.reason) return blockedPlan[plan.reason] ?? reply(409, 'AMBULATORY_PLAN_NOT_ADMISSIBLE');
                const reference = randomBytes(32).toString('hex'), expiresAt = now() + WEB_AMBULATORY_PREPARATION_MS;
                prepared.set(reference, { sessionId: session.id, userId: session.userId, binding: Object.freeze(binding),
                    planDigest: plan.planDigest, counts: plan.counts, expiresAt, verifying: false });
                return { status: 200, value: { reference, operation: binding.operation, expiresAt,
                    target: { id: plan.target!.id, name: plan.target!.name, version: plan.target!.version },
                    fallback: plan.fallback ? { id: plan.fallback.id, name: plan.fallback.name } : null, counts: plan.counts } };
            }, { behavior: 'immediate' });
        },

        async execute(request: Request, access: WebAmbulatoryAccess, input: unknown): Promise<Reply> {
            if (!commandObject(input, ['reference', 'pin']) || typeof input.reference !== 'string' || !/^[a-f0-9]{64}$/u.test(input.reference)
                || typeof input.pin !== 'string' || !isValidConfirmationPin(input.pin)) return reply(400, 'AMBULATORY_COMMAND_INPUT_INVALID');
            const reference = input.reference, { session, generation } = access;
            const entry = prepared.get(reference);
            if (!entry) return reply(409, 'AMBULATORY_COMMAND_UNKNOWN');
            if (entry.sessionId !== session.id || entry.userId !== session.userId
                || entry.binding.originalArchiveGeneration !== generation) return reply(403, 'AMBULATORY_COMMAND_DENIED');
            if (entry.verifying) return reply(409, 'AMBULATORY_COMMAND_ALREADY_SENT');
            if (now() >= entry.expiresAt) { prepared.delete(reference); return reply(409, 'AMBULATORY_PREPARATION_EXPIRED'); }
            entry.verifying = true;
            let verified: Awaited<ReturnType<typeof verifyHostCredentials>>;
            try { verified = await verifyPin({ username: session.username, pin: input.pin }); }
            finally { entry.verifying = false; }
            if (verified.kind !== 'verified' || verified.account.id !== session.userId) {
                const locked = verified.kind === 'denied' && verified.failureClass === 'locked';
                return reply(locked ? 423 : 403, locked ? 'PIN_LOCKED' : 'PIN_DENIED');
            }
            prepared.delete(reference);
            if (now() >= entry.expiresAt) return reply(409, 'AMBULATORY_PREPARATION_EXPIRED');
            const { binding } = entry;
            return dbServer.transaction((tx): Reply => {
                if (!adminStillCurrent(tx, session, generation)) return reply(403, 'LOCAL_ADMIN_REQUIRED');
                const plan = inspectAmbulatoryDestructivePlan(tx, binding);
                if (plan.reason || plan.planDigest !== entry.planDigest) return reply(409, 'AMBULATORY_PLAN_CHANGED');
                const context = { request: new Request(request.url, { headers: { 'x-request-id': binding.commandId } }), session };
                const result = binding.operation === 'ambulatory.clear-test.v1'
                    ? clearAmbulatoryInTransaction(tx, context, binding.ambulatoryId, binding.expectedVersion, 'host', undefined)
                    : deleteAmbulatoryInTransaction(tx, context, binding.ambulatoryId, binding.expectedVersion, 'host', undefined);
                if (result.status !== 200) throw new Error('Admitted ambulatory plan did not commit');
                const terminalEvent = binding.operation === 'ambulatory.clear-test.v1' ? 'ambulatory.cleared' : 'ambulatory.deleted';
                if (!tx.select({ id: auditEvents.eventId }).from(auditEvents).where(and(eq(auditEvents.requestId, binding.commandId),
                    eq(auditEvents.eventType, terminalEvent), eq(auditEvents.subjectRef, binding.ambulatoryId))).get())
                    throw new Error('Ambulatory command committed without its audit event');
                return { status: 200, value: { outcome: 'applied', operation: binding.operation, commandId: binding.commandId,
                    ambulatoryId: binding.ambulatoryId, counts: entry.counts,
                    version: binding.operation === 'ambulatory.clear-test.v1' ? binding.expectedVersion + 1 : null,
                    affectedAmbulatories: binding.operation === 'ambulatory.delete.v1' ? result.value.affectedAmbulatories : [] } };
            }, { behavior: 'immediate' });
        },
    };
}

const processOwnerKey = Symbol.for('mediflow.web-ambulatory-destructive-service.v1');
const processOwners = globalThis as typeof globalThis & {
    [processOwnerKey]?: ReturnType<typeof createWebAmbulatoryDestructiveService>;
};
export const webAmbulatoryDestructiveService = processOwners[processOwnerKey] ??= createWebAmbulatoryDestructiveService();
