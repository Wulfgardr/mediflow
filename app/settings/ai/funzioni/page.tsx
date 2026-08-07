'use client';

// WUL-297 Funzioni cliniche AI: moved from the monolithic settings page.

import { CheckCircle, Save, Shield, Sparkles } from 'lucide-react';
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
        patientInsightEnabled,
        setPatientInsightEnabled,
        documentSynthesisEnabled,
        setDocumentSynthesisEnabled,
        smartImportEnabled,
        setSmartImportEnabled,
        treatmentReasoningEnabled,
        setTreatmentReasoningEnabled,
        ocrEnabled,
        setOcrEnabled,
        documentRouterControlFlowMode,
        setDocumentRouterControlFlowMode,
        selectedInsightMode,
        insightRuntimePreview,
        updateManualInsightConfig,
        saveAiConfig,
    } = useAiSettingsController();

    return (
        <section className="space-y-4" data-testid="settings-ai-functions-section">
            <SettingsSectionIntro
                kicker="Intelligenza locale"
                title="Funzioni cliniche"
                description="Interruttori per funzione e budget insight."
            />

            <div className="space-y-6">
                {/* Patient Insight runtime policy */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-273: Patient Insight runtime settings stay neutral and role-led. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'color-mix(in srgb, var(--lume-ink) 6%, transparent)', color: 'var(--lume-ink)' }}>
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="section-kicker">Patient Insight</p>
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
                </div>

                {/* AI safety toggles */}
                <div className={SETTINGS_CARD_CLASS}>
                    {/* @Codex WUL-273: active AI switches use neutral confirmation; red is reserved for off/blocked states. */}
                    <div className="mb-5 flex items-start gap-3">
                        <div className="rounded-2xl p-2" style={{ background: 'var(--lume-surface-field)', color: 'var(--lume-signal-critical)' }}>
                            <Shield className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="section-kicker">Sicurezza AI</p>
                            <h3 className="mt-1 text-base font-semibold" style={{ color: 'var(--lume-ink)' }}>Disattiva singole funzioni AI</h3>
                            <p className="mt-1 text-xs" style={{ color: 'var(--lume-ink-muted)' }}>Ogni interruttore ferma una funzione specifica, anche se i modelli locali sono installati.</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div
                            className="rounded-[18px] border p-4"
                            style={ocrEnabled
                                ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }
                                : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="ocr-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>OCR documentale (modello locale)</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Se spento, l&apos;estrazione testo da scansioni si ferma e i documenti restano in coda revisione.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="ocrKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={ocrEnabled
                                            ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' }
                                            : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}
                                    >
                                        {ocrEnabled ? 'Attivo' : 'Spento'}
                                    </label>
                                    <button
                                        id="ocrKillSwitch"
                                        type="button"
                                        role="switch"
                                        aria-checked={ocrEnabled}
                                        aria-label="OCR documentale locale"
                                        onClick={() => setOcrEnabled(!ocrEnabled)}
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--lume-accent)]"
                                        style={{ background: ocrEnabled ? 'var(--lume-ink)' : 'color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: ocrEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>
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

                        <div
                            className="rounded-[18px] border p-4"
                            style={patientInsightEnabled
                                ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }
                                : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="patient-insight-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Patient Insight</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Se spento, la scheda paziente non genera nuovi riepiloghi AI.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="patientInsightKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={patientInsightEnabled
                                            ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' }
                                            : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}
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
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--lume-accent)]"
                                        style={{ background: patientInsightEnabled ? 'var(--lume-ink)' : 'color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}
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
                                ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }
                                : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="document-synthesis-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Document Synthesis</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Se spento, OCR e import base restano disponibili, ma non vengono prodotte sintesi cliniche automatiche.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="documentSynthesisKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={documentSynthesisEnabled
                                            ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' }
                                            : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}
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
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--lume-accent)]"
                                        style={{ background: documentSynthesisEnabled ? 'var(--lume-ink)' : 'color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}
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
                                ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }
                                : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="smart-import-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Smart Import</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Se spento, il pannello paziente non propone nuovi suggerimenti Smart Import e non applica quelli in sospeso.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="smartImportKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={smartImportEnabled
                                            ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' }
                                            : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}
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
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--lume-accent)]"
                                        style={{ background: smartImportEnabled ? 'var(--lume-ink)' : 'color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: smartImportEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div
                            className="rounded-[18px] border p-4"
                            style={treatmentReasoningEnabled
                                ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-field)' }
                                : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 28%, transparent)', background: 'var(--lume-surface-field)' }}
                            data-testid="treatment-reasoning-kill-switch-card"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--lume-ink)' }}>Treatment Reasoning</p>
                                    <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--lume-ink-muted)' }}>
                                        Se spento, il pannello terapie non genera nuove bozze con ATHENA-R1-Qwen3-8B via MLX locale. Le bozze restano consultive, richiedono verifica clinica e non scrivono in scheda.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label
                                        htmlFor="treatmentReasoningKillSwitch"
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                                        style={treatmentReasoningEnabled
                                            ? { borderColor: 'color-mix(in srgb, var(--lume-ink) 18%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-ink)' }
                                            : { borderColor: 'color-mix(in srgb, var(--lume-signal-critical) 32%, transparent)', background: 'var(--lume-surface-focal)', color: 'var(--lume-signal-critical)' }}
                                    >
                                        {treatmentReasoningEnabled ? 'Attivo' : 'Spento'}
                                    </label>
                                    <button
                                        id="treatmentReasoningKillSwitch"
                                        type="button"
                                        role="switch"
                                        aria-checked={treatmentReasoningEnabled}
                                        aria-label="Treatment Reasoning locale"
                                        onClick={() => setTreatmentReasoningEnabled(!treatmentReasoningEnabled)}
                                        className="relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--lume-accent)]"
                                        style={{ background: treatmentReasoningEnabled ? 'var(--lume-ink)' : 'color-mix(in srgb, var(--lume-ink) 20%, transparent)' }}
                                    >
                                        <span
                                            className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                            style={{ transform: treatmentReasoningEnabled ? 'translateX(20px)' : 'translateX(0)' }}
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
                        <p className="text-xs" style={{ color: 'var(--lume-ink-muted)' }}>
                Interruttori e budget hanno effetto dopo il salvataggio.
                        </p>
                    </div>
                </div>

            </div>
        </section>
    );
}
