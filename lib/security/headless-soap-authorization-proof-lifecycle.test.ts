/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHeadlessSoapAuthorizationProofLifecycleOwner,
    HeadlessSoapAuthorizationProofLifecycleError,
} from './headless-soap-authorization-proof-lifecycle.ts';

const PRESENTATION = 'A'.repeat(43);
const PROOF = `hsap_${Array.from({ length: 32 }, (_value, index) => index.toString(16).padStart(2, '0')).join('')}`;
const TEST_NOW = Date.now();
const VERIFIED_SESSION = Object.freeze(Object.assign(Object.create(null), {
    id: 'a'.repeat(64), userId: 'synthetic-user', username: 'synthetic-admin', role: 'admin',
    authChannel: 'web', createdAt: TEST_NOW - 1_000, expiresAt: TEST_NOW + 60_000,
}));

function presentation() {
    const registration = Object.freeze(Object.create(null));
    let active = true, attached = false, disposer: (() => void) | null = null;
    const trace: string[] = [];
    return {
        trace,
        lifecycle: Object.freeze({
            async withCurrentPresentation(candidate: unknown, operation: () => void) {
                if (!active || candidate !== PRESENTATION) return false;
                operation(); return active;
            },
            registerDependent(candidate: unknown, dispose: () => void) {
                trace.push('attach');
                if (!active || attached || candidate !== PRESENTATION) return null;
                attached = true; disposer = dispose; return registration;
            },
            confirmDependent(candidate: unknown, candidateRegistration: unknown) {
                return active && attached && candidate === PRESENTATION && candidateRegistration === registration;
            },
            unregisterDependent(candidate: unknown, candidateRegistration: unknown) {
                if (!attached || candidate !== PRESENTATION || candidateRegistration !== registration) return false;
                attached = false; disposer = null; return true;
            },
            async withCurrentDependent(candidate: unknown, candidateRegistration: unknown, operation: () => void) {
                if (!active || !attached || candidate !== PRESENTATION || candidateRegistration !== registration) return false;
                operation(); return active && attached;
            },
        }),
        service: Object.freeze({
            cancel(candidate: unknown) {
                if (!active || candidate !== PRESENTATION) return false;
                active = false;
                if (attached) { attached = false; const pending = disposer; disposer = null; pending?.(); }
                return true;
            },
        }),
    };
}

function fixture(overrides: Partial<{
    verifyFreshPin: (candidate: unknown) => Promise<unknown>;
    now: () => number;
    entropy: () => unknown;
}> = {}) {
    const source = presentation(); let now = 1_000; let timer: (() => void) | null = null, timerDelay: number | null = null;
    let entropyCalls = 0;
    const owner = createHeadlessSoapAuthorizationProofLifecycleOwner({
        presentationLifecycle: source.lifecycle,
        presentationService: source.service,
        verifyFreshPin: overrides.verifyFreshPin ?? (async () => { source.trace.push('pin'); return VERIFIED_SESSION; }),
        entropy: () => { entropyCalls += 1; return (overrides.entropy ??
            (() => Uint8Array.from({ length: 32 }, (_value, index) => index)))(); },
        now: overrides.now ?? (() => now),
        schedule(dispose, delayMs) { timer = dispose; timerDelay = delayMs; return dispose; },
        cancelSchedule(handle) { if (timer === handle) { timer = null; timerDelay = null; } },
    });
    return { owner, source, setNow(value: number) { now = value; }, get timerDelay() { return timerDelay; },
        get entropyCalls() { return entropyCalls; }, fireTimer() { const pending = timer; timer = null; timerDelay = null; pending?.(); } };
}

test('issues one digest-only H5b proof after attaching H5a and verifying a fresh PIN', async () => {
    const { owner, source } = fixture();
    const result = await owner.service.issue(PRESENTATION, '1234');

    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Reflect.ownKeys(result), ['status', 'authorizationProof']);
    assert.deepEqual({ ...result }, { status: 'proof_issued', authorizationProof: PROOF });
    assert.deepEqual(source.trace, ['attach', 'pin']);
    assert.equal(owner.service.issue.length, 2);

    let callbacks = 0;
    assert.equal(await owner.lifecycleController.withCurrentProof(PROOF, () => { callbacks += 1; }), true);
    assert.equal(callbacks, 1);
});

test('keeps foreign inputs inert and exposes only the exact frozen service and controller', async () => {
    const { owner } = fixture();
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['issue', 'wipe']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent',
        'withCurrentProof', 'withSingleUseProof',
    ]);
    await assert.rejects(owner.service.issue('foreign', '1234'), (error: unknown) =>
        error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === 'presentation_unavailable');
    assert.equal(owner.service.wipe('foreign'), false);
    assert.equal(await owner.lifecycleController.withCurrentProof('foreign', () => undefined), false);
});

