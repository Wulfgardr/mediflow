/* @Codex */
import assert from 'node:assert/strict';
import { issueSyntheticWebSession, retireSyntheticWebSession } from './web-auth-lifecycle-owner-test-fixture.ts';
const ACTOR = 'synthetic-soap-grant-attach-failure';
const original = WeakMap.prototype.set; let armed = false;
WeakMap.prototype.set = function(this: WeakMap<object, unknown>, key: object, value: unknown) {
    const result = Reflect.apply(original, this, [key, value]);
    if (armed && value && typeof value === 'object' && 'dispose' in value && 'owner' in value) throw new Error('synthetic apply-then-throw');
    return result;
} as typeof WeakMap.prototype.set;
const { createHeadlessSoapActiveRoleSessionGrantOwner } = await import('./headless-soap-active-role-session-grant.ts');
WeakMap.prototype.set = original;
const session = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, 'attach-failure');
const now = Math.max(Date.now(), session.createdAt);
const attestation = Object.freeze(Object.assign(Object.create(null), {
    attestationRef: `hsar_${'a'.repeat(32)}`, actorRef: ACTOR, schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1', role: 'physician',
    operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1', status: 'active', attestationVersion: 1,
    issuerRef: `hsari_${'b'.repeat(32)}`, expiresAt: new Date(now + 8 * 60 * 60 * 1_000), activatedAt: new Date(now),
    revocationGeneration: 0, revokedAt: null, createdAt: new Date(now - 1_000), updatedAt: new Date(now),
}));
try {
    const owner = createHeadlessSoapActiveRoleSessionGrantOwner({ readCurrentSession: async () => session, readAttestation: () => attestation, clock: () => now });
    const grant = await owner.service.issue(); let calls = 0; armed = true;
    assert.equal(owner.lifecycleController.registerDependent(grant, () => { calls += 1; }), null);
    assert.equal(owner.service.dispose(grant), false); assert.equal(calls, 0);
} finally { WeakMap.prototype.set = original; retireSyntheticWebSession(session); }
