/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHeadlessSoapChildSessionLeaseOwner, HeadlessSoapChildSessionLeaseError } from './headless-soap-child-session-lease.ts';
import type { HeadlessSoapActiveRoleDependentRegistrationV1, HeadlessSoapActiveRoleSessionGrantV1 } from './headless-soap-active-role-session-grant.ts';

function fixture() {
    const grant = Object.freeze(Object.create(null)) as HeadlessSoapActiveRoleSessionGrantV1;
    const registrations = new Map<HeadlessSoapActiveRoleDependentRegistrationV1, () => void>();
    let active = true, beforeUse: (() => void) | null = null, afterUse: (() => void) | null = null, denyNextUse = false, now = 1_000;
    const retire = () => { if (!active) return; active = false; const disposers = [...registrations.values()]; registrations.clear(); for (const dispose of disposers) dispose(); };
    const lifecycle = Object.freeze({
        async withCurrentGrant(operation: (candidate: HeadlessSoapActiveRoleSessionGrantV1) => void) {
            if (!active) throw new Error('synthetic active role unavailable'); operation(grant); return active;
        },
        registerDependent(candidate: unknown, dispose: () => void) {
            if (!active || candidate !== grant) return null; const registration = Object.freeze(Object.create(null)) as HeadlessSoapActiveRoleDependentRegistrationV1;
            registrations.set(registration, dispose); return registration;
        },
        confirmDependent(candidate: unknown, registration: unknown) { return active && candidate === grant && registrations.has(registration as HeadlessSoapActiveRoleDependentRegistrationV1); },
        unregisterDependent(candidate: unknown, registration: unknown) { return candidate === grant && registrations.delete(registration as HeadlessSoapActiveRoleDependentRegistrationV1); },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) {
            if (denyNextUse) { denyNextUse = false; retire(); throw new Error('synthetic active role denial'); }
            if (!active || candidate !== grant || !registrations.has(registration as HeadlessSoapActiveRoleDependentRegistrationV1)) return false;
            const before = beforeUse; beforeUse = null; before?.(); operation(); const after = afterUse; afterUse = null; after?.(); return active;
        },
    });
    return { afterUse: (operation: () => void) => { afterUse = operation; }, beforeUse: (operation: () => void) => { beforeUse = operation; },
        clock: () => now, denyUse: () => { denyNextUse = true; }, lifecycle, retire, setNow: (value: number) => { now = value; } };
}
const denied = (code: string) => (error: unknown) => error instanceof HeadlessSoapChildSessionLeaseError
    && error.code === code && !/synthetic|sqlite|database|patient/iu.test(error.message);
async function prepared() {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let registration: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, candidate => { registration = owner.lifecycleController.registerDependent(candidate, () => undefined); }), true);
    assert.ok(registration); assert.equal(await owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => undefined), true);
    return { current, lease, owner, registration };
}

test('adds one private H6 binding controller without changing H2b service or lifecycle surfaces', () => {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['bindingController', 'lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.service).sort(), ['consumeProposalBudget', 'open', 'recheck', 'terminate']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), ['confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentLease', 'withCurrentProposalBudget']);
    assert.equal(Object.isFrozen(owner.bindingController), true); assert.deepEqual(Reflect.ownKeys(owner.bindingController), ['withCurrentDependentBinding']);
    assert.equal(owner.bindingController.withCurrentDependentBinding.length, 3);
});

test('emits the exact stable child-lease capsule only after H3 consumes its proposal budget', async () => {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let registration: unknown = null, calls = 0, first: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, candidate => { registration = owner.lifecycleController.registerDependent(candidate, () => undefined); }), true); assert.ok(registration);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, () => { calls += 100; }), false); assert.equal(calls, 0);
    assert.equal(await owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => undefined), true);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, binding => { calls += 1; first = binding; }), true); assert.equal(calls, 1);
    const capsule = first as { parent: Record<string, unknown>; child: Record<string, unknown>; lease: Record<string, unknown> };
    assert.equal(Object.getPrototypeOf(capsule), null); assert.equal(Object.isFrozen(capsule), true); assert.deepEqual(Reflect.ownKeys(capsule), ['parent', 'child', 'lease']);
    assert.deepEqual(Reflect.ownKeys(capsule.parent), ['identity', 'contractVersion', 'generation', 'revocationGeneration']);
    assert.deepEqual(Reflect.ownKeys(capsule.child), ['identity', 'contractVersion', 'generation', 'revocationGeneration', 'proposalBudget', 'expiresAt']);
    assert.deepEqual(Reflect.ownKeys(capsule.lease), ['identity', 'contractVersion', 'generation', 'revocationGeneration']);
    for (const record of [capsule.parent, capsule.child, capsule.lease]) { const identity = record.identity as object;
        assert.equal(Object.getPrototypeOf(record), null); assert.equal(Object.isFrozen(record), true); assert.equal(Object.getPrototypeOf(identity), null);
        assert.equal(Object.isFrozen(identity), true); assert.deepEqual(Reflect.ownKeys(identity), []); }
    assert.deepEqual([capsule.parent.contractVersion, capsule.parent.generation, capsule.parent.revocationGeneration], [1, 1, 0]);
    assert.deepEqual([capsule.child.contractVersion, capsule.child.generation, capsule.child.revocationGeneration, capsule.child.proposalBudget, capsule.child.expiresAt], [1, 1, 0, 0, 301_000]);
    assert.deepEqual([capsule.lease.contractVersion, capsule.lease.generation, capsule.lease.revocationGeneration], [1, 1, 0]);
    assert.notEqual(capsule.parent.identity, capsule.child.identity); assert.notEqual(capsule.parent.identity, capsule.lease.identity);
    assert.notEqual(capsule.child.identity, capsule.lease.identity); assert.equal(capsule.lease.identity, lease);
    const repeated: typeof capsule[] = [];
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, binding => { repeated.push(binding as typeof capsule); }), true);
    const second = repeated[0]; assert.ok(second); assert.equal(second.parent.identity, capsule.parent.identity);
    assert.equal(second.child.identity, capsule.child.identity); assert.equal(second.lease.identity, capsule.lease.identity);
});

