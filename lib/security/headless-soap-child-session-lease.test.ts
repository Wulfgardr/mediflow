/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createHeadlessSoapChildSessionLeaseOwner, createHeadlessSoapChildSessionLeaseService, HeadlessSoapChildSessionLeaseError } from './headless-soap-child-session-lease.ts';
import type { HeadlessSoapActiveRoleDependentRegistrationV1, HeadlessSoapActiveRoleSessionGrantV1 } from './headless-soap-active-role-session-grant.ts';

function fixture() {
    const grant = Object.freeze(Object.create(null)) as HeadlessSoapActiveRoleSessionGrantV1;
    const registrations = new Map<HeadlessSoapActiveRoleDependentRegistrationV1, () => void>(); let active = true, beforeUse: (() => void) | null = null, denyNextUse = false, failAttach = false, failFence = false, now = 1_000;
    const retire = () => { if (!active) return; active = false; const disposers = [...registrations.values()]; registrations.clear(); for (const dispose of disposers) dispose(); };
    const lifecycle = Object.freeze({
        async withCurrentGrant(operation: (candidate: HeadlessSoapActiveRoleSessionGrantV1) => void) { if (!active) throw new Error('synthetic active role unavailable'); try { operation(grant); } catch { retire(); return false; } if (failFence) { failFence = false; retire(); return false; } return active; },
        registerDependent(candidate: unknown, dispose: () => void) { if (failAttach) { failAttach = false; return null; } if (!active || candidate !== grant) return null; const registration = Object.freeze(Object.create(null)) as HeadlessSoapActiveRoleDependentRegistrationV1; registrations.set(registration, dispose); return registration; },
        confirmDependent(candidate: unknown, registration: unknown) { return active && candidate === grant && registrations.has(registration as HeadlessSoapActiveRoleDependentRegistrationV1); },
        unregisterDependent(candidate: unknown, registration: unknown) { return candidate === grant && registrations.delete(registration as HeadlessSoapActiveRoleDependentRegistrationV1); },
        async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) { if (denyNextUse) { denyNextUse = false; retire(); throw new Error('synthetic active role denial'); } if (!active || candidate !== grant || !registrations.has(registration as HeadlessSoapActiveRoleDependentRegistrationV1)) return false; const before = beforeUse; beforeUse = null; before?.(); operation(); return active; },
    });
    return { beforeUse: (operation: () => void) => { beforeUse = operation; }, clock: () => now, denyUse: () => { denyNextUse = true; }, failAttach: () => { failAttach = true; }, failFence: () => { failFence = true; }, lifecycle, registrationCount: () => registrations.size, setNow: (value: number) => { now = value; }, retire };
}
const denied = (code: string) => (error: unknown) => error instanceof HeadlessSoapChildSessionLeaseError && error.code === code && !/synthetic|hsar_|sqlite|database/iu.test(error.message);

