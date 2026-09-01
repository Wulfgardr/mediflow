/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeadlessSoapEntryPresentationLifecycleOwner } from './headless-soap-entry-presentation-lifecycle.ts';
import type { HeadlessSoapEntryFieldSetBindingV1 } from './headless-soap-entry-field-set-lifecycle.ts';
import {
    bindHeadlessSoapEntryPresentationGoldenSeal,
    createHeadlessSoapEntryPresentationGoldenFieldSet,
    HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4,
} from './headless-soap-entry-presentation-lifecycle-fixture.test.ts';

const frozen = <T extends object>(value: T): Readonly<T> =>
    Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
const opaque = (): Readonly<Record<never, never>> => Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;

function fixture() {
    const fieldSet = createHeadlessSoapEntryPresentationGoldenFieldSet();
    const entryRef = opaque();
    const entryRegistration = opaque();
    const upstream = frozen({
        activeRole: opaque(),
        childLease: opaque(),
        selection: opaque(),
        patientVersion: 9,
        proposal: opaque(),
        entryIdentity: entryRef,
        payloadDigest: fieldSet.payloadDigest,
    });
    let current = true;
    let dispose: (() => void) | null = null;
    const entryLifecycle = {
        async withCurrentEntry(candidate: unknown, operation: (value: typeof fieldSet) => void) {
            if (!current || candidate !== entryRef) return false;
            operation(fieldSet);
            return current;
        },
        registerDependent(candidate: unknown, candidateDispose: () => void) {
            if (!current || candidate !== entryRef || dispose) return null;
            dispose = candidateDispose;
            return entryRegistration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            return current && candidate === entryRef && registration === entryRegistration && dispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            if (!current || candidate !== entryRef || registration !== entryRegistration || !dispose) return false;
            dispose = null;
            return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
            if (!current || candidate !== entryRef || registration !== entryRegistration || !dispose) return false;
            operation();
            return current;
        },
    };
    const entryBinding = {
        async withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: HeadlessSoapEntryFieldSetBindingV1) => void) {
            if (!current || candidate !== entryRef || registration !== entryRegistration || !dispose) return false;
            operation(upstream as unknown as HeadlessSoapEntryFieldSetBindingV1);
            return current;
        },
    };
    const entryService = { wipe(candidate: unknown) {
        if (!current || candidate !== entryRef) return false;
        current = false;
        const candidateDispose = dispose;
        dispose = null;
        candidateDispose?.();
        return true;
    } };
    return { entryRef, upstream, sources: {
        entryLifecycle, entryBinding, entryService,
        entropy: () => Uint8Array.from({ length: 32 }, (_, index) => index),
    } };
}

test('hands H5b the exact H4 binding plus the verified seal in one current continuation', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(current.sources);
    const handoff = await owner.service.present(current.entryRef);
    await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
    const registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => undefined);
    assert.ok(registration);

    assert.deepEqual(Reflect.ownKeys(owner).sort(), [
        'lifecycleController', 'presentationBindingController', 'sealBindingController', 'service',
    ]);
    assert.deepEqual(Reflect.ownKeys(owner.presentationBindingController), ['withCurrentDependentBinding']);
    let observedBinding: Record<string, unknown> | null = null;
    let observedSeal: Record<string, unknown> | null = null;
    assert.equal(await owner.presentationBindingController.withCurrentDependentBinding(
        handoff.correlationToken,
        registration,
        (binding, sealBundle) => {
            observedBinding = binding as unknown as Record<string, unknown>;
            observedSeal = sealBundle as unknown as Record<string, unknown>;
        },
    ), true);
    assert.ok(observedBinding && observedSeal);
    const binding = observedBinding as unknown as Record<string, unknown>;
    const seal = observedSeal as unknown as Record<string, unknown>;
    assert.deepEqual(Reflect.ownKeys(binding), [
        'activeRole', 'childLease', 'selection', 'patientVersion', 'proposal', 'entryIdentity', 'payloadDigest', 'sealDigest',
    ]);
    assert.equal(Object.getPrototypeOf(binding), null);
    assert.equal(Object.isFrozen(binding), true);
    assert.equal(binding.entryIdentity, current.entryRef);
    assert.equal(binding.payloadDigest, current.upstream.payloadDigest);
    assert.equal(binding.sealDigest, seal.sealDigest);
    assert.notEqual(seal, HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal);
    assert.equal(Object.getPrototypeOf(seal), null);
    assert.equal(Object.isFrozen(seal), true);
});

test('keeps foreign H5a binding inert and terminalizes loss of the H4 binding fence', async () => {
    const foreign = fixture();
    const foreignOwner = createHeadlessSoapEntryPresentationLifecycleOwner(foreign.sources);
    assert.equal(await foreignOwner.presentationBindingController.withCurrentDependentBinding(
        'A'.repeat(43), opaque(), () => assert.fail('foreign presentation callback'),
    ), false);

    const lost = fixture();
    lost.sources.entryBinding.withCurrentDependentBinding = async (_candidate, _registration, operation) => {
        operation(lost.upstream as unknown as HeadlessSoapEntryFieldSetBindingV1);
        return false;
    };
    const owner = createHeadlessSoapEntryPresentationLifecycleOwner(lost.sources);
    const handoff = await owner.service.present(lost.entryRef);
    await bindHeadlessSoapEntryPresentationGoldenSeal(owner, handoff.correlationToken);
    const registration = owner.lifecycleController.registerDependent(handoff.correlationToken, () => undefined);
    assert.ok(registration);
    assert.equal(await owner.presentationBindingController.withCurrentDependentBinding(
        handoff.correlationToken, registration, () => undefined,
    ), false);
    assert.equal(owner.service.cancel(handoff.correlationToken), false);
});
