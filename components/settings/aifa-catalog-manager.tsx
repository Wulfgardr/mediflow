'use client';

import { formatCountLabel } from '@/lib/format-count';
/* shared AIFA surface; real client functions and existing server authority only. */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import { Disclosure } from '@/components/disclosure';
import { importAifaCsv, updateAifaCatalog, getDrugCatalogStatus, clearDrugDatabase } from '@/lib/aifa-importer';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from '@/lib/aifa-catalog';
import { createAifaUpdateGuide, INITIAL_AIFA_GUIDE_STATE, type AifaGuidePhase } from '@/lib/aifa-update-guide';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
import { AifaRemoteNotice, useAifaRemoteStatus } from './aifa-remote-notice';
import type { AifaDownloadProgress } from '@/lib/aifa-catalog-download';
import styles from './repertori-settings.module.css';

const AIFA_COMMAND_STYLE = { minHeight: 'var(--lume-control-height, 44px)', minWidth: 'var(--lume-control-height, 44px)', borderRadius: 'var(--lume-control-radius, 10px)', fontWeight: 600, gap: 8 };
const AIFA_UPLOAD_STYLE = { ...AIFA_COMMAND_STYLE, borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)', color: 'var(--lume-ink-muted)' };
const phaseLabels: Record<AifaGuidePhase, string> = {
    idle: '', updating: 'Scaricamento, validazione e importazione in corso…',
    cancelling: 'Annullamento richiesto; attesa dell’esito della richiesta…',
    verifying: 'Operazione confermata; rilettura dello stato locale in corso…',
    'confirming-import': 'In attesa della conferma di importazione.', importing: 'Validazione e indicizzazione del CSV in corso…',
    'confirming-clear': 'In attesa della conferma di svuotamento.', clearing: 'Svuotamento del catalogo in corso…',
};

