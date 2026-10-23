'use client';


import { ChoiceField } from '@/components/choice-field';
import { formatCountLabel } from '@/lib/format-count';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { isInstalledOllamaModel, parseInstalledOllamaModels } from '@/lib/installed-ollama-models';
import styles from './guided-local-models.module.css';
import { Check, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    SETTINGS_INPUT_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
} from '@/components/settings/settings-ui';

export interface ModelSelectorProps {
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
    const [inventory, setInventory] = useState<{ url: string; provider: string; models: string[]; error: string | null; loading: boolean } | null>(null);
    const [refresh, setRefresh] = useState(0);
    const currentInventory = inventory?.url === targetUrl && inventory?.provider === provider ? inventory : null;
    const installedModels = currentInventory?.models ?? [];
    const loading = Boolean(targetUrl) && (!currentInventory || currentInventory.loading);
    const error = currentInventory?.error;
    const [showCustom, setShowCustom] = useState(false);

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

    const isInstalled = (name: string) => isInstalledOllamaModel(installedModels, name);
    const installedSelection = installedModels.find(model => isInstalledOllamaModel([model], value));

    const modelSelectorTone = {
        iconStyle: { background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' },
        titleStyle: { color: 'var(--lume-ink)' },
        descriptionStyle: { color: 'var(--lume-ink-muted)' },
        selectedCardStyle: { borderColor: 'var(--lume-accent)', background: 'var(--lume-surface-focal)', boxShadow: '0 2px 8px color-mix(in srgb, var(--lume-ink) 10%, transparent)' },
        selectedDot: 'bg-[color:var(--lume-surface-focal)]',
        installedBadgeStyle: { borderColor: 'color-mix(in srgb, var(--lume-ink) 14%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' },
    };
    const c = modelSelectorTone;

    return (
        <div className={cn("mf-section space-y-4", styles.selector)} data-testid={`ai-model-selector-${selectorId}`}>
            <div className="flex items-start gap-2">
                <div className="rounded-xl p-2" style={c.iconStyle}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold" style={c.titleStyle}>{label}</h4>
                    <p className="mt-1 text-sm leading-5" style={c.descriptionStyle}>{description}</p>
                </div>
            </div>

            <div className={styles.stack}>
                <ChoiceField label={`Modelli installati · ${label}`} id={`installed-model-${selectorId}`}
                    value={installedSelection ?? ''} disabled={loading || Boolean(error) || installedModels.length === 0}
                    onChange={event => { if (event.target.value) onChange(event.target.value); }}
                    aria-describedby={`installed-status-${selectorId}`}>
                    <option value="">{value && !installedSelection ? `Selezione attuale: ${value}` : 'Scegli un modello installato'}</option>
                    {installedModels.map(model => <option key={model} value={model}>{model}</option>)}
                </ChoiceField>
                <button type="button" onClick={checkInstalled} disabled={loading || !targetUrl}
                    className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, 'justify-self-start')}>
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                    {loading ? 'Lettura modelli…' : 'Aggiorna modelli installati'}
                </button>
                <p id={`installed-status-${selectorId}`} role="status" className={styles.notice}>
                    {!targetUrl ? 'Inserisci prima l’indirizzo di Ollama.' : loading ? 'Lettura da Ollama in corso…'
                        : error ? error : installedModels.length === 0 ? 'Nessun modello installato in Ollama.'
                            : `${formatCountLabel(installedModels.length, 'modello presente', 'modelli presenti')} in Ollama.`}
                </p>
                {value && !loading && !error && currentInventory && !installedSelection && (
                    <p className={styles.hint}>La selezione attuale «{value}» non è presente nell’elenco. Scegli un modello installato o consulta i consigli.</p>
                )}
                <p className={styles.hint}>La presenza in elenco non abilita le funzioni cliniche. I consigli non sono una verifica sul tuo computer.</p>
            </div>

            <div className="space-y-2">
                {!showCustom ? (
                    <div className="grid gap-2">
                        <details>
                            <summary>Altri modelli e installazione</summary>
                            <p className={styles.hint}>Per scaricare un modello, apri il Terminale sul computer che ospita Ollama ed esegui il comando indicato. Poi aggiorna l’elenco dei modelli installati in MediFlow.</p>
                            <div className="grid gap-2">
                                {recommended.map((model) => {
                                    const installed = isInstalled(model.name);
                                    const selected = isInstalledOllamaModel([value], model.name);

                                    return (
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
                                                    <span className="mt-0.5 block text-sm leading-5" style={{ color: 'var(--lume-ink-muted)' }}>{model.desc}</span>
                                                </div>
                                            </button>

                                            <div className="flex shrink-0 items-center gap-2">
                                                {installed ? (
                                                    <span
                                                        className={styles.status} data-lume-status
                                                        style={c.installedBadgeStyle}
                                                    >
                                                        <Check className="w-3 h-3" /> Installato
                                                    </span>
                                                ) : (
                                                    <div className={styles.hint}>
                                                        <span>Da installare con Ollama:</span>{' '}
                                                        <code className="break-all">ollama pull {model.name}</code>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </details>

                        <button
                            type="button"
                            onClick={() => setShowCustom(true)}
                            className={cn(SETTINGS_SECONDARY_BUTTON_CLASS, 'justify-self-start border-dashed')}
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


        </div>
    );
}
