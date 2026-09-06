/* @Codex WUL-674: configuration facts are not execution receipts. */
import { OLLAMA_LOCAL_MODEL_REFERENCE_MAX_UTF8_BYTES } from './ai-providers/ollama-locality';

export const FUNCTION_STATUS_SCHEMA = 'mediflow.function-status.v1' as const;
export const FUNCTION_IDS = ['document_text', 'document_ocr', 'patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning', 'icd11'] as const;
export type FunctionId = typeof FUNCTION_IDS[number];
export type FunctionState = 'off' | 'needs_setup' | 'blocked' | 'unverified' | 'manual' | 'observed' | 'unavailable';
export type FunctionStatusRow = Readonly<{
    id: FunctionId; state: FunctionState; reason: string; provider: string;
    model: string | null; lastExecutionAt: null;
}>;
export type FunctionStatusSnapshot = Readonly<{
    schemaVersion: typeof FUNCTION_STATUS_SCHEMA; checkedAt: string;
    check: 'configuration_only'; functions: readonly FunctionStatusRow[];
}>;
export type FunctionStatusSources = Readonly<{
    platform: string;
    enabled: Readonly<Record<'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning', boolean>>;
    ollamaLifecycle: string; athenaLifecycle: string;
    clinicalBinding: Readonly<{ state: 'configured' | 'invalid' | 'unavailable'; model: string | null }>;
    athenaArtifact: boolean;
    who: 'disabled' | 'credentials_absent' | 'offline' | 'configured' | 'available' | 'unavailable';
}>;

export const FUNCTION_META: Readonly<Record<FunctionId, Readonly<{ title: string; purpose: string; href: string; action: string }>>> = {
    document_text: { title: 'Lettura dei documenti', purpose: 'Estrae il testo dagli allegati supportati.', href: '/?area=incarico', action: 'Apri una cartella' },
    document_ocr: { title: 'Lettura delle scansioni PDF', purpose: 'Riconosce le pagine senza testo con Apple Vision sul Mac supportato.', href: '/?area=incarico', action: 'Apri una cartella' },
    patient_insight: { title: 'Quadro paziente', purpose: 'Prepara una sintesi da rivedere.', href: '/settings/ai/modelli', action: 'Configura il modello' },
    smart_import: { title: 'Importazione assistita', purpose: 'Propone dati dai documenti prima della conferma.', href: '/settings/ai/modelli', action: 'Configura il modello' },
    document_synthesis: { title: 'Sintesi dei documenti', purpose: 'Prepara una sintesi delle fonti selezionate.', href: '/settings/ai/modelli', action: 'Configura il modello' },
    treatment_reasoning: { title: 'Revisione del trattamento', purpose: 'Prepara una proposta con il percorso locale ATHENA.', href: '/settings/ai/modelli', action: 'Configura ATHENA' },
    icd11: { title: 'Terminologia WHO', purpose: 'Consulta ICD-11, release 2026-01 MMS in inglese.', href: '/settings/diagnostica#who-setup', action: 'Apri configurazione WHO' },
};
export const FUNCTION_STATE_LABELS: Readonly<Record<FunctionState, string>> = {
    off: 'Spenta', needs_setup: 'Da configurare', blocked: 'Bloccata', unverified: 'Da provare', manual: 'Revisione manuale', observed: 'Risposta osservata', unavailable: 'Stato non disponibile',
};

function generativeState(enabled: boolean, lifecycle: string, binding: 'configured' | 'invalid' | 'unavailable'): Pick<FunctionStatusRow, 'state' | 'reason'> {
    if (!enabled) return { state: 'off', reason: 'La funzione è disabilitata nelle impostazioni.' };
    if (lifecycle === 'unavailable' || binding === 'unavailable') return { state: 'unavailable', reason: 'Non è stato possibile leggere i prerequisiti. Rileggi lo stato prima di cambiare la configurazione.' };
    if (lifecycle === 'missing') return { state: 'needs_setup', reason: 'Manca la configurazione verificata del provider locale.' };
    if (lifecycle !== 'available_unqualified') return { state: 'blocked', reason: 'Il provider locale non è ammesso: controlla il suo stato nei dettagli.' };
    if (binding !== 'configured') return { state: 'needs_setup', reason: 'Il modello o il collegamento locale non sono configurati correttamente.' };
    return { state: 'unverified', reason: 'Prerequisiti presenti. La disponibilità si verifica eseguendo la funzione su una fonte da rivedere.' };
}