export default function AifaCatalogManager({ expanded, onExpandedChange }: { expanded?: boolean; onExpandedChange?: (value: boolean) => void } = {}) {
    const confirm = useConfirm();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const guide = useRef<ReturnType<typeof createAifaUpdateGuide> | null>(null);
    const [progress, setProgress] = useState<AifaDownloadProgress | null>(null);
    const [state, setState] = useState(INITIAL_AIFA_GUIDE_STATE);
    const [sourceUrl, setSourceUrl] = useState(AIFA_CATALOG_DEFAULT_SOURCE_URL);
    const [downloadedAt, setDownloadedAt] = useState('');
    const [datasetVersion, setDatasetVersion] = useState('');
    useEffect(() => {
        const current = createAifaUpdateGuide({ read: getDrugCatalogStatus, update: (signal, confirmation) => updateAifaCatalog(signal, confirmation, setProgress),
            importFile: importAifaCsv, clear: clearDrugDatabase }, setState);
        guide.current = current;
        void current.refresh();
        return () => { guide.current = null; current.dispose(); };
    }, []);
    const drugCatalog = state.catalog;
    const busy = state.phase !== 'idle';
    const remote = useAifaRemoteStatus(drugCatalog?.manifest?.importedAt, busy);
    const writeDisabled = busy || state.reconciliationRequired || remote.checking;
    const update = () => guide.current?.update(async message => (await confirm({ title: 'Confermare la riduzione del catalogo?',
        message: `${message} Confermando, il file sarà scaricato di nuovo e applicato solo se identico a quello appena controllato.`,
        confirmLabel: 'Conferma riduzione', tone: 'danger' })).confirmed);
    const phaseText = state.reading ? 'Lettura dello stato locale in corso…' : phaseLabels[state.phase];
    const handleAifaUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = ''; // Selecting the same file again must work after a refusal or failure.
        if (!file) return;
        void guide.current?.importFile(file, { sourceUrl, downloadedAt, version: datasetVersion }, async () => {
            const result = await confirm({ title: 'Importare il file AIFA?',
                message: 'Il CSV locale sostituirà il catalogo al completamento dell’importazione. Controlla fonte, data e versione dichiarate.', confirmLabel: 'Importa' });
            return result.confirmed;
        }, async message => (await confirm({ title: 'Confermare la riduzione del catalogo?', message, confirmLabel: 'Conferma riduzione', tone: 'danger' })).confirmed);
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
        <section className={styles.row} aria-label="Catalogo farmaci AIFA" data-testid="aifa-catalog-guide">
            <Disclosure headingLevel={2} open={expanded} onOpenChange={onExpandedChange}
                title={<span className={styles.title}><span>Farmaci AIFA</span><span className={styles.summary}>
                    {state.reading ? 'Lettura dello stato locale…' : busy ? phaseLabels[state.phase] : drugCatalog
                        ? `${formatCountLabel(drugCatalog.count, 'confezione', 'confezioni')} · ultima lettura locale` : 'Stato locale non disponibile'}
                </span></span>}>
                <div className={styles.body}>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                        Confezioni con AIC, codici ATC e principi attivi del feed AIFA.{' '}
                        <a
                            href={AIFA_CATALOG_DEFAULT_SOURCE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline-offset-2 hover:underline"
                            style={{ color: 'var(--lume-accent)' }}
                        >
                            Fonte: AIFA Open Data
                        </a>
                    </p>
                <AifaRemoteNotice {...remote} disabled={busy} settings />
                <div className="space-y-2">
                    <Button variant="secondary" onClick={() => void update()} disabled={writeDisabled || !remote.status?.networkAllowed}
                        style={AIFA_COMMAND_STYLE}>
                        Aggiorna ora
                    </Button>
                    <p className="text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                        Scarica il feed ufficiale via Internet su tua richiesta. Il catalogo precedente resta disponibile fino al completamento della sostituzione atomica. Nessun dato clinico viene inviato.
                        {' '}<a className="underline" href="https://drive.aifa.gov.it/farmaci/confezioni_fornitura.csv" target="_blank" rel="noopener noreferrer">Fonte: confezioni AIFA</a>.
                        {' '}Dati descrittivi e provvisori: non certificano disponibilità, rimborsabilità o appropriatezza.
                        {' '}<a className="underline" href="https://www.aifa.gov.it/copyright" target="_blank" rel="noopener noreferrer">Condizioni AIFA</a>.
                    </p>
                    {progress && <div role="status" className="text-sm">
                        <p>{progress.phase === 'validating' ? 'Download completato. Validazione del catalogo…' : `${(progress.receivedBytes / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MiB ricevuti${progress.totalBytes ? ` su ${(progress.totalBytes / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MiB` : ''}`}</p>
                        {progress.phase === 'downloading' && progress.totalBytes && <progress aria-label="Download AIFA" max={progress.totalBytes} value={progress.receivedBytes} className="w-full" />}
                    </div>}
                    <p role="status" aria-live="polite" className="text-sm">{phaseText}</p>
                    {state.notice && <p role={state.notice.tone === 'error' ? 'alert' : 'status'} className="text-sm leading-6">{state.notice.text}</p>}
                    {state.reconciliationRequired && <p className="text-sm leading-6">Prima di un’altra modifica, rileggi il catalogo. Una richiesta di annullamento non conferma un rollback.</p>}
                    <div className="flex flex-wrap gap-2">
                        {(state.phase === 'updating' || state.phase === 'cancelling') && <Button variant="secondary" style={AIFA_COMMAND_STYLE} disabled={state.phase === 'cancelling'} onClick={() => guide.current?.cancel()}>{state.phase === 'cancelling' ? 'Annullamento richiesto' : 'Annulla'}</Button>}
                        <Button variant="secondary" style={AIFA_COMMAND_STYLE} disabled={busy} onClick={() => void guide.current?.refresh()}>Rileggi stato</Button>
                    </div>
                </div>

                {drugCatalog?.manifest ? (
                    <div className={styles.provenance}>
                        <p className="font-semibold">Ultimo catalogo osservato</p>
                        <p className="mt-1 break-words">
                            Scaricato il {drugCatalog.manifest.downloadedAt} · {formatCountLabel(drugCatalog.manifest.rowCount, 'confezione', 'confezioni')}
                        </p>
                        <p className="mt-1 break-words">Provenienza del file: <span className="[overflow-wrap:anywhere]">{drugCatalog.manifest.sourceUrl}</span></p>
                        <p className="mt-1">Importato il <time dateTime={drugCatalog.manifest.importedAt}>{new Date(drugCatalog.manifest.importedAt).toLocaleString('it-IT')}</time></p>
                        <Disclosure title="Dettagli provenienza">
                            <p className="mt-1 [overflow-wrap:anywhere]">Versione di acquisizione: {drugCatalog.manifest.version}</p>
                            <p className="mt-1 [overflow-wrap:anywhere]">File: {drugCatalog.manifest.sourceUrl}</p>
                            <p className="mt-1 break-all">SHA-256 {drugCatalog.manifest.sha256}</p>
                            <p className="mt-1">Il manifest identifica il file importato; non certifica autenticità o licenza dello specifico dataset.</p>
                        </Disclosure>
                    </div>
                ) : drugCatalog?.state === 'unverified' ? (
                    <div className={`rounded-[var(--lume-radius-control)] border p-4 text-sm leading-6 ${semanticSignalSurfaceClass('warning')}`}>
                        Il catalogo esistente non ha un manifest. Reimporta il CSV con i dati di provenienza.
                    </div>
                ) : null}

                {state.observedAt && <p className="text-xs leading-5">Stato locale letto il <time dateTime={state.observedAt}>{new Date(state.observedAt).toLocaleString('it-IT')}</time>. Non attesta che il catalogo sia l’ultima pubblicazione AIFA.</p>}
                {drugCatalog?.state === 'not-imported' && <p className="text-sm">Nessun catalogo locale importato.</p>}
                {drugCatalog === null && !state.reading && <p className="text-sm">Stato locale non disponibile.</p>}

                {/* Keep the automatic route first; manual import remains available on demand. */}
                <Disclosure className={styles.manual} title="Carica un CSV già scaricato">
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
                            style={AIFA_UPLOAD_STYLE}
                            disabled={writeDisabled || !datasetVersion.trim() || !downloadedAt || !sourceUrl.trim()}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--lume-radius-control)] border-2 border-dashed px-4 py-3 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
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
                </Disclosure>

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
            </Disclosure>
        </section>
    );
}
