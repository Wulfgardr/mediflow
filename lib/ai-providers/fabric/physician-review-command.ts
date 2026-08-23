/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../../db-server';
import {
    auditEvents,
    durableReviewCommandOperations,
    durableReviewCommandStates,
    durableReviewRecords,
} from '../../schema';

export type PhysicianReviewAction = 'accept' | 'reject' | 'supersede';
type PhysicianReviewState = 'accepted' | 'rejected' | 'superseded';
export type PhysicianReviewCommandErrorCode = 'invalid_command' | 'context_unavailable' | 'actor_forbidden' | 'gesture_invalid' | 'uncertainty_acknowledgment_required' | 'missing' | 'revision_conflict' | 'idempotency_conflict' | 'terminal' | 'corrupt' | 'storage_unavailable';
export class PhysicianReviewCommandError extends Error {
    constructor(public readonly code: PhysicianReviewCommandErrorCode) { super(`Physician review command rejected: ${code}`); }
}
export type PhysicianReviewCommandSources = Readonly<{
    resolveContext: () => unknown;
    consumeGesture: (scope: Readonly<{ proof: string; action: PhysicianReviewAction; reviewId: string; expectedRevision: number }>) => unknown;
    eventId: () => unknown;
    now: () => unknown;
}>;
type Command = Readonly<{ action: PhysicianReviewAction; expectedRevision: number; idempotencyKey: string; gestureProof: string; uncertaintyAcknowledged: boolean }>;
type Context = Readonly<{ reviewId: string; actorRef: string; role: 'physician'; uncertaintyAcknowledgmentRequired: boolean }>;
export type PhysicianReviewCommandResult = Readonly<{ reviewId: string; state: PhysicianReviewState; revision: number; eventId: string }>;

const REVIEW = /^review_[0-9a-f]{32}$/u; const ACTOR = /^actor_[0-9a-f]{32}$/u; const EVENT = /^event_[0-9a-f]{32}$/u;
const KEY = /^idem_[a-z0-9]{16,160}$/u; const GESTURE = /^gesture_[0-9a-f]{32}$/u;
const COMMAND_KEYS = ['action', 'expectedRevision', 'idempotencyKey', 'gestureProof', 'uncertaintyAcknowledged'] as const;
const CONTEXT_KEYS = ['reviewId', 'actorRef', 'role', 'uncertaintyAcknowledgmentRequired'] as const;
const RESULT_KEYS = ['reviewId', 'state', 'revision', 'eventId'] as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stateFor = (action: PhysicianReviewAction): PhysicianReviewState => action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'superseded';
function fail(code: PhysicianReviewCommandErrorCode): never { throw new PhysicianReviewCommandError(code); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable);
}
function command(value: unknown): Command {
    if (!exact(value, COMMAND_KEYS)) return fail('invalid_command');
    const { action, expectedRevision, idempotencyKey, gestureProof, uncertaintyAcknowledged } = value;
    if ((action !== 'accept' && action !== 'reject' && action !== 'supersede') || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey) || typeof gestureProof !== 'string' || !GESTURE.test(gestureProof) || typeof uncertaintyAcknowledged !== 'boolean') return fail('invalid_command');
    return Object.freeze({ action, expectedRevision: expectedRevision as number, idempotencyKey, gestureProof, uncertaintyAcknowledged });
}
function context(value: unknown): Context {
    if (!exact(value, CONTEXT_KEYS)) return fail('context_unavailable');
    const { reviewId, actorRef, role, uncertaintyAcknowledgmentRequired } = value;
    if (typeof reviewId !== 'string' || !REVIEW.test(reviewId) || typeof actorRef !== 'string' || !ACTOR.test(actorRef) || typeof uncertaintyAcknowledgmentRequired !== 'boolean') return fail('context_unavailable');
    if (role !== 'physician') return fail('actor_forbidden');
    return Object.freeze({ reviewId, actorRef, role, uncertaintyAcknowledgmentRequired });
}
function result(value: unknown): PhysicianReviewCommandResult {
    if (!exact(value, RESULT_KEYS)) return fail('corrupt');
    const { reviewId, state, revision, eventId } = value;
    if (typeof reviewId !== 'string' || !REVIEW.test(reviewId) || (state !== 'accepted' && state !== 'rejected' && state !== 'superseded') || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 2 || typeof eventId !== 'string' || !EVENT.test(eventId)) return fail('corrupt');
    return Object.freeze({ reviewId, state, revision: revision as number, eventId });
}
function storage(error: unknown): never { if (error instanceof PhysicianReviewCommandError) throw error; return fail('storage_unavailable'); }

