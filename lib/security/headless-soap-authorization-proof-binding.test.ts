/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    abortResourceUse,
    beginResourceUse,
    commitResourceUse,
    mintResourcePort,
    releaseResourcePort,
    withCurrentResourceBinding,
    type WebResourceBinding,
} from './web-auth-lifecycle-owner-adapter.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';
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

type FixtureOptions = Readonly<{
    verifiedSession?: unknown;
    activeRole?: HeadlessSoapEntryPresentationBindingV1['activeRole'];
    withCurrentWebSessionBinding?: (
        candidate: unknown,
        operation: (binding: WebResourceBinding) => void,
    ) => boolean;
    presentationBindingFence?: (operation: () => void) => boolean;
    entropy?: () => unknown;
}>;

function fixture(options: FixtureOptions = {}) {
    const source = syntheticBinding();
    const presentationBinding = Object.freeze(Object.assign(Object.create(null), {
        activeRole: options.activeRole ?? source.lineage.activeRole,
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
            let invoked = false;
            const invoke = () => {
                invoked = true;
                operation(
                    presentationBinding as unknown as HeadlessSoapEntryPresentationBindingV1,
                    source.sealBundle as unknown as ClinicianSoapEntrySealV1,
                );
            };
            const current = options.presentationBindingFence ? options.presentationBindingFence(invoke) : (invoke(), true);
            return current && invoked && active && attached && bindingCurrent;
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
        verifyFreshPin: async () => options.verifiedSession ?? VERIFIED_SESSION,
        withCurrentWebSessionBinding: options.withCurrentWebSessionBinding ?? ((_candidate, operation) => {
            operation(Object.freeze(Object.assign(Object.create(null), {
                principalRef: presentationBinding.activeRole.principalRef,
                authenticationGeneration: presentationBinding.activeRole.authenticationGeneration,
            })) as WebResourceBinding);
            return true;
        }),
        entropy: options.entropy ?? (() => Uint8Array.from({ length: 32 }, (_value, index) => index)),
        now: () => now,
        schedule: (dispose) => dispose,
        cancelSchedule: () => undefined,
    });
    return { owner, source, presentationBinding, presentationActive() { return active; },
        setBindingCurrent(value: boolean) { bindingCurrent = value; }, setNow(value: number) { now = value; } };
}

function withExactWebBinding(
    candidate: unknown,
    operation: (binding: WebResourceBinding) => void,
): boolean {
    const port = mintResourcePort(candidate);
    if (!port) return false;
    const use = beginResourceUse(port);
    let committed = false;
    try {
        if (!use || !withCurrentResourceBinding(use, operation)) return false;
        committed = commitResourceUse(use);
        return committed;
    } finally {
        if (use && !committed) abortResourceUse(use);
        releaseResourcePort(port);
    }
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

test('rejects a fresh PIN session from a different exact Web cell before entropy', async () => {
    const actor = 'synthetic-h6-exact-session';
    const username = 'synthetic-h6-exact-session';
    const sessionA = issueSyntheticWebSession({ id: actor, username, role: 'admin' }, 'h6-proof-a');
    let generationA: WebResourceBinding['authenticationGeneration'] | null = null;
    assert.equal(withExactWebBinding(sessionA, (binding) => { generationA = binding.authenticationGeneration; }), true);
    assert.ok(generationA);
    const sessionB = issueSyntheticWebSession({ id: actor, username, role: 'admin' }, 'h6-proof-b');
    try {
        const base = syntheticBinding().lineage.activeRole;
        const activeRole = Object.freeze(Object.assign(Object.create(null), {
            ...base,
            principalRef: actor,
            actorRef: actor,
            authenticationGeneration: generationA,
        })) as HeadlessSoapEntryPresentationBindingV1['activeRole'];
        let entropyCalls = 0;
        const current = fixture({
            verifiedSession: sessionB,
            activeRole,
            withCurrentWebSessionBinding: withExactWebBinding,
            entropy: () => { entropyCalls += 1; return Uint8Array.from({ length: 32 }, (_value, index) => index); },
        });
        await assert.rejects(
            current.owner.service.issue(PRESENTATION, '1234'),
            (error: unknown) => (error as { code?: unknown }).code === 'presentation_unavailable',
        );
        assert.equal(entropyCalls, 0);
        assert.equal(current.presentationActive(), false);
    } finally {
        retireSyntheticWebSession(sessionB);
        retireSyntheticWebSession(sessionA);
    }
});

test('accepts the same exact Web cell without nesting resource-use owners', async () => {
    const actor = 'synthetic-h6-exact-session-positive';
    const username = 'synthetic-h6-exact-session-positive';
    const session = issueSyntheticWebSession({ id: actor, username, role: 'admin' }, 'h6-proof-positive');
    try {
        let generation: WebResourceBinding['authenticationGeneration'] | null = null;
        assert.equal(withExactWebBinding(session, (binding) => { generation = binding.authenticationGeneration; }), true);
        assert.ok(generation);
        const base = syntheticBinding().lineage.activeRole;
        const activeRole = Object.freeze(Object.assign(Object.create(null), {
            ...base,
            principalRef: actor,
            actorRef: actor,
            authenticationGeneration: generation,
        })) as HeadlessSoapEntryPresentationBindingV1['activeRole'];
        let entropyCalls = 0;
        const current = fixture({
            verifiedSession: session,
            activeRole,
            withCurrentWebSessionBinding: withExactWebBinding,
            presentationBindingFence: (operation) => withExactWebBinding(session, () => { operation(); }),
            entropy: () => { entropyCalls += 1; return Uint8Array.from({ length: 32 }, (_value, index) => index); },
        });
        const issued = await current.owner.service.issue(PRESENTATION, '1234');
        assert.equal(issued.status, 'proof_issued');
        assert.equal(entropyCalls, 1);
    } finally {
        retireSyntheticWebSession(session);
    }
});

test('rejects a truthy non-boolean Web fence before entropy', async () => {
    const activeRole = syntheticBinding().lineage.activeRole;
    let entropyCalls = 0;
    const current = fixture({
        activeRole,
        withCurrentWebSessionBinding: (_candidate, operation) => {
            operation(Object.freeze(Object.assign(Object.create(null), {
                principalRef: activeRole.principalRef,
                authenticationGeneration: activeRole.authenticationGeneration,
            })) as WebResourceBinding);
            return Promise.resolve(true) as unknown as boolean;
        },
        entropy: () => { entropyCalls += 1; return Uint8Array.from({ length: 32 }, (_value, index) => index); },
    });
    await assert.rejects(
        current.owner.service.issue(PRESENTATION, '1234'),
        (error: unknown) => (error as { code?: unknown }).code === 'presentation_unavailable',
    );
    assert.equal(entropyCalls, 0);
    assert.equal(current.presentationActive(), false);
});
