/* @Codex */
export const TREATMENT_REASONING_SCHEMA_VERSION = 'mediflow.treatment_reasoning.v1';

/* @Codex */
export type TreatmentReasoningTaskKind = 'treatment_reasoning';

/* @Codex */
export type TreatmentReasoningEvidenceSourceKind =
    | 'patient-profile'
    | 'diagnosis'
    | 'therapy'
    | 'observation'
    | 'clinical-entry'
    | 'document-insight'
    | 'attachment-evidence'
    | 'clinician-question'
    | 'external-tool-trace';

/* @Codex */
export type TreatmentReasoningActionIntent =
    | 'no_action'
    | 'review_only'
    | 'open_therapy_form_prefill'
    | 'open_monitoring_form_prefill'
    | 'open_diagnosis_review';

/* @Codex */
export type TreatmentReasoningWritePolicy = 'no_write' | 'review_only' | 'form_prefill_only';

/* @Codex */
export type TreatmentReasoningSafetySeverity = 'info' | 'caution' | 'urgent_review';

/* @Codex */
export interface TreatmentReasoningEvidenceRef {
    id: string;
    sourceKind: TreatmentReasoningEvidenceSourceKind;
    label: string;
    excerpt?: string;
    date?: string;
}

/* @Codex */
export interface TreatmentReasoningKeyEvidence {
    id: string;
    statement: string;
    evidenceRefs: string[];
}

/* @Codex */
export interface TreatmentReasoningSafetyFlag {
    id: string;
    severity: TreatmentReasoningSafetySeverity;
    label: string;
    rationale: string;
    evidenceRefs: string[];
}

/* @Codex */
export interface TreatmentReasoningSuggestedAction {
    id: string;
    intent: TreatmentReasoningActionIntent;
    label: string;
    rationale: string;
    writePolicy: TreatmentReasoningWritePolicy;
    evidenceRefs: string[];
    prefill?: Record<string, unknown>;
    blockedReason?: string;
}

/* @Codex */
export interface TreatmentReasoningTrace {
    mode: 'local_contract' | 'local_model' | 'athena_sidecar' | 'imported_shadow';
    model?: string;
    toolsUsed: string[];
    limitations: string[];
}

/* @Codex */
export interface TreatmentReasoningOutput {
    recommendation: string;
    keyEvidence: TreatmentReasoningKeyEvidence[];
    reasoning: string[];
    caveats: string[];
    safetyFlags: TreatmentReasoningSafetyFlag[];
    suggestedActions: TreatmentReasoningSuggestedAction[];
    trace: TreatmentReasoningTrace;
}

/* @Codex */
export interface TreatmentReasoningEnvelope {
    schemaVersion: typeof TREATMENT_REASONING_SCHEMA_VERSION;
    task: TreatmentReasoningTaskKind;
    summary: string;
    data: TreatmentReasoningOutput;
}

/* @Codex */
export interface TreatmentReasoningParseOptions {
    allowedEvidenceIds?: string[];
}

/* @Codex */
export interface TreatmentReasoningParseResult {
    value: TreatmentReasoningEnvelope;
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    validEvidenceRefs: boolean;
}

/* @Codex */
export interface TreatmentReasoningPromptInput {
    question: string;
    patientContext: string;
    activeTherapies?: string[];
    diagnoses?: string[];
    observations?: string[];
    sources: TreatmentReasoningEvidenceRef[];
}

const MAX_TEXT_CHARS = 400;
const MAX_RECOMMENDATION_CHARS = 900;
const MAX_REASONING_ITEMS = 8;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_ACTIONS = 8;
const MAX_SAFETY_FLAGS = 8;

const DEFAULT_TRACE: TreatmentReasoningTrace = {
    mode: 'local_contract',
    toolsUsed: [],
    limitations: [],
};

function emptyOutput(): TreatmentReasoningOutput {
    return {
        recommendation: '',
        keyEvidence: [],
        reasoning: [],
        caveats: [],
        safetyFlags: [],
        suggestedActions: [],
        trace: { ...DEFAULT_TRACE },
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function normalizeCompactText(value: unknown, maxChars = MAX_TEXT_CHARS): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars)
        .trim();
}

function normalizeStringArray(value: unknown, maxItems: number, maxChars = MAX_TEXT_CHARS): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const items: string[] = [];

    for (const entry of value) {
        const normalized = normalizeCompactText(entry, maxChars);
        if (!normalized) continue;

        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(normalized);

        if (items.length >= maxItems) break;
    }

    return items;
}

