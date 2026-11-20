import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createWebSessionProofBindings, presentedWebSessionProof } from './web-session-proof.ts';
import { LOCAL_CLIENT_SESSION_PROOF_HEADER, WEB_SESSION_PROOF_HEADER } from './web-session-proof-header.ts';

const web = (byte = 'ab') => new Headers({ [WEB_SESSION_PROOF_HEADER]: byte.repeat(32) });
const native = () => new Headers({ [LOCAL_CLIENT_SESSION_PROOF_HEADER]: 'ab'.repeat(32) });

test('admission requires the bound instance, control, session and channel', () => {
    const bindings = createWebSessionProofBindings(() => 10);
    const expected = presentedWebSessionProof(web())!;
    bindings.bind('control', 'session', 20, expected);
    assert.equal(bindings.admits('control', 'session', expected), true);
    assert.equal(bindings.admits('other', 'session', expected), false);
    assert.equal(bindings.admits('control', 'other', expected), false);
    for (const headers of [new Headers(), web('cd'), native()]) {
        const proof = presentedWebSessionProof(headers);
        assert.equal(bindings.admits('control', 'session', proof), false);
        assert.equal(bindings.controlAvailable('control', proof), false);
    }
    assert.equal(bindings.controlAvailable('control', expected), true);
});

test('one proof header with exactly 32 bytes is required', () => {
    assert.equal(presentedWebSessionProof(new Headers({ [WEB_SESSION_PROOF_HEADER]: 'ab' })), null);
    const duplicate = web();
    duplicate.append(WEB_SESSION_PROOF_HEADER, 'ab'.repeat(32));
    assert.equal(presentedWebSessionProof(duplicate), null);
    const simultaneous = web();
    simultaneous.set(LOCAL_CLIENT_SESSION_PROOF_HEADER, 'ab'.repeat(32));
    assert.equal(presentedWebSessionProof(simultaneous), null);
    assert.equal(presentedWebSessionProof(native())?.kind, 'local-client');
});

test('a revoked or expired binding denies admission and cannot remove its successor', () => {
    let time = 10;
    const bindings = createWebSessionProofBindings(() => time);
    const proof = presentedWebSessionProof(native())!;
    const revoke = bindings.bind('control', 'first', 20, proof);
    assert.equal(bindings.admits('control', 'first', proof), true);
    revoke();
    assert.equal(bindings.admits('control', 'first', proof), false);
    let expired = 0;
    bindings.bind('control', 'second', 20, proof, () => { expired++; });
    revoke();
    assert.equal(bindings.admits('control', 'second', proof), true);
    time = 20;
    assert.equal(bindings.admits('control', 'second', proof), false);
    assert.equal(bindings.controlAvailable('control', null), true);
    assert.equal(expired, 1);
});

test('a Web tab joins via its own one-use offer, and shared lock revokes every tab', () => {
    let time = 10;
    const bindings = createWebSessionProofBindings(() => time);
    const source = presentedWebSessionProof(web())!;
    const recipient = presentedWebSessionProof(web('cd'))!;
    const late = presentedWebSessionProof(web('ef'))!;
    const revoke = bindings.bind('control', 'session', 30_000, source);
    assert.equal(bindings.offerTab('control', 'session', null, recipient.digest), false);
    assert.equal(bindings.offerTab('control', 'session', presentedWebSessionProof(native()), recipient.digest), false);
    assert.equal(bindings.offerTab('control', 'session', source, recipient.digest), true);
    assert.equal(bindings.admits('control', 'session', recipient), false);
    assert.deepEqual(bindings.acceptTab(recipient), { controlId: 'control', sessionId: 'session' });
    assert.equal(bindings.acceptTab(recipient), null);
    assert.equal(bindings.admits('control', 'session', recipient), true);
    assert.equal(bindings.offerTab('control', 'session', recipient, late.digest), true);
    time += 10_000;
    assert.equal(bindings.acceptTab(late), null);
    assert.equal(bindings.offerTab('control', 'session', recipient, late.digest), true);
    revoke();
    assert.equal(bindings.admits('control', 'session', source), false);
    assert.equal(bindings.admits('control', 'session', recipient), false);
    assert.equal(bindings.acceptTab(late), null);
});

test('retiring the owner session disposes every registered Web proof', () => {
    const owner = createRequire(import.meta.url)('@mediflow/web-auth-lifecycle-owner') as typeof import('@mediflow/web-auth-lifecycle-owner');
    const control = owner.bootstrapControl();
    assert.ok(control);
    const attempt = owner.begin('login', {
        controlId: control.controlId, ifMatch: control.etag, idempotencyKey: crypto.randomUUID(),
    });
    assert.ok(attempt);
    const issued = owner.issue(attempt, { id: 'synthetic', username: crypto.randomUUID(), role: 'admin' });
    assert.ok(issued);
    const resolution = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolution.status, 'active');
    if (resolution.status !== 'active') return;
    const port = owner.mintResourcePort(resolution.projection);
    assert.ok(port);

    const bindings = createWebSessionProofBindings();
    const proof = presentedWebSessionProof(web())!;
    const peer = presentedWebSessionProof(web('cd'))!;
    const revoke = bindings.bind(control.controlId, issued.sessionId, resolution.projection.expiresAt, proof);
    assert.ok(owner.registerPrivateResource(port, revoke));
    assert.equal(bindings.offerTab(control.controlId, issued.sessionId, proof, peer.digest), true);
    assert.ok(bindings.acceptTab(peer));
    assert.equal(owner.retire(resolution.projection, 'lock', {
        controlId: control.controlId, ifMatch: issued.etag, idempotencyKey: crypto.randomUUID(),
    }).outcome, 'completed');
    assert.equal(bindings.admits(control.controlId, issued.sessionId, proof), false);
    assert.equal(bindings.admits(control.controlId, issued.sessionId, peer), false);
});
