export const AGENT_CIPHER_SUITE = 'P256-HKDF-SHA256-A256GCM' as const;
export const AGENT_ITEM_KINDS = ['anchor', 'note', 'transcription', 'pdf', 'therapy', 'service', 'diagnosis', 'exemption', 'observation'] as const;
export type AgentItemKind = typeof AGENT_ITEM_KINDS[number];
export type AgentCipherContext = { mandateRef: string; visitId: string; itemId: string; kind: AgentItemKind };
export type AgentEnvelope = { version: 1; suite: typeof AGENT_CIPHER_SUITE; ephemeralPublicKey: string; salt: string; iv: string; ciphertext: string };
export const AGENT_MAX_ITEM_BYTES = 16 * 1024 * 1024;
export const isAgentId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
export function agentBase64(bytes: Uint8Array): string {
    let value = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) value += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    return btoa(value);
}
export function agentBytes(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function canonicalBase64(value: unknown, min: number, max: number): value is string {
    if (typeof value !== 'string' || value.length > 4 * Math.ceil(max / 3) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return false;
    try { const bytes = agentBytes(value); return bytes.length >= min && bytes.length <= max && agentBase64(bytes) === value; } catch { return false; }
}
export function validAgentEnvelope(value: unknown): value is AgentEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const envelope = value as AgentEnvelope;
    return Object.keys(envelope).sort().join(',') === 'ciphertext,ephemeralPublicKey,iv,salt,suite,version'
        && envelope.version === 1 && envelope.suite === AGENT_CIPHER_SUITE
        && canonicalBase64(envelope.ephemeralPublicKey, 65, 65) && agentBytes(envelope.ephemeralPublicKey)[0] === 4
        && canonicalBase64(envelope.salt, 32, 32) && canonicalBase64(envelope.iv, 12, 12)
        && canonicalBase64(envelope.ciphertext, 17, AGENT_MAX_ITEM_BYTES + 16);
}
export function agentCipherBinding(context: AgentCipherContext): Uint8Array<ArrayBuffer> {
    if (![context.mandateRef, context.visitId, context.itemId].every(isAgentId) || !AGENT_ITEM_KINDS.includes(context.kind)) throw new Error('AGENT_CIPHER_INVALID');
    return new TextEncoder().encode(JSON.stringify(['mediflow.agent.cassette.v1', AGENT_CIPHER_SUITE, context.mandateRef, context.visitId, context.itemId, context.kind]));
}
async function derive(shared: ArrayBuffer, salt: Uint8Array<ArrayBuffer>, binding: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const bytes = new Uint8Array(shared);
    try {
        const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
        return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: binding }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    } finally { bytes.fill(0); }
}
export async function sealAgentItem(publicKey: string, context: AgentCipherContext, plaintext: Uint8Array<ArrayBuffer>): Promise<AgentEnvelope> {
    if (!plaintext.length || plaintext.length > AGENT_MAX_ITEM_BYTES) throw new Error('AGENT_CIPHER_INVALID');
    const binding = agentCipherBinding(context);
    const target = await crypto.subtle.importKey('raw', agentBytes(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const salt = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(await crypto.subtle.deriveBits({ name: 'ECDH', public: target }, pair.privateKey, 256), salt, binding);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: binding, tagLength: 128 }, key, plaintext);
    return { version: 1, suite: AGENT_CIPHER_SUITE, ephemeralPublicKey: agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
        salt: agentBase64(salt), iv: agentBase64(iv), ciphertext: agentBase64(new Uint8Array(ciphertext)) };
}
export async function openAgentItem(privateKey: CryptoKey, context: AgentCipherContext, envelope: AgentEnvelope): Promise<Uint8Array<ArrayBuffer>> {
    try {
        if (!validAgentEnvelope(envelope)) throw new Error('invalid');
        const binding = agentCipherBinding(context);
        const publicKey = await crypto.subtle.importKey('raw', agentBytes(envelope.ephemeralPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const key = await derive(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256), agentBytes(envelope.salt), binding);
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: agentBytes(envelope.iv), additionalData: binding, tagLength: 128 }, key, agentBytes(envelope.ciphertext)));
    } catch { throw new Error('AGENT_CIPHER_UNREADABLE'); }
}
