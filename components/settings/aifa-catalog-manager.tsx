'use client';

/* @Codex: shared AIFA surface; real client functions and existing server authority only. */
import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Database, Server, Upload } from 'lucide-react';
import { importAifaCsv, updateAifaCatalog, getDrugCatalogStatus, clearDrugDatabase } from '@/lib/aifa-importer';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from '@/lib/aifa-catalog';
import { createAifaUpdateGuide, INITIAL_AIFA_GUIDE_STATE, type AifaGuidePhase } from '@/lib/aifa-update-guide';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { SETTINGS_CARD_CLASS } from './settings-ui';

const AIFA_PANEL_STYLE = { minWidth: 0, border: '1px solid color-mix(in srgb, var(--lume-ink) 14%, transparent)', borderRadius: 'var(--lume-radius-panel)', background: 'var(--lume-surface-focal)', padding: 24 };
const AIFA_COMMAND_STYLE = { minHeight: 44, minWidth: 44, borderRadius: 12, fontWeight: 600, gap: 8 };
const phaseLabels: Record<AifaGuidePhase, string> = {
    idle: '', updating: 'Scaricamento, validazione e importazione in corso…',
    cancelling: 'Annullamento richiesto; attesa dell’esito della richiesta…',
    verifying: 'Operazione confermata; rilettura dello stato locale in corso…',
    'confirming-import': 'In attesa della conferma di importazione.', importing: 'Validazione e indicizzazione del CSV in corso…',
    'confirming-clear': 'In attesa della conferma di svuotamento.', clearing: 'Svuotamento del catalogo in corso…',
};

