'use client';

/* @Codex: installed inventory and explicit model choices for local settings. */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
/* @Codex */
import { isInstalledOllamaModel, parseInstalledOllamaModels } from '@/lib/installed-ollama-models';
import styles from './guided-local-models.module.css';
import { Check, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
/* @Codex */
import { parseOllamaPullStreamLine } from '@/lib/ollama-pull-stream';
import {
    SETTINGS_INPUT_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
} from '@/components/settings/settings-ui';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';

// --- Model Selector Component ---
export interface ModelSelectorProps {
    /* @Codex */
    selectorId: 'clinical' | 'reasoning';
    label: string;
    description: string;
    icon: ReactNode;
    value: string;
    onChange: (val: string) => void;
    recommended: { name: string; desc: string }[];
    provider: string;
    targetUrl: string;
}

export function ModelSelector({ selectorId, label, description, icon, value, onChange, recommended, provider, targetUrl }: ModelSelectorProps) {
    /* @Codex */
    const [inventory, setInventory] = useState<{ url: string; provider: string; models: string[]; error: string | null; loading: boolean } | null>(null);
    const [refresh, setRefresh] = useState(0);
    const currentInventory = inventory?.url === targetUrl && inventory?.provider === provider ? inventory : null;
    const installedModels = currentInventory?.models ?? [];
    const loading = Boolean(targetUrl) && (!currentInventory || currentInventory.loading);
    const error = currentInventory?.error;
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState(0);
    const [pullStatus, setPullStatus] = useState("");
    const [showCustom, setShowCustom] = useState(false);
    const [pullingModel, setPullingModel] = useState<string | null>(null);
    const { showToast } = useToast();
    const confirm = useConfirm();

    /* @Codex: each refresh owns an abort signal; ignored completions cannot replace a newer URL. */
    const checkInstalled = useCallback(() => { setRefresh(previous => previous + 1); }, []);
    useEffect(() => {
        if (provider !== 'ollama' || !targetUrl) return;
        const controller = new AbortController();
        let current = true;
        const timer = setTimeout(() => controller.abort(), 15000);
        setInventory({ url: targetUrl, provider, models: [], error: null, loading: true });
        void (async () => {
            try {
                const res = await fetch('/api/ai/models', {
                    headers: { 'x-target-url': targetUrl }, signal: controller.signal,
                });
                if (!res.ok) throw new Error('Impossibile leggere i modelli. Verifica la connessione e riprova.');
                const models = parseInstalledOllamaModels(await res.json());
                if (current) setInventory({ url: targetUrl, provider, models, error: null, loading: false });
            } catch {
                if (current) setInventory({ url: targetUrl, provider, models: [],
                    error: 'Impossibile leggere i modelli. Verifica la connessione e riprova.', loading: false });
            } finally { clearTimeout(timer); }
        })();
        return () => { current = false; clearTimeout(timer); controller.abort(); };
    }, [provider, targetUrl, refresh]);

    const handlePull = async (modelName: string) => {
        const { confirmed } = await confirm({
            title: `Scaricare il modello ${modelName}?`,
            message: 'Il download può richiedere diversi GB e tempo a seconda della connessione.',
            confirmLabel: 'Scarica'
        });
        if (!confirmed) return;

        setIsPulling(true);
        setPullingModel(modelName);
        setPullProgress(0);
        setPullStatus("Inizializzazione download...");

        try {
            const response = await fetch('/api/ai/pull', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-target-url': targetUrl,
                },
                body: JSON.stringify({ model: modelName })
            });

            if (!response.ok) throw new Error("Download failed to start");
            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    // @Codex
                    const data = parseOllamaPullStreamLine(line);
                    if (!data) continue;

                    if (data.status) setPullStatus(data.status);
                    if (data.progress !== undefined) setPullProgress(data.progress);
                }
            }

            // @Codex
            const trailingData = parseOllamaPullStreamLine(buffer);
            if (trailingData?.status) setPullStatus(trailingData.status);
            if (trailingData?.progress !== undefined) setPullProgress(trailingData.progress);

            showToast({ tone: 'success', title: `Modello ${modelName} installato` });
            await checkInstalled();
            onChange(modelName); // Auto select

        } catch (e) {
            console.error(e);
            showToast({
                tone: 'error',
                title: 'Download non riuscito',
                description: e instanceof Error ? e.message : 'Errore imprevisto'
            });
        } finally {
            setIsPulling(false);
            setPullingModel(null);
            setPullProgress(0);
            setPullStatus("");
        }
    };

    const isInstalled = (name: string) => isInstalledOllamaModel(installedModels, name);
    const installedSelection = installedModels.find(model => isInstalledOllamaModel([model], value));

    const modelSelectorTone = {
        iconStyle: { background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' },
        titleStyle: { color: 'var(--lume-ink)' },
        descriptionStyle: { color: 'var(--lume-ink-muted)' },
        selectedCardStyle: { borderColor: 'var(--lume-accent)', background: 'var(--lume-surface-focal)', boxShadow: '0 2px 8px color-mix(in srgb, var(--lume-ink) 10%, transparent)' },
        selectedDot: 'bg-[color:var(--lume-surface-focal)]',
        installedBadgeStyle: { borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' },
        downloadBadgeStyle: { borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)', background: 'var(--lume-surface-field)', color: 'var(--lume-ink)' },
        progressStyle: { background: 'var(--lume-accent)' },
    };
    const c = modelSelectorTone;

    return (
        <div className={cn("mf-section space-y-4", styles.selector)} data-testid={`ai-model-selector-${selectorId}`}>
            {/* @Codex WUL-229: selector header now uses MediFlow icon disc + ink/muted typography */}
            <div className="flex items-start gap-2">
                <div className="rounded-xl p-2" style={c.iconStyle}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold" style={c.titleStyle}>{label}</h4>
                    <p className="mt-1 text-[13px] leading-5" style={c.descriptionStyle}>{description}</p>
                </div>
            </div>

            {/* @Codex: installed inventory is distinct from recommendations and saved selection. */}
            <div className={styles.stack}>
                <label htmlFor={`installed-model-${selectorId}`}>Modelli installati · {label}</label>
                <select id={`installed-model-${selectorId}`} className={SETTINGS_INPUT_CLASS}
                    value={installedSelection ?? ''} disabled={loading || Boolean(error) || installedModels.length === 0}
                    onChange={event => { if (event.target.value) onChange(event.target.value); }}
                    aria-describedby={`installed-status-${selectorId}`}>
                    <option value="">{value && !installedSelection ? `Selezione attuale: ${value}` : 'Scegli un modello installato'}</option>
                    {installedModels.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
                <button type="button" onClick={checkInstalled} disabled={loading || !targetUrl}
                    className={SETTINGS_SECONDARY_BUTTON_CLASS}>
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                    {loading ? 'Lettura modelli…' : 'Aggiorna modelli installati'}
                </button>
                <p id={`installed-status-${selectorId}`} role="status" className={styles.status}>
                    {!targetUrl ? 'Inserisci prima l’indirizzo di Ollama.' : loading ? 'Lettura da Ollama in corso…'
                        : error ? error : installedModels.length === 0 ? 'Nessun modello installato in Ollama.'
                            : `${installedModels.length} modelli presenti in Ollama.`}
                </p>
                {value && !loading && !error && currentInventory && !installedSelection && (
                    <p className={styles.hint}>La selezione attuale «{value}» non è presente nell’elenco. Scegli un modello installato o consulta i consigli.</p>
                )}
                <p className={styles.hint}>La presenza in elenco non abilita le funzioni cliniche. I consigli non sono una verifica sul tuo computer.</p>
                <h5 className="text-sm font-semibold">Modelli consigliati e scelta personalizzata</h5>
            </div>

            <div className="space-y-2">
                {!showCustom ? (
                    <div className="grid gap-2">
                        {recommended.map((model) => {
                            const installed = isInstalled(model.name);
                            const selected = isInstalledOllamaModel([value], model.name);

                            return (
                                // @Codex WUL-229: option card switches to mf-option-card primitive with style-driven selection accent
                                <div
                                    key={model.name}
                                    className={cn('mf-option-card relative flex flex-wrap items-center justify-between gap-2 !p-4', selected && 'is-active z-10')}
                                    style={selected ? c.selectedCardStyle : undefined}
                                >
                                    <button type="button" onClick={() => onChange(model.name)} aria-pressed={selected}
                                        className={styles.recommendation}>
                                        <div
                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                            style={selected
                                                ? { borderColor: 'var(--lume-ink)', background: 'var(--lume-ink)' }
                                                : { borderColor: 'rgba(112,106,100,0.28)' }}
                                        >
                                            {selected && <div className={`h-1.5 w-1.5 rounded-full ${c.selectedDot}`} />}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="lume-registro block truncate text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>{model.name}</span>
                                            <span className="mt-0.5 block text-[13px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>{model.desc}</span>
                                        </div>
                                    </button>

                                    <div className="flex shrink-0 items-center gap-2">
                                        {installed ? (
                                            <span
                                                className={styles.status}
                                                style={c.installedBadgeStyle}
                                            >
                                                <Check className="w-3 h-3" /> Installato
                                            </span>
                                        ) : (
                                            <button type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePull(model.name);
                                                }}
                                                aria-label={`Scarica ${model.name}`}
                                                disabled={isPulling}
                                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors disabled:opacity-60"
                                                style={c.downloadBadgeStyle}
                                            >
                                                {isPulling && pullingModel === model.name ? (
                                                    <RefreshCw className="w-3 h-3" />
                                                ) : <Download className="w-3 h-3" />}
                                                Scarica
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {/* @Codex WUL-229: secondary toggles use mf-btn-secondary */}
                        <button
                            type="button"
                            onClick={() => setShowCustom(true)}
                            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, 'justify-center border-dashed')}
                        >
                            Usa un modello personalizzato
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            className={SETTINGS_INPUT_CLASS}
                            aria-label={`Modello personalizzato · ${label}`}
                            placeholder="es. llama3"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setShowCustom(false)}
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        >
                            Torna ai consigliati
                        </button>
                    </div>
                )}
            </div>

            {/* Global Pull Status */}
            {isPulling && (
                // @Codex WUL-229: pull status card now uses the shared liquid section primitive
                <div className="mf-section mf-section-tight p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>
                            <RefreshCw className="w-3 h-3" />
                            Scaricamento {pullingModel ? `di ${pullingModel}` : 'in corso'}
                        </span>
                        <span className="lume-registro text-sm" style={{ color: 'var(--lume-ink-muted)' }}>{pullProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)' }}>
                        <div
                            className="h-full transition-[width] duration-300"
                            style={{ width: `${pullProgress}%`, ...c.progressStyle }}
                        />
                    </div>
                    <p className="mt-2 truncate text-[13px]" style={{ color: 'var(--lume-ink-muted)' }}>{pullStatus}</p>
                </div>
            )}
        </div>
    );
}
