/* @Codex */
import 'server-only';

import { randomUUID } from 'node:crypto';
import { types } from 'node:util';

import { eq } from 'drizzle-orm';

import { dbServer, runDbServerImmediateTransaction } from '../db-server';
import { auditEvents } from '../schema';
import { AUDIT_SCHEMA_VERSION, hashAuditRef } from './audit';

const SOURCE_KEYS = ['now', 'readHostContext'] as const;
const CONTEXT_KEYS = ['status', 'userRef', 'parentRef', 'purposeCode', 'patientId', 'ambulatoryId',
    'generation', 'revocationGeneration', 'selectionEpoch', 'restartGeneration', 'parentGeneration',
    'policyGeneration', 'expiresAt', 'bootstrapExpiresAt'] as const;
const STABLE_CONTEXT_KEYS = CONTEXT_KEYS.filter((key) => key !== 'bootstrapExpiresAt');
const INTENT_KEYS = ['schemaVersion', 'eventType', 'outcome', 'operation', 'capabilityId',
    'policyDecision', 'revisionBinding', 'operationCount', 'writesPerformed', 'applyPolicy',
    'denialCode'] as const;
const INTENT_WITH_DURATION_KEYS = [...INTENT_KEYS.slice(0, 8), 'durationMs', ...INTENT_KEYS.slice(8)] as const;
const TERMINAL_KEYS = [...INTENT_KEYS.slice(0, 8), 'durationMs', 'timestamp', ...INTENT_KEYS.slice(8)] as const;
const BINDING_KEYS = ['generation', 'revocationGeneration', 'selectionEpoch'] as const;
const USER_REF = /^user\.[0-9a-f]{64}$/u;
const PARENT_REF = /^parent\.[0-9a-f]{64}$/u;
const DENIAL_CODES = new Set(['plan_denied', 'policy_unavailable', 'currentness_denied', 'service_denied',
    'output_denied', 'authorization_denied', 'audit_failed', 'timeout', 'cancelled', 'restart_forbidden']);
const OPERATION_ID = 'mediflow.semantic_query_plan.execute.v1';
const { isAsyncFunction, isPromise, isProxy } = types;

type CanonicalRecord = Record<string, unknown>;

export class PortableSupervisorSemanticAuditPortV1Error extends Error {
    constructor(readonly code: 'audit_unavailable' | 'context_unavailable') {
        super(`Portable supervisor semantic audit ${code}`);
        this.name = 'PortableSupervisorSemanticAuditPortV1Error';
    }
}

function fail(code: 'audit_unavailable' | 'context_unavailable' = 'audit_unavailable'): never {
    throw new PortableSupervisorSemanticAuditPortV1Error(code);
}