export function buildFunctionStatus(sources: FunctionStatusSources, checkedAt: string): FunctionStatusSnapshot {
    if (new Date(checkedAt).toISOString() !== checkedAt) throw new Error('Invalid status timestamp');
    const row = (id: FunctionId, state: FunctionState, reason: string, provider: string, model: string | null = null): FunctionStatusRow =>
        Object.freeze({ id, state, reason, provider, model, lastExecutionAt: null });
    const functions: FunctionStatusRow[] = [
        row('document_text', 'unverified', 'Apri un allegato e scegli Estrai testo. Il risultato viene mostrato solo dopo la lettura della sorgente corrente.', 'AnyDoc'),
        row('document_ocr', sources.platform === 'darwin' ? 'unverified' : 'manual', sources.platform === 'darwin'
            ? 'Il fallback PDF è previsto su Mac. Motore, limiti e risultato vengono verificati durante la lettura; le immagini singole restano manuali.'
            : 'Il fallback Apple Vision non è qualificato su questa piattaforma. Le scansioni richiedono revisione manuale.', 'Apple Vision'),
    ];
    for (const id of ['patient_insight', 'smart_import', 'document_synthesis'] as const) {
        const result = generativeState(sources.enabled[id], sources.ollamaLifecycle, sources.clinicalBinding.state);
        functions.push(row(id, result.state, result.reason, 'Ollama', sources.clinicalBinding.model));
    }
    const treatment = generativeState(sources.enabled.treatment_reasoning, sources.athenaLifecycle, sources.athenaArtifact ? 'configured' : 'invalid');
    functions.push(row('treatment_reasoning', treatment.state, treatment.reason, 'ATHENA / MLX'));
    const who: Record<FunctionStatusSources['who'], [FunctionState, string]> = {
        disabled: ['off', 'Il servizio WHO è disattivato sul server.'],
        credentials_absent: ['needs_setup', 'Mancano le credenziali WHO sul server.'],
        offline: ['blocked', 'Il collegamento di rete WHO non è abilitato.'],
        configured: ['unverified', 'Configurazione presente, ma nessuna ricerca riuscita osservata dal servizio.'],
        available: ['observed', 'Il servizio ha osservato una ricerca riuscita in questo processo. Verifica fonte e data sulla singola ricerca.'],
        unavailable: ['blocked', 'L’ultimo tentativo del servizio non è riuscito. Controlla la connessione e riprova.'],
    };
    functions.push(row('icd11', ...who[sources.who], 'WHO ICD API'));
    return Object.freeze({ schemaVersion: FUNCTION_STATUS_SCHEMA, checkedAt, check: 'configuration_only', functions: Object.freeze(functions) });
}

/* @Codex: reject incomplete snapshots instead of presenting missing rows as off. */
export function parseFunctionStatus(value: unknown): FunctionStatusSnapshot {
    if (!value || typeof value !== 'object') throw new Error('Invalid function status');
    const data = value as Partial<FunctionStatusSnapshot>;
    if (data.schemaVersion !== FUNCTION_STATUS_SCHEMA || data.check !== 'configuration_only'
        || typeof data.checkedAt !== 'string' || new Date(data.checkedAt).toISOString() !== data.checkedAt
        || !Array.isArray(data.functions) || data.functions.length !== FUNCTION_IDS.length) throw new Error('Invalid function status');
    const seen = new Set<string>();
    for (const item of data.functions) {
        if (!item || typeof item !== 'object' || !FUNCTION_IDS.includes(item.id)
            || !Object.hasOwn(FUNCTION_STATE_LABELS, item.state) || seen.has(item.id)
            || typeof item.reason !== 'string' || item.reason.length > 600
            || typeof item.provider !== 'string' || item.provider.length > 80
            || (item.model !== null && (typeof item.model !== 'string' || new TextEncoder().encode(item.model).byteLength > OLLAMA_LOCAL_MODEL_REFERENCE_MAX_UTF8_BYTES))
            || item.lastExecutionAt !== null) throw new Error('Invalid function status');
        seen.add(item.id);
    }
    return data as FunctionStatusSnapshot;
}
