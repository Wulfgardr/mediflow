import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes } from 'node:crypto';
import { AGENT_CIPHER_SUITE, AGENT_MAX_ITEM_BYTES, agentCipherBinding, validAgentEnvelope, type AgentCipherContext, type AgentEnvelope } from '../../../lib/agent-cassette-crypto';

export function sealAgentItemNode(publicKey: string, context: AgentCipherContext, plaintext: Uint8Array): AgentEnvelope {
    if (!plaintext.length || plaintext.length > AGENT_MAX_ITEM_BYTES) throw new Error('AGENT_CIPHER_INVALID');
    const ephemeral = createECDH('prime256v1'); ephemeral.generateKeys();
    const binding = agentCipherBinding(context), salt = randomBytes(32), iv = randomBytes(12);
    const shared = ephemeral.computeSecret(Buffer.from(publicKey, 'base64'));
    const key = Buffer.from(hkdfSync('sha256', shared, salt, binding, 32)); shared.fill(0);
    try {
        const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(binding);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
        return { version: 1, suite: AGENT_CIPHER_SUITE, ephemeralPublicKey: ephemeral.getPublicKey().toString('base64'), salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') };
    } finally { key.fill(0); }
}
export function openAgentItemNode(privateKeyPkcs8: Uint8Array, context: AgentCipherContext, envelope: AgentEnvelope): Buffer {
    try {
        if (!validAgentEnvelope(envelope)) throw new Error('invalid');
        const jwk = createPrivateKey({ key: Buffer.from(privateKeyPkcs8), type: 'pkcs8', format: 'der' }).export({ format: 'jwk' });
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new Error('invalid');
        const ephemeral = createECDH('prime256v1'); const scalar = Buffer.from(jwk.d, 'base64url');
        try { ephemeral.setPrivateKey(scalar); } finally { scalar.fill(0); }
        const binding = agentCipherBinding(context), shared = ephemeral.computeSecret(Buffer.from(envelope.ephemeralPublicKey, 'base64'));
        const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(envelope.salt, 'base64'), binding, 32)); shared.fill(0);
        try {
            const ciphertext = Buffer.from(envelope.ciphertext, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
            decipher.setAAD(binding); decipher.setAuthTag(ciphertext.subarray(-16));
            return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
        } finally { key.fill(0); }
    } catch { throw new Error('AGENT_CIPHER_UNREADABLE'); }
}
