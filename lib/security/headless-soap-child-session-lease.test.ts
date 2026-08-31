/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createHeadlessSoapChildSessionLeaseService, HeadlessSoapChildSessionLeaseError } from './headless-soap-child-session-lease.ts';
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
