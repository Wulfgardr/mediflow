import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPairingAuthority } from './local-ui-pairing-authority.mjs';

function fixture() {
  let now = 1000, live = true;
  const notices = [];
  const binding = { instance: 'generation-1', dataDir: '/synthetic/archive', sourceFingerprint: 'source-1' };
  const authority = createPairingAuthority(binding, frame => notices.push(frame), () => now);
  const request = { ...binding, nonce: crypto.randomUUID(), host: crypto.randomUUID(), expiresAt: 8000 };
  const session = { current: () => live };
  return { authority, request, notices, session, expire: () => { now = 8001; }, lock: () => { live = false; } };
}

test('pairing requires a local decision before use and binds the confirmed host', () => {
  const f = fixture(); assert.equal(f.authority.offer(f.request), true);
  assert.equal(f.authority.use(f.request.nonce, f.request.host), false);
  assert.equal(f.authority.decide(f.request.nonce, true, f.session, 'a'.repeat(24)), true);
  assert.equal(f.authority.use(f.request.nonce, f.request.host), true);
  assert.equal(f.authority.use(f.request.nonce, crypto.randomUUID()), false);
  assert.equal(f.authority.use(crypto.randomUUID(), f.request.host), false);
});

test('refusal, expiration and replay cannot authorize navigation', () => {
  for (const outcome of ['refuse', 'expire', 'replay']) {
    const f = fixture(); f.authority.offer(f.request);
    if (outcome === 'expire') f.expire();
    assert.equal(f.authority.decide(f.request.nonce, outcome !== 'refuse', f.session, 'a'.repeat(24)), outcome === 'replay');
    if (outcome === 'replay') f.authority.revoke(f.request.nonce);
    assert.equal(f.authority.offer(f.request), false);
    assert.equal(f.authority.decide(f.request.nonce, true, f.session, 'a'.repeat(24)), false);
    assert.equal(f.authority.use(f.request.nonce, f.request.host), false);
  }
});

test('another instance, archive, source generation or invalid nonce is denied', () => {
  for (const changes of [{ instance: 'generation-2' }, { dataDir: '/another' }, { sourceFingerprint: 'source-2' },
    { nonce: 'invalid' }, { expiresAt: 62000 }, { extra: true }]) {
    const f = fixture(); assert.equal(f.authority.offer({ ...f.request, ...changes }), false);
    assert.equal(f.authority.decide(f.request.nonce, true, f.session, 'a'.repeat(24)), false);
  }
});

test('revocation, locked session and disconnect retire the capability', () => {
  for (const reason of ['revoke', 'lock', 'disconnect']) {
    const f = fixture(); f.authority.offer(f.request); f.authority.decide(f.request.nonce, true, f.session, 'a'.repeat(24));
    assert.equal(f.authority.use(f.request.nonce, f.request.host), true);
    if (reason === 'lock') f.lock();
    else if (reason === 'disconnect') f.authority.close();
    else f.authority.revoke(f.request.nonce);
    assert.equal(f.authority.use(f.request.nonce, f.request.host), false);
    assert.equal(f.authority.offer(f.request), false);
  }
});

test('a request observed by a session cannot survive its lock or gain authority without a UI code', () => {
  const f = fixture(); f.authority.offer(f.request);
  assert.equal(f.authority.observe(f.request.nonce, f.session), true);
  f.lock();
  assert.equal(f.authority.decide(f.request.nonce, true, { current: () => true }, 'a'.repeat(24)), false);
  const other = fixture(); other.authority.offer(other.request);
  assert.equal(other.authority.decide(other.request.nonce, true, other.session), false);
  assert.equal(other.authority.use(other.request.nonce, other.request.host), false);
});
