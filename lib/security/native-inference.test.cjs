/* @Codex — genuine lifecycle emissions; only DB rows/query mechanics are synthetic. */
'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const f = require('./native-ordinary.test-support.cjs');
const native = require('./native-inference-lifecycle.ts');
const shared = require('./ordinary-session-authority.ts');
const projection = require('./server-session-projection-owner.ts');
const clinical = require('./server-session-clinical-context.ts');
const raw = f.owner.serverSessions;
beforeEach(f.reset); after(f.reset);
const use = port => { const value = native.beginResourceUse(port); assert.ok(value); return value; };
function nativeOwner(session) {
    return projection.createNativePortProjectionOwnerProcessOwner({ resolve: clinical.createCanonicalNativeClinicalContextResolver(f.db.dbServer) }).registry.create(session);
}
test('genuine native emission is opaque, single-use, same-session and distinct from Web authority', () => {
    const session = f.issue(), second = f.issue(); const port = native.mintResourcePort(session), other = native.mintResourcePort(second);
    assert.ok(port); assert.ok(other); assert.deepEqual(Reflect.ownKeys(port), []); assert.ok(Object.isFrozen(port));
    assert.equal(f.owner.mintResourcePort(session), null); assert.equal(native.mintResourcePort(f.web()), null);
    assert.equal(native.mintResourcePort({ ...session }), null); assert.equal(native.mintResourcePort(new Proxy(session, {})), null);
    assert.equal(native.beginResourceUse({ ...port }), null); assert.equal(native.beginResourceUse(new Proxy(port, {})), null);
    let firstGeneration, secondGeneration;
    const a = use(port), b = use(other);
    assert.equal(native.withCurrentResourceBinding(a, binding => { firstGeneration = binding.authenticationGeneration; assert.equal(binding.sessionId, session.id); }), true);
    assert.equal(native.withCurrentResourceBinding(b, binding => { secondGeneration = binding.authenticationGeneration; }), true);
    assert.notEqual(firstGeneration, secondGeneration);
    assert.equal(native.commitResourceUse(a), true); assert.equal(native.commitResourceUse(a), false); native.abortResourceUse(b);
    assert.ok(shared.mintResourcePort(session)); assert.ok(shared.mintResourcePort(f.web()));
});
test('legacy native, local API, DTO, mobile and configure-only cannot issue inference', () => {
    assert.equal(native.mintResourcePort(raw.createSession(f.user, 'native')), null);
    assert.equal(native.mintResourcePort({ id: 'local-api', authChannel: 'native', role: 'admin' }), null);
    assert.equal(native.mintResourcePort(f.issue({}, { clientPlatform: 'ios' })), null);
    f.pair({ grantedCapabilities: ['native.ai.configure'] }); assert.equal(native.mintResourcePort(f.issue()), null);
    f.pair(); assert.equal(native.mintResourcePort(f.issue({ role: 'viewer' })), null);
});
for (const [name, revoke] of [
    ['pair removed', () => f.setSetting('network.pairing.state', JSON.stringify({ clients: [], intents: [] }))],
    ['pair token rotated', () => f.pair({ tokenHash: 'a'.repeat(64) })],
    ['inference capability revoked', () => f.pair({ grantedCapabilities: ['network.replica.readonly-patients', 'native.ai.configure'] })],
    ['patient-read capability revoked', () => f.pair({ grantedCapabilities: ['network.ai.central-runtime'] })],
    ['operator role revoked', () => { f.rows.users[0].role = 'viewer'; }],
    ['operator deleted', () => { f.rows.users = []; }],
    ['home-base mode left', () => f.setSetting('network.mode', 'standalone')],
]) test(`${name}: final use denies and physically disposes all generation resources; no resurrection`, () => {
    const session = f.issue(), port = native.mintResourcePort(session), token = use(port); let disposed = 0;
    assert.ok(native.registerPrivateResource(port, () => { disposed++; }));
    revoke(); assert.equal(native.commitResourceUse(token), false); assert.equal(disposed, 1);
    f.pair(); f.setSetting('network.mode', 'network-home-base'); f.rows.users = [{ ...f.user }];
    assert.equal(native.mintResourcePort(session), null); assert.equal(native.beginResourceUse(port), null);
});
test('session deletion physically revokes without another request; registration cannot cross ports', () => {
    const session = f.issue(), a = native.mintResourcePort(session), b = native.mintResourcePort(session); let disposed = 0;
    const registration = native.registerPrivateResource(a, () => { disposed++; }); assert.ok(registration);
    assert.equal(native.unregisterPrivateResource(b, registration), false);
    raw.deleteSession(session.id); assert.equal(disposed, 1); assert.equal(native.beginResourceUse(a), null);
});
test('mutation of original session principal is denied and cannot be repaired to renew the generation', () => {
    const session = f.issue(), port = native.mintResourcePort(session); session.role = 'admin';
    assert.equal(native.beginResourceUse(port), null); session.role = 'user'; assert.equal(native.mintResourcePort(session), null);
});
test('native binding rejects async/callback return/clone and poisons reentrant commits', async () => {
    const session = f.issue(), port = native.mintResourcePort(session);
    const token = use(port); assert.equal(native.withCurrentResourceBinding(token, () => {
        assert.equal(native.commitResourceUse(token), false);
    }), false); assert.equal(native.commitResourceUse(token), false);
    const fresh = f.issue(), freshPort = native.mintResourcePort(fresh), rawPort = raw.mintNativeSessionResourcePort(fresh);
    const rawUse = raw.beginNativeSessionResourceUse(rawPort);
    assert.equal(raw.withCurrentNativeSessionResourceBinding(rawUse, () => Promise.reject(new Error('synthetic'))), false);
    assert.equal(raw.commitNativeSessionResourceUse(rawUse), false);
    const asyncUse = use(freshPort); assert.equal(native.withCurrentResourceBinding(asyncUse, async () => {}), false);
});
test('native full owner uses canonical patient membership/version and denies Web, clone and durable/OCR authority', () => {
    const session = f.issue(), owner = nativeOwner(session);
    const lease = owner.issueSelection({ expectedEpoch: 0, patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' });
    assert.equal(lease.selectionEpoch, 1);
    assert.equal(owner.snapshotSelectionEpoch(session), 1);
    assert.throws(() => owner.snapshotSelectionEpoch({ ...session }));
    assert.throws(() => owner.mintOcrLeaseCommitPort(session));
    assert.throws(() => owner.mintDurableReviewCommitPort(session));
    assert.ok(owner.mintPatientInsightLeaseCommitPort(session));
    assert.ok(owner.mintDocumentSynthesisLeaseCommitPort(session));
    assert.ok(owner.mintTreatmentReasoningLeaseCommitPort(session));
    assert.throws(() => nativeOwner(f.web()));
    f.rows.patientsToAmbulatories = [];
    assert.throws(() => owner.issueSelection({ expectedEpoch: 1, patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' }));
});
test('Web registry does not accept native and native resolver does not accept Web', () => {
    const session = f.issue();
    const registry = projection.createFullPortProjectionOwnerFactory({ resolve: () => Object.freeze({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory', patientVersion: 1 }) });
    assert.throws(() => registry.create(session));
    const resolve = clinical.createCanonicalNativeClinicalContextResolver(f.db.dbServer);
    assert.throws(() => resolve(f.web(), { patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' }));
});
test('native original deadline cannot be extended by getSession renewal; real monotonic timeout revokes physically', () => {
    const script = `const assert=require('node:assert/strict');const raw=require(${JSON.stringify(f.root + '/packages/web-auth-lifecycle-owner')}).serverSessions;
      const s=raw.createNativeServerSession({id:'synthetic',username:'synthetic',role:'user'}, {clientId:'synthetic',clientPlatform:'macos',tokenHash:'b'.repeat(64)},raw.captureNativeLoginSessionFence());
      const port=raw.mintNativeSessionResourcePort(s);assert.ok(port);let disposed=0;
      raw.registerNativeSessionPrivateResource(port,()=>{disposed++});s.expiresAt+=60000;raw.getSession(s.id);
      setTimeout(()=>{assert.equal(raw.beginNativeSessionResourceUse(port),null);assert.equal(disposed,1);assert.equal(raw.mintNativeSessionResourcePort(s),null);},100);`;
    const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, MEDIFLOW_SESSION_TTL_MS: '35' }, timeout: 3000 });
    assert.equal(run.status, 0, run.stderr?.toString());
});
