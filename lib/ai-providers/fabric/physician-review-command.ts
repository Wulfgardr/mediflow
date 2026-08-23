/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../../db-server';
import { auditEvents, durableReviewCommandOperations, durableReviewCommandStates, durableReviewRecords } from '../../schema';

export type PhysicianReviewAction = 'accept' | 'reject';
type PhysicianReviewState = 'accepted' | 'rejected';
export type PhysicianReviewCommandErrorCode = 'invalid_command' | 'context_unavailable' | 'actor_forbidden' | 'gesture_invalid' | 'uncertainty_acknowledgment_required' | 'missing' | 'revision_conflict' | 'idempotency_conflict' | 'terminal' | 'corrupt' | 'storage_unavailable';
export class PhysicianReviewCommandError extends Error {
    constructor(public readonly code: PhysicianReviewCommandErrorCode) { super(`Physician review command rejected: ${code}`); }
}
export type PhysicianReviewCommandSources = Readonly<{
    resolveContext: () => unknown;
    consumeGesture: (scope: Readonly<{ proof: string; actorRef: string; action: PhysicianReviewAction; reviewId: string; expectedRevision: number }>) => unknown;
    eventId: () => unknown;
    now: () => unknown;
}>;
type Command = Readonly<{ action: PhysicianReviewAction; expectedRevision: number; idempotencyKey: string; gestureProof: string; uncertaintyAcknowledged: boolean }>;
type Context = Readonly<{ reviewId: string; actorRef: string; uncertaintyAcknowledgmentRequired: boolean }>;
export type PhysicianReviewCommandResult = Readonly<{ reviewId: string; state: PhysicianReviewState; revision: number; eventId: string }>;

const REVIEW = /^review_[0-9a-f]{32}$/u; const EVENT = /^event_[0-9a-f]{32}$/u;
const KEY = /^idem_[a-z0-9]{16,160}$/u; const GESTURE = /^gesture_[0-9a-f]{32}$/u;
const COMMAND_KEYS = ['action', 'expectedRevision', 'idempotencyKey', 'gestureProof', 'uncertaintyAcknowledged'] as const;
const CONTEXT_KEYS = ['reviewId', 'actorRef', 'uncertaintyAcknowledgmentRequired'] as const;
const RESULT_KEYS = ['reviewId', 'state', 'revision', 'eventId'] as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stateFor = (action: PhysicianReviewAction): PhysicianReviewState => action === 'accept' ? 'accepted' : 'rejected';
function fail(code: PhysicianReviewCommandErrorCode): never { throw new PhysicianReviewCommandError(code); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]! && descriptors[key]!.enumerable);
}
function command(value: unknown): Command {
    if (!exact(value, COMMAND_KEYS)) return fail('invalid_command');
    const { action, expectedRevision, idempotencyKey, gestureProof, uncertaintyAcknowledged } = value;
    if ((action !== 'accept' && action !== 'reject') || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey) || typeof gestureProof !== 'string' || !GESTURE.test(gestureProof) || typeof uncertaintyAcknowledged !== 'boolean') return fail('invalid_command');
    return Object.freeze({ action, expectedRevision, idempotencyKey, gestureProof, uncertaintyAcknowledged });
}
function context(value: unknown): Context {
    if (!exact(value, CONTEXT_KEYS)) return fail('context_unavailable');
    const { reviewId, actorRef, uncertaintyAcknowledgmentRequired } = value;
    if (typeof reviewId !== 'string' || !REVIEW.test(reviewId) || typeof actorRef !== 'string' || actorRef.length === 0 || actorRef.length > 256 || actorRef !== actorRef.trim() || typeof uncertaintyAcknowledgmentRequired !== 'boolean') return fail('context_unavailable');
    return Object.freeze({ reviewId, actorRef, uncertaintyAcknowledgmentRequired });
}
function result(value: unknown): PhysicianReviewCommandResult {
    if (!exact(value, RESULT_KEYS)) return fail('corrupt');
    const { reviewId, state, revision, eventId } = value;
    if (typeof reviewId !== 'string' || !REVIEW.test(reviewId) || (state !== 'accepted' && state !== 'rejected') || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 2 || typeof eventId !== 'string' || !EVENT.test(eventId)) return fail('corrupt');
    return Object.freeze({ reviewId, state, revision, eventId });
}
function replayResult(snapshot: string): PhysicianReviewCommandResult {
    try { return result(JSON.parse(snapshot) as unknown); } catch (error) { if (error instanceof PhysicianReviewCommandError) throw error; return fail('corrupt'); }
}
function storage(error: unknown): never { if (error instanceof PhysicianReviewCommandError) throw error; return fail('storage_unavailable'); }
function commandDigest(input: Command, actorRef: string): string { return digest(JSON.stringify([input.action, input.expectedRevision, input.uncertaintyAcknowledged, digest(input.gestureProof), actorRef])); }
function operationId(reviewId: string, idempotencyKey: string): string { return digest(`${reviewId}\0${idempotencyKey}`); }
function metadata(input: Command, state: PhysicianReviewState, digestValue: string, revision: number): string {
    return JSON.stringify({ flags: [input.action, state, `digest_${digestValue}`], resourceVersion: revision });
}

