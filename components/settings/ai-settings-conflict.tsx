import type { AiConfigurationSnapshot } from '@/lib/ai-settings-configuration';
import { AI_INSIGHT_MODE_OPTIONS } from '@/lib/ai-insight-settings';
import { isAiLaneEnabledValue } from '@/lib/ai-lane-kill-switch';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from './settings-ui';

export function AiSettingsConflict({ conflict, readback, busy, onReread }: {
    conflict: 'conflict' | 'review' | null;
    readback: AiConfigurationSnapshot | null;
    busy: boolean;
    onReread: () => Promise<void>;
}) {
    if (!conflict) return null;
    let budget = 'Non impostati';
    if (readback?.aiInsightManualConfig) {
        try {
            const value = JSON.parse(readback.aiInsightManualConfig);
            budget = `${value.maxDocuments} documenti, ${value.maxDocumentSummaryChars} caratteri per documento, ${value.maxDocumentContextChars} caratteri di contesto, ${value.outputMaxTokens} token`;
        } catch { budget = 'Valore precedente non leggibile'; }
    }
    const mode = AI_INSIGHT_MODE_OPTIONS.find(option => option.value === readback?.aiInsightMode)?.title ?? 'Automatica';
    const router = { off: 'Spento', shadow: 'Osservazione', active: 'Attivo' };
    const hardware: Record<string, string> = { low: 'Basso', medium: 'Medio', high: 'Alto', custom: 'Personalizzato' };
    return <div role="status" className="space-y-3">
        <p>{conflict === 'conflict'
            ? 'Le impostazioni sono cambiate. La bozza è conservata. Rileggi i valori registrati prima di confermarla.'
            : 'Valori registrati riletti. Confrontali con la bozza nei campi, poi conferma con Salva.'}</p>
        <button type="button" className={SETTINGS_SECONDARY_BUTTON_CLASS} disabled={busy} onClick={onReread}>
            Rileggi impostazioni
        </button>
        {readback && <dl className="space-y-1" aria-label="Impostazioni IA registrate">
            <div><dt>Modalità</dt><dd>{mode}</dd></div>
            <div><dt>Limiti personalizzati</dt><dd>{budget}</dd></div>
            <div><dt>Instradamento documenti</dt><dd>{router[readback.documentRouterControlFlow as keyof typeof router] ?? 'Osservazione'}</dd></div>
            <div><dt>Profilo hardware</dt><dd>{hardware[readback.hardwareProfile ?? 'custom'] ?? readback.hardwareProfile}</dd></div>
            <div><dt>Modello clinico</dt><dd>{readback.aiModel_clinical ?? readback.aiModel ?? 'Non impostato'}</dd></div>
            <div><dt>Modello di ragionamento</dt><dd>{readback.aiModel_reasoning ?? readback.aiModel ?? 'Non impostato'}</dd></div>
            <div><dt>Provider</dt><dd>{readback.aiProvider ?? 'Ollama'}</dd></div>
            <div><dt>Indirizzo di Ollama</dt><dd>{readback.aiUrl ?? readback.ollamaUrl ?? 'Non impostato'}</dd></div>
            {([
                ['Quadro paziente', readback.aiPatientInsightKillSwitch],
                ['Sintesi dei documenti', readback.aiDocumentSynthesisKillSwitch],
                ['Importazione assistita', readback.aiSmartImportKillSwitch],
            ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{isAiLaneEnabledValue(value) ? 'Abilitata' : 'Disabilitata'}</dd></div>)}
        </dl>}
    </div>;
}
