/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import { createHeadlessSoapEntryFieldSetLifecycleOwner } from './headless-soap-entry-field-set-lifecycle.ts';
import type { HeadlessSoapProposalBindingV1 } from './headless-soap-proposal-lifecycle.ts';

const frozen = <T extends object>(value: T): Readonly<T> =>
    Object.freeze(Object.assign(Object.create(null), value)) as Readonly<T>;
const opaque = (): Readonly<Record<never, never>> => Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;

function snapshot() {
    const accepted = validateClinicianSoapWriteDraft(Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico',
        objective: 'Parametro sintetico',
        assessment: 'Valutazione sintetica',
        plan: 'Piano sintetico',
    }));
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('synthetic H1 snapshot denied');
    return accepted;
}

function fixture() {
    const proposalRef = opaque();
    const proposalRegistration = opaque();
    const upstream = frozen({
        activeRole: opaque(),
        childLease: opaque(),
        selection: opaque(),
        patientVersion: 7,
        proposal: frozen({ proposalIdentity: proposalRef, revision: 1, expiresAt: 120_001 }),
    });
    let current = true;
    let dispose: (() => void) | null = null;
    const proposalLifecycle = {
        async withCurrentProposal(candidate: unknown, operation: (value: ReturnType<typeof snapshot>) => void) {
            if (!current || candidate !== proposalRef) return false;
            operation(snapshot());
            return current;
        },
        registerDependent(candidate: unknown, candidateDispose: () => void) {
            if (!current || candidate !== proposalRef || dispose) return null;
            dispose = candidateDispose;
            return proposalRegistration;
        },
        confirmDependent(candidate: unknown, registration: unknown) {
            return current && candidate === proposalRef && registration === proposalRegistration && dispose !== null;
        },
        unregisterDependent(candidate: unknown, registration: unknown) {
            if (!current || candidate !== proposalRef || registration !== proposalRegistration || !dispose) return false;
            dispose = null;
            return true;
        },
        async withCurrentDependent(candidate: unknown, registration: unknown,
            operation: (value: ReturnType<typeof snapshot>) => void) {
            if (!current || candidate !== proposalRef || registration !== proposalRegistration || !dispose) return false;
            operation(snapshot());
            return current;
        },
    };
    const proposalBinding = {
        async withCurrentDependentBinding(candidate: unknown, registration: unknown,
            operation: (binding: HeadlessSoapProposalBindingV1) => void) {
            if (!current || candidate !== proposalRef || registration !== proposalRegistration || !dispose) return false;
            operation(upstream as unknown as HeadlessSoapProposalBindingV1);
            return current;
        },
    };
    const proposalService = { wipe(candidate: unknown) {
        if (!current || candidate !== proposalRef) return false;
        current = false;
        const candidateDispose = dispose;
        dispose = null;
        candidateDispose?.();
        return true;
    } };
    return { proposalRef, upstream, sources: {
        proposalLifecycle, proposalBinding, proposalService, clock: () => 1_704_067_200_987,
    } };
}

test('propagates the exact H3 binding and adds only H4 entry identity and payload digest', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current.sources);
    const entryRef = await owner.service.materialize(current.proposalRef);
    const registration = owner.lifecycleController.registerDependent(entryRef, () => undefined);
    assert.ok(registration);

    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.bindingController), ['withCurrentDependentBinding']);
    let observed: Record<string, unknown> | null = null;
    assert.equal(await owner.bindingController.withCurrentDependentBinding(entryRef, registration, (binding) => {
        observed = binding as unknown as Record<string, unknown>;
    }), true);
    assert.ok(observed);
    const binding = observed as unknown as Record<string, unknown>;
    assert.deepEqual(Reflect.ownKeys(binding), [
        'activeRole', 'childLease', 'selection', 'patientVersion', 'proposal', 'entryIdentity', 'payloadDigest',
    ]);
    assert.equal(Object.getPrototypeOf(binding), null);
    assert.equal(Object.isFrozen(binding), true);
    assert.equal(binding.activeRole, current.upstream.activeRole);
    assert.equal(binding.childLease, current.upstream.childLease);
    assert.equal(binding.selection, current.upstream.selection);
    assert.equal(binding.patientVersion, 7);
    assert.equal(binding.proposal, current.upstream.proposal);
    assert.equal(binding.entryIdentity, entryRef);
    assert.equal(Object.isFrozen(binding.payloadDigest), true);
});

test('keeps foreign H4 binding identities inert and terminalizes a failed upstream final fence', async () => {
    const foreign = fixture();
    const foreignOwner = createHeadlessSoapEntryFieldSetLifecycleOwner(foreign.sources);
    assert.equal(await foreignOwner.bindingController.withCurrentDependentBinding(
        opaque(), opaque(), () => assert.fail('foreign binding callback'),
    ), false);

    const lost = fixture();
    lost.sources.proposalBinding.withCurrentDependentBinding = async (_candidate, _registration, operation) => {
        operation(lost.upstream as unknown as HeadlessSoapProposalBindingV1);
        return false;
    };
    const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(lost.sources);
    const entryRef = await owner.service.materialize(lost.proposalRef);
    const registration = owner.lifecycleController.registerDependent(entryRef, () => undefined);
    assert.ok(registration);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(entryRef, registration, () => undefined), false);
    assert.equal(owner.service.wipe(entryRef), false);
});

test('poisons H4 when a binding callback reenters dependent confirmation', async () => {
    const current = fixture();
    const owner = createHeadlessSoapEntryFieldSetLifecycleOwner(current.sources);
    const entryRef = await owner.service.materialize(current.proposalRef);
    const registration = owner.lifecycleController.registerDependent(entryRef, () => undefined);
    assert.ok(registration);
    let inner = true;
    const outer = await owner.bindingController.withCurrentDependentBinding(entryRef, registration, () => {
        inner = owner.lifecycleController.confirmDependent(entryRef, registration);
    });
    assert.deepEqual({ inner, outer }, { inner: false, outer: false });
    assert.equal(owner.service.wipe(entryRef), false);
});
