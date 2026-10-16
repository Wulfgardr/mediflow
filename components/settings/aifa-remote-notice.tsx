'use client';

import { useEffect, useRef, useState } from 'react';
import type { AifaRemoteState } from '@/lib/aifa-catalog-source';
import { AIFA_NETWORK_SETTING_KEY } from '@/lib/aifa-catalog-source';
import type { AifaCatalogClientStatus } from '@/lib/aifa-importer';

export type AifaSourceClientStatus = {
    remote: AifaRemoteState;
    catalog: AifaCatalogClientStatus;
    networkAllowed: boolean;
    networkPreference: boolean;
};

export function useAifaRemoteStatus(revision?: string, busy = false) {
    const pending = useRef<Promise<AifaSourceClientStatus> | null>(null);
    const [status, setStatus] = useState<AifaSourceClientStatus | null>(null);
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState(false);
    const [preferenceRevision, setPreferenceRevision] = useState(0);
    useEffect(() => {
        if (busy) return;
        let current = true;
        pending.current ??= fetch('/api/drugs/source', { method: 'POST', cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error('source unavailable');
                const value = await response.json() as AifaSourceClientStatus;
                if (!value || !['available', 'unchanged', 'unavailable'].includes(value.remote?.outcome)
                    || typeof value.networkAllowed !== 'boolean' || typeof value.networkPreference !== 'boolean') throw new Error('source invalid');
                return value;
            }).finally(() => { pending.current = null; });
        void pending.current.then(value => { if (current) { setStatus(value); setError(false); } }).catch(() => { if (current) setError(true); })
            .finally(() => { if (current) setChecking(false); });
        return () => { current = false; };
    }, [revision, busy, preferenceRevision]);
    const setNetwork = async (enabled: boolean) => {
        setChecking(true);
        try {
            const response = await fetch(`/api/settings/${AIFA_NETWORK_SETTING_KEY}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: enabled ? 'enabled' : 'disabled' }),
            });
            if (!response.ok) throw new Error('setting rejected');
            setPreferenceRevision(value => value + 1);
        } catch { setError(true); setChecking(false); }
    };
    return { status, checking, error, setNetwork };
}

const date = (value: string) => new Date(value).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function AifaRemoteNotice({ status, checking, error, setNetwork, disabled = false, settings = false }: ReturnType<typeof useAifaRemoteStatus> & { disabled?: boolean; settings?: boolean }) {
    const remote = status?.remote;
    const local = status?.catalog.manifest;
    const publication = remote?.lastModified ? `AIFA ha pubblicato una versione del ${date(remote.lastModified)}` : 'La data di pubblicazione AIFA non è disponibile';
    const localDescription = local ? local.lastModified ? `il catalogo locale è del ${date(local.lastModified)}`
        : `il catalogo locale è stato scaricato il ${date(local.downloadedAt)}, senza data AIFA confrontabile`
        : 'nessun catalogo locale importato';
    const message = error ? 'Verifica AIFA non disponibile. Il catalogo locale resta consultabile.'
        : !remote ? 'Verifica AIFA in corso…'
            : remote.reason === 'network_disabled' ? 'Verifica AIFA non disponibile: accesso Internet disattivato.'
                : remote.reason === 'busy' ? 'Verifica AIFA rinviata: un’operazione sul catalogo è in corso.'
                    : remote.outcome === 'available' ? `Aggiornamento disponibile. ${publication}; ${localDescription}.`
                        : remote.outcome === 'unchanged' ? `Nessuna variazione segnalata da AIFA. ${remote.lastModified ? `Versione del ${date(remote.lastModified)}` : 'Data di pubblicazione non disponibile'}.`
                            : remote.reason === 'local_metadata_absent' ? `${publication}. La versione locale non ha metadati AIFA confrontabili; puoi aggiornarla.`
                                : 'Verifica AIFA non disponibile. Il catalogo locale resta consultabile.';
    return <div className="type-meta space-y-2" style={{ color: 'var(--lume-ink-muted)' }} data-testid="aifa-remote-notice">
        <p role="status" aria-live="polite">{message}</p>
        {remote?.checkedAt && <p>Ultimo tentativo: {new Date(remote.checkedAt).toLocaleString('it-IT')}. Controllo al massimo ogni 24 ore.</p>}
        {settings && <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={status?.networkPreference ?? false} disabled={disabled || checking || !status}
                onChange={event => void setNetwork(event.currentTarget.checked)} />
            Consenti verifiche e download del catalogo pubblico AIFA via Internet
        </label>}
    </div>;
}
