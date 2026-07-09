/* @Codex */
import { AIService, type AIStats, type ChatMessage } from './ai-service';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from './athena-model-identity';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    AiTreatmentReasoningDisabledError,
    assertAiTreatmentReasoningEnabledValue,
} from './ai-treatment-reasoning-kill-switch';
import { db, type Attachment, type ClinicalEntry, type Observation, type Patient, type Therapy } from './db';
import {
    buildTreatmentReasoningPrompt,
    parseTreatmentReasoningResponse,
    type TreatmentReasoningEnvelope,
    type TreatmentReasoningParseResult,
} from './treatment-reasoning-contract';
import {
    buildTreatmentReasoningContextBundle,
    type TreatmentReasoningContextBundle,
} from './treatment-reasoning-context';

interface TreatmentReasoningPatientData {
    patient: Patient;
    entries: ClinicalEntry[];
    therapies: Therapy[];
    observations: Observation[];
    attachments: Attachment[];
}

export interface TreatmentReasoningModelInfo {
    provider: string;
    model: string;
    runtimeArtifact?: string;
    quantizationBits?: number;
}

export interface TreatmentReasoningDraft {
    generatedAt: string;
    model: TreatmentReasoningModelInfo;
    sourceSummary: TreatmentReasoningContextBundle['sourceSummary'];
    sources: TreatmentReasoningContextBundle['sources'];
    envelope: TreatmentReasoningEnvelope;
    parse: Pick<TreatmentReasoningParseResult, 'validJson' | 'validTask' | 'validEvidenceRefs'>;
    stats?: AIStats;
}

export interface TreatmentReasoningAiRuntime {
    getModelInfo(): TreatmentReasoningModelInfo;
    chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number, options?: { responseFormat?: 'json' }): Promise<{ content: string; stats?: AIStats }>;
}

export interface GenerateTreatmentReasoningOptions {
    question?: string;
    signal?: AbortSignal;
    now?: Date;
    maxTokens?: number;
}

export interface TreatmentReasoningServiceDeps {
    getKillSwitchValue?: () => Promise<unknown>;
    loadPatientData?: (patientId: string) => Promise<TreatmentReasoningPatientData>;
    createAI?: () => Promise<TreatmentReasoningAiRuntime>;
}

class AthenaMlxBrowserRuntime implements TreatmentReasoningAiRuntime {
    getModelInfo(): TreatmentReasoningModelInfo {
        return {
            provider: 'athena_mlx',
            model: ATHENA_R1_QWEN3_8B_MODEL_ID,
        };
    }

    async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number): Promise<{ content: string; stats?: AIStats }> {
        const prompt = messages
            .map((message) => (typeof message.content === 'string' ? message.content : ''))
            .filter(Boolean)
            .join('\n\n');
        const response = await fetch('/api/system/treatment-reasoning/athena-mlx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                // Omit maxTokens unless the caller sets one: the route resolves the
                // server-side default and the MEDIFLOW_ATHENA_MAX_TOKENS override.
                ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
            }),
            signal,
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new AiTreatmentReasoningDisabledError();
            }
            // The server payload can carry runtime internals (local paths, exit
            // codes): keep the UI-facing message honest but redacted.
            throw new Error(`Runtime ATHENA locale non disponibile (HTTP ${response.status}). Dettagli nel log del server locale.`);
        }

        const payload = await response.json() as {
            content?: string;
            latencyMs?: number;
        };

        return {
            content: payload.content || '',
            stats: {
                latency: payload.latencyMs ?? 0,
                tokensIn: 0,
                tokensOut: 0,
            },
        };
    }
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function withRuntimeTrace(
    envelope: TreatmentReasoningEnvelope,
    model: TreatmentReasoningModelInfo,
    parse: TreatmentReasoningDraft['parse'],
): TreatmentReasoningEnvelope {
    const limitations = [
        ...envelope.data.trace.limitations,
        !parse.validJson ? 'La risposta del modello non era JSON valido: usare solo come fallimento di controllo.' : '',
        !parse.validTask ? 'La risposta non ha dichiarato lo schema mediflow.treatment_reasoning.v1.' : '',
        !parse.validEvidenceRefs ? 'Una o piu citazioni del modello non corrispondevano alle fonti ammesse.' : '',
    ];

    return {
        ...envelope,
        data: {
            ...envelope.data,
            trace: {
                ...envelope.data.trace,
                mode: 'local_model',
                model: model.model,
                toolsUsed: uniqueStrings(envelope.data.trace.toolsUsed),
                limitations: uniqueStrings(limitations),
            },
        },
    };
}

