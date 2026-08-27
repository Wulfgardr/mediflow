/* @Codex */

const MAX_U64 = BigInt('18446744073709551615');
const PENDING_TTL_MS = 120_000;
const REPLAY_TTL_MS = 300_000;
const IDEMPOTENCY_CAP = 64;
type Pending = Readonly<{ operation: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Begin = Readonly<{ kind: 'begin'; requestFence: string; fence: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Lock = { kind: 'lock'; requestFence: string; fence: string; fingerprint: string; generation: bigint; detachedSessionId: string | null; receipt: 'pending' | 'confirmed'; createdAt: number };
type Entry = Begin | Lock;
type Result = Readonly<{ ok: false }> | Readonly<{ ok: true; fence: string; generation: bigint }>;
const denied = Object.freeze({ ok: false } as const);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const u64 = (value: unknown): value is bigint => typeof value === 'bigint' && value >= BigInt(0) && value <= MAX_U64;

/** Process-local P2a state; callers supply primitive ordering data only. */
/* @Codex */
export function createWebAuthControlRecord(initialFence: unknown, successorFactory: unknown, initialGeneration: unknown = BigInt(0)) {
    if (!text(initialFence) || typeof successorFactory !== 'function' || !u64(initialGeneration)) throw new TypeError('invalid trusted control seam');
    let fence = initialFence; let generation = initialGeneration; let pending: Pending | null = null; let activeSessionId: string | null = null; let clock = 0;
    const used = new Set<string>([fence]); const entries = new Map<string, Entry>();
    const tick = (value: unknown): number | null => { if (!time(value)) return null; clock = Math.max(clock, value); if (pending && clock - pending.createdAt >= PENDING_TTL_MS) pending = null; return clock; };
    const replay = (key: unknown, fingerprint: unknown, requestFence: unknown, at: number): Entry | null | false => {
        if (!text(key) || !text(fingerprint) || !text(requestFence)) return false;
        const entry = entries.get(key);
        return !entry ? null : entry.fingerprint === fingerprint && entry.requestFence === requestFence && at - entry.createdAt < REPLAY_TTL_MS ? entry : false;
    };
    const next = (expectedFence: string, expectedGeneration: bigint, expectedPending: Pending | null): string | null => {
        if (expectedGeneration === MAX_U64) return null;
        let value: unknown; try { value = (successorFactory as () => unknown)(); } catch { return null; }
        return text(value) && !used.has(value) && fence === expectedFence && generation === expectedGeneration && pending === expectedPending ? value : null;
    };
    const advance = (value: string): Readonly<{ ok: true; fence: string; generation: bigint }> => { fence = value; used.add(value); generation += BigInt(1); return Object.freeze({ ok: true, fence, generation }); };
    return Object.freeze({
        begin(kind: unknown, operation: unknown, key: unknown, fingerprint: unknown, at: unknown): Result {
            const current = tick(at); if (current === null || (kind !== 'login' && kind !== 'setup') || !text(operation) || !text(key) || !text(fingerprint)) return denied;
            const prior = replay(key, fingerprint, fence, current);
            if (prior) return prior.kind === 'begin' ? Object.freeze({ ok: true, fence: prior.fence, generation: prior.generation }) : denied;
            if (prior === false || entries.size >= IDEMPOTENCY_CAP || pending || activeSessionId) return denied;
            pending = Object.freeze({ operation, fingerprint, generation, createdAt: current }); entries.set(key, Object.freeze({ kind: 'begin', requestFence: fence, fence, fingerprint, generation, createdAt: current }));
            return Object.freeze({ ok: true, fence, generation });
        },
        finalizeAuth(expectedFence: unknown, operation: unknown, expectedGeneration: unknown, fingerprint: unknown, sessionId: unknown, at: unknown): Result {
            if (tick(at) === null || !text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !text(sessionId)) return denied;
            const match = pending;
            if (!match || activeSessionId || fence !== expectedFence || generation !== expectedGeneration || match.operation !== operation || match.fingerprint !== fingerprint || match.generation !== generation) return denied;
            const successor = next(fence, generation, match); if (!successor) return denied;
            activeSessionId = sessionId; pending = null; return advance(successor);
        },
        advanceLock(expectedFence: unknown, key: unknown, fingerprint: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; detachedSessionId: string | null }> {
            const current = tick(at); if (current === null || !text(expectedFence) || !text(key) || !text(fingerprint)) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior) return prior.kind === 'lock' ? Object.freeze({ ok: true, fence: prior.fence, generation: prior.generation, detachedSessionId: prior.detachedSessionId }) : denied;
            if (prior === false || entries.size >= IDEMPOTENCY_CAP || fence !== expectedFence) return denied;
            const match = pending; const successor = next(fence, generation, match); if (!successor) return denied;
            const detachedSessionId = activeSessionId; pending = null; activeSessionId = null; const result = advance(successor);
            entries.set(key, { kind: 'lock', requestFence: expectedFence, fence: result.fence, fingerprint, generation: result.generation, detachedSessionId, receipt: 'pending', createdAt: current });
            return Object.freeze({ ...result, detachedSessionId });
        },
        finalizeLock(expectedFence: unknown, key: unknown, fingerprint: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; receipt: 'confirmed' }> {
            const current = tick(at); if (current === null) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior === null || prior === false || prior.kind !== 'lock') return denied;
            prior.receipt = 'confirmed'; return Object.freeze({ ok: true, fence: prior.fence, generation: prior.generation, receipt: 'confirmed' });
        },
        disposeBoundSession(expectedFence: unknown, sessionId: unknown, at: unknown): Result {
            if (tick(at) === null || !text(expectedFence) || !text(sessionId) || fence !== expectedFence || activeSessionId !== sessionId) return denied;
            const successor = next(fence, generation, pending); if (!successor) return denied;
            activeSessionId = null; pending = null; return advance(successor);
        },
        snapshot(): Readonly<{ fence: string; generation: bigint; pending: boolean; active: boolean }> { return Object.freeze({ fence, generation, pending: pending !== null, active: activeSessionId !== null }); },
    });
}
export const WEB_AUTH_PENDING_TTL_MS = PENDING_TTL_MS;
export const WEB_AUTH_REPLAY_TTL_MS = REPLAY_TTL_MS;
export const WEB_AUTH_IDEMPOTENCY_CAP = IDEMPOTENCY_CAP;
