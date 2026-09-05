// @Codex MF085-003: pure input contract shared by UI and the write boundary.
export interface ScaleQuestion {
    id: string;
    text: string;
    type: 'boolean' | 'choice' | 'number' | 'text';
    options?: { label: string; value: number }[];
    minScore?: number;
    maxScore?: number;
    optional?: boolean;
}

export interface ScaleInstrumentProvenance {
    instrumentId: string;
    instrumentVersion: string;
    definitionVersion: string;
    sourceId: string;
    sourceUrl: string;
    sourceDocumentVersion: string;
    language: string;
    translationStatus: string;
    riskClassification: string;
}

export type ScaleAnswers = Record<string, string | number>;
export interface ScaleDefinition {
    id: string;
    title: string;
    description: string;
    questions: ScaleQuestion[];
    instrument?: ScaleInstrumentProvenance;
    retired?: boolean;
    scoringLogic: (answers: ScaleAnswers) => number;
    interpretation: (score: number) => string;
}
export interface ScaleResult {
    score: number;
    answers: ScaleAnswers;
    interpretation: string;
}

export class ScaleValidationError extends Error {
    constructor(public readonly issues: readonly string[]) {
        super('Valutazione non completa o non valida. Verificare le risposte prima di inviare.');
        this.name = 'ScaleValidationError';
    }
}

export function isScaleAnswerValid(question: ScaleQuestion, value: unknown, present = true): boolean {
    if (!present) return question.optional === true;
    if (question.type === 'text') {
        return typeof value === 'string' && (question.optional === true || value.trim().length > 0);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (question.type === 'boolean') return value === 0 || value === 1;
    if (question.type === 'choice') return question.options?.some(option => option.value === value) === true;
    // Number questions need an explicit finite upper bound; blank is never zero.
    return typeof question.maxScore === 'number' && Number.isFinite(question.maxScore)
        && value >= (question.minScore ?? 0) && value <= question.maxScore;
}

export function validateScaleAnswers(definition: ScaleDefinition, input: unknown): asserts input is ScaleAnswers {
    if (definition.retired) throw new ScaleValidationError(['retired-instrument']);
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        throw new ScaleValidationError(['answer-object-required']);
    }
    const answers = input as Record<string, unknown>;
    const ids = new Set(definition.questions.map(question => question.id));
    const issues: string[] = [];
    if (!ids.size || ids.size !== definition.questions.length) issues.push('invalid-definition');
    for (const key of Reflect.ownKeys(answers)) {
        if (typeof key !== 'string' || !ids.has(key)) issues.push(`unknown:${String(key)}`);
    }
    for (const question of definition.questions) {
        const present = Object.prototype.hasOwnProperty.call(answers, question.id);
        if (!isScaleAnswerValid(question, answers[question.id], present)) {
            issues.push(`${present ? 'invalid' : 'missing'}:${question.id}`);
        }
    }
    if (issues.length) throw new ScaleValidationError(issues);
}

export function withValidatedScoring(definition: ScaleDefinition): ScaleDefinition {
    // @Codex: immutable catalog snapshots prevent accidental domain/provenance drift after binding.
    const questions = definition.questions.map(question => {
        const options = question.options?.map(option => Object.freeze({ ...option }));
        if (options) Object.freeze(options);
        return Object.freeze({ ...question, options });
    });
    Object.freeze(questions);
    const stable = {
        ...definition, questions,
        ...(definition.instrument ? { instrument: Object.freeze({ ...definition.instrument }) } : {}),
    };
    const scoreAnswers = definition.scoringLogic;
    return Object.freeze({
        ...stable,
        scoringLogic: (answers: ScaleAnswers) => {
            validateScaleAnswers(stable, answers);
            const score = scoreAnswers(answers);
            if (!Number.isFinite(score)) throw new ScaleValidationError(['invalid-total']);
            return score;
        },
    });
}

export function calculateScaleResult(definition: ScaleDefinition, input: unknown): ScaleResult {
    validateScaleAnswers(definition, input);
    const answers = { ...input };
    const score = definition.scoringLogic(answers);
    if (!Number.isFinite(score)) throw new ScaleValidationError(['invalid-total']);
    return { score, answers, interpretation: definition.interpretation(score) };
}
