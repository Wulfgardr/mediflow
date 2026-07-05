'use client';

// WUL-297 Funzioni e Sicurezza AI: moved from the monolithic settings page.

import { CheckCircle, ChevronDown, Save, Shield, Sparkles } from 'lucide-react';
import {
    AI_INSIGHT_MODE_OPTIONS,
} from '@/lib/ai-insight-settings';
import { cn } from '@/lib/utils';
/* @Codex */
import { useAiSettingsController } from '@/lib/hooks/use-ai-settings-controller';
/* @Codex */
import AiModelParliamentPanel from '@/components/settings/ai-model-parliament-panel';
/* @Codex */
import AiRolloutReadinessPanel from '@/components/settings/ai-rollout-readiness-panel';
import {
    SETTINGS_CARD_CLASS,
    SETTINGS_INPUT_CLASS,
    SETTINGS_PRIMARY_BUTTON_CLASS,
    SettingsSectionIntro,
} from '@/components/settings/settings-ui';

export default function SettingsAiFunctionsPage() {
    const {
        hardwareProfile,
        aiInsightSettings,
        setAiInsightSettings,
        isSavingAi,
        patientInsightEnabled,
        setPatientInsightEnabled,
        documentSynthesisEnabled,
        setDocumentSynthesisEnabled,
        smartImportEnabled,
        setSmartImportEnabled,
        selectedInsightMode,
        insightRuntimePreview,
        updateManualInsightConfig,
        saveAiConfig,
    } = useAiSettingsController();

    return (
        <section className="space-y-4" data-testid="settings-ai-functions-section">
            <SettingsSectionIntro
                kicker="AI locale"
                title="Funzioni e Sicurezza"
                description="Interruttori di sicurezza delle funzioni AI, budget insight e governance del rollout."
            />

            <div className="space-y-6">
                {/* Patient Insight runtime policy */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-273: Patient Insight runtime settings stay neutral and role-led. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'rgba(15, 23, 42, 0.06)', color: 'var(--mf-ink)' }}>
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="section-kicker">Patient Insight</p>
                                <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Budget contesto e output</h3>
                                <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Quanto contesto leggere e quanto produrre per ogni insight: bilancia velocità e completezza.</p>
                            </div>
                            <span className="apple-chip whitespace-nowrap">{selectedInsightMode.title}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {AI_INSIGHT_MODE_OPTIONS.map((option) => {
                            const selected = aiInsightSettings.mode === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setAiInsightSettings((prev) => ({ ...prev, mode: option.value }))}
                                    className={cn('mf-option-card text-left !px-3 !py-3', selected && 'is-active')}
                                    style={selected ? { borderColor: 'rgba(15, 23, 42, 0.22)', background: 'rgba(248, 250, 252, 0.9)' } : undefined}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold" style={{ color: 'var(--mf-ink)' }}>{option.title}</span>
                                        {selected ? <CheckCircle className="h-4 w-4" style={{ color: 'var(--mf-ink)' }} /> : null}
                                    </div>
                                    <p className="mt-1 text-[11px]" style={{ color: 'var(--mf-muted)' }}>{option.description}</p>
                                </button>
                            );
                        })}
                    </div>

                    <p
                        className="mt-3 rounded-[14px] border px-3 py-2 text-[11px] leading-5"
                        style={{ borderColor: 'rgba(15, 23, 42, 0.12)', background: 'rgba(248, 250, 252, 0.85)', color: 'var(--mf-muted)' }}
                    >
                        {aiInsightSettings.mode === 'full_auto'
                            ? 'MediFlow sceglie automaticamente quante fonti leggere in base al profilo della postazione e alla complessità del caso.'
                            : selectedInsightMode.description}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--mf-muted)' }}>Profilo hardware</span>
                            <span className="font-semibold" style={{ color: 'var(--mf-ink)' }}>
                                {hardwareProfile === 'low' ? 'Leggero' : hardwareProfile === 'medium' ? 'Bilanciato' : 'Avanzato'}
                            </span>
                        </div>
                        <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--mf-muted)' }}>Budget AI</span>
                            <span className="font-semibold" style={{ color: 'var(--mf-ink)' }}>{insightRuntimePreview}</span>
                        </div>
                    </div>

                    {aiInsightSettings.mode === 'manual' && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                                Documenti massimi
                                <input
                                    type="number"
                                    min={2}
                                    max={12}
                                    value={aiInsightSettings.manualConfig.maxDocuments}
                                    onChange={(e) => updateManualInsightConfig('maxDocuments', Number.parseInt(e.target.value, 10))}
                                    className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
                                />
                            </label>
                            <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                                Caratteri per documento
                                <input
                                    type="number"
                                    min={120}
                                    max={480}
                                    value={aiInsightSettings.manualConfig.maxDocumentSummaryChars}
                                    onChange={(e) => updateManualInsightConfig('maxDocumentSummaryChars', Number.parseInt(e.target.value, 10))}
                                    className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
                                />
                            </label>
                            <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                                Budget contesto documenti
                                <input
                                    type="number"
                                    min={800}
                                    max={5000}
                                    value={aiInsightSettings.manualConfig.maxDocumentContextChars}
                                    onChange={(e) => updateManualInsightConfig('maxDocumentContextChars', Number.parseInt(e.target.value, 10))}
                                    className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
                                />
                            </label>
                            <label className="text-xs font-medium" style={{ color: 'var(--mf-muted)' }}>
                                Output max token
                                <input
                                    type="number"
                                    min={256}
                                    max={1200}
                                    value={aiInsightSettings.manualConfig.outputMaxTokens}
                                    onChange={(e) => updateManualInsightConfig('outputMaxTokens', Number.parseInt(e.target.value, 10))}
                                    className={`mt-1 ${SETTINGS_INPUT_CLASS}`}
                                />
                            </label>
                        </div>
                    )}
                </div>

                {/* AI safety toggles */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-273: active AI switches use neutral confirmation; red is reserved for off/blocked states. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'rgba(192, 57, 43, 0.12)', color: 'var(--mf-critical)' }}>
                            <Shield className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Sicurezza AI</p>
                            <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--mf-ink)' }}>Disattiva singole funzioni AI</h3>
                            <p className="mt-1 text-xs" style={{ color: 'var(--mf-muted)' }}>Ogni interruttore ferma una funzione specifica, anche se i modelli locali sono installati.</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div
                            className="rounded-[18px] border p-4"
                            style={patientInsightEnabled
                                ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                            data-testid="patient-insight-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Patient Insight</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                        Se spento, la scheda paziente non genera nuovi riepiloghi AI.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="patientInsightKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={patientInsightEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                    >
                                        {patientInsightEnabled ? 'Attivo' : 'Spento'}
                                    </label>
                                    <button
                                        id="patientInsightKillSwitch"
                                        type="button"
                                        role="switch"
                                        aria-checked={patientInsightEnabled}
                                        aria-label="Patient Insight locale"
                                        onClick={() => setPatientInsightEnabled(!patientInsightEnabled)}
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                        style={{ background: patientInsightEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: patientInsightEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div
                            className="rounded-[18px] border p-4"
                            style={documentSynthesisEnabled
                                ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                            data-testid="document-synthesis-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Document Synthesis</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                        Se spento, OCR e import base restano disponibili, ma non vengono prodotte sintesi cliniche automatiche.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="documentSynthesisKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={documentSynthesisEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                    >
                                        {documentSynthesisEnabled ? 'Attivo' : 'Spento'}
                                    </label>
                                    <button
                                        id="documentSynthesisKillSwitch"
                                        type="button"
                                        role="switch"
                                        aria-checked={documentSynthesisEnabled}
                                        aria-label="Document Synthesis locale"
                                        onClick={() => setDocumentSynthesisEnabled(!documentSynthesisEnabled)}
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                        style={{ background: documentSynthesisEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: documentSynthesisEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div
                            className="rounded-[18px] border p-4"
                            style={smartImportEnabled
                                ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(248, 250, 252, 0.85)' }
                                : { borderColor: 'rgba(192, 57, 43, 0.28)', background: 'rgba(192, 57, 43, 0.08)' }}
                            data-testid="smart-import-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--mf-ink)' }}>Smart Import</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--mf-muted)' }}>
                                        Se spento, il pannello paziente non propone nuovi suggerimenti Smart Import e non applica quelli in sospeso.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="smartImportKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={smartImportEnabled
                                            ? { borderColor: 'rgba(15, 23, 42, 0.18)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-ink)' }
                                            : { borderColor: 'rgba(192, 57, 43, 0.32)', background: 'rgba(255,255,255,0.85)', color: 'var(--mf-critical)' }}
                                    >
                                        {smartImportEnabled ? 'Attivo' : 'Spento'}
                                    </label>
                                    <button
                                        id="smartImportKillSwitch"
                                        type="button"
                                        role="switch"
                                        aria-checked={smartImportEnabled}
                                        aria-label="Smart Import locale"
                                        onClick={() => setSmartImportEnabled(!smartImportEnabled)}
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:rgba(15,23,42,0.24)]"
                                        style={{ background: smartImportEnabled ? 'var(--mf-ink)' : 'rgba(112,106,100,0.2)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: smartImportEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Save (shared with Modelli e Hardware: persists the whole AI configuration) */}
                <div className={SETTINGS_CARD_CLASS}>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                onClick={saveAiConfig}
                disabled={isSavingAi}
                className={SETTINGS_PRIMARY_BUTTON_CLASS}
                        >
                <Save className="w-4 h-4" />
                {isSavingAi ? 'Salvataggio...' : 'Salva Configurazione'}
                        </button>
                        <p className="text-xs" style={{ color: 'var(--mf-muted)' }}>
                Interruttori e budget hanno effetto dopo il salvataggio.
                        </p>
                    </div>
                </div>

                {/* Read-only governance */}
                {/* WUL-297: expanded by default now that governance lives on a dedicated page. */}
                <details open className="group rounded-[24px] border border-slate-200/70 bg-white/60 backdrop-blur-md dark:border-white/10 dark:bg-white/5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                        <div>
                            <p className="section-kicker">Governance</p>
                            <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">Confronto modelli e prontezza al rilascio</h3>
                        </div>
                        <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-4 border-t border-slate-200/70 px-5 py-5 dark:border-white/10">
                        <AiModelParliamentPanel />
                        <AiRolloutReadinessPanel />
                    </div>
                </details>
            </div>
        </section>
    );
}
