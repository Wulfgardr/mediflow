import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { agentBase64, agentBytes, openAgentItem, sealAgentItem, type AgentCipherContext } from './agent-cassette-crypto';
import { openAgentItemNode, sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';

async function fixture() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const context: AgentCipherContext = { mandateRef: randomUUID(), visitId: randomUUID(), itemId: randomUUID(), kind: 'note' };
    return { publicKey, privateBytes, privateKey, context, plaintext: new TextEncoder().encode('SYNTHETIC_CASSETTE_ONLY_NOTE_6742') };
}
test('Node ECDH/HKDF/AES-GCM ciphertext opens in non-extractable WebCrypto and the reverse opens in Node', async () => {
    const f = await fixture();
    try {
        assert.equal(f.privateKey.extractable, false);
        const node = sealAgentItemNode(f.publicKey, f.context, f.plaintext);
        assert.deepEqual(await openAgentItem(f.privateKey, f.context, node), f.plaintext);
        const browser = await sealAgentItem(f.publicKey, f.context, f.plaintext);
        assert.deepEqual(new Uint8Array(openAgentItemNode(f.privateBytes, f.context, browser)), f.plaintext);
        assert.notEqual(browser.ephemeralPublicKey, node.ephemeralPublicKey);
        assert.notEqual(browser.iv, node.iv); assert.notEqual(browser.salt, node.salt);
        assert.ok(!JSON.stringify([node, browser]).includes(new TextDecoder().decode(f.plaintext)));
    } finally { f.privateBytes.fill(0); }
});
for (const field of ['mandateRef', 'visitId', 'itemId', 'kind'] as const) test(`ciphertext cannot move across bound ${field}`, async () => {
    const f = await fixture();
    try {
        const sealed = sealAgentItemNode(f.publicKey, f.context, f.plaintext);
        const wrong = { ...f.context, [field]: field === 'kind' ? 'therapy' : randomUUID() } as AgentCipherContext;
        await assert.rejects(openAgentItem(f.privateKey, wrong, sealed), /AGENT_CIPHER_UNREADABLE/u);
        assert.throws(() => openAgentItemNode(f.privateBytes, wrong, sealed), /AGENT_CIPHER_UNREADABLE/u);
    } finally { f.privateBytes.fill(0); }
});
for (const field of ['ciphertext', 'iv', 'salt', 'ephemeralPublicKey'] as const) test(`altered ${field} is rejected by both implementations`, async () => {
    const f = await fixture();
    try {
        const sealed = sealAgentItemNode(f.publicKey, f.context, f.plaintext), bytes = agentBytes(sealed[field]); bytes[bytes.length - 1] ^= 1;
        const altered = { ...sealed, [field]: agentBase64(bytes) };
        await assert.rejects(openAgentItem(f.privateKey, f.context, altered), /AGENT_CIPHER_UNREADABLE/u);
        assert.throws(() => openAgentItemNode(f.privateBytes, f.context, altered), /AGENT_CIPHER_UNREADABLE/u);
    } finally { f.privateBytes.fill(0); }
});
test('another mandate key, added plaintext fields and unsupported versions cannot open a cassette', async () => {
    const f = await fixture(), other = await fixture();
    try {
        const sealed = sealAgentItemNode(f.publicKey, f.context, f.plaintext);
        await assert.rejects(openAgentItem(other.privateKey, f.context, sealed), /AGENT_CIPHER_UNREADABLE/u);
        assert.throws(() => openAgentItemNode(other.privateBytes, f.context, sealed), /AGENT_CIPHER_UNREADABLE/u);
        for (const changed of [{ ...sealed, version: 2 }, { ...sealed, clinicalText: 'synthetic' }]) {
            await assert.rejects(openAgentItem(f.privateKey, f.context, changed as typeof sealed), /AGENT_CIPHER_UNREADABLE/u);
        }
    } finally { f.privateBytes.fill(0); other.privateBytes.fill(0); }
});