function exact(value: unknown, keys: readonly string[], canonical: boolean): CanonicalRecord | null {
    try {
        if (!value || typeof value !== 'object' || isProxy(value) || isPromise(value)
            || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if ((canonical && (prototype !== null || !Object.isFrozen(value)))
            || (!canonical && prototype !== null && prototype !== Object.prototype)) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length
            || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output = Object.create(null) as CanonicalRecord;
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)
                || (canonical && (descriptor.writable || descriptor.configurable))) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function integer(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function discardPromise(value: unknown): boolean {
    if (!isPromise(value)) return false;
    try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* denied */ }
    return true;
}

function binding(value: unknown): CanonicalRecord | null {
    const parsed = exact(value, BINDING_KEYS, true);
    return parsed && integer(parsed.generation, 1) && integer(parsed.revocationGeneration)
        && integer(parsed.selectionEpoch) ? parsed : null;
}

function hostContext(value: unknown): CanonicalRecord {
    const parsed = exact(value, CONTEXT_KEYS, true);
    if (!parsed || parsed.status !== 'available' || parsed.purposeCode !== 'care_coordination'
        || typeof parsed.userRef !== 'string' || !USER_REF.test(parsed.userRef)
        || typeof parsed.parentRef !== 'string' || !PARENT_REF.test(parsed.parentRef)
        || typeof parsed.patientId !== 'string' || parsed.patientId.length < 1 || parsed.patientId.length > 256
        || parsed.patientId.trim() !== parsed.patientId
        || typeof parsed.ambulatoryId !== 'string' || parsed.ambulatoryId.length < 1
        || parsed.ambulatoryId.length > 256 || parsed.ambulatoryId.trim() !== parsed.ambulatoryId
        || !integer(parsed.generation, 1) || !integer(parsed.revocationGeneration)
        || !integer(parsed.selectionEpoch) || !integer(parsed.restartGeneration, 1)
        || !integer(parsed.parentGeneration, 1) || !integer(parsed.policyGeneration, 1)
        || !integer(parsed.expiresAt, 1) || !integer(parsed.bootstrapExpiresAt, 1)
        || parsed.bootstrapExpiresAt > parsed.expiresAt) return fail('context_unavailable');
    return parsed;
}

function sameContext(left: CanonicalRecord, right: CanonicalRecord): boolean {
    return STABLE_CONTEXT_KEYS.every((key) => left[key] === right[key])
        && (right.bootstrapExpiresAt as number) >= (left.bootstrapExpiresAt as number);
}

function auditShape(value: unknown, terminal: boolean): CanonicalRecord {
    const keys = terminal ? TERMINAL_KEYS : INTENT_KEYS;
    const parsed = exact(value, keys, true)
        ?? (!terminal ? exact(value, INTENT_WITH_DURATION_KEYS, true) : null);
    if (!parsed || parsed.schemaVersion !== 'mediflow.aip.audit.v1'
        || parsed.eventType !== 'semantic_query_plan_execution' || parsed.operation !== OPERATION_ID
        || parsed.capabilityId !== OPERATION_ID || !integer(parsed.operationCount)
        || parsed.operationCount > 2 || parsed.writesPerformed !== 0 || parsed.applyPolicy !== 'none') {
        return fail();
    }
    const parsedBinding = parsed.revisionBinding === null ? null : binding(parsed.revisionBinding);
    if (parsed.revisionBinding !== null && !parsedBinding) return fail();
    if (parsed.outcome === 'allowed') {
        if (parsed.policyDecision !== 'allowed' || !parsedBinding || parsed.operationCount < 1
            || parsed.denialCode !== null) return fail();
    } else if (parsed.outcome === 'denied') {
        if (parsed.policyDecision !== 'denied' || typeof parsed.denialCode !== 'string'
            || !DENIAL_CODES.has(parsed.denialCode)) return fail();
    } else return fail();
    if ('durationMs' in parsed && (!integer(parsed.durationMs) || parsed.durationMs > 250)) return fail();
    if (terminal && (!integer(parsed.timestamp) || !integer(parsed.durationMs))) return fail();
    return parsed;
}

function sameBinding(left: unknown, right: CanonicalRecord): boolean {
    const parsed = left === null ? null : binding(left);
    return parsed === null || (parsed.generation === right.generation
        && parsed.revocationGeneration === right.revocationGeneration
        && parsed.selectionEpoch === right.selectionEpoch);
}

function coherent(intent: CanonicalRecord, terminal: CanonicalRecord): boolean {
    for (const key of INTENT_KEYS) {
        if (key === 'revisionBinding') {
            const left = intent[key], right = terminal[key];
            if ((left === null) !== (right === null)) return false;
            if (left !== null) {
                const leftBinding = binding(left), rightBinding = binding(right);
                if (!leftBinding || !rightBinding || BINDING_KEYS.some((item) => leftBinding[item] !== rightBinding[item])) {
                    return false;
                }
            }
        } else if (intent[key] !== terminal[key]) return false;
    }
    return !('durationMs' in intent) || intent.durationMs === terminal.durationMs;
}

function metadata(terminal: CanonicalRecord): string {
    const current = terminal.revisionBinding === null ? null : binding(terminal.revisionBinding)!;
    return JSON.stringify({
        flags: [
            `operation:${terminal.operation}`,
            `capability:${terminal.capabilityId}`,
            `outcome:${terminal.outcome}`,
            `policy:${terminal.policyDecision}`,
            ...(current ? [`generation:${current.generation}`,
                `revocation_generation:${current.revocationGeneration}`,
                `selection_epoch:${current.selectionEpoch}`] : []),
            `duration_ms:${terminal.durationMs}`,
            `writes:${terminal.writesPerformed}`,
            `apply:${terminal.applyPolicy}`,
        ],
        counts: terminal.operationCount,
        ...(terminal.denialCode === null ? {} : { reasonCode: terminal.denialCode }),
    });
}

/** Persists one synchronous terminal semantic-query audit under the SQLite writer lock. */
export function createPortableSupervisorSemanticAuditPortV1(sourcesValue: unknown) {
    const sources = exact(sourcesValue, SOURCE_KEYS, false);
    if (!sources || typeof sources.now !== 'function' || isProxy(sources.now) || isAsyncFunction(sources.now)
        || typeof sources.readHostContext !== 'function' || isProxy(sources.readHostContext)
        || isAsyncFunction(sources.readHostContext)) return fail();
    const nowSource = sources.now as () => unknown;
    const readHostContext = sources.readHostContext as () => unknown;
    let lastNow = -1;
    const now = (): number => {
        let value: unknown;
        try { value = nowSource(); } catch { return fail(); }
        if (discardPromise(value) || !integer(value) || value < lastNow) return fail();
        lastNow = value;
        return value;
    };
    const readContext = (): CanonicalRecord => {
        let value: unknown;
        try { value = readHostContext(); } catch (error) { throw error; }
        if (discardPromise(value)) return fail('context_unavailable');
        return hostContext(value);
    };
    return function commitTerminalAudit(intentValue: unknown, decideAtCommit: () => unknown): unknown {
        const intent = auditShape(intentValue, false);
        if (typeof decideAtCommit !== 'function' || isProxy(decideAtCommit)
            || isAsyncFunction(decideAtCommit)) return fail();
        return runDbServerImmediateTransaction(() => {
            const beforeContext = readContext();
            const beforeNow = now();
            if (beforeNow >= (beforeContext.bootstrapExpiresAt as number)
                || beforeNow >= (beforeContext.expiresAt as number)) return fail('context_unavailable');
            let terminalValue: unknown;
            try { terminalValue = decideAtCommit(); } catch (error) { throw error; }
            if (discardPromise(terminalValue)) return fail();
            const terminal = auditShape(terminalValue, true);
            const afterContext = readContext();
            const afterNow = now();
            if (!sameContext(beforeContext, afterContext)
                || afterNow >= (afterContext.bootstrapExpiresAt as number)
                || afterNow >= (afterContext.expiresAt as number)
                || !coherent(intent, terminal) || !sameBinding(terminal.revisionBinding, afterContext)
                || (terminal.timestamp as number) < beforeNow || (terminal.timestamp as number) > afterNow
                || (terminal.timestamp as number) >= (afterContext.expiresAt as number)) {
                return fail('context_unavailable');
            }
            const eventId = randomUUID(), occurredAt = new Date(terminal.timestamp as number);
            const redactedMetadata = metadata(terminal);
            // Re-hash opaque context refs: audit linkage stays stable without exposing operational refs.
            const actorRef = hashAuditRef(afterContext.userRef as string);
            const subjectRef = hashAuditRef(afterContext.parentRef as string);
            dbServer.insert(auditEvents).values({ eventId, schemaVersion: AUDIT_SCHEMA_VERSION,
                eventType: 'agent.semantic_query.executed', occurredAt,
                outcome: terminal.outcome === 'allowed' ? 'success' : 'denied', actorType: 'user', actorRef,
                subjectType: 'agent_operation', subjectRef, sourceSurface: 'api', requestId: null,
                redactedMetadata, createdAt: occurredAt }).run();
            const stored = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, eventId)).get();
            const storedTime = Math.floor((terminal.timestamp as number) / 1_000) * 1_000;
            if (!stored || stored.schemaVersion !== AUDIT_SCHEMA_VERSION
                || stored.eventType !== 'agent.semantic_query.executed'
                || stored.outcome !== (terminal.outcome === 'allowed' ? 'success' : 'denied')
                || stored.actorType !== 'user' || stored.actorRef !== actorRef
                || stored.subjectType !== 'agent_operation' || stored.subjectRef !== subjectRef
                || stored.sourceSurface !== 'api' || stored.requestId !== null
                || stored.redactedMetadata !== redactedMetadata || !(stored.occurredAt instanceof Date)
                || stored.occurredAt.getTime() !== storedTime || !(stored.createdAt instanceof Date)
                || stored.createdAt.getTime() !== storedTime) return fail();
            return terminalValue;
        });
    };
}
