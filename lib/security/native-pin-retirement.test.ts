/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import * as web from './web-auth-lifecycle-owner-adapter';
import {
    createNativeServerSession, isPairedNativeServerSession, captureNativeLoginSessionFence,
    preparePairedNativePinRetirement, prepareNativeLegacyUserRetirement,
    commitNativeLegacyUserRetirement, abortNativeLegacyUserRetirement, clearAllSessions, getSession,
} from './server-session';

const user = { id: 'synthetic-native-pin', username: ['synthetic', 'native', 'pin'].join('-'), role: 'admin' };
const pair = { clientId: 'synthetic-pin-ipad', clientPlatform: 'ipados' as const, tokenHash: 'a'.repeat(64) };
function webSession(subject = user) {
    const control = web.bootstrapControl(); assert.ok(control);
    const attempt = web.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: randomUUID() });
    assert.ok(attempt);
    const issued = web.issue(attempt, subject); assert.ok(issued);
    return { control, issued, resolve: () => web.resolve(issued.sessionId, control.controlId) };
}
test.afterEach(() => clearAllSessions());

test('the native PIN proof can only prepare same-user Web retirement once', () => {
    const first = webSession(); const sibling = webSession();
    const other = webSession({ ...user, id: 'synthetic-unrelated-user' });
    const native = createNativeServerSession(user, pair, captureNativeLoginSessionFence());
    assert.ok(isPairedNativeServerSession(native, pair));
    assert.equal(web.prepareUserRetirement(native), null);
    assert.equal(web.prepareNativeUserRetirement(native), null);
    assert.equal(web.prepareNativeUserRetirement(user.id), null);
    const retirement = preparePairedNativePinRetirement(native); assert.ok(retirement);
    assert.equal(web.prepareNativeUserRetirement({ ...retirement }), null);
    const webRetirement = web.prepareNativeUserRetirement(retirement); assert.ok(webRetirement);
    assert.equal(web.prepareNativeUserRetirement(retirement), null);
    assert.equal(web.commitUserRetirement(webRetirement).outcome, 'completed');
    assert.notEqual(first.resolve().status, 'active'); assert.notEqual(sibling.resolve().status, 'active');
    assert.equal(other.resolve().status, 'active');
    // Claiming the bridge never consumes the native finalization handle.
    assert.equal(commitNativeLegacyUserRetirement(retirement).outcome, 'completed');
    assert.equal(getSession(native.id), null);
    const otherSession = other.resolve();
    if (otherSession.status === 'active') web.retire(otherSession.projection, 'delete');
});

test('raw user retirement, terminal proof and a copied native session cannot enter the bridge', () => {
    const raw = prepareNativeLegacyUserRetirement(user.id); assert.ok(raw);
    assert.equal(web.prepareNativeUserRetirement(raw), null);
    assert.equal(abortNativeLegacyUserRetirement(raw), true);
    const native = createNativeServerSession(user, pair, captureNativeLoginSessionFence());
    assert.equal(preparePairedNativePinRetirement({ ...native }), null);
    const retired = preparePairedNativePinRetirement(native); assert.ok(retired);
    assert.equal(abortNativeLegacyUserRetirement(retired), true);
    assert.equal(web.prepareNativeUserRetirement(retired), null);
    assert.equal(getSession(native.id), native);
});

test('aborting both preparations preserves existing sessions and burns the older Web attempt', () => {
    const active = webSession();
    const control = web.bootstrapControl(); assert.ok(control);
    const pending = web.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: randomUUID() });
    assert.ok(pending);
    const native = createNativeServerSession(user, pair, captureNativeLoginSessionFence());
    const prepared = preparePairedNativePinRetirement(native); assert.ok(prepared);
    const pairedWeb = web.prepareNativeUserRetirement(prepared); assert.ok(pairedWeb);
    assert.equal(web.abortUserRetirement(pairedWeb), true);
    assert.equal(abortNativeLegacyUserRetirement(prepared), true);
    assert.equal(web.issue(pending, user), null);
    assert.equal(active.resolve().status, 'active'); assert.equal(getSession(native.id), native);
    const current = active.resolve();
    if (current.status === 'active') web.retire(current.projection, 'delete');
});
