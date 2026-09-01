/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessSoapAuthorizationProofLifecycleOwner,
    HeadlessSoapAuthorizationProofLifecycleError,
} from './headless-soap-authorization-proof-lifecycle.ts';

const TOKENS = [`${'A'.repeat(42)}A`, `${'B'.repeat(42)}A`, `${'C'.repeat(42)}A`] as const;
const ENTROPY = Uint8Array.from({ length: 32 }, (_value, index) => index);
const SESSION_NOW = Date.now();
const VERIFIED_SESSION = Object.freeze(Object.assign(Object.create(null), {
    id: 'a'.repeat(64), userId: 'synthetic-user', username: 'synthetic-admin', role: 'admin',
    authChannel: 'web', createdAt: SESSION_NOW - 1_000, expiresAt: SESSION_NOW + 60_000,
}));

type PresentationRecord = { active: boolean; registration: object | null; dispose: (() => void) | null };

function source() {
    const records = new Map<string, PresentationRecord>(TOKENS.map((token) => [token, {
        active: true, registration: null, dispose: null,
    }]));
    let failFinalFence = false, duplicateCallbacks = false, drainAfterCallback = false;
    let deferredFence: Promise<void> | null = null, releaseDeferredFence: (() => void) | null = null;
    const read = (candidate: unknown) => typeof candidate === 'string' ? records.get(candidate) : undefined;
    return {
        lifecycle: Object.freeze({
            async withCurrentPresentation(candidate: unknown, operation: () => void) {
                const record = read(candidate); if (!record?.active) return false; operation(); return record.active;
            },
            registerDependent(candidate: unknown, dispose: () => void) {
                const record = read(candidate); if (!record?.active || record.registration) return null;
                record.registration = Object.freeze(Object.create(null)); record.dispose = dispose; return record.registration;
            },
            confirmDependent(candidate: unknown, registration: unknown) {
                const record = read(candidate); return !!record?.active && record.registration === registration;
            },
            unregisterDependent(candidate: unknown, registration: unknown) {
                const record = read(candidate); if (!record || record.registration !== registration) return false;
                record.registration = null; record.dispose = null; return true;
            },
            async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
                const record = read(candidate); if (!record?.active || record.registration !== registration) return false;
                operation(); if (duplicateCallbacks) operation();
                if (deferredFence) await deferredFence;
                if (drainAfterCallback) queueMicrotask(() => { drain(candidate); });
                return !failFinalFence && record.active && record.registration === registration;
            },
        }),
        service: Object.freeze({ cancel(candidate: unknown) { return drain(candidate); } }),
        failFinalFence() { failFinalFence = true; },
        duplicateCallbacks() { duplicateCallbacks = true; },
        drainAfterCallback() { drainAfterCallback = true; },
        deferNextFinalFence() {
            deferredFence = new Promise<void>((resolve) => { releaseDeferredFence = resolve; });
        },
        releaseFinalFence() {
            const release = releaseDeferredFence; deferredFence = null; releaseDeferredFence = null; release?.();
        },
        current(candidate: unknown) { return read(candidate)?.active === true; },
        drain(candidate: unknown) { return drain(candidate); },
    };
    function drain(candidate: unknown): boolean {
        const record = read(candidate); if (!record?.active) return false; record.active = false;
        const dispose = record.dispose; record.registration = null; record.dispose = null; dispose?.(); return true;
    }
}

function owner(options: Partial<{
    entropy: () => unknown;
    now: () => number;
    schedule: (dispose: () => void, delayMs: number) => unknown;
    verifyFreshPin: (candidate: unknown) => Promise<unknown>;
}> = {}) {
    const presentation = source(); let now = 10; const timers = new Set<() => void>();
    const lifecycle = createHeadlessSoapAuthorizationProofLifecycleOwner({
        presentationLifecycle: presentation.lifecycle, presentationService: presentation.service,
        verifyFreshPin: options.verifyFreshPin ?? (async () => VERIFIED_SESSION), entropy: options.entropy ?? (() => ENTROPY), now: options.now ?? (() => now),
        schedule: options.schedule ?? ((dispose) => { timers.add(dispose); return dispose; }),
        cancelSchedule: (handle) => { if (typeof handle === 'function') timers.delete(handle as () => void); },
    });
    return { lifecycle, presentation, setNow(value: number) { now = value; }, fireTimers() {
        const pending = [...timers]; timers.clear(); for (const timer of pending) timer(); } };
}

