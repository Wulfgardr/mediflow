import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabKeyShare } from './tab-key-share';

async function pair() {
    const name = 'synthetic-tab-key-' + crypto.randomUUID();
    let binding: string | null = 'synthetic-session-1';
    let active = true;
    const access = (recipient: string) => ({
        currentBinding: () => binding,
        recipient: async () => recipient,
        offer: async () => active,
        accept: async () => active ? binding : null,
        reconcile() {},
    });
    const a = createTabKeyShare<{ id: string }>(new BroadcastChannel(name), access('a'.repeat(64)));
    const b = createTabKeyShare<{ id: string }>(new BroadcastChannel(name), access('b'.repeat(64)));
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    await a.publish({ key, user: { id: 'synthetic-doctor' }, wrapping: null });
    return { a, b, key, revoke() { active = false; }, replace() { binding = 'synthetic-session-2'; }, close() { a.dispose(); b.dispose(); } };
}

test('a second tab receives a nonextractable CryptoKey that opens the original ciphertext', async () => {
    const f = await pair();
    try {
        const result = await f.b.request(1000);
        assert.ok(result);
        assert.equal(result.user.id, 'synthetic-doctor');
        assert.equal(result.key.extractable, false);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, f.key, new TextEncoder().encode('SYNTHETIC_CIPHERTEXT'));
        assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, result.key, ciphertext)), 'SYNTHETIC_CIPHERTEXT');
        await assert.rejects(crypto.subtle.exportKey('raw', result.key));
    } finally { f.close(); }
});

test('an idle-locked donor has no key to send', async () => {
    const f = await pair();
    try { f.a.clear(); assert.equal(await f.b.request(40), null); } finally { f.close(); }
});

test('server revocation prevents transfer even while the donor still holds its key', async () => {
    const f = await pair();
    try { f.revoke(); assert.equal(await f.b.request(40), null); } finally { f.close(); }
});

test('a new session cannot receive a key published under the previous session', async () => {
    const f = await pair();
    try { f.replace(); assert.equal(await f.b.request(40), null); } finally { f.close(); }
});

test('a local lock invalidates a response already in flight', async () => {
    const f = await pair();
    try {
        const pending = f.b.request(40);
        f.b.clear();
        assert.equal(await pending, null);
    } finally { f.close(); }
});

test('a peer made from a transferred key can serve a third tab after the original closes', async () => {
    const f = await pair();
    try {
        const shared = await f.b.request(1000);
        assert.ok(shared);
        await f.b.publish(shared);
        f.a.clear();
        assert.ok(await f.a.request(1000));
    } finally { f.close(); }
});