function normalizeEvidenceSourceKind(value: unknown): TreatmentReasoningEvidenceSourceKind {
    const normalized = normalizeCompactText(value, 80);
    const allowed: TreatmentReasoningEvidenceSourceKind[] = [
        'patient-profile',
        'diagnosis',
        'therapy',
        'observation',
        'clinical-entry',
        'document-insight',
        'attachment-evidence',
        'clinician-question',
        'external-tool-trace',
    ];
    return allowed.includes(normalized as TreatmentReasoningEvidenceSourceKind)
        ? normalized as TreatmentReasoningEvidenceSourceKind
        : 'clinician-question';
}

function normalizeActionIntent(value: unknown): TreatmentReasoningActionIntent {
    const normalized = normalizeCompactText(value, 80);
    const allowed: TreatmentReasoningActionIntent[] = [
        'no_action',
        'review_only',
        'open_therapy_form_prefill',
        'open_monitoring_form_prefill',
        'open_diagnosis_review',
    ];
    return allowed.includes(normalized as TreatmentReasoningActionIntent)
        ? normalized as TreatmentReasoningActionIntent
        : 'review_only';
}

function normalizeWritePolicy(value: unknown): { policy: TreatmentReasoningWritePolicy; blockedReason?: string } {
    const normalized = normalizeCompactText(value, 80);
    if (normalized === 'no_write' || normalized === 'review_only' || normalized === 'form_prefill_only') {
        return { policy: normalized };
    }

    return {
        policy: 'review_only',
        blockedReason: 'Automatic clinical writes are outside mediflow.treatment_reasoning.v1.',
    };
}

function normalizeSafetySeverity(value: unknown): TreatmentReasoningSafetySeverity {
    const normalized = normalizeCompactText(value, 80);
    if (normalized === 'info' || normalized === 'caution' || normalized === 'urgent_review') {
        return normalized;
    }
    return 'caution';
}

function normalizeTrace(value: unknown): TreatmentReasoningTrace {
    const record = asRecord(value);
    const rawMode = normalizeCompactText(record.mode, 80);
    const mode = rawMode === 'local_model' || rawMode === 'athena_sidecar' || rawMode === 'imported_shadow'
        ? rawMode
        : 'local_contract';

    return {
        mode,
        model: normalizeCompactText(record.model, 140) || undefined,
        toolsUsed: normalizeStringArray(record.toolsUsed, 20, 120),
        limitations: normalizeStringArray(record.limitations, 10, 220),
    };
}

function normalizeEvidenceRefs(
    value: unknown,
    allowedEvidenceIds: Set<string> | null
): { refs: string[]; valid: boolean } {
    const rawRefs = normalizeStringArray(value, 12, 120);
    if (!allowedEvidenceIds) {
        return { refs: rawRefs, valid: true };
    }

    const refs = rawRefs.filter((ref) => allowedEvidenceIds.has(ref));
    return { refs, valid: refs.length === rawRefs.length };
}

function stableId(prefix: string, index: number): string {
    return `${prefix}-${index + 1}`;
}

function normalizeKeyEvidence(
    value: unknown,
    index: number,
    allowedEvidenceIds: Set<string> | null
): { item: TreatmentReasoningKeyEvidence | null; validEvidenceRefs: boolean } {
    const record = asRecord(value);
    const statement = normalizeCompactText(record.statement);
    if (!statement) return { item: null, validEvidenceRefs: true };

    const normalizedRefs = normalizeEvidenceRefs(record.evidenceRefs, allowedEvidenceIds);
    return {
        item: {
            id: normalizeCompactText(record.id, 80) || stableId('evidence', index),
            statement,
            evidenceRefs: normalizedRefs.refs,
        },
        validEvidenceRefs: normalizedRefs.valid,
    };
}

function normalizeSafetyFlag(
    value: unknown,
    index: number,
    allowedEvidenceIds: Set<string> | null
): { item: TreatmentReasoningSafetyFlag | null; validEvidenceRefs: boolean } {
    const record = asRecord(value);
    const label = normalizeCompactText(record.label, 180);
    const rationale = normalizeCompactText(record.rationale);
    if (!label || !rationale) return { item: null, validEvidenceRefs: true };

    const normalizedRefs = normalizeEvidenceRefs(record.evidenceRefs, allowedEvidenceIds);
    return {
        item: {
            id: normalizeCompactText(record.id, 80) || stableId('safety', index),
            severity: normalizeSafetySeverity(record.severity),
            label,
            rationale,
            evidenceRefs: normalizedRefs.refs,
        },
        validEvidenceRefs: normalizedRefs.valid,
    };
}

