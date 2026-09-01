/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHeadlessSoapAuthorizationProofLifecycleOwner } from './headless-soap-authorization-proof-lifecycle.ts';
import { syntheticBinding } from './headless-soap-command-binding-test-fixture.ts';
import type { HeadlessSoapEntryPresentationBindingV1 } from './headless-soap-entry-presentation-lifecycle.ts';
import type { ClinicianSoapEntrySealV1 } from '../headless/clinician-soap-entry-seal.ts';

const PRESENTATION = 'A'.repeat(43);
const TEST_NOW = Date.now();
const VERIFIED_SESSION = Object.freeze(Object.assign(Object.create(null), {
    id: '1'.repeat(64), userId: 'synthetic-clinician', username: 'synthetic.clinician', role: 'admin',
    authChannel: 'web', createdAt: TEST_NOW - 1_000, expiresAt: TEST_NOW + 60_000,
}));

function fixture() {
    const source = syntheticBinding();
    const presentationBinding = Object.freeze(Object.assign(Object.create(null), {
        activeRole: source.lineage.activeRole,
        childLease: source.lineage.childLease,
        selection: source.lineage.selection,
        patientVersion: source.lineage.patientVersion,
        proposal: source.lineage.proposal,
        entryIdentity: source.lineage.entryIdentity,
        payloadDigest: source.lineage.payloadDigest,
        sealDigest: source.lineage.sealDigest,
    }));
    const presentationRegistration = Object.freeze(Object.create(null));
    let active = true;
    let attached = false;
    let presentationDispose: (() => void) | null = null;
    let bindingCurrent = true;
    const presentationLifecycle = Object.freeze({
        async withCurrentPresentation(candidate: unknown, operation: () => void) {
            if (!active || candidate !== PRESENTATION) return false;
            operation(); return active;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            if (!active || attached || candidate !== PRESENTATION) return null;
            attached = true; presentationDispose = dispose; return presentationRegistration;
        },
        confirmDependent(candidate: unknown, candidateRegistration: unknown) {
            return active && attached && candidate === PRESENTATION && candidateRegistration === presentationRegistration;
        },
        unregisterDependent(candidate: unknown, candidateRegistration: unknown) {
            if (!attached || candidate !== PRESENTATION || candidateRegistration !== presentationRegistration) return false;
            attached = false; presentationDispose = null; return true;
        },
        async withCurrentDependent(candidate: unknown, candidateRegistration: unknown, operation: () => void) {
            if (!active || !attached || candidate !== PRESENTATION || candidateRegistration !== presentationRegistration) return false;
            operation(); return active && attached;
        },
    });
    const presentationBindingController = Object.freeze({
        async withCurrentDependentBinding(candidate: unknown, candidateRegistration: unknown,
            operation: (binding: HeadlessSoapEntryPresentationBindingV1,
                sealBundle: ClinicianSoapEntrySealV1) => void) {
            if (!active || !attached || candidate !== PRESENTATION || candidateRegistration !== presentationRegistration) return false;
            operation(
                presentationBinding as unknown as HeadlessSoapEntryPresentationBindingV1,
                source.sealBundle as unknown as ClinicianSoapEntrySealV1,
            );
            return active && attached && bindingCurrent;
        },
    });
    const presentationService = Object.freeze({ cancel(candidate: unknown) {
        if (!active || candidate !== PRESENTATION) return false;
        active = false;
        if (attached) { attached = false; const dispose = presentationDispose; presentationDispose = null; dispose?.(); }
        return true;
    } });
    let now = 1_000;
    const owner = createHeadlessSoapAuthorizationProofLifecycleOwner({
        presentationLifecycle,
        presentationBinding: presentationBindingController,
        presentationService,
        verifyFreshPin: async () => VERIFIED_SESSION,
        entropy: () => Uint8Array.from({ length: 32 }, (_value, index) => index),
        now: () => now,
        schedule: (dispose) => dispose,
        cancelSchedule: () => undefined,
    });
    return { owner, source, presentationBinding, setBindingCurrent(value: boolean) { bindingCurrent = value; }, setNow(value: number) { now = value; } };
}

test('resolves one complete H6 lineage and seal through the exact H5b dependent', async () => {
    const current = fixture();
    const issued = await current.owner.service.issue(PRESENTATION, '1234');
    let drains = 0;
    const registration = current.owner.lifecycleController.registerDependent(
        issued.authorizationProof,
        () => { drains += 1; },
    );
    assert.ok(registration);
    assert.deepEqual(Reflect.ownKeys(current.owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(current.owner.bindingController), [
        'withCurrentDependentBinding', 'withSingleUseDependentBinding',
    ]);
    let lineage: Record<string, unknown> | null = null;
    let seal: unknown = null;
    assert.equal(await current.owner.bindingController.withCurrentDependentBinding(
        issued.authorizationProof,
        registration,
        (candidate, sealBundle) => { lineage = candidate as unknown as Record<string, unknown>; seal = sealBundle; },
    ), true);
    assert.ok(lineage);
    const resolved = lineage as unknown as Record<string, unknown>;
    assert.deepEqual(Reflect.ownKeys(resolved), [
        'schema', 'operationId', 'webSession', 'activeRole', 'childLease', 'selection', 'patientVersion',
        'action', 'purpose', 'proposal', 'entryIdentity', 'payloadDigest', 'sealDigest', 'policyDigest',
    ]);
    assert.deepEqual(resolved.webSession, VERIFIED_SESSION);
    assert.notEqual(resolved.webSession, VERIFIED_SESSION);
    assert.deepEqual(resolved.activeRole, current.presentationBinding.activeRole);
    assert.notEqual(resolved.activeRole, current.presentationBinding.activeRole);
    assert.equal(seal, current.source.sealBundle);
    assert.equal(drains, 0);
    assert.equal(await current.owner.lifecycleController.withCurrentProof(
        issued.authorizationProof, () => undefined,
    ), true);
});

test('consumes H5b and its H6 dependent exactly once after resolving the same binding', async () => {
    const current = fixture();
    const issued = await current.owner.service.issue(PRESENTATION, '1234');
    let drains = 0;
    const registration = current.owner.lifecycleController.registerDependent(
        issued.authorizationProof,
        () => { drains += 1; },
    );
    assert.ok(registration);
    let calls = 0;
    assert.equal(await current.owner.bindingController.withSingleUseDependentBinding(
        issued.authorizationProof,
        registration,
        () => { calls += 1; },
    ), true);
    assert.deepEqual({ calls, drains }, { calls: 1, drains: 1 });
    assert.equal(await current.owner.bindingController.withSingleUseDependentBinding(
        issued.authorizationProof, registration, () => { calls += 100; },
    ), false);
    assert.equal(calls, 1);
});

test('burns the proof when the H5a binding final fence is lost', async () => {
    const current = fixture();
    const issued = await current.owner.service.issue(PRESENTATION, '1234');
    const registration = current.owner.lifecycleController.registerDependent(issued.authorizationProof, () => undefined);
    assert.ok(registration);
    current.setBindingCurrent(false);
    await assert.rejects(current.owner.bindingController.withCurrentDependentBinding(
        issued.authorizationProof, registration, () => undefined,
    ), (error: unknown) => (error as { code?: unknown }).code === 'presentation_unavailable');
    assert.equal(current.owner.service.wipe(issued.authorizationProof), false);
});
