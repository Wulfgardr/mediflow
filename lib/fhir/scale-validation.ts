import type { FhirClinicalEntryInput } from './types';

export class FhirScaleScoreError extends Error {
    readonly code = 'INVALID_SCALE_SCORE';
    readonly severity = 'error';

    constructor(public readonly recordId: string) {
        super('INVALID_SCALE_SCORE');
        this.name = 'FhirScaleScoreError';
    }
}

export class FhirScaleTitleError extends Error {
    readonly code = 'INVALID_SCALE_TITLE';
    readonly severity = 'error';

    constructor(public readonly recordId: string) {
        super('INVALID_SCALE_TITLE');
        this.name = 'FhirScaleTitleError';
    }
}

function toIntegerScaleScore(score: unknown): number | null {
    if (typeof score === 'number') {
        return Number.isInteger(score) && score >= -2147483648 && score <= 2147483647 ? score : null;
    }
    if (typeof score !== 'string' || !/^-?\d+$/.test(score.trim())) return null;
    const integer = BigInt(score.trim());
    return integer >= BigInt(-2147483648) && integer <= BigInt(2147483647) ? Number(integer) : null;
}

export function validateFhirScaleEntry(entry: FhirClinicalEntryInput): number {
    const score = toIntegerScaleScore(entry.metadata?.score);
    if (score === null) throw new FhirScaleScoreError(entry.id);
    const title = entry.metadata?.title;
    if (typeof title !== 'string' || title.trim() === '') throw new FhirScaleTitleError(entry.id);
    return score;
}