async function denial(pending: Promise<unknown>, code: string) {
    await assert.rejects(pending, (error: unknown) =>
        error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === code);
}

test('keeps digest tombstones across failed duplicate entropy and spent proofs', async () => {
    const current = owner(); const first = await current.lifecycle.service.issue(TOKENS[0], '1234');
    await denial(current.lifecycle.service.issue(TOKENS[1], '1234'), 'proof_unavailable');
    assert.equal(current.presentation.current(TOKENS[0]), true);
    assert.equal(current.presentation.current(TOKENS[1]), false);
    assert.equal(current.lifecycle.service.wipe(first.authorizationProof), true);
    await denial(current.lifecycle.service.issue(TOKENS[2], '1234'), 'proof_unavailable');
});

test('upstream drain, wipe, and timer expiry each drain a downstream dependent once', async () => {
    for (const finish of ['upstream', 'wipe', 'timer'] as const) {
        const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let drains = 0;
        const registration = current.lifecycle.lifecycleController.registerDependent(proof.authorizationProof, () => { drains += 1; });
        assert.ok(registration);
        if (finish === 'upstream') assert.equal(current.presentation.drain(TOKENS[0]), true);
        else if (finish === 'wipe') assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), true);
        else { current.setNow(30_010); current.fireTimers(); }
        assert.equal(drains, 1);
        assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), false);
        assert.equal(current.presentation.drain(TOKENS[0]), false);
        current.fireTimers(); assert.equal(drains, 1);
    }
});

test('burns a single-use proof when the upstream final fence fails after the callback', async () => {
    const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let callbacks = 0, drains = 0;
    const registration = current.lifecycle.lifecycleController.registerDependent(proof.authorizationProof, () => { drains += 1; });
    assert.ok(registration); current.presentation.failFinalFence();
    assert.equal(await current.lifecycle.lifecycleController.withSingleUseProof(proof.authorizationProof, () => { callbacks += 1; }), false);
    assert.deepEqual({ callbacks, drains }, { callbacks: 1, drains: 1 });
    assert.equal(await current.lifecycle.lifecycleController.withCurrentProof(proof.authorizationProof, () => undefined), false);
});

test('burns with the exact time denial when expiry or rollback wins during the async final fence', async () => {
    for (const [last, code] of [[30_010, 'proof_expired'], [9, 'lifecycle_unavailable']] as const) {
        const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let callbacks = 0;
        current.presentation.deferNextFinalFence();
        const pending = current.lifecycle.lifecycleController.withSingleUseProof(
            proof.authorizationProof, () => { callbacks += 1; });
        assert.equal(callbacks, 1);
        current.setNow(last); current.presentation.releaseFinalFence();
        await denial(pending, code);
        assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), false);
    }
});

test('cannot report single-use success after upstream drains before the await continuation', async () => {
    const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let callbacks = 0;
    current.presentation.drainAfterCallback();
    assert.equal(await current.lifecycle.lifecycleController.withSingleUseProof(
        proof.authorizationProof, () => { callbacks += 1; }), false);
    assert.equal(callbacks, 1);
    assert.equal(current.presentation.current(TOKENS[0]), false);
    assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), false);
});

test('preserves expiry or rollback denial when the timer retires a proof during a currentness fence', async () => {
    for (const [last, code] of [[30_010, 'proof_expired'], [9, 'lifecycle_unavailable']] as const) {
        const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let callbacks = 0;
        current.presentation.deferNextFinalFence();
        const pending = current.lifecycle.lifecycleController.withCurrentProof(
            proof.authorizationProof, () => { callbacks += 1; });
        assert.equal(callbacks, 1);
        current.setNow(last); current.fireTimers(); current.presentation.releaseFinalFence();
        await denial(pending, code);
        assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), false);
    }
});

