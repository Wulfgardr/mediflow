'use client';

// WUL-297 Repertori (AIFA + esenzioni): moved from the monolithic settings page.

import { useCallback, useState, useEffect, useRef } from 'react';
import { AlertTriangle, Database, Server, Upload } from 'lucide-react';
import {
    importAifaCsv,
    getDrugCatalogStatus,
    clearDrugDatabase,
    type AifaCatalogClientStatus,
} from '@/lib/aifa-importer';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from '@/lib/aifa-catalog';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { semanticSignalSurfaceClass } from '@/components/ui/semantic-signal';
/* @Codex */
import ExemptionDbManager from '@/components/settings/exemption-db-manager';
import { SETTINGS_CARD_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsRepertoriPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { showToast } = useToast();
    const confirm = useConfirm();

    // --- AIFA State ---
    const [drugCatalog, setDrugCatalog] = useState<AifaCatalogClientStatus | null>(null);
    const [importing, setImporting] = useState(false);
    const [sourceUrl, setSourceUrl] = useState(AIFA_CATALOG_DEFAULT_SOURCE_URL);
    const [downloadedAt, setDownloadedAt] = useState(() => new Date().toISOString().slice(0, 10));
    const [datasetVersion, setDatasetVersion] = useState('');

    /* @Codex Stable loader shared by initial hydration and explicit refresh. */
    const loadStatus = useCallback(async () => {
        try {
            setDrugCatalog(await getDrugCatalogStatus());
        } catch (e) {
            console.error(e);
        }
    }, []);

    // Load initial data
    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    // --- AIFA Handlers ---
    const handleAifaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const { confirmed } = await confirm({
            title: 'Importare il file AIFA?',
            message: "Questa operazione potrebbe richiedere del tempo.",
            confirmLabel: 'Importa',
        });
        if (!confirmed) {
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        setImporting(true);
        try {
            const result = await importAifaCsv(file, {
                sourceUrl,
                downloadedAt,
                version: datasetVersion,
            });
            showToast({
                tone: 'success',
                title: 'Catalogo AIFA importato',
                description: `${result.count.toLocaleString('it-IT')} farmaci indicizzati con manifest di provenienza.`,
            });
            setDrugCatalog(result);
        } catch (err) {
            console.error(err);
            showToast({
                tone: 'error',
                title: 'Importazione AIFA non riuscita',
                description: err instanceof Error ? err.message : 'Verifica file e provenienza.',
            });
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleClearDrugs = async () => {
        const { confirmed } = await confirm({
            title: 'Svuotare il database farmaci?',
            message: "L'intero elenco dei farmaci indicizzati verrà cancellato.",
            confirmLabel: 'Svuota',
            tone: 'danger',
        });
        if (confirmed) {
            await clearDrugDatabase();
            await loadStatus();
        }
    };

    return (
        <section className="space-y-4" data-testid="settings-repertori-section">
            <SettingsSectionIntro
                kicker="Dati e sicurezza"
                title="Repertori"
                description="AIFA ed esenzioni consultabili localmente anche senza rete."
            />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            <Database className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Farmaci</p>
                            <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Database AIFA offline</h2>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Elenco farmaci rimborsabili usato dal prescrittore.{' '}
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
                        <div className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">Farmaci indicizzati</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                                    {drugCatalog !== null ? drugCatalog.count.toLocaleString('it-IT') : '-'}
                                </p>
                            </div>
                            <Server className="w-8 h-8 text-slate-300 dark:text-white/20" />
                        </div>

                        <div className="space-y-3 rounded-[var(--lume-radius-card)] border border-[color:color-mix(in_srgb,var(--lume-ink)_14%,transparent)] bg-[color:var(--lume-surface-field)] p-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-1 text-xs font-medium text-[color:var(--lume-ink)]">
                                    Versione dataset
                                    <input
                                        value={datasetVersion}
                                        onChange={(event) => setDatasetVersion(event.target.value)}
                                        className="mf-input mt-1 w-full"
                                        placeholder="es. confezioni 2026-07-16"
                                        disabled={importing}
                                    />
                                </label>
                                <label className="space-y-1 text-xs font-medium text-[color:var(--lume-ink)]">
                                    Data di scarico
                                    <input
                                        type="date"
                                        value={downloadedAt}
                                        onChange={(event) => setDownloadedAt(event.target.value)}
                                        className="mf-input mt-1 w-full"
                                        disabled={importing}
                                    />
                                </label>
                            </div>
                            <label className="block space-y-1 text-xs font-medium text-[color:var(--lume-ink)]">
                                URL fonte
                                <input
                                    type="url"
                                    value={sourceUrl}
                                    onChange={(event) => setSourceUrl(event.target.value)}
                                    className="mf-input mt-1 w-full"
                                    disabled={importing}
                                />
                            </label>
                            <p className="text-xs leading-5 text-[color:var(--lume-ink-muted)]">
                                Il file resta locale. MediFlow salva fonte, versione, data, hash SHA-256 e riferimento ai termini AIFA nel database.
                            </p>
                        </div>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleAifaUpload}
                            accept=".csv"
                            className="hidden"
                            disabled={importing}
                            aria-label="Carica file CSV AIFA"
                        />

                        {!importing ? (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={!datasetVersion.trim() || !downloadedAt || !sourceUrl.trim()}
                                className="flex w-full items-center justify-center gap-2 rounded-[var(--lume-radius-control)] border-2 border-dashed border-slate-300 bg-white/72 px-4 py-3 text-slate-600 transition-[border-color,background-color,color] hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/25 dark:hover:bg-white/10"
                            >
                                <Upload className="w-5 h-5" />
                                <span className="font-medium">Carica file AIFA (.csv)</span>
                            </button>
                        ) : (
                            <div role="status" className="space-y-2 text-center">
                                <p className="text-sm font-medium text-[color:var(--lume-ink)]">Validazione e indicizzazione in corso</p>
                                <p className="text-xs text-[color:var(--lume-ink-muted)]">Il catalogo precedente resta disponibile fino al completamento.</p>
                            </div>
                        )}

                        {drugCatalog?.manifest ? (
                            <div className={`rounded-[var(--lume-radius-control)] border p-3 text-xs ${semanticSignalSurfaceClass('success')}`}>
                                <p className="font-semibold">Manifest di provenienza registrato</p>
                                <p className="mt-1 break-words">
                                    {drugCatalog.manifest.version} · scaricato il {drugCatalog.manifest.downloadedAt} · SHA-256 {drugCatalog.manifest.sha256.slice(0, 12)}…
                                </p>
                                <p className="mt-1">
                                    Il manifest identifica il file importato; non certifica autenticità o licenza dello specifico dataset.
                                </p>
                            </div>
                        ) : drugCatalog?.state === 'unverified' ? (
                            <div className={`rounded-[var(--lume-radius-control)] border p-3 text-xs ${semanticSignalSurfaceClass('warning')}`}>
                                Il catalogo esistente non ha un manifest. Reimporta il CSV con i dati di provenienza.
                            </div>
                        ) : null}

                        {drugCatalog !== null && drugCatalog.count > 0 && (
                            <button
                                onClick={handleClearDrugs}
                                className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                            >
                                <AlertTriangle className="w-3 h-3" />
                                Svuota database farmaci
                            </button>
                        )}
                    </div>
                </div>

                <ExemptionDbManager />
            </div>
        </section>
    );
}
