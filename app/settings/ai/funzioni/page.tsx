'use client';

/* @Codex */
import { FunctionPreferencesPanel } from '@/components/function-models/function-preferences-panel';
import { useCallback } from 'react';
import type { FunctionModelPreferences } from '@/lib/function-models/browser';
import Link from 'next/link';

// WUL-297 Funzioni cliniche AI: moved from the monolithic settings page.

import { CheckCircle, Save, Sparkles } from 'lucide-react';
/* @Codex */
import functionStyles from '@/components/settings/function-status-panel.module.css';
import {
    AI_INSIGHT_MODE_OPTIONS,
} from '@/lib/ai-insight-settings';
import { cn } from '@/lib/utils';
/* @Codex */
import { useAiSettingsController } from '@/lib/hooks/use-ai-settings-controller';
/* @Codex */
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
        setPatientInsightEnabled,
        setDocumentSynthesisEnabled,
        setSmartImportEnabled,
        setTreatmentReasoningEnabled,
        documentRouterControlFlowMode,
        setDocumentRouterControlFlowMode,
        selectedInsightMode,
        insightRuntimePreview,
        updateManualInsightConfig,
        saveAiConfig,
    } = useAiSettingsController();

    /* @Codex: mirror confirmed switches into the existing shared configuration draft. */
    const syncPreferences = useCallback((dto: FunctionModelPreferences) => {
        for (const row of dto.functions) {
            if (row.id === 'patient_insight') setPatientInsightEnabled(row.enabled);
            if (row.id === 'smart_import') setSmartImportEnabled(row.enabled);
            if (row.id === 'document_synthesis') setDocumentSynthesisEnabled(row.enabled);
            if (row.id === 'treatment_reasoning') setTreatmentReasoningEnabled(row.enabled);
        }
    }, [setPatientInsightEnabled, setSmartImportEnabled, setDocumentSynthesisEnabled, setTreatmentReasoningEnabled]);

    return (
        <section className={`space-y-4 ${functionStyles.functionSettings}`} data-testid="settings-ai-functions-section">
            <SettingsSectionIntro
                kicker="Intelligenza locale"
                title="Funzioni cliniche"
                description="Scegli quali proposte usare. Puoi modificare ogni funzione e salvare le preferenze."
            />

            {/* @Codex: per-proposal access stays separate from local model preferences. */}
            <aside className={SETTINGS_CARD_CLASS} aria-label="ChatGPT e modelli delle funzioni">
                <p>Le preferenze locali restano sul computer. Per usare OpenAI, scegli il canale nella funzione e prepara una proposta: servono consenso sul contesto redatto, accesso dedicato e verifica dei modelli disponibili per quel tentativo.</p>
                <Link href="/settings/ai/chatgpt" className="underline">Gestisci OpenAI · ChatGPT</Link>
            </aside>
            <FunctionPreferencesPanel onRead={syncPreferences} />

            <div className="space-y-6">
                <details className={SETTINGS_CARD_CLASS}>
                    <summary className={functionStyles.advancedSummary}>Lettura e instradamento dei documenti</summary>
                        <div
                            className="rounded-[18px] border p-4"
                            style={{ borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="ocr-unavailable-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Lettura locale degli allegati</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        AnyDoc estrae il testo; sui PDF supportati il percorso locale puo usare Apple Vision per le pagine scansionate. Le immagini singole restano da rivedere manualmente. Questo percorso e separato dal registro OCR di Fabric.
                                    </p>
                                </div>
                                <span className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}>
                                    Revisione richiesta
                                </span>
                            </div>
                        </div>

                        <div
                            className="rounded-[18px] border p-4"
                            style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="document-router-control-flow-card"
                        >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Instradamento documentale deterministico</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Decide quando le classi a estrazione certa possono usare la sintesi deterministica invece del modello.
                                    </p>
                                </div>
                                <label className="text-xs font-medium" style={{ color: 'var(--lume-ink-muted)' }}>
                                    Modalita
                                    <select
                                        aria-label="Modalita instradamento documentale deterministico"
                                        value={documentRouterControlFlowMode}
                                        onChange={(event) => setDocumentRouterControlFlowMode(event.target.value as typeof documentRouterControlFlowMode)}
                                        className={`mt-1 min-w-40 ${SETTINGS_INPUT_CLASS}`}
                                    >
                                        <option value="off">Spento</option>
                                        <option value="shadow">Osservazione</option>
                                        <option value="active">Attivo</option>
                                    </select>
                                </label>
                            </div>
                            <p className="mt-3 rounded-[14px] border px-3 py-2 text-[11px] leading-5" style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink-muted)' }}>
                                {documentRouterControlFlowMode === 'off'
                                    ? 'Spento: il modello analizza tutti i documenti.'
                                    : documentRouterControlFlowMode === 'shadow'
                                        ? 'Osservazione: il router registra cosa salterebbe senza cambiare la sintesi.'
                                        : 'Attivo: le classi a estrazione certa saltano il modello e usano la sintesi deterministica.'}
                            </p>
                        </div>

                </details>

                {/* @Codex: advanced controls remain available below the function choices. */}
                <details className={SETTINGS_CARD_CLASS}>
                    <summary className={functionStyles.advancedSummary}>Regola contesto e lunghezza delle sintesi</summary>
                    {/* @Codex WUL-273: Patient Insight runtime settings stay neutral and role-led. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'color-mix(in srgb, var(--lume-ink) 6%, transparent)', color: 'var(--lume-ink)' }}>
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="section-kicker">Quadro paziente</p>
                                <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--lume-ink)' }}>Budget contesto e output</h3>
                                <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Quanto contesto leggere e quanto produrre per ogni insight: bilancia velocità e completezza.</p>
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
                                    style={selected ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 22%, transparent)', background: 'var(--lume-surface-field)' } : undefined}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold" style={{ color: 'var(--lume-ink)' }}>{option.title}</span>
                                        {selected ? <CheckCircle className="h-4 w-4" style={{ color: 'var(--lume-ink)' }} /> : null}
                                    </div>
                                    <p className="mt-1 text-[11px]" style={{ color: 'var(--lume-ink-muted)' }}>{option.description}</p>
                                </button>
                            );
                        })}
                    </div>

                    <p
                        className="mt-3 rounded-[14px] border px-3 py-2 text-[11px] leading-5"
                        style={{ borderColor: 'color-mix(in srgb, var(--lume-ink) 12%, transparent)', background: 'var(--lume-surface-field)', color: 'var(--lume-ink-muted)' }}
                    >
                        {aiInsightSettings.mode === 'full_auto'
                            ? 'MediFlow sceglie automaticamente quante fonti leggere in base al profilo della postazione e alla complessità del caso.'
                            : selectedInsightMode.description}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--lume-ink-muted)' }}>Profilo hardware</span>
                            <span className="font-semibold" style={{ color: 'var(--lume-ink)' }}>
                                {hardwareProfile === 'low' ? 'Leggero' : hardwareProfile === 'medium' ? 'Bilanciato' : 'Avanzato'}
                            </span>
                        </div>
                        <div className="mf-section mf-section-tight !rounded-lg px-3 py-2">
                            <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--lume-ink-muted)' }}>Budget AI</span>
                            <span className="font-semibold" style={{ color: 'var(--lume-ink)' }}>{insightRuntimePreview}</span>
                        </div>
                    </div>

                    {aiInsightSettings.mode === 'manual' && (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="text-xs font-medium" style={{ color: 'var(--lume-ink-muted)' }}>
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
                            <label className="text-xs font-medium" style={{ color: 'var(--lume-ink-muted)' }}>
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
                            <label className="text-xs font-medium" style={{ color: 'var(--lume-ink-muted)' }}>
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
                            <label className="text-xs font-medium" style={{ color: 'var(--lume-ink-muted)' }}>
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
                </details>

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
                        <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                Salva i parametri avanzati. Le preferenze per esperienza si applicano dal pannello in alto.
                        </p>
                    </div>
                </div>

            </div>
        </section>
    );
}
