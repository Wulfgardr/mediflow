'use client';

// WUL-297 Modelli e Hardware: moved from the monolithic settings page.

import { useState } from 'react';
import { AlertTriangle, Bot, CheckCircle, Cpu, RefreshCw, Save, Server, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';
/* @Codex */
import { useAiSettingsController } from '@/lib/hooks/use-ai-settings-controller';
/* @Codex */
import AiRolloutGuardNotice from '@/components/settings/ai-rollout-guard-notice';
import { ModelSelector } from '@/components/settings/ai-model-selector';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SETTINGS_SECONDARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

export default function SettingsAiModelsPage() {
    const {
        hardwareProfile,
        aiConfig,
        setAiConfig,
        isSavingAi,
        aiTestStatus,
        aiHealth,
        applyHardwareProfile,
        saveAiConfig,
        testAiConnection,
    } = useAiSettingsController();

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isDockerApp, setIsDockerApp] = useState(false);

    return (
        <section className="space-y-4" data-testid="settings-ai-models-section">
            <SettingsSectionIntro
                kicker="Intelligenza locale"
                title="Modelli e hardware"
                description="Profilo hardware e modelli Ollama per i ruoli generali. ATHENA mantiene una lane locale separata."
            />

            <div className="space-y-6">
                {/* Profilo hardware */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-229: hardware tier cards now ride mf-option-card with token-driven accents */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'color-mix(in srgb, var(--lume-ink) 6%, transparent)', color: 'var(--lume-ink)' }}>
                            <Cpu className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Profilo hardware</p>
                            <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--lume-ink)' }}>Capacità del computer</h3>
                            <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Imposta i modelli di default in base alla RAM disponibile. Sovrascrive le selezioni manuali.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div
                            onClick={() => applyHardwareProfile('low')}
                            className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'low' && 'is-active')}
                            style={hardwareProfile === 'low' ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 22%, transparent)', background: 'var(--lume-surface-field)' } : undefined}
                        >
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--lume-ink)' }}>Leggero</span>
                                {hardwareProfile === 'low' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--lume-ink)' }} />}
                            </div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>&lt; 16GB RAM</p>
                            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>Usa solo modelli molto compressi (Q4_K_M).</p>
                        </div>

                        <div
                            onClick={() => applyHardwareProfile('medium')}
                            className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'medium' && 'is-active')}
                            style={hardwareProfile === 'medium' ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 22%, transparent)', background: 'var(--lume-surface-field)' } : undefined}
                        >
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--lume-ink)' }}>Bilanciato</span>
                                {hardwareProfile === 'medium' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--lume-ink)' }} />}
                            </div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>16-32GB RAM</p>
                            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>Qwen 14B per sintesi e reasoning.</p>
                        </div>

                        <div
                            onClick={() => applyHardwareProfile('high')}
                            className={cn('mf-option-card !px-4 !py-4', hardwareProfile === 'high' && 'is-active')}
                            style={hardwareProfile === 'high' ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 22%, transparent)', background: 'var(--lume-surface-field)' } : undefined}
                        >
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--lume-ink)' }}>Avanzato</span>
                                {hardwareProfile === 'high' && <CheckCircle className="w-4 h-4" style={{ color: 'var(--lume-ink)' }} />}
                            </div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>&gt; 32GB RAM</p>
                            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>Qwen 3.5 35B A3B per le superfici text-only generali.</p>
                        </div>
                    </div>
                </div>

                {/* Ruoli del team AI */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-273: AI roles header follows the neutral settings surface. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'color-mix(in srgb, var(--lume-ink) 6%, transparent)', color: 'var(--lume-ink)' }}>
                            <Stethoscope className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Ruoli del team AI</p>
                            <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--lume-ink)' }}>Modelli Ollama per ruoli generali</h3>
                            <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Queste selezioni non configurano la lane Treatment Reasoning.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <ModelSelector
                            selectorId="clinical"
                            label="Radiologo & Clinico"
                            description="Per sintesi cliniche, insight e strutturazione testuale dopo l'estrazione locale."
                            icon={<Bot className="w-5 h-5" />}
                            value={aiConfig.model_clinical}
                            onChange={(val) => setAiConfig({ ...aiConfig, model_clinical: val })}
                            recommended={[
                                { name: "qwen3.5:35b-a3b", desc: "Qwen 3.5 35B A3B (Default consigliato)" },
                                { name: "qwen2.5:32b", desc: "Qwen 2.5 32B (Compatibilita legacy)" },
                                { name: "qwen2.5:14b", desc: "Qwen 2.5 14B (Bilanciato)" },
                                { name: "qwen2.5:7b", desc: "Qwen 2.5 7B (Leggero)" },
                                { name: "hf.co/unsloth/medgemma-1.5-4b-it-GGUF", desc: "MedGemma 4B (Specialistico medico, non default)" }
                            ]}
                            provider={aiConfig.provider}
                            targetUrl={aiConfig.url}
                        />

                        <ModelSelector
                            selectorId="reasoning"
                            label="Internista (Reasoning)"
                            description="Per riassunti narrativi e supporto testuale generale; non governa la revisione terapeutica ATHENA."
                            icon={<Cpu className="w-5 h-5" />}
                            value={aiConfig.model_reasoning}
                            onChange={(val) => setAiConfig({ ...aiConfig, model_reasoning: val })}
                            recommended={[
                                { name: "qwen3.5:35b-a3b", desc: "Qwen 3.5 35B A3B (Potente, default)" },
                                { name: "qwen2.5:32b", desc: "Qwen 2.5 32B (Compatibilita legacy)" },
                                { name: "qwen2.5:14b", desc: "Qwen 2.5 14B (Ottimo, 16GB RAM)" },
                                { name: "qwen2.5:7b", desc: "Qwen 2.5 7B (Leggero)" },
                                { name: "deepseek-r1:14b", desc: "DeepSeek R1 14B (Reasoning)" }
                            ]}
                            provider={aiConfig.provider}
                            targetUrl={aiConfig.url}
                        />

                        <AiRolloutGuardNotice
                            selections={[
                                {
                                    roleId: 'clinical',
                                    roleLabel: 'Radiologo & Clinico',
                                    model: aiConfig.model_clinical,
                                },
                                {
                                    roleId: 'reasoning',
                                    roleLabel: 'Internista (Reasoning)',
                                    model: aiConfig.model_reasoning,
                                },
                            ]}
                        />
                    </div>
                </div>

                {/* Connessione locale + Save */}
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl bg-slate-100/80 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            <Server className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Connessione locale</p>
                            <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">Provider</h3>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ollama per i ruoli generali. Treatment Reasoning usa la lane locale ATHENA separata.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center rounded-[18px] border border-slate-200/70 bg-white/72 px-3 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                            Provider AI per ruoli generali: <span className="ml-2 font-semibold text-slate-900 dark:text-white">Ollama</span>
                        </div>
                        <input
                            type="text"
                            value={aiConfig.url}
                            onChange={(e) => setAiConfig({ ...aiConfig, url: e.target.value })}
                            placeholder="http://127.0.0.1:11434/v1"
                            aria-label="URL provider Ollama"
                            className={`${SETTINGS_INPUT_CLASS} font-mono text-xs`}
                        />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                        <label
                            htmlFor="advancedFit"
                            className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400"
                        >
                            <input
                                type="checkbox"
                                id="advancedFit"
                                checked={showAdvanced}
                                onChange={(e) => setShowAdvanced(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-white/10 dark:bg-white/5"
                            />
                            Mostra opzioni avanzate
                        </label>
                    </div>

                    {showAdvanced && (
                        <div className="mt-3 rounded-[18px] border border-dashed border-slate-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-white/5">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="dockerMode"
                                    checked={isDockerApp}
                                    onChange={(e) => {
                                        const newVal = e.target.checked;
                                        setIsDockerApp(newVal);
                                        setAiConfig(prev => ({
                                            ...prev,
                                            url: newVal
                                                ? "http://host.docker.internal:11434/v1"
                                                : "http://127.0.0.1:11434/v1"
                                        }));
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-white/10 dark:bg-white/5"
                                />
                                <label htmlFor="dockerMode" className="cursor-pointer text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Docker Internal Host (se l&apos;app è in container)
                                </label>
                            </div>
                        </div>
                    )}

                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200/70 pt-4 dark:border-white/10">
                        <button
                            onClick={saveAiConfig}
                            disabled={isSavingAi}
                            className={SETTINGS_PRIMARY_BUTTON_CLASS}
                        >
                            <Save className="w-4 h-4" />
                            {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                        </button>

                        <button
                            onClick={testAiConnection}
                            className={SETTINGS_SECONDARY_BUTTON_CLASS}
                        >
                            <RefreshCw className="w-4 h-4" />
                            Test Connessione
                        </button>

                        <p className="ml-auto text-[10px] text-slate-400 italic">
                            CPU alta? Riavvia Ollama (`docker restart ollama`).
                        </p>
                    </div>

                    {aiHealth && (
                        <div className={cn(
                            "mt-4 animate-in slide-in-from-top-2 fade-in rounded-[18px] border p-3 text-sm space-y-1",
                            aiHealth.status === 'ok'
                                ? "border-slate-200 bg-slate-50 text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                                : "border-red-200/70 bg-red-50/80 text-red-800 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200"
                        )}>
                            <div className="flex items-start gap-2 font-semibold">
                                {aiHealth.status === 'ok' ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                                <p>{aiHealth.status === 'ok' ? 'Sistema AI operativo' : 'Problema rilevato'}</p>
                            </div>
                            <p className="pl-6 text-xs opacity-90">{aiHealth.message}</p>
                        </div>
                    )}

                    {aiTestStatus === 'success' && (
                        <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                            <CheckCircle className="w-4 h-4" />
                            Connessione a Ollama riuscita.
                        </div>
                    )}
                    {aiTestStatus === 'error' && (
                        <div className="mt-3 flex items-center gap-2 rounded-[14px] border border-red-200/70 bg-red-50/80 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-200">
                            <AlertTriangle className="w-4 h-4" />
                            Impossibile connettersi. Controlla che Ollama sia attivo.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
