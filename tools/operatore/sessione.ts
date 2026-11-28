import { db } from '@/lib/db';
import {
    checkAuthHealthRequest, installArchiveGenerationTransport, loginWithPinRequest, loginWithVerifierRequest, readUnlockParameters,
} from '@/lib/security/client-auth-api';
import { deriveUnlockMaterial, openUnlockWrapping } from '@/lib/security/unlock-credential';
import { unwrapMasterKeyVersioned } from '@/lib/security/security';
import { confirmAgentUnlock } from '@/lib/security/agent-unlock-confirm';
import type { Credenziali } from './credenziali';

export type SessioneOperatore = Readonly<{
    utente: Readonly<{ id: string; role: string }>;
    archivio: string;
    agentiRinnovati: boolean | null;
    pin: string;
}>;

export class AccessoRifiutato extends Error {
    constructor(readonly codice: string, readonly stato: number) { super(`Accesso rifiutato (${codice || stato}).`); }
}

export class ServerNonRaggiungibile extends Error {
    constructor() { super('MediFlow non risponde su questo indirizzo.'); }
}

function base64(valore: string): Uint8Array {
    return Uint8Array.from(atob(valore), carattere => carattere.charCodeAt(0));
}

async function chiaveResidente(transitoria: CryptoKey): Promise<CryptoKey> {
    const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', transitoria));
    try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
    finally { bytes.fill(0); }
}

export async function statoServer(): Promise<{ raggiungibile: boolean; configurato: boolean; credenziale: string | null }> {
    try {
        const { response, payload } = await checkAuthHealthRequest({ fresh: true });
        const unlock = readUnlockParameters(payload?.unlock);
        return { raggiungibile: response.ok, configurato: payload?.isSetup === true, credenziale: unlock?.credential ?? null };
    } catch { return { raggiungibile: false, configurato: false, credenziale: null }; }
}

export async function accedi(credenziali: Credenziali): Promise<SessioneOperatore> {
    installArchiveGenerationTransport();
    let controllo;
    try { controllo = await checkAuthHealthRequest({ fresh: true }); }
    catch { throw new ServerNonRaggiungibile(); }
    if (!controllo.response.ok || controllo.payload?.status !== 'ok' || controllo.controlState !== 'accepted') throw new ServerNonRaggiungibile();
    if (controllo.payload.isSetup !== true) throw new AccessoRifiutato('ARCHIVIO_NON_CONFIGURATO', 409);
    const unlock = readUnlockParameters(controllo.payload.unlock);
    if (!unlock) throw new AccessoRifiutato('SBLOCCO_SCONOSCIUTO', 409);

    const materiale = unlock.credential === 'passphrase' ? await deriveUnlockMaterial(credenziali.segreto, base64(unlock.salt)) : null;
    const risposta = materiale ? await loginWithVerifierRequest(materiale.verifier) : await loginWithPinRequest(credenziali.segreto);
    const dati = risposta.payload as Record<string, unknown> | null;
    if (!risposta.response.ok || risposta.controlState !== 'accepted') {
        throw new AccessoRifiutato(typeof dati?.code === 'string' ? dati.code : '', risposta.response.status);
    }
    if (!dati || typeof dati.id !== 'string' || typeof dati.role !== 'string' || typeof dati.encryptedMasterKey !== 'string'
        || typeof dati.archiveGeneration !== 'string') throw new AccessoRifiutato('RISPOSTA_NON_VALIDA', 502);
    const sale = typeof dati.salt === 'string' ? base64(dati.salt) : Uint8Array.from(Array.isArray(dati.salt) ? dati.salt as number[] : []);
    const chiave = materiale
        ? await chiaveResidente(await openUnlockWrapping(dati.encryptedMasterKey, materiale.kek))
        : await unwrapMasterKeyVersioned(dati.encryptedMasterKey, credenziali.segreto, sale);
    const agentiRinnovati = typeof dati.agentUnlockTicket === 'string' ? await confirmAgentUnlock({ ticket: dati.agentUnlockTicket }) : null;
    db.setKey(chiave);
    return { utente: { id: dati.id, role: dati.role }, archivio: dati.archiveGeneration, agentiRinnovati, pin: credenziali.pin };
}

export async function chiudiSessione(): Promise<void> {
    db.setKey(null);
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
}