test('shares one parent identity across siblings while keeping child and lease identities distinct', async () => {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const firstLease = await owner.service.open(), secondLease = await owner.service.open(), bindings: unknown[] = [];
    for (const lease of [firstLease, secondLease]) { let registration: unknown = null;
        assert.equal(await owner.lifecycleController.withCurrentLease(lease, candidate => { registration = owner.lifecycleController.registerDependent(candidate, () => undefined); }), true);
        assert.ok(registration); assert.equal(await owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => undefined), true);
        assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, binding => { bindings.push(binding); }), true); }
    const first = bindings[0] as { parent: { identity: object }; child: { identity: object }; lease: { identity: object } }, second = bindings[1] as typeof first;
    assert.equal(first.parent.identity, second.parent.identity); assert.notEqual(first.child.identity, second.child.identity); assert.notEqual(first.lease.identity, second.lease.identity);
});

test('binds H6 only to the exact H3 registration that consumed the private proposal budget', async () => {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let first: unknown = null, sibling: unknown = null, calls = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, candidate => {
        first = owner.lifecycleController.registerDependent(candidate, () => undefined);
        sibling = owner.lifecycleController.registerDependent(candidate, () => undefined);
    }), true); assert.ok(first); assert.ok(sibling);
    assert.equal(await owner.lifecycleController.withCurrentProposalBudget(lease, first, () => undefined), true);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, sibling, () => { calls += 100; }), false);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, first, () => { calls += 1; }), true); assert.equal(calls, 1);
});

test('does not derive an H6 registration anchor from public proposal-budget consumption', async () => {
    const current = fixture(), owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let registration: unknown = null, calls = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, candidate => {
        registration = owner.lifecycleController.registerDependent(candidate, () => undefined);
    }), true); assert.ok(registration);
    assert.equal(await owner.service.consumeProposalBudget(lease), lease);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, () => { calls += 1; }), false); assert.equal(calls, 0);
});

test('clears the private anchor when proposal transition callback or final fence fails', async () => {
    const callbackFailure = fixture(), failedOwner = createHeadlessSoapChildSessionLeaseOwner({ ...callbackFailure.lifecycle, clock: callbackFailure.clock });
    const failedLease = await failedOwner.service.open(); let failedRegistration: unknown = null;
    assert.equal(await failedOwner.lifecycleController.withCurrentLease(failedLease, candidate => {
        failedRegistration = failedOwner.lifecycleController.registerDependent(candidate, () => undefined);
    }), true); assert.ok(failedRegistration);
    assert.equal(await failedOwner.lifecycleController.withCurrentProposalBudget(
        failedLease, failedRegistration, () => { throw new Error('synthetic proposal transition failure'); }), false);
    assert.equal(await failedOwner.bindingController.withCurrentDependentBinding(failedLease, failedRegistration, () => undefined), false);
    await assert.rejects(failedOwner.service.recheck(failedLease), denied('lease_unavailable'));

    const lostFence = fixture(), fenceOwner = createHeadlessSoapChildSessionLeaseOwner({ ...lostFence.lifecycle, clock: lostFence.clock });
    const fenceLease = await fenceOwner.service.open(); let fenceRegistration: unknown = null, calls = 0;
    assert.equal(await fenceOwner.lifecycleController.withCurrentLease(fenceLease, candidate => {
        fenceRegistration = fenceOwner.lifecycleController.registerDependent(candidate, () => undefined);
    }), true); assert.ok(fenceRegistration); lostFence.afterUse(lostFence.retire);
    await assert.rejects(fenceOwner.lifecycleController.withCurrentProposalBudget(
        fenceLease, fenceRegistration, () => { calls += 1; }), denied('child_unavailable'));
    assert.equal(calls, 1); assert.equal(await fenceOwner.bindingController.withCurrentDependentBinding(
        fenceLease, fenceRegistration, () => undefined), false);
});

