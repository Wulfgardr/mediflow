/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createClinicianSoapExplicitGestureOwner } from './clinician-soap-explicit-gesture.ts';
import {
    createHeadlessSoapEntryPresentationLifecycleOwner,
} from '../security/headless-soap-entry-presentation-lifecycle.ts';
import {
    createHeadlessSoapEntryPresentationGoldenFieldSet,
    HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4,
} from '../security/headless-soap-entry-presentation-lifecycle-fixture.test.ts';

function record<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null), value));
}

function serverFixture() {
    const fieldSet = createHeadlessSoapEntryPresentationGoldenFieldSet();
    const entryRef = Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
    const entryRegistration = Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
    let current = true;
    let entryDispose: (() => void) | null = null;
    const server = createHeadlessSoapEntryPresentationLifecycleOwner({
        entryLifecycle: {
            async withCurrentEntry(candidate, operation) {
                if (!current || candidate !== entryRef) return false;
                operation(fieldSet);
                return current;
            },
            registerDependent(candidate, dispose) {
                if (!current || candidate !== entryRef || entryDispose) return null;
                entryDispose = dispose;
                return entryRegistration;
            },
            confirmDependent(candidate, registration) {
                return current && candidate === entryRef && registration === entryRegistration && entryDispose !== null;
            },
            unregisterDependent(candidate, registration) {
                if (!current || candidate !== entryRef || registration !== entryRegistration || !entryDispose) return false;
                entryDispose = null;
                return true;
            },
            async withCurrentDependent(candidate, registration, operation) {
                if (!current || candidate !== entryRef || registration !== entryRegistration || !entryDispose) return false;
                operation();
                return current;
            },
        },
        entryService: { wipe(candidate) {
            if (!current || candidate !== entryRef) return false;
            current = false;
            const dispose = entryDispose;
            entryDispose = null;
            dispose?.();
            return true;
        } },
        entropy: () => Uint8Array.from({ length: 32 }, (_value, index) => index),
    });
    return { entryRef, fieldSet, server };
}

test('close cancels a real gesture-bound H5a presentation before bind settlement can publish PIN-required', async () => {
    const current = serverFixture();
    const handoff = await current.server.service.present(current.entryRef);
    let releaseSettlement!: () => void;
    const settlementGate = new Promise<void>((resolve) => { releaseSettlement = resolve; });
    let reportBound!: (accepted: boolean) => void;
    const serverBound = new Promise<boolean>((resolve) => { reportBound = resolve; });
    let cancelCalls = 0;
    const client = createClinicianSoapExplicitGestureOwner({
        correlationToken: handoff.correlationToken,
        async seal(candidate: unknown) {
            assert.equal(candidate, current.fieldSet);
            return record({ status: 'sealed', bundle: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal });
        },
        async reopen(bundle: unknown, expectedFieldSet: unknown) {
            assert.equal(bundle, HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal);
            assert.equal(expectedFieldSet, current.fieldSet);
            return record({ status: 'reopened', fieldSet: current.fieldSet });
        },
        async bindGestureSeal(token: unknown, bundle: unknown) {
            const accepted = await current.server.sealBindingController.bindGestureSeal(token, bundle);
            reportBound(accepted);
            await settlementGate;
            return accepted;
        },
        cancelPresentation(token: unknown) {
            cancelCalls += 1;
            return current.server.service.cancel(token);
        },
    });
    assert.equal((await client.prepare(current.fieldSet)).status, 'ready');
    const pending = client.consumeExplicitGesture();
    assert.equal(await serverBound, true);

    client.close();
    releaseSettlement();
    const result = await pending;
    let staleCallbackCalls = 0;
    const stillCurrent = await current.server.lifecycleController.withCurrentPresentation(
        handoff.correlationToken,
        () => { staleCallbackCalls += 1; },
    );
    const forcedCleanup = current.server.service.cancel(handoff.correlationToken);

    assert.deepEqual(result, record({ status: 'denied', code: 'gesture_unavailable' }));
    assert.equal(cancelCalls, 1);
    assert.equal(stillCurrent, false);
    assert.equal(staleCallbackCalls, 0);
    assert.equal(forcedCleanup, false);
});

test('a second gesture cancels a real gesture-bound H5a presentation before the first settlement', async () => {
    const current = serverFixture();
    const handoff = await current.server.service.present(current.entryRef);
    let releaseSettlement!: () => void;
    const settlementGate = new Promise<void>((resolve) => { releaseSettlement = resolve; });
    let reportBound!: (accepted: boolean) => void;
    const serverBound = new Promise<boolean>((resolve) => { reportBound = resolve; });
    let cancelCalls = 0;
    const client = createClinicianSoapExplicitGestureOwner({
        correlationToken: handoff.correlationToken,
        async seal() {
            return record({ status: 'sealed', bundle: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal });
        },
        async reopen() {
            return record({ status: 'reopened', fieldSet: current.fieldSet });
        },
        async bindGestureSeal(token: unknown, bundle: unknown) {
            const accepted = await current.server.sealBindingController.bindGestureSeal(token, bundle);
            reportBound(accepted);
            await settlementGate;
            return accepted;
        },
        cancelPresentation(token: unknown) {
            cancelCalls += 1;
            return current.server.service.cancel(token);
        },
    });
    assert.equal((await client.prepare(current.fieldSet)).status, 'ready');
    const first = client.consumeExplicitGesture();
    assert.equal(await serverBound, true);

    const second = client.consumeExplicitGesture();
    releaseSettlement();
    const results = await Promise.all([first, second]);
    let staleCallbackCalls = 0;
    const stillCurrent = await current.server.lifecycleController.withCurrentPresentation(
        handoff.correlationToken,
        () => { staleCallbackCalls += 1; },
    );
    const forcedCleanup = current.server.service.cancel(handoff.correlationToken);

    assert.equal(results.every((result) => result.status === 'denied'
        && result.code === 'gesture_unavailable'), true);
    assert.equal(cancelCalls, 1);
    assert.equal(stillCurrent, false);
    assert.equal(staleCallbackCalls, 0);
    assert.equal(forcedCleanup, false);
});
