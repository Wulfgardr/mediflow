'use client';

import { useEffect, useRef, useState } from 'react';
import { Disclosure } from '@/components/disclosure';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatCountLabel } from '@/lib/format-count';
import {
    DRUG_CATALOG_FIELDS, DRUG_CATALOG_FIELD_LABELS, DRUG_CATALOG_REQUIRED_FIELDS,
    type DrugCatalogField, type DrugCatalogMapping, type DrugCatalogSourceInput,
} from '@/lib/drug-catalog-import';
import { commitDrugCatalog, DrugCatalogClientError, previewDrugCatalog, type DrugCatalogPreview } from '@/lib/drug-catalog-client';
import styles from './repertori-settings.module.css';

const control = { minHeight: 'var(--lume-control-height, 44px)', borderRadius: 'var(--lume-control-radius, 10px)' };
const EMPTY_SOURCE: DrugCatalogSourceInput = { agency: '', codeSystem: '', version: '', date: '', sourceUrl: null };
const DELIMITER_LABELS: Record<DrugCatalogMapping['delimiter'], string> = { ',': 'Virgola', ';': 'Punto e virgola', '\t': 'Tabulazione' };

/** Catalogo farmaci di un'agenzia diversa da AIFA: fonte, colonne, anteprima, conferma. */
export default function DrugCatalogImportPanel({ expanded, onExpandedChange }: { expanded?: boolean; onExpandedChange?: (value: boolean) => void } = {}) {
    const confirm = useConfirm();
    const [source, setSource] = useState<DrugCatalogSourceInput>(EMPTY_SOURCE);
    const [file, setFile] = useState<File | null>(null);
    const [header, setHeader] = useState<string[]>([]);
    const [mapping, setMapping] = useState<DrugCatalogMapping | null>(null);
    const [preview, setPreview] = useState<DrugCatalogPreview | null>(null);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const active = useRef<AbortController | null>(null);
    useEffect(() => () => active.current?.abort(), []);

    async function run(action: (signal: AbortSignal) => Promise<void>) {
        if (active.current) return;
        const controller = new AbortController(); active.current = controller;
        setBusy(true); setMessage('');
        try { await action(controller.signal); }
        catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Operazione non riuscita.'); }
        finally { active.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
    function resetPreview() { setPreview(null); setAccepted(false); }
    function choose(field: DrugCatalogField, value: string) {
        if (!mapping) return;
        const columns = { ...mapping.columns };
        if (value === '') delete columns[field]; else columns[field] = Number(value);
        setMapping({ ...mapping, columns }); resetPreview();
    }
    const sourceReady = !!(source.agency.trim() && source.codeSystem.trim() && source.version.trim() && source.date);
    const mappingReady = !!mapping && DRUG_CATALOG_REQUIRED_FIELDS.every(field => mapping.columns[field] !== undefined);
    async function commit(signal: AbortSignal, reductionConfirmation?: string) {
        if (!file || !mapping || !preview) return;
        try {
            const result = await commitDrugCatalog({ file, mapping, source: { ...source, sourceUrl: source.sourceUrl?.trim() || null },
                previewSha256: preview.sha256, expectedSnapshot: preview.current.snapshot, reductionConfirmation }, signal);
            resetPreview(); setFile(null); setHeader([]); setMapping(null);
            setMessage(`Catalogo attivo: ${result.imported.agency}, ${result.imported.codeSystem} ${result.imported.version}, ${formatCountLabel(result.count, 'voce', 'voci')}.`);
        } catch (error) {
            if (error instanceof DrugCatalogClientError && error.code === 'DRUG_CATALOG_REDUCTION_CONFIRMATION_REQUIRED' && error.confirmation && !reductionConfirmation) {
                const answer = await confirm({ title: 'Confermare un catalogo più piccolo?', message: error.message, confirmLabel: 'Conferma', tone: 'danger' });
                if (answer.confirmed) return commit(signal, error.confirmation);
                setMessage('Importazione annullata; catalogo conservato.'); return;
            }
            if (error instanceof DrugCatalogClientError && error.code === 'DRUG_CATALOG_CHANGED') resetPreview();
            throw error;
        }
    }

    return <section className={styles.row} aria-label="Catalogo farmaci di un’altra agenzia">
        <Disclosure headingLevel={2} open={expanded} onOpenChange={onExpandedChange}
            title={<span className={styles.title}><span>Farmaci da un’altra agenzia</span>
                <span className={styles.summary}>{busy ? 'Controllo in corso…' : 'CSV con colonne da associare'}</span></span>}>
            <div className={styles.body}>
                <p className="text-sm leading-6">Importa il catalogo dell’agenzia o dell’ente che classifica i farmaci dove lavori. Sostituisce il catalogo attivo; terapie e prescrizioni salvate conservano i loro codici.</p>
                <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
                    <legend className="mb-2 text-sm font-semibold">Fonte dichiarata</legend>
                    <label className="text-sm">Agenzia o ente
                        <input className="mf-input mt-1 w-full" style={control} maxLength={200} value={source.agency}
                            onChange={e => { setSource({ ...source, agency: e.target.value }); resetPreview(); }} />
                    </label>
                    <label className="text-sm">Codifica dei farmaci
                        <input className="mf-input mt-1 w-full" style={control} maxLength={120} value={source.codeSystem} placeholder="es. NDC, CIS, PZN"
                            onChange={e => { setSource({ ...source, codeSystem: e.target.value }); resetPreview(); }} />
                    </label>
                    <label className="text-sm">Versione
                        <input className="mf-input mt-1 w-full" style={control} maxLength={120} value={source.version}
                            onChange={e => { setSource({ ...source, version: e.target.value }); resetPreview(); }} />
                    </label>
                    <label className="text-sm">Data del catalogo
                        <input type="date" className="mf-input mt-1 w-full" style={control} value={source.date}
                            onChange={e => { setSource({ ...source, date: e.target.value }); resetPreview(); }} />
                    </label>
                    <label className="text-sm sm:col-span-2">URL della fonte (facoltativo)
                        <input type="url" className="mf-input mt-1 w-full" style={control} value={source.sourceUrl ?? ''}
                            onChange={e => { setSource({ ...source, sourceUrl: e.target.value }); resetPreview(); }} />
                    </label>
                </fieldset>
                <label className="block space-y-2 text-sm">File del catalogo (.csv, UTF-8)
                    <input type="file" accept=".csv,text/csv" disabled={busy} className="block w-full min-w-0 text-sm" style={control} onChange={event => {
                        const next = event.target.files?.[0]; event.target.value = ''; if (!next) return;
                        void run(async signal => {
                            resetPreview(); setFile(next); setHeader([]); setMapping(null);
                            const value = await previewDrugCatalog(next, undefined, signal);
                            setHeader(value.header); setMapping(value.mapping);
                        });
                    }} />
                </label>
                {file && mapping && <fieldset className="space-y-3" disabled={busy} aria-label="Associazione delle colonne">
                    <legend className="text-sm font-semibold">Colonne di {file.name}</legend>
                    <label className="block text-sm">Separatore
                        <select className="mf-input mt-1 block min-h-11" value={mapping.delimiter}
                            onChange={e => { setMapping({ ...mapping, delimiter: e.target.value as DrugCatalogMapping['delimiter'] }); resetPreview(); }}>
                            {Object.entries(DELIMITER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {DRUG_CATALOG_FIELDS.map(field => <label key={field} className="text-sm">
                            {DRUG_CATALOG_FIELD_LABELS[field]}{DRUG_CATALOG_REQUIRED_FIELDS.includes(field) ? ' (obbligatorio)' : ''}
                            <select className="mf-input mt-1 block w-full min-h-11" value={mapping.columns[field] ?? ''} onChange={e => choose(field, e.target.value)}>
                                <option value="">Non presente</option>
                                {header.map((name, index) => <option key={index} value={index}>{name || `Colonna ${index + 1}`}</option>)}
                            </select>
                        </label>)}
                    </div>
                    <button type="button" className="border px-4 text-sm font-semibold" style={control} disabled={busy || !mappingReady}
                        onClick={() => void run(async signal => { resetPreview(); setPreview(await previewDrugCatalog(file, mapping, signal)); })}>
                        Genera anteprima
                    </button>
                </fieldset>}
                {preview?.counts && <div aria-label="Anteprima catalogo farmaci" className="space-y-3 border p-4" style={{ borderRadius: 'var(--lume-control-radius, 10px)' }}>
                    <h3 className="font-semibold">Anteprima</h3>
                    <p className="text-sm">{formatCountLabel(preview.counts.importable, 'voce importabile', 'voci importabili')} su {formatCountLabel(preview.counts.total, 'riga', 'righe')}
                        {preview.counts.rejected ? `, ${formatCountLabel(preview.counts.rejected, 'riga scartata', 'righe scartate')}` : ''}
                        {preview.counts.duplicateCodes ? `, ${formatCountLabel(preview.counts.duplicateCodes, 'codice ripetuto', 'codici ripetuti')}` : ''}.</p>
                    <p className="text-sm">Catalogo attuale: {preview.current.source
                        ? `${preview.current.source.agency}, ${preview.current.source.codeSystem} ${preview.current.source.version}, ${formatCountLabel(preview.current.count, 'voce', 'voci')}`
                        : preview.current.manifest ? `AIFA ${preview.current.manifest.version}, ${formatCountLabel(preview.current.count, 'confezione', 'confezioni')}`
                            : preview.current.count ? formatCountLabel(preview.current.count, 'voce senza fonte', 'voci senza fonte') : 'nessuno'}.</p>
                    {preview.reductionRequired && <p className="text-sm">Il nuovo catalogo ha meno del 90% delle voci attuali: servirà una seconda conferma.</p>}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead><tr><th scope="col">Codice</th><th scope="col">Denominazione</th><th scope="col">Principio attivo</th><th scope="col">ATC</th><th scope="col">Confezione</th><th scope="col">Classe</th></tr></thead>
                            <tbody>{preview.sample.map(row => <tr key={row.code}><td className="lume-code">{row.code}</td><td>{row.name}</td>
                                <td>{row.activePrinciple}</td><td className="lume-code">{row.atc}</td><td>{row.packaging}</td><td>{row.reimbursementClass}</td></tr>)}</tbody>
                        </table>
                    </div>
                    {preview.diagnostics.length > 0 && <Disclosure title="Righe con avvisi">
                        <ul className="text-sm">{preview.diagnostics.map(item => <li key={`${item.row}-${item.reason}`}>Riga {item.row}: {item.reason}</li>)}</ul>
                    </Disclosure>}
                    <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />
                        <span>Ho controllato fonte, colonne e anteprima.</span>
                    </label>
                    <button type="button" className="border px-4 text-sm font-semibold" style={control} disabled={busy || !accepted || !sourceReady}
                        onClick={() => void run(signal => commit(signal))}>Importa catalogo</button>
                    {!sourceReady && <p className="text-sm">Completa agenzia, codifica, versione e data della fonte.</p>}
                </div>}
                <p role="status" aria-live="polite" className="text-sm">{message}</p>
            </div>
        </Disclosure>
    </section>;
}