export default function AifaCatalogManager() {
    const titleId = useId();
    const confirm = useConfirm();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const guide = useRef<ReturnType<typeof createAifaUpdateGuide> | null>(null);
    const [state, setState] = useState(INITIAL_AIFA_GUIDE_STATE);
    const [sourceUrl, setSourceUrl] = useState(AIFA_CATALOG_DEFAULT_SOURCE_URL);
    const [downloadedAt, setDownloadedAt] = useState('');
    const [datasetVersion, setDatasetVersion] = useState('');
    useEffect(() => {
        const current = createAifaUpdateGuide({ read: getDrugCatalogStatus, update: updateAifaCatalog,
            importFile: importAifaCsv, clear: clearDrugDatabase }, setState);
        guide.current = current;
        void current.refresh(); // Local read only, including Strict Mode remounts.
        return () => { guide.current = null; current.dispose(); };
    }, []);
    const drugCatalog = state.catalog;
    const busy = state.phase !== 'idle';
    const writeDisabled = busy || state.reconciliationRequired;
    const phaseText = state.reading ? 'Lettura dello stato locale in corso…' : phaseLabels[state.phase];
    const handleAifaUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = ''; // Selecting the same file again must work after a refusal or failure.
        if (!file) return;
        void guide.current?.importFile(file, { sourceUrl, downloadedAt, version: datasetVersion }, async () => {
            const result = await confirm({ title: 'Importare il file AIFA?',
                message: 'Il CSV locale sostituirà il catalogo al completamento dell’importazione. Controlla fonte, data e versione dichiarate.', confirmLabel: 'Importa' });
            return result.confirmed;
        });
    };
    const handleClearDrugs = () => {
        void guide.current?.clear(async () => {
            const result = await confirm({ title: 'Svuotare il database farmaci?',
                message: 'L’intero elenco dei farmaci indicizzati verrà cancellato. Questa azione non può essere annullata.',
                confirmLabel: 'Svuota', tone: 'danger' });
            return result.confirmed;
        });
    };
    return (
        <section className={SETTINGS_CARD_CLASS} style={AIFA_PANEL_STYLE} aria-labelledby={titleId} data-testid="aifa-catalog-guide">
            <div className="mb-5 flex items-start gap-3">
                <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                    <Database className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <p className="section-kicker">Farmaci</p>
                    <h2 id={titleId} className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Database AIFA offline</h2>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                        Confezioni con AIC, codici ATC e principi attivi del feed AIFA.{' '}
                        <a
                            href={AIFA_CATALOG_DEFAULT_SOURCE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
                        >
                            Fonte: AIFA Open Data
                        </a>
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between rounded-[var(--lume-radius-control)] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">Confezioni indicizzate</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {drugCatalog !== null ? drugCatalog.count.toLocaleString('it-IT') : '-'}
                        </p>
                    </div>
                    <Server className="w-8 h-8 text-slate-300 dark:text-white/20" />
                </div>

                {/* @Codex Explicit acquisition; opening this page only reads local status. */}
                <div className="space-y-2">
                    <Button onClick={() => void guide.current?.update()} disabled={writeDisabled}
                        className="w-full" style={AIFA_COMMAND_STYLE}>
                        Aggiorna da AIFA
                    </Button>
                    <p className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                        Scarica il feed ufficiale via Internet su tua richiesta. Il catalogo precedente resta disponibile fino al completamento della sostituzione atomica. Nessun dato clinico viene inviato.
                        {' '}<a className="underline" href="https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv" target="_blank" rel="noopener noreferrer">Fonte: confezioni AIFA</a>.
                        {' '}Dati descrittivi e provvisori: non certificano disponibilità, rimborsabilità o appropriatezza.
                        {' '}<a className="underline" href="https://www.aifa.gov.it/copyright" target="_blank" rel="noopener noreferrer">Condizioni AIFA</a>.
                    </p>
                    <p role="status" aria-live="polite" className="text-sm">{phaseText}</p>
                    {state.notice && <p role={state.notice.tone === 'error' ? 'alert' : 'status'} className="text-sm leading-6">{state.notice.text}</p>}
                    {state.reconciliationRequired && <p className="text-sm leading-6">Prima di un’altra modifica, rileggi il catalogo. Una richiesta di annullamento non conferma un rollback.</p>}
                    <div className="flex flex-wrap gap-2">
                        {(state.phase === 'updating' || state.phase === 'cancelling') && <Button variant="secondary" style={AIFA_COMMAND_STYLE} disabled={state.phase === 'cancelling'} onClick={() => guide.current?.cancel()}>{state.phase === 'cancelling' ? 'Annullamento richiesto' : 'Annulla'}</Button>}
                        <Button variant="secondary" style={AIFA_COMMAND_STYLE} disabled={busy} onClick={() => void guide.current?.refresh()}>Rileggi stato</Button>
                    </div>
                </div>

                {drugCatalog?.manifest ? (
                    <div className="rounded-[var(--lume-radius-control)] border p-4 text-sm leading-6" style={{ color: 'var(--lume-ink)' }}>
                        <p className="font-semibold">Ultimo catalogo osservato</p>
                        <p className="mt-1 break-words">
                            Scaricato il {drugCatalog.manifest.downloadedAt} · {drugCatalog.manifest.rowCount.toLocaleString('it-IT')} confezioni
                        </p>
                        <p className="mt-1 break-words">Provenienza del file: <span className="[overflow-wrap:anywhere]">{drugCatalog.manifest.sourceUrl}</span></p>
                        <p className="mt-1">Importato il <time dateTime={drugCatalog.manifest.importedAt}>{new Date(drugCatalog.manifest.importedAt).toLocaleString('it-IT')}</time></p>
                        <details className="mt-2">
                            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Dettagli provenienza</summary>
                            <p className="mt-1 [overflow-wrap:anywhere]">Versione di acquisizione: {drugCatalog.manifest.version}</p>
                            <p className="mt-1 [overflow-wrap:anywhere]">File: {drugCatalog.manifest.sourceUrl}</p>
                            <p className="mt-1 break-all">SHA-256 {drugCatalog.manifest.sha256}</p>
                            <p className="mt-1">Il manifest identifica il file importato; non certifica autenticità o licenza dello specifico dataset.</p>
                        </details>
                    </div>
                ) : drugCatalog?.state === 'unverified' ? (
                    <div className={`rounded-[var(--lume-radius-control)] border p-4 text-sm leading-6 ${semanticSignalSurfaceClass('warning')}`}>
                        Il catalogo esistente non ha un manifest. Reimporta il CSV con i dati di provenienza.
                    </div>
                ) : null}

                {state.observedAt && <p className="text-xs leading-5">Stato locale letto il <time dateTime={state.observedAt}>{new Date(state.observedAt).toLocaleString('it-IT')}</time>. Non attesta che il catalogo sia l’ultima pubblicazione AIFA.</p>}
                {drugCatalog?.state === 'not-imported' && <p className="text-sm">Nessun catalogo locale importato.</p>}
                {drugCatalog === null && !state.reading && <p className="text-sm">Stato locale non disponibile.</p>}

                {/* @Codex Keep the automatic route first; manual import remains available on demand. */}
                <details className="rounded-[var(--lume-radius-control)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] p-4">
                    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Carica un CSV già scaricato</summary>
                    <p className="mb-4 mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">Usa un file locale e indica la sua provenienza.</p>
                    <div className="space-y-3 rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1 text-sm font-medium text-[color:var(--lume-ink)]">
                                Versione dataset (caricamento manuale)
                                <input
                                    value={datasetVersion}
                                    onChange={(event) => setDatasetVersion(event.target.value)}
                                    className="mf-input mt-1 w-full"
                                    placeholder="es. confezioni 2026-07-16"
                                    disabled={writeDisabled}
                                />
                            </label>
                            <label className="space-y-1 text-sm font-medium text-[color:var(--lume-ink)]">
                                Data di scarico
                                <input
                                    type="date"
                                    value={downloadedAt}
                                    onChange={(event) => setDownloadedAt(event.target.value)}
                                    className="mf-input mt-1 w-full"
                                    disabled={writeDisabled}
                                />
                            </label>
                        </div>
                        <label className="block space-y-1 text-sm font-medium text-[color:var(--lume-ink)]">
                            URL fonte
                            <input
                                type="url"
                                value={sourceUrl}
                                onChange={(event) => setSourceUrl(event.target.value)}
                                className="mf-input mt-1 w-full"
                                disabled={writeDisabled}
                            />
                        </label>
                        <p className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                            Il file resta locale. MediFlow salva fonte, versione, data, hash SHA-256 e riferimento ai termini AIFA nel database.
                        </p>
                    </div>

                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleAifaUpload}
                        accept=".csv"
                        className="hidden"
                        disabled={writeDisabled}
                        aria-label="Carica file CSV AIFA"
                    />

                    {!busy ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            style={AIFA_COMMAND_STYLE}
                            disabled={writeDisabled || !datasetVersion.trim() || !downloadedAt || !sourceUrl.trim()}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--lume-radius-control)] border-2 border-dashed border-slate-300 bg-white/72 px-4 py-3 text-slate-600 transition-[border-color,background-color,color] hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/25 dark:hover:bg-white/10"
                        >
                            <Upload className="w-5 h-5" />
                            <span className="font-medium">Carica file AIFA (.csv)</span>
                        </button>
                    ) : state.phase === 'importing' ? (
                        <div role="status" className="space-y-2 text-center">
                            <p className="text-sm font-medium text-[color:var(--lume-ink)]">Validazione e indicizzazione in corso</p>
                            <p className="text-xs text-[color:var(--lume-ink-muted)]">Il catalogo precedente resta disponibile fino al completamento.</p>
                        </div>
                    ) : null}
                </details>

                {drugCatalog !== null && drugCatalog.count > 0 && (
                    <Button variant="secondary" style={AIFA_COMMAND_STYLE}
                        onClick={handleClearDrugs}
                        disabled={writeDisabled}
                        className="text-[color:var(--lume-signal-critical)]"
                    >
                        <AlertTriangle className="w-3 h-3" />
                        Svuota catalogo
                    </Button>
                )}
            </div>
        </section>
    );
}