function normalizeSuggestedAction(
    value: unknown,
    index: number,
    allowedEvidenceIds: Set<string> | null
): { item: TreatmentReasoningSuggestedAction | null; validEvidenceRefs: boolean } {
    const record = asRecord(value);
    const label = normalizeCompactText(record.label, 180);
    const rationale = normalizeCompactText(record.rationale);
    if (!label || !rationale) return { item: null, validEvidenceRefs: true };

    const normalizedRefs = normalizeEvidenceRefs(record.evidenceRefs, allowedEvidenceIds);
    const writePolicy = normalizeWritePolicy(record.writePolicy);
    const blockedReason = normalizeCompactText(record.blockedReason, 240) || writePolicy.blockedReason;

    return {
        item: {
            id: normalizeCompactText(record.id, 80) || stableId('action', index),
            intent: normalizeActionIntent(record.intent),
            label,
            rationale,
            writePolicy: writePolicy.policy,
            evidenceRefs: normalizedRefs.refs,
            prefill: asRecord(record.prefill),
            blockedReason,
        },
        validEvidenceRefs: normalizedRefs.valid,
    };
}

function normalizeOutput(
    value: unknown,
    allowedEvidenceIds: Set<string> | null
): { output: TreatmentReasoningOutput; validEvidenceRefs: boolean } {
    const record = asRecord(value);
    let validEvidenceRefs = true;

    const keyEvidence: TreatmentReasoningKeyEvidence[] = [];
    if (Array.isArray(record.keyEvidence)) {
        record.keyEvidence.slice(0, MAX_EVIDENCE_ITEMS).forEach((entry, index) => {
            const normalized = normalizeKeyEvidence(entry, index, allowedEvidenceIds);
            if (normalized.item) keyEvidence.push(normalized.item);
            validEvidenceRefs = validEvidenceRefs && normalized.validEvidenceRefs;
        });
    }

    const safetyFlags: TreatmentReasoningSafetyFlag[] = [];
    if (Array.isArray(record.safetyFlags)) {
        record.safetyFlags.slice(0, MAX_SAFETY_FLAGS).forEach((entry, index) => {
            const normalized = normalizeSafetyFlag(entry, index, allowedEvidenceIds);
            if (normalized.item) safetyFlags.push(normalized.item);
            validEvidenceRefs = validEvidenceRefs && normalized.validEvidenceRefs;
        });
    }

    const suggestedActions: TreatmentReasoningSuggestedAction[] = [];
    if (Array.isArray(record.suggestedActions)) {
        record.suggestedActions.slice(0, MAX_ACTIONS).forEach((entry, index) => {
            const normalized = normalizeSuggestedAction(entry, index, allowedEvidenceIds);
            if (normalized.item) suggestedActions.push(normalized.item);
            validEvidenceRefs = validEvidenceRefs && normalized.validEvidenceRefs;
        });
    }

    return {
        output: {
            recommendation: normalizeCompactText(record.recommendation, MAX_RECOMMENDATION_CHARS),
            keyEvidence,
            reasoning: normalizeStringArray(record.reasoning, MAX_REASONING_ITEMS),
            caveats: normalizeStringArray(record.caveats, MAX_REASONING_ITEMS),
            safetyFlags,
            suggestedActions,
            trace: normalizeTrace(record.trace),
        },
        validEvidenceRefs,
    };
}

function extractJsonObject(response: string): string | null {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? response;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return candidate.slice(start, end + 1);
}

/* @Codex */
export function parseTreatmentReasoningResponse(
    response: string,
    options: TreatmentReasoningParseOptions = {}
): TreatmentReasoningParseResult {
    const rawJson = extractJsonObject(response);
    const fallback: TreatmentReasoningEnvelope = {
        schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
        task: 'treatment_reasoning',
        summary: '',
        data: emptyOutput(),
    };

    if (!rawJson) {
        return {
            value: fallback,
            rawJson: null,
            validJson: false,
            validTask: false,
            validEvidenceRefs: false,
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawJson);
    } catch {
        return {
            value: fallback,
            rawJson,
            validJson: false,
            validTask: false,
            validEvidenceRefs: false,
        };
    }

    const record = asRecord(parsed);
    const validTask = record.schemaVersion === TREATMENT_REASONING_SCHEMA_VERSION
        && record.task === 'treatment_reasoning';
    const allowedEvidenceIds = options.allowedEvidenceIds
        ? new Set(options.allowedEvidenceIds)
        : null;
    const normalized = normalizeOutput(record.data, allowedEvidenceIds);

    return {
        value: {
            schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
            task: 'treatment_reasoning',
            summary: normalizeCompactText(record.summary, 300),
            data: normalized.output,
        },
        rawJson,
        validJson: true,
        validTask,
        validEvidenceRefs: normalized.validEvidenceRefs,
    };
}

