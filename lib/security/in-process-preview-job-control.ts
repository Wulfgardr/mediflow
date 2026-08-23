/* @Codex */

export type InProcessPreviewJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'revoked';
export type InProcessPreviewJobErrorCode = 'input_invalid' | 'dependency_unavailable' | 'idempotency_conflict' | 'job_ref_conflict' | 'revision_conflict' | 'job_missing' | 'job_terminal' | 'transition_invalid' | 'lease_expired' | 'lease_revoked' | 'rate_limited';
export class InProcessPreviewJobError extends Error {
    constructor(readonly code: InProcessPreviewJobErrorCode) { super('Preview job operation rejected.'); this.name = 'InProcessPreviewJobError'; }
}
export type InProcessPreviewJobScope = Readonly<{ agentRef: string; capabilityId: string; sessionRef: string; leaseRef: string }>;
export type InProcessPreviewJob = Readonly<{ jobRef: string; revision: number; state: InProcessPreviewJobState }>;
export type InProcessPreviewJobControlSources = Readonly<{
    clock: () => number;
    jobRef: () => string;
    leaseGuard: Readonly<{ status: (scope: InProcessPreviewJobScope, now: number) => 'active' | 'expired' | 'revoked' }>;
    rateLimitPolicy: Readonly<{ consume: (scope: Readonly<Pick<InProcessPreviewJobScope, 'agentRef' | 'capabilityId' | 'sessionRef'>>, now: number) => 'allowed' | 'rate_limited' }>;
}>;
type Submit = Readonly<{ scope: InProcessPreviewJobScope; idempotencyKey: string; commandDigest: string }>;
type Transition = Readonly<{ jobRef: string; expectedRevision: number }>;
type Record = { scope: InProcessPreviewJobScope; digest: string; jobRef: string; revision: number; state: InProcessPreviewJobState };
type Replay = Readonly<{ scope: InProcessPreviewJobScope; digest: string; outcome: InProcessPreviewJob }>;
type LeaseFailure = 'lease_expired' | 'lease_revoked';
const TERMINAL = new Set<InProcessPreviewJobState>(['completed', 'failed', 'cancelled', 'expired', 'revoked']);
function fail(code: InProcessPreviewJobErrorCode): never { throw new InProcessPreviewJobError(code); }
function opaque(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function values(value: unknown, keys: readonly string[]): unknown[] | null {
    try { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null; const own = Reflect.ownKeys(value); if (own.length !== keys.length || !keys.every((key) => own.includes(key))) return null;
        return keys.map((key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; }); } catch { return null; }
}
function copyScope(value: unknown): InProcessPreviewJobScope | null {
    const fields = values(value, ['agentRef', 'capabilityId', 'sessionRef', 'leaseRef']); if (!fields || !opaque(fields[0]) || !opaque(fields[1]) || !opaque(fields[2]) || !opaque(fields[3])) return null;
    return Object.freeze({ agentRef: fields[0], capabilityId: fields[1], sessionRef: fields[2], leaseRef: fields[3] });
}
function copySubmit(value: unknown): Submit | null {
    const fields = values(value, ['scope', 'idempotencyKey', 'commandDigest']); const scope = fields && copyScope(fields[0]); return scope && opaque(fields[1]) && opaque(fields[2]) ? { scope, idempotencyKey: fields[1], commandDigest: fields[2] } : null;
}
function same(left: InProcessPreviewJobScope, right: InProcessPreviewJobScope): boolean {
    return left.agentRef === right.agentRef && left.capabilityId === right.capabilityId && left.sessionRef === right.sessionRef && left.leaseRef === right.leaseRef;
}
function copyTransition(value: unknown): Transition | null {
    const fields = values(value, ['jobRef', 'expectedRevision']); return fields && opaque(fields[0]) && typeof fields[1] === 'number' && Number.isSafeInteger(fields[1]) && fields[1] >= 0 ? { jobRef: fields[0], expectedRevision: fields[1] } : null;
}

/* @Codex */
export function createInProcessPreviewJobControl(sources: InProcessPreviewJobControlSources) {
    const jobs = new Map<string, Record>(); const replays = new Map<string, Replay>(); const latches: Readonly<{ scope: InProcessPreviewJobScope; code: LeaseFailure }>[] = [];
    const snapshot = (record: Record): InProcessPreviewJob => Object.freeze({ jobRef: record.jobRef, revision: record.revision, state: record.state });
    const latched = (scope: InProcessPreviewJobScope) => latches.find((entry) => same(entry.scope, scope));
    const now = () => { try { const value = sources.clock(); return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail('dependency_unavailable'); } catch { return fail('dependency_unavailable'); } };
    const guard = (scope: InProcessPreviewJobScope, at: number) => { const failure = latched(scope); if (failure) fail(failure.code); let status: unknown; try { status = sources.leaseGuard.status(scope, at); } catch { return fail('dependency_unavailable'); } if (status === 'active') return; if (status === 'expired' || status === 'revoked') { const code: LeaseFailure = status === 'expired' ? 'lease_expired' : 'lease_revoked'; latches.push(Object.freeze({ scope, code })); fail(code); } return fail('dependency_unavailable'); };
    const jobRef = () => { try { const value = sources.jobRef(); return opaque(value) ? value : fail('dependency_unavailable'); } catch { return fail('dependency_unavailable'); } };
    const rate = (scope: Readonly<Pick<InProcessPreviewJobScope, 'agentRef' | 'capabilityId' | 'sessionRef'>>, at: number) => { let result: unknown; try { result = sources.rateLimitPolicy.consume(scope, at); } catch { return fail('dependency_unavailable'); } if (result === 'allowed') return; if (result === 'rate_limited') return fail('rate_limited'); return fail('dependency_unavailable'); };
    const transition = (value: unknown, allowed: readonly InProcessPreviewJobState[], state: InProcessPreviewJobState): InProcessPreviewJob => {
        const input = copyTransition(value); if (!input) return fail('input_invalid'); const record = jobs.get(input.jobRef); if (!record) return fail('job_missing'); if (TERMINAL.has(record.state)) return fail('job_terminal');
        guard(record.scope, now()); if (record.revision !== input.expectedRevision) return fail('revision_conflict'); if (!allowed.includes(record.state)) return fail('transition_invalid');
        record.state = state; record.revision += 1; return snapshot(record);
    };
    return Object.freeze({
        submit(value: unknown): InProcessPreviewJob {
            const input = copySubmit(value); if (!input) return fail('input_invalid'); const replay = replays.get(input.idempotencyKey); if (replay && (!same(replay.scope, input.scope) || replay.digest !== input.commandDigest)) return fail('idempotency_conflict');
            const at = now(); guard(input.scope, at); if (replay) return replay.outcome; const ref = jobRef(); if (jobs.has(ref)) return fail('job_ref_conflict'); const rateScope = Object.freeze({ agentRef: input.scope.agentRef, capabilityId: input.scope.capabilityId, sessionRef: input.scope.sessionRef }); rate(rateScope, at);
            const record: Record = { scope: input.scope, digest: input.commandDigest, jobRef: ref, revision: 0, state: 'queued' }; jobs.set(ref, record); const outcome = snapshot(record); replays.set(input.idempotencyKey, Object.freeze({ scope: input.scope, digest: input.commandDigest, outcome })); return outcome;
        },
        start(input: unknown): InProcessPreviewJob { return transition(input, ['queued'], 'running'); },
        complete(input: unknown): InProcessPreviewJob { return transition(input, ['running'], 'completed'); },
        fail(input: unknown): InProcessPreviewJob { return transition(input, ['running'], 'failed'); },
        cancel(input: unknown): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'cancelled'); },
        expire(input: unknown): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'expired'); },
        revoke(input: unknown): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'revoked'); },
    });
}
