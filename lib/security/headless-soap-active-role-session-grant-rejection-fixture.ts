/* @Codex */
import assert from 'node:assert/strict';
import { createHeadlessSoapActiveRoleSessionGrantOwner } from './headless-soap-active-role-session-grant.ts';
import { issueSyntheticWebSession, retireSyntheticWebSession } from './web-auth-lifecycle-owner-test-fixture.ts';
const ACTOR = 'synthetic-soap-grant-rejection';
const session = issueSyntheticWebSession({ id: ACTOR, username: 'synthetic-soap-admin', role: 'admin' }, 'rejection');
const now = Math.max(Date.now(), session.createdAt), attestation = Object.freeze(Object.assign(Object.create(null), {
    attestationRef: `hsar_${'a'.repeat(32)}`, actorRef: ACTOR, schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1', role: 'physician',
    operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1', status: 'active', attestationVersion: 1,
    issuerRef: `hsari_${'b'.repeat(32)}`, expiresAt: new Date(now + 8 * 60 * 60 * 1_000), activatedAt: new Date(now),
    revocationGeneration: 0, revokedAt: null, createdAt: new Date(now - 1_000), updatedAt: new Date(now),
}));
let unhandled = 0; const onUnhandled = () => { unhandled += 1; }; process.on('unhandledRejection', onUnhandled);
try {
    const owner = createHeadlessSoapActiveRoleSessionGrantOwner({ readCurrentSession: async () => session, readAttestation: () => attestation, clock: () => now });
    const grant = await owner.service.issue(), registration = owner.lifecycleController.registerDependent(grant, () => undefined); assert.ok(registration);
    assert.equal(await owner.lifecycleController.withCurrentDependent(grant, registration, () => Promise.reject(new Error('synthetic rejected result'))), false);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(unhandled, 0);
} finally { process.off('unhandledRejection', onUnhandled); retireSyntheticWebSession(session); }
