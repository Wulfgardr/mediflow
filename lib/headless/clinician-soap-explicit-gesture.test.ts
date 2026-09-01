/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createClinicianSoapExplicitGestureOwner,
    scheduleClinicianSoapExplicitGesturePreparation,
} from './clinician-soap-explicit-gesture.ts';

type SealDenialCode = 'field_set_unavailable' | 'seal_unavailable' | 'seal_mismatch' | 'lifecycle_unavailable';

function record<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value));
}

function fixture() {
    const fieldSet = record({ syntheticFieldSet: true });
    const bundle = record({ syntheticSealBundle: true });
    const reopenedFieldSet = record({ syntheticFieldSet: true });
    const correlationToken = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
    const calls: string[] = [];
    let sealCalls = 0, reopenCalls = 0, bindCalls = 0, cancelCalls = 0;
    let sealResult: Readonly<Record<string, unknown>> = record({ status: 'sealed', bundle });
    let reopenResult: Readonly<Record<string, unknown>> = record({ status: 'reopened', fieldSet: reopenedFieldSet });
    let reopenGate: Promise<void> | null = null, releaseReopenGate: (() => void) | null = null;
    let bindGate: Promise<void> | null = null, releaseBindGate: (() => void) | null = null;
    let bindResult = true;

    const ports = {
        correlationToken,
        async seal(candidate: unknown) {
            calls.push('seal'); sealCalls += 1; assert.equal(candidate, fieldSet); return sealResult;
        },
        async reopen(candidateBundle: unknown, expectedFieldSet: unknown) {
            calls.push('reopen'); reopenCalls += 1;
            assert.equal(candidateBundle, bundle); assert.equal(expectedFieldSet, fieldSet);
            if (reopenGate) await reopenGate;
            return reopenResult;
        },
        async bindGestureSeal(candidateToken: unknown, candidateBundle: unknown) {
            calls.push('bind'); bindCalls += 1;
            assert.equal(candidateToken, correlationToken); assert.equal(candidateBundle, bundle);
            if (bindGate) await bindGate;
            return bindResult;
        },
        cancelPresentation(candidateToken: unknown) {
            calls.push('cancel'); cancelCalls += 1;
            assert.equal(candidateToken, correlationToken);
            return true;
        },
    };
    return {
        fieldSet, bundle, correlationToken, calls, ports,
        sealCalls: () => sealCalls,
        reopenCalls: () => reopenCalls,
        bindCalls: () => bindCalls,
        cancelCalls: () => cancelCalls,
        denySeal(code: SealDenialCode) { sealResult = record({ status: 'denied', code }); },
        denyReopen(code: SealDenialCode) { reopenResult = record({ status: 'denied', code }); },
        blockReopen() { reopenGate = new Promise<void>((resolve) => { releaseReopenGate = resolve; }); },
        releaseReopen() { const release = releaseReopenGate; reopenGate = null; releaseReopenGate = null; release?.(); },
        denyBind() { bindResult = false; },
        blockBind() { bindGate = new Promise<void>((resolve) => { releaseBindGate = resolve; }); },
        releaseBind() { const release = releaseBindGate; bindGate = null; releaseBindGate = null; release?.(); },
    };
}

function assertClosed(result: unknown) {
    assert.equal(typeof result, 'object');
    assert.notEqual((result as { status?: unknown } | null)?.status, 'ready');
    assert.notEqual((result as { status?: unknown } | null)?.status, 'pin_required');
}

test('cancels a replayed preparation before its irreversible seal starts', async () => {
    const calls: string[] = [];
    const cancelReplayedSetup = scheduleClinicianSoapExplicitGesturePreparation(() => { calls.push('replayed'); });
    cancelReplayedSetup();
    scheduleClinicianSoapExplicitGesturePreparation(() => { calls.push('current'); });

    await Promise.resolve();

    assert.deepEqual(calls, ['current']);
});

test('prepares one H4 seal without accepting or exposing a PIN', async () => {
    const current = fixture();
    const owner = createClinicianSoapExplicitGestureOwner(current.ports);

    const result = await owner.prepare(current.fieldSet);

    assert.equal(result.status, 'ready');
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Reflect.ownKeys(result), ['status']);
    assert.deepEqual(current.calls, ['seal']);
    assert.equal(current.sealCalls(), 1);
    assert.equal(current.reopenCalls(), 0);

    assertClosed(await owner.prepare(current.fieldSet));
    assert.equal(current.sealCalls(), 1);
    assertClosed(await owner.consumeExplicitGesture());
    assert.equal(current.reopenCalls(), 0);
    assert.equal(current.cancelCalls(), 1);
});

test('reopens the same H4 bundle and field set only on the explicit gesture', async () => {
    const current = fixture();
    const owner = createClinicianSoapExplicitGestureOwner(current.ports);
    assert.equal((await owner.prepare(current.fieldSet)).status, 'ready');
    assert.equal(current.reopenCalls(), 0);

    const result = await owner.consumeExplicitGesture();

    assert.equal(result.status, 'pin_required');
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Reflect.ownKeys(result), ['status']);
    assert.deepEqual(current.calls, ['seal', 'reopen', 'bind']);
    assert.equal(current.reopenCalls(), 1);
    assert.equal(current.bindCalls(), 1);

    assertClosed(await owner.consumeExplicitGesture());
    assert.equal(current.reopenCalls(), 1);
    assert.equal(current.cancelCalls(), 0);
});