/** Runs one host-resolved, gesture-bound terminal review transition. It cannot apply clinical data. */
export function createPhysicianReviewCommandService(sources: PhysicianReviewCommandSources) {
    return Object.freeze({ execute(value: unknown): PhysicianReviewCommandResult {
        const input = command(value); let resolved: Context;
        try { resolved = context(sources.resolveContext()); } catch (error) { if (error instanceof PhysicianReviewCommandError) throw error; return fail('context_unavailable'); }
        if (input.action === 'accept' && resolved.uncertaintyAcknowledgmentRequired && !input.uncertaintyAcknowledged) fail('uncertainty_acknowledgment_required');
        const state = stateFor(input.action); const commandDigest = digest(JSON.stringify([input.action, input.expectedRevision, input.uncertaintyAcknowledged]));
        try {
            const replay = dbServer.select().from(durableReviewCommandOperations).where(and(eq(durableReviewCommandOperations.reviewId, resolved.reviewId), eq(durableReviewCommandOperations.idempotencyKey, input.idempotencyKey))).get();
            if (replay) {
                if (replay.commandDigest !== commandDigest) fail('idempotency_conflict');
                const parsed = result(JSON.parse(replay.resultSnapshot) as unknown);
                if (parsed.reviewId !== resolved.reviewId || parsed.eventId !== replay.auditEventId) fail('corrupt');
                return parsed;
            }
        } catch (error) { return storage(error); }
        let gesture: unknown;
        try { gesture = sources.consumeGesture(Object.freeze({ proof: input.gestureProof, action: input.action, reviewId: resolved.reviewId, expectedRevision: input.expectedRevision })); } catch { return fail('gesture_invalid'); }
        if (gesture !== true) return fail('gesture_invalid');
        let eventId: unknown; let now: unknown;
        try { eventId = sources.eventId(); now = sources.now(); } catch { return fail('context_unavailable'); }
        if (typeof eventId !== 'string' || !EVENT.test(eventId) || typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) return fail('context_unavailable');
        const resolvedEventId = eventId; const occurredAt = now;
        try {
            return runDbServerImmediateTransaction(() => {
                const replay = dbServer.select().from(durableReviewCommandOperations).where(and(eq(durableReviewCommandOperations.reviewId, resolved.reviewId), eq(durableReviewCommandOperations.idempotencyKey, input.idempotencyKey))).get();
                if (replay) {
                    if (replay.commandDigest !== commandDigest) fail('idempotency_conflict');
                    const parsed = result(JSON.parse(replay.resultSnapshot) as unknown);
                    if (parsed.reviewId !== resolved.reviewId || parsed.eventId !== replay.auditEventId) fail('corrupt');
                    return parsed;
                }
                const record = dbServer.select({ reviewRevision: durableReviewRecords.reviewRevision }).from(durableReviewRecords).where(eq(durableReviewRecords.id, resolved.reviewId)).get();
                if (!record) fail('missing');
                if (record.reviewRevision !== input.expectedRevision) fail('revision_conflict');
                const current = dbServer.select().from(durableReviewCommandStates).where(eq(durableReviewCommandStates.reviewId, resolved.reviewId)).get();
                if (current) fail('terminal');
                const outcome = Object.freeze({ reviewId: resolved.reviewId, state, revision: input.expectedRevision + 1, eventId: resolvedEventId });
                dbServer.insert(durableReviewCommandStates).values({ reviewId: outcome.reviewId, reviewState: outcome.state, revision: outcome.revision, action: input.action }).run();
                dbServer.insert(auditEvents).values({ eventId: outcome.eventId, schemaVersion: 1, eventType: `ai.review.${outcome.state}`, occurredAt: new Date(occurredAt), outcome: 'success', actorType: 'user', actorRef: resolved.actorRef, subjectType: 'ai_review', subjectRef: outcome.reviewId, sourceSurface: 'api', requestId: null, redactedMetadata: JSON.stringify({ flags: [input.action, outcome.state, `digest_${commandDigest}`], resourceVersion: outcome.revision }), createdAt: new Date(occurredAt) }).run();
                dbServer.insert(durableReviewCommandOperations).values({ id: digest(`${outcome.reviewId}\0${input.idempotencyKey}`), reviewId: outcome.reviewId, idempotencyKey: input.idempotencyKey, commandDigest, resultSnapshot: JSON.stringify(outcome), auditEventId: outcome.eventId }).run();
                return result(outcome);
            });
        } catch (error) { return storage(error); }
    } });
}