async function defaultGetKillSwitchValue(): Promise<unknown> {
    return (await db.settings.get(AI_TREATMENT_REASONING_KILL_SWITCH_KEY))?.value;
}

async function defaultLoadPatientData(patientId: string): Promise<TreatmentReasoningPatientData> {
    const [patient, entries, therapies, observations, attachments] = await Promise.all([
        db.patients.get(patientId),
        db.entries.query({ patientId, includeDeleted: true }).toArray(),
        db.therapies.query({ patientId, includeDeleted: true }).toArray(),
        db.observations.query({ patientId }).toArray(),
        db.attachments.query({ patientId }).toArray(),
    ]);

    if (!patient) {
        throw new Error('Paziente non trovato');
    }

    return {
        patient,
        entries,
        therapies,
        observations,
        attachments,
    };
}

async function defaultCreateAI(): Promise<TreatmentReasoningAiRuntime> {
    if (typeof window !== 'undefined') {
        return new AthenaMlxBrowserRuntime();
    }
    return AIService.create('reasoning');
}

export async function generateTreatmentReasoningDraftFromContext(
    context: TreatmentReasoningContextBundle,
    ai: TreatmentReasoningAiRuntime,
    options: Pick<GenerateTreatmentReasoningOptions, 'signal' | 'maxTokens'> = {},
): Promise<TreatmentReasoningDraft> {
    if (context.sources.length === 0) {
        throw new Error('Nessuna sorgente disponibile per il ragionamento terapeutico');
    }

    const model = ai.getModelInfo();
    const prompt = buildTreatmentReasoningPrompt(context);
    const result = await ai.chat(
        [{ role: 'user', content: prompt }],
        options.signal,
        options.maxTokens,
        { responseFormat: 'json' },
    );
    const parsed = parseTreatmentReasoningResponse(result.content, {
        allowedEvidenceIds: context.sources.map((source) => source.id),
    });
    const parse = {
        validJson: parsed.validJson,
        validTask: parsed.validTask,
        validEvidenceRefs: parsed.validEvidenceRefs,
    };

    return {
        generatedAt: new Date().toISOString(),
        model,
        sourceSummary: context.sourceSummary,
        sources: context.sources,
        envelope: withRuntimeTrace(parsed.value, model, parse),
        parse,
        stats: result.stats,
    };
}

export async function generatePatientTreatmentReasoningDraft(
    patientId: string,
    options: GenerateTreatmentReasoningOptions = {},
    deps: TreatmentReasoningServiceDeps = {},
): Promise<TreatmentReasoningDraft> {
    const killSwitchValue = deps.getKillSwitchValue
        ? await deps.getKillSwitchValue()
        : await defaultGetKillSwitchValue();
    assertAiTreatmentReasoningEnabledValue(killSwitchValue);

    const data = deps.loadPatientData
        ? await deps.loadPatientData(patientId)
        : await defaultLoadPatientData(patientId);
    const context = buildTreatmentReasoningContextBundle({
        ...data,
        question: options.question,
        now: options.now,
    });
    const ai = deps.createAI ? await deps.createAI() : await defaultCreateAI();

    return generateTreatmentReasoningDraftFromContext(context, ai, options);
}
