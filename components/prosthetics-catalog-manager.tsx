'use client';
import { useEffect, useRef, useState } from 'react';
import { PROSTHETICS_COLUMNS, type ProstheticsStatus, type ProstheticsPreview, type ProstheticsReceipt, type ProstheticsManifest } from '@/lib/reference-data/prosthetics-catalog-contract';
import { ProstheticsClientError, prostheticsRequest, readProstheticsSource, type ProstheticsSource } from '@/lib/reference-data/prosthetics-catalog-client';
import { ProstheticsImportFields } from './prosthetics-import-fields';
import { ProstheticsSourcesPanel } from './prosthetics-source-documents';
import { ProstheticsCatalogLookup } from './prosthetics-catalog-manager-lookup';
import { formatCountLabel } from '@/lib/format-count';
import { Disclosure } from '@/components/disclosure';
import styles from './settings/repertori-settings.module.css';

const control = { minHeight: 'var(--lume-control-height, 44px)', borderRadius: 'var(--lume-control-radius, 10px)' };
function Provenance({ manifest }: { manifest: ProstheticsManifest }) {
    return <div className="space-y-1 text-sm leading-6" style={{ overflowWrap: 'anywhere' }}>
        <p>File: {manifest.sourceName} · {manifest.bytes.toLocaleString('it-IT')} byte</p>
        {manifest.metadata && <><p>Codifica: {manifest.metadata.codeSystem} · Versione: {manifest.metadata.version}</p>
            <p>Fonte: {manifest.metadata.source} · Ambito: {manifest.metadata.scope}</p></>}
        <Disclosure title="SHA-256 e formato">
            <p className="break-all">SHA-256: {manifest.sha256}</p><p>Formato: {manifest.contract}</p>
        </Disclosure>
    </div>;
}
export default function ProstheticsCatalogManager({ expanded, onExpandedChange }: { expanded?: boolean; onExpandedChange?: (value: boolean) => void } = {}) {
    const [status, setStatus] = useState<ProstheticsStatus | null>(null);
    const [source, setSource] = useState<ProstheticsSource | null>(null);
    const [preview, setPreview] = useState<ProstheticsPreview | null>(null);
    const [receipt, setReceipt] = useState<ProstheticsReceipt | null>(null);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const active = useRef<AbortController | null>(null);
    const initial = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController(); initial.current = controller;
        void prostheticsRequest<ProstheticsStatus>('status', controller.signal).then(setStatus)
            .catch(() => { if (!controller.signal.aborted) setMessage('Stato non disponibile. Premi Rileggi stato.'); });
        return () => { controller.abort(); active.current?.abort(); };
    }, []);
    async function run(action: (signal: AbortSignal) => Promise<void>) {
        if (active.current) return;
        initial.current?.abort();
        const controller = new AbortController(); active.current = controller;
        setBusy(true); setMessage('');
        try { await action(controller.signal); }
        catch (error) {
            if (controller.signal.aborted) return;
            setMessage(error instanceof TypeError ? 'Connessione interrotta. Rileggi stato o riprova la stessa conferma: l’import potrebbe essere già registrato.'
                : error instanceof Error ? error.message : 'Operazione non riuscita. Rileggi stato.');
            if (error instanceof ProstheticsClientError && ['CATALOG_REVISION_CONFLICT', 'PREVIEW_EXPIRED_OR_CHANGED', 'UNAUTHORIZED', 'PROSTHETICS_CATALOG_AUTHORITY_REVOKED'].includes(error.code)) { setPreview(null); setAccepted(false); }
        } finally { if (!controller.signal.aborted) setBusy(false); active.current = null; }
    }
    async function makePreview(value: ProstheticsSource, signal: AbortSignal) {
        setPreview(null); setAccepted(false); setReceipt(null);
        setPreview(await prostheticsRequest<ProstheticsPreview>('preview', signal, value));
    }
    async function reread(signal: AbortSignal, expected: ProstheticsReceipt | null = receipt) {
        const current = await prostheticsRequest<ProstheticsStatus>('status', signal); setStatus(current);
        if (expected) setMessage(current.latestReceipt?.operationKey === expected.operationKey && current.revision === expected.revision
            ? 'Import registrato e stato del repertorio riletto.' : 'Ricevuta registrata; il repertorio è cambiato dopo quell’import. Verifica lo stato corrente.');
        else setMessage('Stato del repertorio riletto.');
    }
    async function commit(signal: AbortSignal) {
        if (!source || !preview?.proof || !accepted) return;
        const result = await prostheticsRequest<{ receipt: ProstheticsReceipt; replayed: boolean }>('commit', signal, { ...source, proof: preview.proof, acceptSubset: true });
        setReceipt(result.receipt); setPreview(null); setAccepted(false);
        try { await reread(signal, result.receipt); }
        catch { if (!signal.aborted) setMessage('Import registrato; rilettura non riuscita. Premi Rileggi stato.'); }
    }
    return <section aria-label="Import repertorio protesica" className={styles.row}>
        <Disclosure headingLevel={2} open={expanded} onOpenChange={onExpandedChange}
            title={<span className={styles.title}><span>Protesica e ausili</span><span className={styles.summary}>
                {busy ? 'Controllo in corso…' : status ? `${formatCountLabel(status.count, 'voce', 'voci')} · ${formatCountLabel(status.sourceCount, 'fonte locale', 'fonti locali')}` : 'Conteggio non disponibile'}
            </span></span>}>
        <div className={styles.body}>
        <p className="text-sm leading-6">Carica il repertorio della tua fonte, controlla l’anteprima e conferma l’importazione.</p>
        <Disclosure title="Formato CSV e colonne">
            <p>Verifica provenienza, ambito e validità della fonte e conserva il file originale. La codifica dichiarata nel file non viene convertita in ISO.</p>
            <p>UTF-8, virgola o punto e virgola, LF o CRLF; virgolette doppie per celle con virgole. Nessun a capo nelle celle. Massimo 2 MiB e 20.000 righe. Campi obbligatori senza spazi esterni: codifica, codice, descrizione, versione, fonte e ambito. Le due date sono facoltative, in formato YYYY-MM-DD.</p>
            <p className="mt-2" style={{ overflowWrap: 'anywhere' }}>{PROSTHETICS_COLUMNS.join(',')}</p>
            <p className="mt-2">Un solo sistema di codifica, versione, fonte e ambito per file. Duplicati ed errori bloccano tutto l’import. I codici assenti restano; le prescrizioni salvate non cambiano.</p>
        </Disclosure>
        <a className="inline-flex items-center border px-4 text-sm font-semibold" style={control} href="/api/prosthetics/catalog/template" download>Scarica template sintetico CSV</a>
        <label className="block space-y-2 text-sm font-normal">File repertorio protesica (.csv)
            <input type="file" accept=".csv,text/csv" disabled={busy} className="block w-full min-w-0 text-sm" style={control} onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                void run(async signal => { setSource(null); setPreview(null); setAccepted(false); setReceipt(null);
                    const value = await readProstheticsSource(file, signal); setSource(value); await makePreview(value, signal); });
            }} />
        </label>
        {source && <ProstheticsImportFields source={source} disabled={busy} onChange={value => { setSource(value); setPreview(null); setAccepted(false); }} />}
        <p role="status" aria-live="polite" className="text-sm leading-6">{busy ? 'Controllo in corso…' : message}</p>
        {preview && <div aria-label="Anteprima protesica" className="space-y-3 border p-4" style={{ borderRadius: 'var(--lume-control-radius, 10px)' }}>
            <h3 className="font-semibold">{preview.valid ? 'Anteprima pronta' : 'Import bloccato'}</h3>
            <p className="text-sm">Righe: {preview.manifest.counts.total}. Valide: {preview.manifest.counts.valid}. Non valide: {preview.manifest.counts.invalid}. Duplicati: {preview.manifest.counts.duplicates}. Errori: {preview.manifest.counts.errors}.</p>
            <Provenance manifest={preview.manifest} />
            {preview.changes && <p className="text-sm">Nuove: {preview.changes.inserted}. Aggiornate: {preview.changes.updated}. Contenuto invariato: {preview.changes.unchanged}. La provenienza sarà registrata per tutte le righe.</p>}
            {preview.diagnostics.length > 0 && <ul className="list-disc space-y-2 pl-5 text-sm">{preview.diagnostics.map((item, index) => <li key={index}>Riga {item.row}, {item.column}: {item.message}</li>)}</ul>}
            {preview.diagnosticsTruncated && <p className="text-sm">Mostrati i primi 200 errori. Correggi il file e ripeti l’anteprima.</p>}
            {preview.sample.length > 0 && <Disclosure title={preview.sample.length === 1 ? 'Campione: una voce' : `Campione: prime ${preview.sample.length} voci`}>
                <ul className="space-y-2 text-sm leading-6" style={{ overflowWrap: 'anywhere' }}>{preview.sample.map((row, index) => <li key={index}><strong>{row.codeSystem} · {row.code}</strong>: {row.description}<br />Date dichiarate: {row.startDate ?? 'non indicata'} / {row.endDate ?? 'non indicata'}</li>)}</ul>
            </Disclosure>}
            {preview.valid && <><label className="flex items-start gap-3 py-3 text-sm leading-6" style={{ minHeight: 'var(--lume-control-height, 44px)' }}><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} style={{ minWidth: 24, height: 24 }} />Ho verificato fonte, versione, ambito e campi. Confermo l’aggiornamento del solo repertorio.</label>
                <button type="button" disabled={busy || !accepted} className="ui-btn-primary px-4 text-sm font-semibold disabled:opacity-50" style={control} onClick={() => void run(commit)}>Conferma importazione protesica</button></>}
        </div>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="border px-4 text-sm font-semibold" style={control} onClick={() => void run(signal => reread(signal))}>Rileggi stato</button>
            {source && <button type="button" disabled={busy} className="border px-4 text-sm font-semibold" style={control} onClick={() => void run(signal => makePreview(source, signal))}>Genera nuova anteprima</button>}</div>
        {(receipt ?? status?.latestReceipt) && <div aria-label="Ricevuta protesica" className="space-y-2 border p-4 text-sm" style={{ borderRadius: 'var(--lume-control-radius, 10px)' }}>
            <h3 className="font-semibold">Import registrato</h3><p>{new Date((receipt ?? status!.latestReceipt)!.committedAt).toLocaleString('it-IT')} · {(receipt ?? status!.latestReceipt)!.applied} {(receipt ?? status!.latestReceipt)!.applied === 1 ? 'voce' : 'voci'}</p>
            <Provenance manifest={(receipt ?? status!.latestReceipt)!.manifest} />
            <p>La ricevuta documenta l’import locale, non la validità normativa della fonte.</p>
        </div>}
        <ProstheticsSourcesPanel key={`sources:${status?.revision}`} />
        <ProstheticsCatalogLookup key={status?.revision ?? 'unknown'} />
        </div>
        </Disclosure>
    </section>;
}