test('awaits the host-owned gesture seal binding after byte-exact reopen and before requiring a PIN', async () => {
    const current = fixture(); current.blockBind();
    const owner = createClinicianSoapExplicitGestureOwner(current.ports);
    assert.equal((await owner.prepare(current.fieldSet)).status, 'ready');

    let settled = false;
    const resultPromise = owner.consumeExplicitGesture().then((result) => {
        settled = true;
        return result;
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(current.calls, ['seal', 'reopen', 'bind']);
    assert.equal(current.bindCalls(), 1);
    assert.equal(settled, false);

    current.releaseBind();
    const result = await resultPromise;
    assert.equal(result.status, 'pin_required');
    assert.equal(current.cancelCalls(), 0);
});

test('terminalizes when seal binding denies or close wins while binding is pending', async () => {
    const denied = fixture(); denied.denyBind();
    const deniedOwner = createClinicianSoapExplicitGestureOwner(denied.ports);
    assert.equal((await deniedOwner.prepare(denied.fieldSet)).status, 'ready');
    assert.deepEqual(
        await deniedOwner.consumeExplicitGesture(),
        record({ status: 'denied', code: 'gesture_unavailable' }),
    );
    assert.deepEqual(denied.calls, ['seal', 'reopen', 'bind', 'cancel']);
    assertClosed(await deniedOwner.consumeExplicitGesture());
    assert.equal(denied.cancelCalls(), 1);

    const closed = fixture(); closed.blockBind();
    const closedOwner = createClinicianSoapExplicitGestureOwner(closed.ports);
    assert.equal((await closedOwner.prepare(closed.fieldSet)).status, 'ready');
    const pending = closedOwner.consumeExplicitGesture();
    await Promise.resolve();
    await Promise.resolve();
    closedOwner.close();
    closed.releaseBind();
    assert.deepEqual(await pending, record({ status: 'denied', code: 'gesture_unavailable' }));
    assert.equal(closed.bindCalls(), 1);
    assert.equal(closed.cancelCalls(), 1);
});

test('terminalizes concurrent gestures before either can require a PIN', async () => {
    const current = fixture(); current.blockReopen();
    const owner = createClinicianSoapExplicitGestureOwner(current.ports);
    assert.equal((await owner.prepare(current.fieldSet)).status, 'ready');

    const first = owner.consumeExplicitGesture();
    const second = owner.consumeExplicitGesture();
    await Promise.resolve();
    assert.equal(current.reopenCalls(), 1);
    current.releaseReopen();

    const results = await Promise.all([first, second]);
    assert.equal(results.filter((result) => result.status === 'pin_required').length, 0);
    assert.equal(results.every((result) => result.status === 'denied'
        && result.code === 'gesture_unavailable'), true);
    assert.equal(current.reopenCalls(), 1);
    assert.equal(current.cancelCalls(), 1);
});

test('terminalizes on either H4 denial and preserves the PHI-safe denial', async () => {
    const sealDenied = fixture(); sealDenied.denySeal('seal_unavailable');
    const sealOwner = createClinicianSoapExplicitGestureOwner(sealDenied.ports);
    assert.deepEqual(await sealOwner.prepare(sealDenied.fieldSet), record({ status: 'denied', code: 'seal_unavailable' }));
    assertClosed(await sealOwner.consumeExplicitGesture());
    assertClosed(await sealOwner.prepare(sealDenied.fieldSet));
    assert.equal(sealDenied.sealCalls(), 1); assert.equal(sealDenied.reopenCalls(), 0);
    assert.equal(sealDenied.cancelCalls(), 1);

    const reopenDenied = fixture(); reopenDenied.denyReopen('seal_mismatch');
    const reopenOwner = createClinicianSoapExplicitGestureOwner(reopenDenied.ports);
    assert.equal((await reopenOwner.prepare(reopenDenied.fieldSet)).status, 'ready');
    assert.deepEqual(
        await reopenOwner.consumeExplicitGesture(),
        record({ status: 'denied', code: 'seal_mismatch' }),
    );
    assertClosed(await reopenOwner.consumeExplicitGesture());
    assertClosed(await reopenOwner.prepare(reopenDenied.fieldSet));
    assert.equal(reopenDenied.sealCalls(), 1); assert.equal(reopenDenied.reopenCalls(), 1);
    assert.equal(reopenDenied.cancelCalls(), 1);
});

test('close terminalizes preparation or review and prevents retained work from being reopened', async () => {
    const beforePrepare = fixture();
    const closedOwner = createClinicianSoapExplicitGestureOwner(beforePrepare.ports);
    closedOwner.close();
    assertClosed(await closedOwner.prepare(beforePrepare.fieldSet));
    assertClosed(await closedOwner.consumeExplicitGesture());
    assert.equal(beforePrepare.sealCalls(), 0); assert.equal(beforePrepare.reopenCalls(), 0);
    assert.equal(beforePrepare.cancelCalls(), 1);

    const afterPrepare = fixture();
    const preparedOwner = createClinicianSoapExplicitGestureOwner(afterPrepare.ports);
    assert.equal((await preparedOwner.prepare(afterPrepare.fieldSet)).status, 'ready');
    preparedOwner.close();
    assertClosed(await preparedOwner.consumeExplicitGesture());
    assertClosed(await preparedOwner.prepare(afterPrepare.fieldSet));
    assert.equal(afterPrepare.sealCalls(), 1); assert.equal(afterPrepare.reopenCalls(), 0);
    assert.equal(afterPrepare.cancelCalls(), 1);
});