test('opens one zero-field process-local child lease and rechecks the same identity', async () => {
    const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock });
    assert.deepEqual(Reflect.ownKeys(service).sort(), ['consumeProposalBudget', 'open', 'recheck', 'terminate']); assert.equal(service.open.length, 0);
    const lease = await service.open(); assert.equal(await service.recheck(lease), lease);
    assert.equal(Object.getPrototypeOf(lease), null); assert.equal(Object.isFrozen(lease), true); assert.deepEqual(Reflect.ownKeys(lease), []); assert.equal(JSON.stringify(lease), '{}');
});
test('private owner attaches, fences, unregisters, and synchronously drains child dependents', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    assert.deepEqual(Reflect.ownKeys(owner).sort(), ['lifecycleController', 'service']);
    assert.deepEqual(Reflect.ownKeys(owner.lifecycleController).sort(), ['confirmDependent', 'registerDependent', 'unregisterDependent', 'withCurrentDependent', 'withCurrentLease', 'withCurrentProposalBudget']);
    const lease = await owner.service.open(); let registration: unknown = null, removed: unknown = null, disposals = 0, removedDisposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => {
        registration = owner.lifecycleController.registerDependent(candidate, () => { disposals += 1; });
        removed = owner.lifecycleController.registerDependent(candidate, () => { removedDisposals += 1; });
        assert.ok(registration); assert.ok(removed);
    }), true);
    assert.equal(owner.lifecycleController.confirmDependent(lease, registration), true);
    assert.equal(owner.lifecycleController.unregisterDependent(lease, removed), true); assert.equal(owner.lifecycleController.unregisterDependent(lease, removed), false);
    current.retire(); assert.equal(disposals, 1); assert.equal(removedDisposals, 0); assert.equal(owner.lifecycleController.confirmDependent(lease, registration), false);
    await assert.rejects(owner.service.recheck(lease), denied('lease_unavailable'));
});
test('private continuations consume one proposal budget and isolate callback failure to one child', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock }); const sibling = await owner.service.open();
    const lease = await owner.service.open(); let registration: unknown = null, calls = 0, disposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => { registration = owner.lifecycleController.registerDependent(candidate, () => { disposals += 1; }); assert.ok(registration); }), true);
    assert.equal(await owner.lifecycleController.withCurrentDependent(lease, registration, () => { calls += 1; }), true);
    assert.equal(await owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => { calls += 1; }), true);
    await assert.rejects(owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => { calls += 100; }), denied('proposal_budget_exhausted'));
    assert.equal(await owner.service.recheck(lease), lease); assert.equal(calls, 2);
    assert.equal(await owner.lifecycleController.withCurrentDependent(lease, registration, () => { throw new Error('synthetic child failure'); }), false);
    assert.equal(disposals, 1); await assert.rejects(owner.service.recheck(lease), denied('lease_unavailable')); assert.equal(await owner.service.recheck(sibling), sibling);
});
test('private continuations reject async callbacks and poison nested child work', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let registration: unknown = null, disposals = 0, nested: Promise<boolean> | null = null;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => { registration = owner.lifecycleController.registerDependent(candidate, () => { disposals += 1; }); assert.ok(registration); }), true);
    assert.equal(await owner.lifecycleController.withCurrentDependent(lease, registration, () => { nested = owner.lifecycleController.withCurrentDependent(lease, registration, () => undefined); }), false);
    assert.equal(await nested, false); assert.equal(disposals, 1);
    const asyncLease = await owner.service.open(); let asyncRegistration: unknown = null, asyncDisposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(asyncLease, (candidate) => { asyncRegistration = owner.lifecycleController.registerDependent(candidate, () => { asyncDisposals += 1; }); assert.ok(asyncRegistration); }), true);
    assert.equal(await owner.lifecycleController.withCurrentDependent(asyncLease, asyncRegistration, async () => undefined), false); assert.equal(asyncDisposals, 0);
    assert.equal(await owner.service.recheck(asyncLease), asyncLease);
    assert.equal(await owner.lifecycleController.withCurrentDependent(asyncLease, asyncRegistration, () => Promise.reject(new Error('synthetic rejected child result'))), false); assert.equal(asyncDisposals, 1);
    const nestedAsyncLease = await owner.service.open(); let nestedAsyncRegistration: unknown = null, nestedAsync: Promise<boolean> | null = null, nestedAsyncDisposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(nestedAsyncLease, (candidate) => { nestedAsyncRegistration = owner.lifecycleController.registerDependent(candidate, () => { nestedAsyncDisposals += 1; }); assert.ok(nestedAsyncRegistration); }), true);
    assert.equal(await owner.lifecycleController.withCurrentDependent(nestedAsyncLease, nestedAsyncRegistration, () => {
        nestedAsync = owner.lifecycleController.withCurrentDependent(nestedAsyncLease, nestedAsyncRegistration, async () => undefined);
    }), false);
    assert.equal(await nestedAsync, false); assert.equal(nestedAsyncDisposals, 1); await assert.rejects(owner.service.recheck(nestedAsyncLease), denied('lease_unavailable'));
});
test('private child drain contains a throwing wipe and preserves its sibling', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(), sibling = await owner.service.open(); let continued = 0, throwing = 0, first: unknown = null, second: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => {
        first = owner.lifecycleController.registerDependent(candidate, () => { continued += 1; });
        second = owner.lifecycleController.registerDependent(candidate, () => { throwing += 1; throw new Error('synthetic wipe failure'); }); assert.ok(first); assert.ok(second);
    }), true);
    assert.equal(owner.service.terminate(lease), true); assert.deepEqual({ continued, throwing }, { continued: 1, throwing: 1 });
    assert.equal(owner.lifecycleController.confirmDependent(lease, first), false); assert.equal(owner.lifecycleController.confirmDependent(lease, second), false); assert.equal(await owner.service.recheck(sibling), sibling);
});
test('parent drain snapshots every child before a reentrant disposer can mutate siblings', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const first = await owner.service.open(), second = await owner.service.open(), third = await owner.service.open(); const calls = [0, 0, 0]; const registrations: unknown[] = [];
    for (const [index, lease] of [first, second, third].entries()) {
        assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => {
            registrations[index] = owner.lifecycleController.registerDependent(candidate, () => { calls[index] += 1; if (lease === third) owner.service.terminate(second); }); assert.ok(registrations[index]);
        }), true);
    }
    current.retire(); assert.deepEqual(calls, [1, 1, 1]);
    for (const [index, lease] of [first, second, third].entries()) assert.equal(owner.lifecycleController.confirmDependent(lease, registrations[index]), false);
});
test('private proposal continuation has one concurrent winner and never republishes after unregister', async () => {
    const current = fixture(); const owner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock });
    const lease = await owner.service.open(); let registration: unknown = null, proposals = 0;
    assert.equal(await owner.lifecycleController.withCurrentLease(lease, (candidate) => { registration = owner.lifecycleController.registerDependent(candidate, () => undefined); assert.ok(registration); }), true);
    const outcomes = await Promise.allSettled([
        owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => { proposals += 1; }),
        owner.lifecycleController.withCurrentProposalBudget(lease, registration, () => { proposals += 1; }),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value).length, 1);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && denied('proposal_budget_exhausted')(outcome.reason)).length, 1); assert.equal(proposals, 1);
    assert.equal(await owner.service.recheck(lease), lease);
    assert.equal(await owner.lifecycleController.withCurrentDependent(lease, registration, () => { assert.equal(owner.lifecycleController.unregisterDependent(lease, registration), true); }), false);
    await assert.rejects(owner.service.recheck(lease), denied('lease_unavailable'));
});
test('private continuation preserves time and parent-denial precedence over a foreign registration', async () => {
    const expired = fixture(); const expiredOwner = createHeadlessSoapChildSessionLeaseOwner({ ...expired.lifecycle, clock: expired.clock }); const expiredLease = await expiredOwner.service.open(); expired.setNow(301_000);
    await assert.rejects(expiredOwner.lifecycleController.withCurrentProposalBudget(expiredLease, Object.freeze(Object.create(null)), () => undefined), denied('lease_expired'));
    const deniedParent = fixture(); const deniedOwner = createHeadlessSoapChildSessionLeaseOwner({ ...deniedParent.lifecycle, clock: deniedParent.clock }); const deniedLease = await deniedOwner.service.open(); deniedParent.denyUse();
    await assert.rejects(deniedOwner.lifecycleController.withCurrentDependent(deniedLease, Object.freeze(Object.create(null)), () => undefined), denied('active_role_unavailable'));
    const current = fixture(); const currentOwner = createHeadlessSoapChildSessionLeaseOwner({ ...current.lifecycle, clock: current.clock }); const currentLease = await currentOwner.service.open(); let registration: unknown = null, proposals = 0;
    assert.equal(await currentOwner.lifecycleController.withCurrentLease(currentLease, (candidate) => { registration = currentOwner.lifecycleController.registerDependent(candidate, () => undefined); assert.ok(registration); }), true);
    assert.equal(await currentOwner.lifecycleController.withCurrentProposalBudget(currentLease, Object.freeze(Object.create(null)), () => { proposals += 100; }), false);
    assert.equal(await currentOwner.lifecycleController.withCurrentProposalBudget(currentLease, undefined, () => { proposals += 100; }), false);
    assert.equal(await currentOwner.lifecycleController.withCurrentProposalBudget(currentLease, registration, () => { proposals += 1; }), true);
    assert.equal(proposals, 1); assert.equal(await currentOwner.service.recheck(currentLease), currentLease);
});
test('consumes exactly one proposal budget and keeps the lease recheckable', async () => {
    const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock }); const lease = await service.open();
    assert.equal(await service.consumeProposalBudget(lease), lease);
    await assert.rejects(service.consumeProposalBudget(lease), denied('proposal_budget_exhausted'));
    assert.equal(await service.recheck(lease), lease);
});
test('uses a five-minute half-open TTL and never revives after clock rollback', async () => {
    const expiry = fixture(); const expiryService = createHeadlessSoapChildSessionLeaseService({ ...expiry.lifecycle, clock: expiry.clock }); const expiring = await expiryService.open();
    expiry.setNow(300_999); assert.equal(await expiryService.recheck(expiring), expiring); expiry.setNow(301_000);
    await assert.rejects(expiryService.recheck(expiring), denied('lease_expired')); expiry.setNow(1_000); await assert.rejects(expiryService.recheck(expiring), denied('lease_unavailable'));
    const rollback = fixture(); const rollbackService = createHeadlessSoapChildSessionLeaseService({ ...rollback.lifecycle, clock: rollback.clock }); const rolling = await rollbackService.open();
    rollback.setNow(2_000); assert.equal(await rollbackService.recheck(rolling), rolling); rollback.setNow(1_999);
    await assert.rejects(rollbackService.recheck(rolling), denied('child_unavailable')); rollback.setNow(2_001); await assert.rejects(rollbackService.recheck(rolling), denied('lease_unavailable'));
    const inFlight = fixture(); const inFlightService = createHeadlessSoapChildSessionLeaseService({ ...inFlight.lifecycle, clock: inFlight.clock }); const inFlightLease = await inFlightService.open();
    inFlight.setNow(300_999); inFlight.beforeUse(() => { inFlight.setNow(2_000); }); await assert.rejects(inFlightService.recheck(inFlightLease), denied('child_unavailable'));
    await assert.rejects(inFlightService.recheck(inFlightLease), denied('lease_unavailable'));
});
test('terminates only one child while its sibling and parent remain current', async () => {
    const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock });
    const first = await service.open(), sibling = await service.open(); assert.notEqual(first, sibling); assert.equal(current.registrationCount(), 1);
    assert.equal(service.terminate(first), true); assert.equal(service.terminate(first), false); await assert.rejects(service.recheck(first), denied('lease_unavailable'));
    assert.equal(await service.recheck(sibling), sibling); assert.equal(await service.consumeProposalBudget(sibling), sibling); assert.equal(await service.open() === sibling, false);
});
test('cascades parent retirement and active-role denial to every sibling', async () => {
    const retired = fixture(); const retiredService = createHeadlessSoapChildSessionLeaseService({ ...retired.lifecycle, clock: retired.clock }); const first = await retiredService.open(), second = await retiredService.open();
    retired.retire(); for (const lease of [first, second]) { await assert.rejects(retiredService.recheck(lease), denied('lease_unavailable')); assert.equal(retiredService.terminate(lease), false); }
    await assert.rejects(retiredService.open(), denied('active_role_unavailable'));
    const deniedParent = fixture(); const deniedService = createHeadlessSoapChildSessionLeaseService({ ...deniedParent.lifecycle, clock: deniedParent.clock }); const deniedFirst = await deniedService.open(), deniedSibling = await deniedService.open();
    deniedParent.denyUse(); await assert.rejects(deniedService.recheck(deniedFirst), denied('active_role_unavailable')); await assert.rejects(deniedService.recheck(deniedSibling), denied('lease_unavailable'));
});
test('rejects forged, cross-owner, restarted, and terminal lease identities', async () => {
    const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock }); const lease = await service.open();
    const restarted = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock });
    for (const foreign of [{}, { ...lease }, structuredClone(lease), new Proxy(lease, {})]) await assert.rejects(service.recheck(foreign), denied('lease_unavailable'));
    await assert.rejects(restarted.recheck(lease), denied('lease_unavailable')); assert.equal(service.terminate(lease), true); await assert.rejects(service.recheck(lease), denied('lease_unavailable'));
});
test('fails closed on attach, final-fence, unsafe-clock, and in-flight child loss', async () => {
    const attach = fixture(); attach.failAttach(); await assert.rejects(createHeadlessSoapChildSessionLeaseService({ ...attach.lifecycle, clock: attach.clock }).open(), denied('lifecycle_unavailable'));
    const fence = fixture(); fence.failFence(); await assert.rejects(createHeadlessSoapChildSessionLeaseService({ ...fence.lifecycle, clock: fence.clock }).open(), denied('lifecycle_unavailable')); assert.equal(fence.registrationCount(), 0);
    const unsafeClock = fixture(); unsafeClock.setNow(Number.MAX_SAFE_INTEGER); await assert.rejects(createHeadlessSoapChildSessionLeaseService({ ...unsafeClock.lifecycle, clock: unsafeClock.clock }).open(), denied('lifecycle_unavailable'));
    const inFlight = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...inFlight.lifecycle, clock: inFlight.clock }); const lost = await service.open(), sibling = await service.open();
    inFlight.beforeUse(() => { assert.equal(service.terminate(lost), true); }); await assert.rejects(service.recheck(lost), denied('child_unavailable')); assert.equal(await service.recheck(sibling), sibling);
});
test('does not publish a lease terminalized by the final clock sample', async () => {
    const current = fixture(), leaseHolder: { value: unknown } = { value: null }; let armed = false, clockReads = 0;
    const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: () => {
        const observedAt = current.clock(); if (armed && ++clockReads === 2) service.terminate(leaseHolder.value); return observedAt;
    } });
    const lease = await service.open(); leaseHolder.value = lease; armed = true;
    await assert.rejects(service.recheck(lease), denied('child_unavailable')); await assert.rejects(service.recheck(lease), denied('lease_unavailable'));
});
test('does not resolve public recheck or budget consumption after post-await child loss', async () => {
    for (const operation of ['recheck', 'consumeProposalBudget'] as const) {
        const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock }); const lease = await service.open();
        const pending = service[operation](lease); assert.equal(service.terminate(lease), true);
        await assert.rejects(pending, denied('child_unavailable')); await assert.rejects(service.recheck(lease), denied('lease_unavailable'));
    }
});
test('serializes concurrent proposal-budget consumption to one winner', async () => {
    const current = fixture(); const service = createHeadlessSoapChildSessionLeaseService({ ...current.lifecycle, clock: current.clock }); const lease = await service.open();
    const outcomes = await Promise.allSettled([service.consumeProposalBudget(lease), service.consumeProposalBudget(lease)]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value === lease).length, 1);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && denied('proposal_budget_exhausted')(outcome.reason)).length, 1);
    assert.equal(await service.recheck(lease), lease);
});
test('imports no digest, patient, selection, review, Fabric, route, persistence, proof, or writer authority', () => {
    const source = fs.readFileSync(new URL('./headless-soap-child-session-lease.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:soap-entry|selection|review|fabric|route|db-server|schema|patient|proof|writer)/iu);
    assert.doesNotMatch(source, /\b(?:patientRef|ambulatoryRef|selectionEpoch|soapDigest|proposalRef|authorizationProof|commandId|idempotencyKey|fieldSet|payload)\b/u);
    assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|randomUUID|randomBytes)\b/u);
});
