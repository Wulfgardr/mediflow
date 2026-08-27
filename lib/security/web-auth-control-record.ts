/* @Codex */

const apply = Reflect.apply;
const ObjectConstructor = Object;
const freeze = Object.freeze;
const MapConstructor = Map;
const SetConstructor = Set;
const mapGetIntrinsic = Map.prototype.get;
const mapSetIntrinsic = Map.prototype.set;
const mapSizeIntrinsic = ObjectConstructor.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const setAddIntrinsic = Set.prototype.add;
const setHasIntrinsic = Set.prototype.has;
const isSafeInteger = Number.isSafeInteger;
const max = Math.max;
const bigint = BigInt;
const ZERO = bigint(0);
const ONE = bigint(1);
const MAX_U64 = bigint('18446744073709551615');
const PENDING_TTL_MS = 120_000;
const REPLAY_TTL_MS = 300_000;
const IDEMPOTENCY_CAP = 64;
type Pending = Readonly<{ operation: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Begin = Readonly<{ kind: 'begin'; requestFence: string; fence: string; fingerprint: string; generation: bigint; createdAt: number }>;
type Lock = { kind: 'lock'; requestFence: string; fence: string; fingerprint: string; generation: bigint; detachedSessionId: string | null; receipt: 'pending' | 'confirmed'; createdAt: number };
type Entry = Begin | Lock;
type Result = Readonly<{ ok: false }> | Readonly<{ ok: true; fence: string; generation: bigint }>;
const denied = freeze({ ok: false } as const);
const frozen = <Value>(value: Value): Readonly<Value> => apply(freeze, ObjectConstructor, [value]) as Readonly<Value>;
const mapGet = <Value>(map: Map<string, Value>, key: string): Value | undefined => apply(mapGetIntrinsic, map, [key]) as Value | undefined;
const mapSet = <Value>(map: Map<string, Value>, key: string, value: Value): void => { apply(mapSetIntrinsic, map, [key, value]); };
const mapSize = (map: Map<string, unknown>): number => apply(mapSizeIntrinsic!, map, []) as number;
const setAdd = (set: Set<string>, value: string): void => { apply(setAddIntrinsic, set, [value]); };
const setHas = (set: Set<string>, value: string): boolean => apply(setHasIntrinsic, set, [value]) as boolean;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const time = (value: unknown): value is number => typeof value === 'number' && isSafeInteger(value) && value >= 0;
const u64 = (value: unknown): value is bigint => typeof value === 'bigint' && value >= ZERO && value <= MAX_U64;

/** Process-local P2a state; callers supply primitive ordering data only. */
/* @Codex */
export function createWebAuthControlRecord(initialFence: unknown, initialGeneration: unknown = ZERO) {
    if (!text(initialFence) || !u64(initialGeneration)) throw new TypeError('invalid trusted control state');
    let fence = initialFence; let generation = initialGeneration; let pending: Pending | null = null; let activeSessionId: string | null = null; let clock = 0;
    const used = new SetConstructor<string>(); const entries = new MapConstructor<string, Entry>(); setAdd(used, fence);
    const tick = (value: unknown): number | null => { if (!time(value)) return null; clock = max(clock, value); if (pending && clock - pending.createdAt >= PENDING_TTL_MS) pending = null; return clock; };
    const replay = (key: unknown, fingerprint: unknown, requestFence: unknown, at: number): Entry | null | false => {
        if (!text(key) || !text(fingerprint) || !text(requestFence)) return false;
        const entry = mapGet(entries, key);
        return !entry ? null : entry.fingerprint === fingerprint && entry.requestFence === requestFence && at - entry.createdAt < REPLAY_TTL_MS ? entry : false;
    };
    const successor = (value: unknown): string | null => text(value) ? value : null;
    const next = (value: string, expectedFence: string, expectedGeneration: bigint, expectedPending: Pending | null): string | null =>
        expectedGeneration === MAX_U64 || setHas(used, value) || fence !== expectedFence || generation !== expectedGeneration || pending !== expectedPending ? null : value;
    const advance = (value: string, output: Readonly<{ ok: true; fence: string; generation: bigint }>): Result => { fence = value; setAdd(used, value); generation += ONE; return output; };
    return frozen({
        begin(kind: unknown, operation: unknown, key: unknown, fingerprint: unknown, at: unknown): Result {
            const current = tick(at); if (current === null || (kind !== 'login' && kind !== 'setup') || !text(operation) || !text(key) || !text(fingerprint)) return denied;
            const prior = replay(key, fingerprint, fence, current);
            if (prior) return prior.kind === 'begin' ? frozen({ ok: true, fence: prior.fence, generation: prior.generation }) : denied;
            if (prior === false || mapSize(entries) >= IDEMPOTENCY_CAP || pending || activeSessionId) return denied;
            const preparedPending = frozen({ operation, fingerprint, generation, createdAt: current });
            const preparedEntry = frozen({ kind: 'begin' as const, requestFence: fence, fence, fingerprint, generation, createdAt: current });
            const output = frozen({ ok: true as const, fence, generation });
            mapSet(entries, key, preparedEntry); pending = preparedPending;
            return output;
        },
        finalizeAuth(expectedFence: unknown, operation: unknown, expectedGeneration: unknown, fingerprint: unknown, sessionId: unknown, successorFence: unknown, at: unknown): Result {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(operation) || !u64(expectedGeneration) || !text(fingerprint) || !text(sessionId) || tick(at) === null) return denied;
            const match = pending;
            if (!match || activeSessionId || fence !== expectedFence || generation !== expectedGeneration || match.operation !== operation || match.fingerprint !== fingerprint || match.generation !== generation) return denied;
            const nextFence = next(successorFenceValue, fence, generation, match); if (!nextFence) return denied;
            const output = frozen({ ok: true as const, fence: nextFence, generation: generation + ONE });
            activeSessionId = sessionId; pending = null; return advance(nextFence, output);
        },
        advanceLock(expectedFence: unknown, key: unknown, fingerprint: unknown, successorFence: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; detachedSessionId: string | null }> {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(key) || !text(fingerprint)) return denied;
            const current = tick(at); if (current === null) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior) return prior.kind === 'lock' && prior.fence === successorFenceValue ? frozen({ ok: true, fence: prior.fence, generation: prior.generation, detachedSessionId: prior.detachedSessionId }) : denied;
            if (prior === false || mapSize(entries) >= IDEMPOTENCY_CAP || fence !== expectedFence) return denied;
            const match = pending; const nextFence = next(successorFenceValue, fence, generation, match); if (!nextFence) return denied;
            const detachedSessionId = activeSessionId; const nextGeneration = generation + ONE;
            const entry: Lock = { kind: 'lock', requestFence: expectedFence, fence: nextFence, fingerprint, generation: nextGeneration, detachedSessionId, receipt: 'pending', createdAt: current };
            const output = frozen({ ok: true as const, fence: nextFence, generation: nextGeneration, detachedSessionId });
            pending = null; activeSessionId = null; fence = nextFence; setAdd(used, nextFence); generation = nextGeneration; mapSet(entries, key, entry);
            return output;
        },
        finalizeLock(expectedFence: unknown, key: unknown, fingerprint: unknown, at: unknown): Result | Readonly<{ ok: true; fence: string; generation: bigint; receipt: 'confirmed' }> {
            const current = tick(at); if (current === null) return denied;
            const prior = replay(key, fingerprint, expectedFence, current);
            if (prior === null || prior === false || prior.kind !== 'lock') return denied;
            const output = frozen({ ok: true as const, fence: prior.fence, generation: prior.generation, receipt: 'confirmed' as const });
            prior.receipt = 'confirmed'; return output;
        },
        disposeBoundSession(expectedFence: unknown, sessionId: unknown, successorFence: unknown, at: unknown): Result {
            const successorFenceValue = successor(successorFence);
            if (!successorFenceValue || !text(expectedFence) || !text(sessionId) || tick(at) === null || fence !== expectedFence || activeSessionId !== sessionId) return denied;
            const nextFence = next(successorFenceValue, fence, generation, pending); if (!nextFence) return denied;
            const output = frozen({ ok: true as const, fence: nextFence, generation: generation + ONE });
            activeSessionId = null; pending = null; return advance(nextFence, output);
        },
        snapshot(): Readonly<{ fence: string; generation: bigint; pending: boolean; active: boolean }> { return frozen({ fence, generation, pending: pending !== null, active: activeSessionId !== null }); },
    });
}
export const WEB_AUTH_PENDING_TTL_MS = PENDING_TTL_MS;
export const WEB_AUTH_REPLAY_TTL_MS = REPLAY_TTL_MS;
export const WEB_AUTH_IDEMPOTENCY_CAP = IDEMPOTENCY_CAP;