test('requires the exact live H3 registration and denies restarted or revoked identities', async () => {
    const { current, lease, owner, registration } = await prepared(); const foreignRegistration = Object.freeze(Object.create(null)); let calls = 0;
    assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, foreignRegistration, () => { calls += 100; }), false); assert.equal(await owner.service.recheck(lease), lease);
    const restarted = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    assert.equal(await restarted.bindingController.withCurrentDependentBinding(lease, registration, () => { calls += 100; }), false);
    current.retire(); assert.equal(await owner.bindingController.withCurrentDependentBinding(lease, registration, () => { calls += 100; }), false); assert.equal(calls, 0);
});

test('fails closed on expiry, active-role denial, registration drift, and final-fence loss', async () => {
    const expired = await prepared(); expired.current.setNow(301_000);
    await assert.rejects(expired.owner.bindingController.withCurrentDependentBinding(expired.lease, expired.registration, () => undefined), denied('lease_expired'));
    assert.equal(await expired.owner.bindingController.withCurrentDependentBinding(expired.lease, expired.registration, () => undefined), false);
    const deniedParent = await prepared(); deniedParent.current.denyUse();
    await assert.rejects(deniedParent.owner.bindingController.withCurrentDependentBinding(deniedParent.lease, deniedParent.registration, () => undefined), denied('active_role_unavailable'));
    const drifted = await prepared(); drifted.current.beforeUse(() => { assert.equal(drifted.owner.lifecycleController.unregisterDependent(drifted.lease, drifted.registration), true); });
    assert.equal(await drifted.owner.bindingController.withCurrentDependentBinding(drifted.lease, drifted.registration, () => undefined), false);
    await assert.rejects(drifted.owner.service.recheck(drifted.lease), denied('lease_unavailable'));
    const lostFence = await prepared(); let calls = 0; lostFence.current.afterUse(lostFence.current.retire);
    await assert.rejects(lostFence.owner.bindingController.withCurrentDependentBinding(lostFence.lease, lostFence.registration, () => { calls += 1; }), denied('child_unavailable'));
    assert.equal(calls, 1);
});

test('rejects async callbacks and burns the child on async result, throw, or reentry', async () => {
    const asyncFunction = await prepared();
    assert.equal(await asyncFunction.owner.bindingController.withCurrentDependentBinding(asyncFunction.lease, asyncFunction.registration, async () => undefined), false);
    assert.equal(await asyncFunction.owner.service.recheck(asyncFunction.lease), asyncFunction.lease);
    assert.equal(await asyncFunction.owner.bindingController.withCurrentDependentBinding(asyncFunction.lease, asyncFunction.registration, () => Promise.resolve()), false);
    await assert.rejects(asyncFunction.owner.service.recheck(asyncFunction.lease), denied('lease_unavailable'));
    const thrown = await prepared(); assert.equal(await thrown.owner.bindingController.withCurrentDependentBinding(
        thrown.lease, thrown.registration, () => { throw new Error('synthetic callback failure'); }), false);
    await assert.rejects(thrown.owner.service.recheck(thrown.lease), denied('lease_unavailable'));
    const reentered = await prepared(); let nested: Promise<boolean> | null = null;
    assert.equal(await reentered.owner.bindingController.withCurrentDependentBinding(reentered.lease, reentered.registration, () => {
        nested = reentered.owner.bindingController.withCurrentDependentBinding(reentered.lease, reentered.registration, () => undefined); }), false);
    assert.ok(nested); assert.equal(await nested, false); await assert.rejects(reentered.owner.service.recheck(reentered.lease), denied('lease_unavailable'));
});
