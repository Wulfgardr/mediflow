'use client';

/* WUL-297: moved verbatim from app/settings/page.tsx into the AI sub-route. */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
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
    selectorId: 'clinical' | 'reasoning' | 'ocr';
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
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(false);
    const [isPulling, setIsPulling] = useState(false);
    const [pullProgress, setPullProgress] = useState(0);
    const [pullStatus, setPullStatus] = useState("");
    const [showCustom, setShowCustom] = useState(false);
    const [pullingModel, setPullingModel] = useState<string | null>(null);
    const { showToast } = useToast();
    const confirm = useConfirm();

    const checkInstalled = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/ai/models', {
                headers: { 'x-target-url': targetUrl }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.models) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setInstalledModels(data.models.map((m: any) => m.name));
                }
            }
        } catch (e) {
            console.error("Failed to list models", e);
        } finally {
            setLoading(false);
        }
    }, [targetUrl]);

    // Initial check
    useEffect(() => {
        if (provider === 'ollama') {
            void checkInstalled();
        }
    }, [provider, checkInstalled]);

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

    const isInstalled = (name: string) => installedModels.some(m => m.startsWith(name) || name.startsWith(m));

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
        <div className="mf-section space-y-4" data-testid={`ai-model-selector-${selectorId}`}>
            {/* @Codex WUL-229: selector header now uses MediFlow icon disc + ink/muted typography */}
            <div className="flex items-start gap-3">
                <div className="rounded-2xl p-2.5" style={c.iconStyle}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold" style={c.titleStyle}>{label}</h4>
                    <p className="mt-1 text-[11px] leading-5" style={c.descriptionStyle}>{description}</p>
                </div>
            </div>

            <div className="space-y-2">
                {!showCustom ? (
                    <div className="grid gap-2">
                        {recommended.map((model) => {
                            const installed = isInstalled(model.name);
                            const selected = value === model.name;

                            return (
                                // @Codex WUL-229: option card switches to mf-option-card primitive with style-driven selection accent
                                <div
                                    key={model.name}
                                    onClick={() => onChange(model.name)}
                                    className={cn('mf-option-card relative flex items-center justify-between gap-3 !px-3.5 !py-3', selected && 'is-active z-10')}
                                    style={selected ? c.selectedCardStyle : undefined}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div
                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                            style={selected
                                                ? { borderColor: 'var(--lume-ink)', background: 'var(--lume-ink)' }
                                                : { borderColor: 'rgba(112,106,100,0.28)' }}
                                        >
                                            {selected && <div className={`h-1.5 w-1.5 rounded-full ${c.selectedDot}`} />}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="lume-registro block truncate text-xs font-semibold" style={{ color: 'var(--lume-ink)' }}>{model.name}</span>
                                            <span className="mt-0.5 block text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>{model.desc}</span>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        {installed ? (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                                                style={c.installedBadgeStyle}
                                            >
                                                <Check className="w-3 h-3" /> Installato
                                            </span>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePull(model.name);
                                                }}
                                                disabled={isPulling}
                                                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60"
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
                            placeholder="es. llama3"
                            autoFocus
                        />
                        <button
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
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--lume-ink)' }}>
                            <RefreshCw className="w-3 h-3" />
                            Scaricamento {pullingModel ? `di ${pullingModel}` : 'in corso'}
                        </span>
                        <span className="lume-registro text-xs" style={{ color: 'var(--lume-ink-muted)' }}>{pullProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)' }}>
                        <div
                            className="h-full transition-[width] duration-300"
                            style={{ width: `${pullProgress}%`, ...c.progressStyle }}
                        />
                    </div>
                    <p className="mt-2 truncate text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>{pullStatus}</p>
                </div>
            )}
        </div>
    );
}