test('keeps clock and result shape fail-closed after an async source poisons ambient intrinsics', async () => {
    const originalAssign = Object.assign, originalIsSafeInteger = Number.isSafeInteger;
    const current = owner({
        now: () => Number.NaN,
        verifyFreshPin: async () => {
            Object.assign = ((target: object, ...sources: object[]) => {
                const assigned = originalAssign(target, ...sources);
                Object.defineProperty(assigned, 'extra', { enumerable: true, value: true });
                return assigned;
            }) as typeof Object.assign;
            Number.isSafeInteger = () => true;
            return VERIFIED_SESSION;
        },
    });
    try {
        await denial(current.lifecycle.service.issue(TOKENS[0], '1234'), 'lifecycle_unavailable');
    } finally {
        Object.assign = originalAssign; Number.isSafeInteger = originalIsSafeInteger;
    }
});

test('keeps TTL overflow fail-closed if an async source replaces the global Number binding', async () => {
    const originalNumber = globalThis.Number, observed = originalNumber.MAX_SAFE_INTEGER;
    const current = owner({
        now: () => observed,
        verifyFreshPin: async () => {
            globalThis.Number = { MAX_SAFE_INTEGER: Infinity } as unknown as NumberConstructor;
            return VERIFIED_SESSION;
        },
    });
    let caught: unknown;
    try {
        await current.lifecycle.service.issue(TOKENS[0], '1234');
    } catch (error) {
        caught = error;
    } finally {
        globalThis.Number = originalNumber;
    }
    assert.equal(caught instanceof HeadlessSoapAuthorizationProofLifecycleError, true);
    assert.equal((caught as HeadlessSoapAuthorizationProofLifecycleError).code, 'lifecycle_unavailable');
});

test('does not invoke the single-use callback after a clock source reenters and spends the proof', async () => {
    let reenter = false, proof = '';
    const current = owner({ now: () => {
        if (reenter) current.lifecycle.service.wipe(proof);
        return 10;
    } });
    proof = (await current.lifecycle.service.issue(TOKENS[0], '1234')).authorizationProof;
    reenter = true; let callbacks = 0;
    assert.equal(await current.lifecycle.lifecycleController.withSingleUseProof(
        proof, () => { callbacks += 1; }), false);
    assert.equal(callbacks, 0);
    assert.equal(current.lifecycle.service.wipe(proof), false);
});

test('runs a duplicated upstream callback once and burns the poisoned proof', async () => {
    const current = owner(); const proof = await current.lifecycle.service.issue(TOKENS[0], '1234'); let callbacks = 0;
    current.presentation.duplicateCallbacks();
    assert.equal(await current.lifecycle.lifecycleController.withCurrentProof(proof.authorizationProof, () => { callbacks += 1; }), false);
    assert.equal(callbacks, 1);
    assert.equal(current.lifecycle.service.wipe(proof.authorizationProof), false);
});

test('terminalizes entropy, clock, scheduler, and synchronous timer failures after H5a attach', async () => {
    const cases: Array<[ReturnType<typeof owner>, string]> = [
        [owner({ entropy: () => new Uint8Array(31) }), 'proof_unavailable'],
        [owner({ now: () => Number.MAX_SAFE_INTEGER }), 'lifecycle_unavailable'],
        [owner({ schedule: () => { throw new Error('scheduler'); } }), 'lifecycle_unavailable'],
        [owner({ schedule: (dispose) => { dispose(); return dispose; } }), 'lifecycle_unavailable'],
    ];
    for (const [current, code] of cases) {
        await denial(current.lifecycle.service.issue(TOKENS[0], '1234'), code);
        assert.equal(current.presentation.current(TOKENS[0]), false);
    }
});
