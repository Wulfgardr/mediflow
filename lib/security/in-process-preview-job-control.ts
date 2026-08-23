/* @Codex */

export type InProcessPreviewJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'revoked';
export type InProcessPreviewJobErrorCode = 'input_invalid' | 'idempotency_conflict' | 'revision_conflict' | 'job_missing' | 'job_terminal' | 'transition_invalid' | 'lease_expired' | 'lease_revoked' | 'rate_limited';
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
const TERMINAL = new Set<InProcessPreviewJobState>(['completed', 'failed', 'cancelled', 'expired', 'revoked']);
function fail(code: InProcessPreviewJobErrorCode): never { throw new InProcessPreviewJobError(code); }
function opaque(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function copyScope(value: InProcessPreviewJobScope): InProcessPreviewJobScope | null {
    if (!value || typeof value !== 'object' || !opaque(value.agentRef) || !opaque(value.capabilityId) || !opaque(value.sessionRef) || !opaque(value.leaseRef)) return null;
    return Object.freeze({ agentRef: value.agentRef, capabilityId: value.capabilityId, sessionRef: value.sessionRef, leaseRef: value.leaseRef });
}
function same(left: InProcessPreviewJobScope, right: InProcessPreviewJobScope): boolean {
    return left.agentRef === right.agentRef && left.capabilityId === right.capabilityId && left.sessionRef === right.sessionRef && left.leaseRef === right.leaseRef;
}

/* @Codex */
export function createInProcessPreviewJobControl(sources: InProcessPreviewJobControlSources) {
    const jobs = new Map<string, Record>(); const replays = new Map<string, Replay>();
    const snapshot = (record: Record): InProcessPreviewJob => Object.freeze({ jobRef: record.jobRef, revision: record.revision, state: record.state });
    const guard = (scope: InProcessPreviewJobScope, now: number) => { const status = sources.leaseGuard.status(scope, now); if (status === 'expired') fail('lease_expired'); if (status !== 'active') fail('lease_revoked'); };
    const transition = (input: Transition, allowed: readonly InProcessPreviewJobState[], state: InProcessPreviewJobState, guarded = true): InProcessPreviewJob => {
        const record = jobs.get(input.jobRef); if (!record) return fail('job_missing'); if (record.revision !== input.expectedRevision) return fail('revision_conflict');
        if (TERMINAL.has(record.state)) return fail('job_terminal'); if (!allowed.includes(record.state)) return fail('transition_invalid'); if (guarded) guard(record.scope, sources.clock());
        record.state = state; record.revision += 1; return snapshot(record);
    };
    return Object.freeze({
        submit(input: Submit): InProcessPreviewJob {
            const scope = copyScope(input?.scope); if (!scope || !opaque(input?.idempotencyKey) || !opaque(input?.commandDigest)) return fail('input_invalid');
            const replay = replays.get(input.idempotencyKey); if (replay) return same(replay.scope, scope) && replay.digest === input.commandDigest ? replay.outcome : fail('idempotency_conflict');
            const now = sources.clock(); guard(scope, now); const rateScope = Object.freeze({ agentRef: scope.agentRef, capabilityId: scope.capabilityId, sessionRef: scope.sessionRef });
            if (sources.rateLimitPolicy.consume(rateScope, now) !== 'allowed') return fail('rate_limited'); const jobRef = sources.jobRef(); if (!opaque(jobRef)) return fail('input_invalid');
            const record: Record = { scope, digest: input.commandDigest, jobRef, revision: 0, state: 'queued' }; jobs.set(jobRef, record); const outcome = snapshot(record); replays.set(input.idempotencyKey, Object.freeze({ scope, digest: input.commandDigest, outcome })); return outcome;
        },
        start(input: Transition): InProcessPreviewJob { return transition(input, ['queued'], 'running'); },
        complete(input: Transition): InProcessPreviewJob { return transition(input, ['running'], 'completed'); },
        fail(input: Transition): InProcessPreviewJob { return transition(input, ['running'], 'failed'); },
        cancel(input: Transition): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'cancelled'); },
        expire(input: Transition): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'expired', false); },
        revoke(input: Transition): InProcessPreviewJob { return transition(input, ['queued', 'running'], 'revoked', false); },
    });
}
