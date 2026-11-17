import { db } from './db';
import { type AgentMandate, type AgentMandateInput } from './agent-mandate-contract';

export async function generateMandateKeys(): Promise<Pick<AgentMandateInput, 'publicKey' | 'wrappedPrivateKey'>> {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    try {
        const wrappedPrivateKey = await db.sealLocalDraft(btoa(String.fromCharCode(...raw)));
        const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))));
        return { publicKey, wrappedPrivateKey };
    } finally { raw.fill(0); }
}
export async function openMandatePrivateKey(mandate: Pick<AgentMandate, 'wrappedPrivateKey'>): Promise<CryptoKey> {
    const raw = await db.openLocalDraft(mandate.wrappedPrivateKey);
    if (typeof raw !== 'string') throw new Error('Mandato non disponibile.');
    const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
    try { return await crypto.subtle.importKey('pkcs8', bytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']); }
    finally { bytes.fill(0); }
}
