'use client';

/* @Codex */
import { useEffect, useRef, useState } from 'react';
import { Database } from 'lucide-react';
import {
    commitExemptionFile, ExemptionImportClientError, getExemptionImportStatus,
    previewExemptionFile, readExemptionImportSource, type ExemptionImportSource,
} from '@/lib/exemption-importer';
import { EXEMPTION_COLUMNS, type ExemptionCatalogStatus, type ExemptionImportPreview, type ExemptionImportReceipt } from '@/lib/exemption-import-contract';

export default function ExemptionDbManager() {
    const [status, setStatus] = useState<ExemptionCatalogStatus | null>(null);
    const [source, setSource] = useState<ExemptionImportSource | null>(null);
    const [preview, setPreview] = useState<ExemptionImportPreview | null>(null);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [message, setMessage] = useState('');
    const [receipt, setReceipt] = useState<ExemptionImportReceipt | null>(null);
    const [verified, setVerified] = useState(false);

    useEffect(() => {
        let active = true;
        void getExemptionImportStatus().then((value) => { if (active) setStatus(value); })
            .catch(() => { if (active) setMessage('Conteggio non disponibile. Premi Rileggi stato.'); });
        return () => { active = false; };
    }, []);

    async function run(action: () => Promise<void>) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setMessage('');
        try { await action(); }
        catch (error) {
            setMessage(error instanceof TypeError ? 'Connessione interrotta. Rileggi lo stato o riprova la stessa conferma.'
                : error instanceof Error ? error.message : 'Operazione non riuscita. Rileggi lo stato.');
            if (error instanceof ExemptionImportClientError && ['CATALOG_REVISION_CONFLICT', 'PREVIEW_EXPIRED_OR_CHANGED'].includes(error.code)) {
                setPreview(null); setAccepted(false);
            }
        } finally { inFlight.current = false; setBusy(false); }
    }
    async function makePreview(value: ExemptionImportSource) {
        setAccepted(false); setReceipt(null); setVerified(false); setPreview(null);
        setPreview(await previewExemptionFile(value));
    }
    async function reread(expected: ExemptionImportReceipt | null = receipt) {
        const current = await getExemptionImportStatus();
        setStatus(current);
        if (expected) {
            const same = current.latestReceipt?.operationKey === expected.operationKey && current.revision === expected.revision;
            setVerified(same);
            setMessage(same ? 'Import registrato e stato del repertorio riletto.' : 'La ricevuta è registrata, ma il repertorio è cambiato dopo l’import. Verifica lo stato corrente.');
        }
    }
    async function commit() {
        if (!source || !preview?.proof || !accepted) return;
        const result = await commitExemptionFile(source, preview.proof);
        setReceipt(result.receipt); setVerified(false); setPreview(null); setAccepted(false);
        try { await reread(result.receipt); }
        catch { setMessage('Import registrato; rilettura non riuscita. Premi Rileggi stato.'); }
    }

    return (
        <section aria-label="Import esenzioni" className="mf-section lume-focal space-y-5 p-6 md:p-7">
            <div className="flex items-center gap-3">
                <Database aria-hidden="true" className="h-6 w-6 text-emerald-600" />
                <div>
                    <p className="section-kicker">Repertorio amministrativo</p>
                    <h2 className="text-lg font-bold">Codifiche Esenzioni</h2>
                    <p className="text-sm">{status ? `${status.count.toLocaleString()} codici nel repertorio` : 'Conteggio non disponibile'}</p>
                </div>
            </div>
            <p className="text-sm">Importa un file locale: prima controlli l’anteprima, poi confermi l’aggiornamento. I codici assenti dal file restano nel repertorio e le assegnazioni ai pazienti restano invariate.</p>
            <details className="text-sm">
                <summary className="cursor-pointer">Formato richiesto e limiti</summary>
                <p className="mt-2">Un file UTF-8, massimo 2 MiB e 20.000 righe, separatore | e fine riga CRLF. Date YYYYMMDD, flag S/N, null espresso come {'\\N'}. Codici duplicati o righe non valide bloccano tutto il file.</p>
                <p className="mt-2 break-words">Intestazioni obbligatorie: {EXEMPTION_COLUMNS.join(', ')}.</p>
                <p className="mt-2">Il repertorio ridotto serve alla ricerca dei codici; non determina eleggibilità o validità prescrittiva. Conserva il file originale.</p>
            </details>
            <label className="block space-y-2 text-sm font-medium">
                <span>File esenzioni (.txt o .csv delimitato da |)</span>
                <input type="file" accept=".txt,.csv" disabled={busy} className="block w-full min-h-11 text-sm"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        void run(async () => {
                            setSource(null); setPreview(null); setAccepted(false); setReceipt(null); setVerified(false);
                            const value = await readExemptionImportSource(file);
                            setSource(value); await makePreview(value);
                        });
                    }} />
            </label>
            {source && <p className="break-all text-sm">File selezionato: {source.sourceName}</p>}
            {busy && <p role="status">Controllo in corso…</p>}
            {preview && (
                <div className="space-y-3 rounded-xl border p-4" aria-label="Anteprima import">
                    <h3 className="font-semibold">{preview.valid ? 'Anteprima pronta' : 'Import bloccato'}</h3>
                    <p className="text-sm">Righe lette: {preview.manifest.rowCount}. Valide: {preview.manifest.validRows}. Errori: {preview.manifest.errorCount}. Duplicati: {preview.manifest.duplicateRows}. Nessuna scrittura eseguita nell’anteprima.</p>
                    {preview.diagnostics.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">
                        {preview.diagnostics.map((item, index) => <li key={index}>Riga {item.line}, {item.column}: {item.message}</li>)}
                    </ul>}
                    {preview.manifest.errorCount > preview.diagnostics.length && <p className="text-sm">Mostrati i primi 100 errori. Correggi il file e genera una nuova anteprima.</p>}
                    <p className="text-sm">Colonne escluse, senza interpretazione normativa: {preview.manifest.excludedColumns.length
                        ? preview.manifest.excludedColumns.map((column) => `${column.name} (${column.nonNullValues} valori)`).join(', ')
                        : 'nessuna colonna aggiuntiva nel file'}.</p>
                    {preview.sample.length > 0 && <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="text-left">Campione: prime {preview.sample.length} righe valide</caption>
                            <thead><tr><th scope="col" className="p-2">Codice</th><th scope="col" className="p-2">Descrizione</th></tr></thead>
                            <tbody>{preview.sample.map((row) => <tr key={row.line}><td className="p-2">{row.code}</td><td className="p-2">{row.description}</td></tr>)}</tbody>
                        </table>
                    </div>}
                    <details className="text-xs"><summary>Provenienza e revisione</summary>
                        <p className="break-all">SHA-256: {preview.manifest.sourceSha256}</p>
                        <p className="break-all">Revisione: {preview.revision}</p>
                        <p>{preview.manifest.parserVersion}; {preview.manifest.policy}</p>
                    </details>
                    {preview.valid && <>
                        <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={accepted} disabled={busy} className="mt-1 h-5 w-5 shrink-0"
                                onChange={(event) => setAccepted(event.target.checked)} />
                            Accetto l’import del subset indicato e l’esclusione delle altre colonne. Aggiorno il catalogo senza eliminare codici assenti dalla fonte.
                        </label>
                        <button type="button" className="ui-btn-primary min-h-11" disabled={busy || !accepted} onClick={() => void run(commit)}>Conferma importazione</button>
                    </>}
                </div>
            )}
            {receipt && <div className="space-y-2 rounded-xl border p-4 text-sm" aria-label="Ricevuta import">
                <p>{receipt.applied} codici applicati: {receipt.inserted} nuovi, {receipt.updated} aggiornati. {verified ? 'Rilettura confermata.' : 'Verifica lo stato con Rileggi stato.'}</p>
                <details><summary>Ricevuta e hash fonte</summary>
                    <p className="break-all">Operazione: {receipt.operationKey}</p>
                    <p className="break-all">SHA-256: {receipt.manifest.sourceSha256}</p>
                    <p>Registrata: {receipt.committedAt}</p>
                </details>
            </div>}
            {message && <p role="status" className="text-sm">{message}</p>}
            <div className="flex flex-wrap gap-3">
                {source && <button type="button" className="ui-btn-secondary min-h-11" disabled={busy} onClick={() => void run(() => makePreview(source))}>Genera nuova anteprima</button>}
                <button type="button" className="ui-btn-secondary min-h-11" disabled={busy} onClick={() => void run(() => reread())}>Rileggi stato</button>
            </div>
            {status?.latestReceipt && !receipt && <p className="text-xs">Ultimo import registrato: {status.latestReceipt.committedAt}, {status.latestReceipt.applied} codici. La registrazione non attesta l’attualità normativa della fonte.</p>}
        </section>
    );
}
