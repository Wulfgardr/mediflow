'use client';
import { useEffect, useRef, useState } from 'react';
import { getICDCatalogStatus } from '@/lib/icd-service';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { WHO_EMBEDDED_ATTRIBUTION } from '@/lib/reference-data/icd11-embedded-contract';
import type { WhoCatalogPreview, WhoCatalogStatus } from '@/lib/reference-data/icd11-embedded-store';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

const endpoint = '/api/icd/catalog';
export function WhoEmbeddedCatalog({ onChanged }: { onChanged(): void }) {
    const confirm = useConfirm();
    const [status, setStatus] = useState<WhoCatalogStatus | null>(null);
    const [preview, setPreview] = useState<WhoCatalogPreview | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const active = useRef<AbortController | null>(null);
    const mounted = useRef(false);
    const statusGeneration = useRef(0);
    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        const generation = ++statusGeneration.current;
        void getICDCatalogStatus(controller.signal).then(value => {
            if (!controller.signal.aborted && generation === statusGeneration.current) setStatus(value);
        }).catch(() => { if (!controller.signal.aborted && generation === statusGeneration.current) setError('Stato del catalogo WHO non leggibile. Riprova.'); });
        return () => { mounted.current = false; controller.abort(); active.current?.abort(); };
    }, []);
    async function refresh() {
        const generation = ++statusGeneration.current;
        const value = await getICDCatalogStatus(active.current?.signal ?? AbortSignal.timeout(8000));
        if (mounted.current && generation === statusGeneration.current) { setStatus(value); onChanged(); }
    }
    async function run(action: 'preview' | 'activate' | 'rollback') {
        if (busy || active.current) return;
        const accepted = await confirm({ title: action === 'preview' ? 'Scaricare il catalogo WHO?' : action === 'activate' ? 'Attivare il catalogo verificato?' : 'Ripristinare il catalogo precedente?',
            message: action === 'preview'
                ? 'Scarica la SimpleTabulation MMS 2026-01 inglese da icdcdn.who.int. Non invia dati clinici. Licenza CC BY-ND 3.0 IGO, attribuzione WHO. Il catalogo in uso resta disponibile; l’attivazione richiede una seconda conferma.'
                : action === 'activate' ? `Attiva ${preview?.manifest.categories.toLocaleString('it-IT')} categorie della release 2026-01 in inglese. La versione precedente resta ripristinabile. Non modifica le diagnosi salvate.`
                    : 'Torna alla versione precedente del catalogo. Non modifica le diagnosi salvate.',
            confirmLabel: action === 'preview' ? 'Scarica anteprima' : action === 'activate' ? 'Attiva catalogo' : 'Ripristina catalogo' });
        if (!accepted.confirmed || !mounted.current || active.current) return;
        const controller = new AbortController(); active.current = controller;
        statusGeneration.current++;
        setBusy(true); setNotice(''); setError('');
        try {
            const body = action === 'preview' ? { action, confirmed: true } : action === 'activate'
                ? { action, confirmed: true, previewId: preview?.previewId, expectedRevision: preview?.expectedRevision }
                : { action, confirmed: true, expectedRevision: status?.revision };
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: controller.signal });
            const value = await response.json();
            if (!mounted.current) return;
            if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Aggiornamento WHO non riuscito.');
            if (action === 'preview') { setPreview(value as WhoCatalogPreview); setNotice('Anteprima verificata. Il catalogo in uso non è cambiato.'); }
            else { setPreview(null); await refresh(); setNotice(action === 'activate' ? 'Catalogo attivato e riletto.' : 'Catalogo precedente ripristinato e riletto.'); }
        } catch (error) {
            if (mounted.current) { setError(controller.signal.aborted ? 'Operazione interrotta. Rileggi lo stato per verificare il catalogo in uso.' : error instanceof Error ? error.message : 'Operazione WHO non riuscita.'); setPreview(null); }
        } finally { active.current = null; if (mounted.current) setBusy(false); }
    }
    const label = status ? { ready: 'Pronto', absent: 'Assente', unverified: 'Non verificato' }[status.state] : 'Stato non ancora letto';
    return <div className="mt-4 space-y-3 text-base font-normal" data-testid="who-embedded-catalog">
        <h3 className="text-base font-semibold">Catalogo WHO incorporato</h3>
        <p>Stato: {label}{status && !status.enabled ? ' · Disattivato dal gestore' : ''} · MMS 2026-01 · Inglese</p>
        {status?.manifest && <p>{status.manifest.categories.toLocaleString('it-IT')} categorie con codice disponibili senza rete, Docker o credenziali.</p>}
        {status?.state === 'absent' && <p>Il catalogo non è incluso in questa distribuzione. Per cercare senza Docker serve prima un’acquisizione confermata.</p>}
        {status?.state === 'unverified' && <p>Il catalogo non ha superato i controlli. La ricerca incorporata non è disponibile.</p>}
        <p className="text-sm text-[color:var(--lume-ink-muted)]">{WHO_EMBEDDED_ATTRIBUTION}. Dati WHO separati dalla licenza del software. Solo categorie e titoli inglesi, senza sinonimi o postcoordinazione.</p>
        <div className="flex flex-wrap gap-2">
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !status?.enabled} onClick={() => void run('preview')}>Aggiorna dalla WHO</button>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => { setError(''); void refresh().catch(() => setError('Stato del catalogo WHO non leggibile.')); }}>Rileggi catalogo</button>
            {status?.previousAvailable && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy || !status.enabled} onClick={() => void run('rollback')}>Ripristina catalogo precedente</button>}
            {busy && <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} onClick={() => active.current?.abort()}>Annulla operazione WHO</button>}
        </div>
        {busy && <p role="status">Operazione WHO in corso…</p>}
        {preview && <div className="space-y-2 border-t border-[color:var(--lume-border-color)] pt-3">
            <p>Anteprima: {preview.manifest.categories.toLocaleString('it-IT')} categorie · {preview.manifest.rows.toLocaleString('it-IT')} righe · {preview.manifest.withoutCode.toLocaleString('it-IT')} righe senza codice escluse · {preview.manifest.bytes.toLocaleString('it-IT')} byte.</p>
            <details className="text-sm"><summary>Impronta del file verificato</summary><p className="break-all">SHA-256: <code>{preview.manifest.sha256}</code></p></details>
            <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={() => void run('activate')}>Attiva catalogo verificato</button>
        </div>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
    </div>;
}
