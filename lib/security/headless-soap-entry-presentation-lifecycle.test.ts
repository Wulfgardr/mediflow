/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createClinicianSoapEntryFieldSet,
} from '../headless/clinician-soap-entry-field-set.ts';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import {
    createHeadlessSoapEntryPresentationLifecycleOwner,
} from './headless-soap-entry-presentation-lifecycle.ts';

function opaque(): Readonly<Record<never, never>> {
    return Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;
}

function canonicalFieldSet() {
    const draft = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico',
        objective: 'Parametro sintetico',
        assessment: 'Valutazione sintetica',
        plan: 'Piano sintetico',
    });
    const accepted = validateClinicianSoapWriteDraft(draft);
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('synthetic H1 fixture denied');
    const fieldSet = createClinicianSoapEntryFieldSet(accepted, 1_704_067_200_987);
    assert.ok(fieldSet);
    return fieldSet;
}

function fixture() {
    const entryRef = opaque();
    const entryRegistration = opaque();
    const fieldSet = canonicalFieldSet();
    const calls: string[] = [];
    let current = true;
    let entryDispose: (() => void) | null = null;
    let entropyCalls = 0;
    let registerCalls = 0;
    let wipeCalls = 0;

    const entryLifecycle = {
        async withCurrentEntry(candidate: unknown, operation: (value: typeof fieldSet) => void) {
            calls.push('entry:with:begin');
            if (!current || candidate !== entryRef) return false;
            operation(fieldSet);
            calls.push('entry:with:end');
            return current;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            calls.push('entry:register');
            registerCalls += 1;
            if (!current || candidate !== entryRef || entryDispose) return null;
            entryDispose = dispose;
            return entryRegistration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            calls.push('entry:confirm');
            return current && candidate === entryRef && registration === entryRegistration && entryDispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            calls.push('entry:unregister');
            if (!current || candidate !== entryRef || registration !== entryRegistration || !entryDispose) return false;
            entryDispose = null;
            return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown,
            operation: (value: typeof fieldSet) => void) {
            calls.push('entry:with-dependent:begin');
            if (!current || candidate !== entryRef || registration !== entryRegistration || !entryDispose) return false;
            operation(fieldSet);
            calls.push('entry:with-dependent:end');
            return current;
        },
    };
    const entryService = {
        wipe(candidate: unknown) {
            calls.push('entry:wipe');
            wipeCalls += 1;
            if (!current || candidate !== entryRef) return false;
            current = false;
            const dispose = entryDispose;
            entryDispose = null;
            dispose?.();
            return true;
        },
    };
    const entropy = () => {
        calls.push('entropy');
        entropyCalls += 1;
        return Uint8Array.from({ length: 32 }, (_, index) => index);
    };
    return {
        entryRef,
        fieldSet,
        calls,
        sources: { entryLifecycle, entryService, entropy },
        entropyCalls: () => entropyCalls,
        registerCalls: () => registerCalls,
        wipeCalls: () => wipeCalls,
    };
}

test('publishes one canonical authority-free handoff only after H4 attach and confirmation', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);

    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['cancel', 'present']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), [
        'confirmDependent',
        'registerDependent',
        'unregisterDependent',
        'withCurrentDependent',
        'withCurrentPresentation',
    ]);

    const handoff = await owner.service.present(current.entryRef);
    current.calls.push('published');

    assert.deepEqual(current.calls, [
        'entry:with:begin',
        'entropy',
        'entry:register',
        'entry:with:end',
        'entry:confirm',
        'published',
    ]);
    assert.equal(current.entropyCalls(), 1);
    assert.equal(current.registerCalls(), 1);
    assert.deepEqual(Reflect.ownKeys(handoff), ['schema', 'correlationToken', 'fieldSet']);
    assert.equal(handoff.schema, 'mediflow.headless.soap-entry-presentation.v1');
    assert.equal(handoff.correlationToken, 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    assert.deepEqual(handoff.fieldSet, current.fieldSet);
    assert.notEqual(handoff.fieldSet, current.fieldSet);
    assert.equal(Object.getPrototypeOf(handoff), null);
    assert.equal(Object.isFrozen(handoff), true);

    await assert.rejects(owner.service.present(current.entryRef));
    assert.equal(current.entropyCalls(), 1);
    assert.equal(current.registerCalls(), 1);
});

test('exposes H5b currentness with zero-argument callbacks and one opaque dependent registration', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.entryRef);
    let registration: unknown = null;
    let currentCallbackArguments = -1;
    let dependentCallbackArguments = -1;
    let disposeCalls = 0;

    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        handoff.correlationToken,
        function () {
            currentCallbackArguments = arguments.length;
            registration = owner.lifecycleController.registerDependent(
                handoff.correlationToken,
                () => { disposeCalls += 1; },
            );
        },
    ), true);
    assert.equal(currentCallbackArguments, 0);
    assert.ok(registration);
    assert.equal(Object.getPrototypeOf(registration), null);
    assert.equal(Object.isFrozen(registration), true);
    assert.deepEqual(Reflect.ownKeys(registration), []);
    assert.equal(owner.lifecycleController.confirmDependent(handoff.correlationToken, registration), true);
    assert.equal(owner.lifecycleController.registerDependent(handoff.correlationToken, () => undefined), null);

    assert.equal(await owner.lifecycleController.withCurrentDependent(
        handoff.correlationToken,
        registration,
        function () { dependentCallbackArguments = arguments.length; },
    ), true);
    assert.equal(dependentCallbackArguments, 0);
    assert.equal(owner.lifecycleController.unregisterDependent(handoff.correlationToken, registration), true);
    assert.equal(owner.lifecycleController.unregisterDependent(handoff.correlationToken, registration), false);
    assert.equal(disposeCalls, 0);
});

test('cancel terminalizes the presentation, drains H5b once, and wipes its H4 entry', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.entryRef);
    let registration: unknown = null;
    let disposeCalls = 0;

    assert.equal(await owner.lifecycleController.withCurrentPresentation(handoff.correlationToken, () => {
        registration = owner.lifecycleController.registerDependent(
            handoff.correlationToken,
            () => { disposeCalls += 1; },
        );
    }), true);
    assert.ok(registration);
    assert.equal(owner.lifecycleController.confirmDependent(handoff.correlationToken, registration), true);

    assert.equal(owner.service.cancel(handoff.correlationToken), true);
    assert.equal(owner.service.cancel(handoff.correlationToken), false);
    assert.equal(disposeCalls, 1);
    assert.equal(current.wipeCalls(), 1);
    assert.equal(await owner.lifecycleController.withCurrentPresentation(
        handoff.correlationToken,
        () => assert.fail('stale presentation callback must stay inert'),
    ), false);
    assert.equal(owner.lifecycleController.confirmDependent(handoff.correlationToken, registration), false);
});