function renderList(title: string, items: string[] | undefined): string {
    const normalized = normalizeStringArray(items ?? [], 20, 220);
    if (normalized.length === 0) return `${title}: none`;
    return `${title}:\n${normalized.map((item) => `- ${item}`).join('\n')}`;
}

function renderSource(source: TreatmentReasoningEvidenceRef): string {
    const date = source.date ? ` (${source.date})` : '';
    const excerpt = source.excerpt ? ` :: ${normalizeCompactText(source.excerpt, 260)}` : '';
    return `- ${source.id} [${source.sourceKind}] ${source.label}${date}${excerpt}`;
}

/* @Codex */
export function buildTreatmentReasoningPrompt(input: TreatmentReasoningPromptInput): string {
    const sources = input.sources
        .map((source) => ({
            ...source,
            id: normalizeCompactText(source.id, 120),
            sourceKind: normalizeEvidenceSourceKind(source.sourceKind),
            label: normalizeCompactText(source.label, 180),
            excerpt: normalizeCompactText(source.excerpt, 260) || undefined,
            date: normalizeCompactText(source.date, 80) || undefined,
        }))
        .filter((source) => source.id && source.label);

    return [
        'Sei una lane locale di supporto al ragionamento terapeutico di MediFlow.',
        'Non sei un prescrittore, non sei un medical device e non devi applicare modifiche alla cartella.',
        'Usa solo le fonti elencate. Se mancano dati clinici necessari, dichiaralo nei caveats.',
        'Ogni keyEvidence, safetyFlag e suggestedAction deve citare evidenceRefs esistenti.',
        'Le suggestedActions possono solo essere no_write, review_only o form_prefill_only: mai auto_apply.',
        'Mantieni l output compatto: massimo 3 keyEvidence, 3 reasoning, 4 caveats, 4 safetyFlags e 4 suggestedActions.',
        'Ogni recommendation, statement, rationale, caveat o reasoning deve essere breve: massimo 180 caratteri.',
        'Non includere markdown, testo prima/dopo il JSON, <think> o spiegazioni fuori schema.',
        '',
        `Schema richiesto: ${TREATMENT_REASONING_SCHEMA_VERSION}`,
        'Restituisci solo JSON valido con task "treatment_reasoning".',
        '',
        `Domanda clinica: ${normalizeCompactText(input.question, 500)}`,
        '',
        `Contesto paziente sintetico:\n${normalizeCompactText(input.patientContext, 1200) || 'none'}`,
        '',
        renderList('Diagnosi note', input.diagnoses),
        '',
        renderList('Terapie attive', input.activeTherapies),
        '',
        renderList('Osservazioni recenti', input.observations),
        '',
        `Fonti ammesse:\n${sources.map(renderSource).join('\n') || 'none'}`,
        '',
        'JSON shape:',
        JSON.stringify({
            schemaVersion: TREATMENT_REASONING_SCHEMA_VERSION,
            task: 'treatment_reasoning',
            summary: 'one sentence summary',
            data: {
                recommendation: 'support statement, not an order',
                keyEvidence: [{ id: 'evidence-1', statement: '...', evidenceRefs: ['src-1'] }],
                reasoning: ['...'],
                caveats: ['...'],
                safetyFlags: [{ id: 'safety-1', severity: 'caution', label: '...', rationale: '...', evidenceRefs: ['src-1'] }],
                suggestedActions: [{
                    id: 'action-1',
                    intent: 'review_only',
                    label: '...',
                    rationale: '...',
                    writePolicy: 'review_only',
                    evidenceRefs: ['src-1'],
                    prefill: {},
                }],
                trace: { mode: 'local_model', toolsUsed: [], limitations: [] },
            },
        }, null, 2),
    ].join('\n');
}