test('attaches H5a before awaiting PIN and cannot publish after an upstream drain', async () => {
    for (const pinOutcome of [true, false]) {
        let resolvePin!: (accepted: boolean) => void;
        const pin = new Promise<boolean>((resolve) => { resolvePin = resolve; });
        const current = fixture({ verifyFreshPin: async () => pin });
        const pending = current.owner.service.issue(PRESENTATION, '1234');
        assert.deepEqual(current.source.trace, ['attach']);
        assert.equal(current.source.service.cancel(PRESENTATION), true);
        resolvePin(pinOutcome);
        await assert.rejects(pending, (error: unknown) =>
            error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === 'presentation_unavailable');
        assert.equal(current.entropyCalls, 0);
    }
});

test('maps invalid or denied fresh PINs to one terminal PHI-safe denial', async () => {
    for (const [pin, verifyFreshPin] of [
        ['123', async () => true],
        ['1234', async () => false],
        ['1234', async () => { throw new Error('credential detail'); }],
    ] as const) {
        const current = fixture({ verifyFreshPin });
        await assert.rejects(current.owner.service.issue(PRESENTATION, pin), (error: unknown) =>
            error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === 'pin_unavailable');
        assert.equal(current.source.service.cancel(PRESENTATION), false);
        assert.equal(current.entropyCalls, 0);
    }
});

test('uses a half-open 30000 ms TTL, reschedules an early timer, and rejects rollback', async () => {
    const current = fixture(); const issued = await current.owner.service.issue(PRESENTATION, '1234');
    assert.equal(current.timerDelay, 30_000);
    current.setNow(2_000); current.fireTimer();
    assert.equal(current.timerDelay, 29_000);
    current.setNow(30_999);
    assert.equal(await current.owner.lifecycleController.withCurrentProof(issued.authorizationProof, () => undefined), true);
    current.setNow(31_000);
    await assert.rejects(current.owner.lifecycleController.withCurrentProof(issued.authorizationProof, () => undefined),
        (error: unknown) => error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === 'proof_expired');
    assert.equal(current.owner.service.wipe(issued.authorizationProof), false);

    const rollback = fixture(); const rollbackProof = await rollback.owner.service.issue(PRESENTATION, '1234');
    rollback.setNow(999);
    await assert.rejects(rollback.owner.lifecycleController.withCurrentProof(rollbackProof.authorizationProof, () => undefined),
        (error: unknown) => error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === 'lifecycle_unavailable');
});

test('moves one registered proof through minted, in-flight, and spent while draining once', async () => {
    const current = fixture(); const issued = await current.owner.service.issue(PRESENTATION, '1234'); let drains = 0, calls = 0;
    const registration = current.owner.lifecycleController.registerDependent(issued.authorizationProof, () => { drains += 1; });
    assert.ok(registration);
    assert.equal(current.owner.lifecycleController.confirmDependent(issued.authorizationProof, registration), true);
    assert.equal(await current.owner.lifecycleController.withSingleUseProof(issued.authorizationProof, () => { calls += 1; }), true);
    assert.deepEqual({ calls, drains }, { calls: 1, drains: 1 });
    assert.equal(await current.owner.lifecycleController.withCurrentProof(issued.authorizationProof, () => undefined), false);
    assert.equal(current.owner.service.wipe(issued.authorizationProof), false);
});

test('burns with the exact time denial when expiry or rollback wins before single use', async () => {
    for (const [last, code] of [[31_000, 'proof_expired'], [999, 'lifecycle_unavailable']] as const) {
        const samples = [1_000, last, last];
        const current = fixture({ now: () => samples.shift() ?? last }); let callbacks = 0;
        const issued = await current.owner.service.issue(PRESENTATION, '1234');
        await assert.rejects(current.owner.lifecycleController.withSingleUseProof(
            issued.authorizationProof, () => { callbacks += 1; }),
        (error: unknown) => error instanceof HeadlessSoapAuthorizationProofLifecycleError && error.code === code);
        assert.equal(callbacks, 0);
        assert.equal(current.owner.service.wipe(issued.authorizationProof), false);
    }
});

test('burns on callback throw, Promise result, and reentry without leaking a second use', async () => {
    const callbacks: Array<(owner: ReturnType<typeof fixture>['owner'], proof: string) => () => void> = [
        () => () => { throw new Error('denied'); },
        () => (() => Promise.resolve()) as unknown as () => void,
        (owner, proof) => () => { owner.service.wipe(proof); },
        (owner, proof) => () => { void owner.lifecycleController.withCurrentProof(proof, () => undefined); },
        (owner, proof) => () => { owner.lifecycleController.registerDependent(proof, () => undefined); },
    ];
    for (const callback of callbacks) {
        const current = fixture(); const issued = await current.owner.service.issue(PRESENTATION, '1234'); let drains = 0;
        const registration = current.owner.lifecycleController.registerDependent(issued.authorizationProof, () => { drains += 1; });
        assert.ok(registration);
        assert.equal(await current.owner.lifecycleController.withSingleUseProof(
            issued.authorizationProof, callback(current.owner, issued.authorizationProof)), false);
        assert.equal(drains, 1);
        assert.equal(await current.owner.lifecycleController.withSingleUseProof(issued.authorizationProof, () => undefined), false);
    }
});