/** Validates the complete durable replay receipt, including its append-only PHI-safe audit event. */
function replay(resolved: Context, input: Command, digestValue: string): PhysicianReviewCommandResult | null {
    const operation = dbServer.select().from(durableReviewCommandOperations).where(and(eq(durableReviewCommandOperations.reviewId, resolved.reviewId), eq(durableReviewCommandOperations.idempotencyKey, input.idempotencyKey))).get();
    if (!operation) return null;
    if (operation.id !== operationId(resolved.reviewId, input.idempotencyKey)) fail('corrupt');
    if (operation.commandDigest !== digestValue) fail('idempotency_conflict');
    const parsed = replayResult(operation.resultSnapshot); const state = stateFor(input.action);
    if (parsed.reviewId !== resolved.reviewId || parsed.state !== state || parsed.revision !== input.expectedRevision + 1 || parsed.eventId !== operation.auditEventId) fail('corrupt');
    const stored = dbServer.select().from(durableReviewCommandStates).where(eq(durableReviewCommandStates.reviewId, resolved.reviewId)).get();
    if (!stored || stored.reviewState !== state || stored.action !== input.action || stored.revision !== parsed.revision) fail('corrupt');
    const audit = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, parsed.eventId)).get();
    if (!audit || audit.schemaVersion !== 1 || audit.eventType !== `ai.review.${state}` || audit.outcome !== 'success' || audit.actorType !== 'user' || audit.actorRef !== resolved.actorRef || audit.subjectType !== 'ai_review' || audit.subjectRef !== resolved.reviewId || audit.sourceSurface !== 'api' || audit.requestId !== null || audit.redactedMetadata !== metadata(input, state, digestValue, parsed.revision) || !(audit.occurredAt instanceof Date) || !(audit.createdAt instanceof Date)) fail('corrupt');
    return parsed;
}
function preflight(resolved: Context, input: Command): void {
    const record = dbServer.select({ reviewRevision: durableReviewRecords.reviewRevision }).from(durableReviewRecords).where(eq(durableReviewRecords.id, resolved.reviewId)).get();
    if (!record) fail('missing');
    if (record.reviewRevision !== input.expectedRevision) fail('revision_conflict');
    if (dbServer.select({ reviewId: durableReviewCommandStates.reviewId }).from(durableReviewCommandStates).where(eq(durableReviewCommandStates.reviewId, resolved.reviewId)).get()) fail('terminal');
}

/** Runs one host-resolved review transition. A concurrent winner or audit rollback may consume a proof; callers fail closed and obtain a new proof before retrying. */
export function createPhysicianReviewCommandService(sources: PhysicianReviewCommandSources) {
    return Object.freeze({ execute(value: unknown): PhysicianReviewCommandResult {
        const input = command(value); let resolved: Context;
        try { resolved = context(sources.resolveContext()); } catch (error) { if (error instanceof PhysicianReviewCommandError) throw error; return fail('context_unavailable'); }
        if (input.action === 'accept' && resolved.uncertaintyAcknowledgmentRequired && !input.uncertaintyAcknowledged) fail('uncertainty_acknowledgment_required');
        const digestValue = commandDigest(input, resolved.actorRef);
        try { const previous = replay(resolved, input, digestValue); if (previous) return previous; preflight(resolved, input); } catch (error) { return storage(error); }
        let gesture: unknown;
        try { gesture = sources.consumeGesture(Object.freeze({ proof: input.gestureProof, actorRef: resolved.actorRef, action: input.action, reviewId: resolved.reviewId, expectedRevision: input.expectedRevision })); } catch { return fail('gesture_invalid'); }
        if (gesture !== true) return fail('gesture_invalid');
        let eventId: unknown; let now: unknown;
        try { eventId = sources.eventId(); now = sources.now(); } catch { return fail('context_unavailable'); }
        if (typeof eventId !== 'string' || !EVENT.test(eventId) || typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) return fail('context_unavailable');
        const state = stateFor(input.action); const outcome = Object.freeze({ reviewId: resolved.reviewId, state, revision: input.expectedRevision + 1, eventId });
        try { return runDbServerImmediateTransaction(() => {
            const previous = replay(resolved, input, digestValue); if (previous) return previous;
            preflight(resolved, input);
            dbServer.insert(durableReviewCommandStates).values({ reviewId: outcome.reviewId, reviewState: outcome.state, revision: outcome.revision, action: input.action }).run();
            dbServer.insert(auditEvents).values({ eventId: outcome.eventId, schemaVersion: 1, eventType: `ai.review.${outcome.state}`, occurredAt: new Date(now), outcome: 'success', actorType: 'user', actorRef: resolved.actorRef, subjectType: 'ai_review', subjectRef: outcome.reviewId, sourceSurface: 'api', requestId: null, redactedMetadata: metadata(input, outcome.state, digestValue, outcome.revision), createdAt: new Date(now) }).run();
            dbServer.insert(durableReviewCommandOperations).values({ id: operationId(outcome.reviewId, input.idempotencyKey), reviewId: outcome.reviewId, idempotencyKey: input.idempotencyKey, commandDigest: digestValue, resultSnapshot: JSON.stringify(outcome), auditEventId: outcome.eventId }).run();
            return result(outcome);
        }); } catch (error) { return storage(error); }
    } });
}
