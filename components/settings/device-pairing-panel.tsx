'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import type { NetworkPairedClientSummary } from '@/lib/api/v1/types';
import type { DevicePairingList, DevicePairingOffer } from '@/lib/network-pairing-offer-contract';
import { clientArchiveGeneration } from '@/lib/security/client-auth-api';
import styles from './settings-lume.module.css';

const route = '/api/device-pairing';
const mutationHeaders = () => ({
    'Content-Type': 'application/json',
    'x-mediflow-archive-generation': clientArchiveGeneration(),
});

const offerErrors: Record<string, string> = {
    PIN_DENIED: 'PIN non accettato.',
    LOCAL_ADMIN_REQUIRED: 'Sblocca MediFlow come amministratore su questo computer.',
    NETWORK_MODE_DISABLED: 'Abilita home-base per collegare un dispositivo.',
    PAIRING_ENDPOINT_UNAVAILABLE: 'Il collegamento sicuro in rete non è attivo. Controlla la diagnostica.',
    PAIRING_OFFERS_FULL: 'Attendi che scada uno dei codici già aperti, oppure usalo per collegare un dispositivo.',
};

export async function readDevicePairingList(): Promise<DevicePairingList | null> {
    const response = await fetch(route, { cache: 'no-store' });
    return response.ok ? response.json() as Promise<DevicePairingList> : null;
}

export function DevicePairingPanel({ networkEnabled, clients, onClientsChange }: {
    networkEnabled: boolean;
    clients: NetworkPairedClientSummary[];
    onClientsChange: (clients: NetworkPairedClientSummary[]) => void;
}) {
    const [confirmingOffer, setConfirmingOffer] = useState(false);
    const [revokeId, setRevokeId] = useState<string | null>(null);
    const [offer, setOffer] = useState<(DevicePairingOffer & { image: string }) | null>(null);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState('');

    async function createOffer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const pin = new FormData(form).get('pin');
        form.reset();
        setPending(true);
        setMessage('');
        try {
            const response = await fetch(route, {
                method: 'POST', headers: mutationHeaders(), body: JSON.stringify({ pin }),
            });
            if (!response.ok) {
                const failure = await response.json().catch(() => null) as { code?: string } | null;
                setMessage(offerErrors[failure?.code ?? ''] ?? 'Codice di collegamento non disponibile.');
                return;
            }
            const [created, { encodeQR }] = await Promise.all([response.json() as Promise<DevicePairingOffer>, import('qr')]);
            const next = { ...created, image: encodeQR(created.link, 'data-url', { border: 4, scale: 4 }) };
            setOffer(next);
            setConfirmingOffer(false);
            window.setTimeout(() => setOffer(current => current === next ? null : current),
                Math.max(0, Date.parse(next.expiresAt) - Date.now()));
        } catch {
            setMessage('Codice di collegamento non disponibile.');
        } finally {
            setPending(false);
        }
    }

    async function revoke(clientId: string) {
        setPending(true);
        setMessage('');
        try {
            const response = await fetch(`/api/v1/network/pairing-clients/${encodeURIComponent(clientId)}`, {
                method: 'DELETE', headers: mutationHeaders(),
            });
            if (!response.ok && response.status !== 404) throw new Error('Revocation unconfirmed');
            const list = await readDevicePairingList().catch(() => null);
            onClientsChange(list?.clients ?? clients.filter(client => client.clientId !== clientId));
            setRevokeId(null);
        } catch {
            setMessage('Scollegamento non confermato. Aggiorna l’elenco e riprova.');
        } finally {
            setPending(false);
        }
    }

    async function refresh() {
        setMessage('');
        setPending(true);
        try {
            const list = await readDevicePairingList();
            if (!list) throw new Error('Pairing list unavailable');
            onClientsChange(list.clients);
        } catch {
            setMessage('Elenco dei dispositivi non disponibile.');
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="space-y-4">
            {networkEnabled && <div className="space-y-3">
                {!confirmingOffer && !offer && <button type="button" className={styles.secondaryAction} disabled={pending}
                    onClick={() => { setConfirmingOffer(true); setMessage(''); }}>Collega un dispositivo</button>}
                {confirmingOffer && <form className="flex flex-wrap items-end gap-2" onSubmit={event => void createOffer(event)}>
                    <label className="grid gap-1">PIN di conferma
                        <input name="pin" type="password" minLength={4} maxLength={8} required
                            autoComplete="off" className="rounded-md border border-[var(--lume-rule)] px-3 py-2" />
                    </label>
                    <button type="submit" className={styles.primaryAction} disabled={pending}>Mostra QR</button>
                    <button type="button" className={styles.secondaryAction} disabled={pending}
                        onClick={() => { setConfirmingOffer(false); setMessage(''); }}>Annulla</button>
                </form>}
                {offer && <div className="space-y-2">
                    <Image src={offer.image} alt="QR per collegare un dispositivo MediFlow"
                        width={232} height={232} unoptimized className="[image-rendering:pixelated]" />
                    <p>Inquadra il QR con l’iPhone entro cinque minuti.</p>
                    <details>
                        <summary>Impronta del computer</summary>
                        <p className="lume-code">{new URL(offer.link).searchParams.get('fingerprint')?.match(/.{4}/gu)?.join(' ')}</p>
                    </details>
                    <div className="flex flex-wrap gap-2">
                        <a className={styles.primaryAction} href={offer.link} referrerPolicy="no-referrer">Apri nell’app</a>
                        <button type="button" className={styles.secondaryAction}
                            onClick={() => { setOffer(null); void refresh(); }}>Chiudi QR</button>
                    </div>
                </div>}
            </div>}
            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">Dispositivi collegati</h3>
                    <button type="button" className={styles.secondaryAction} disabled={pending}
                        onClick={() => void refresh()}>Aggiorna elenco</button>
                </div>
                {clients.length === 0 ? <p>Nessun dispositivo collegato.</p> : <ul className="space-y-2">
                    {clients.map(client => <li key={client.clientId} className="flex flex-wrap items-center gap-2">
                        <span>{client.deviceName}</span>
                        <time dateTime={client.pairedAt} className="text-sm">
                            {new Date(client.pairedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                        {revokeId === client.clientId ? <>
                            <button type="button" className={styles.secondaryAction} disabled={pending}
                                onClick={() => void revoke(client.clientId)}>Conferma scollegamento</button>
                            <button type="button" className={styles.secondaryAction} disabled={pending}
                                onClick={() => setRevokeId(null)}>Annulla</button>
                        </> : <button type="button" className={styles.secondaryAction} disabled={pending}
                            aria-label={`Scollega ${client.deviceName}`}
                            onClick={() => { setMessage(''); setRevokeId(client.clientId); }}>Scollega</button>}
                    </li>)}
                </ul>}
            </div>
            {message && <p role="status">{message}</p>}
        </div>
    );
}
