// @Codex MF085-003: production write seam; never trust a caller-supplied total or interpretation.
import { SCALES } from './scale-definitions';
import { calculateScaleResult, ScaleValidationError } from './scale-validation';

export function prepareScaleSubmission(scaleId: string, answers: unknown) {
    const definition = Object.prototype.hasOwnProperty.call(SCALES, scaleId) ? SCALES[scaleId] : undefined;
    if (!definition || definition.retired) throw new ScaleValidationError(['inactive-instrument']);
    const result = calculateScaleResult(definition, answers);
    const metadata = {
        title: definition.title,
        scaleId: definition.id,
        score: result.score,
        interpretation: result.interpretation,
        answers: result.answers,
        ...(definition.instrument ? { instrument: { ...definition.instrument } } : {}),
    };
    return {
        title: definition.title,
        content: `Valutazione ${definition.title} completata.\nPunteggio: ${result.score}\nInterpretazione: ${result.interpretation}`,
        metadata,
    };
}

export type PreparedScaleSubmission = ReturnType<typeof prepareScaleSubmission>;

export async function submitScale<T>(
    scaleId: string,
    answers: unknown,
    write: (submission: PreparedScaleSubmission) => T | Promise<T>,
): Promise<T> {
    // All validation and metadata creation finish before the first possible clinical write.
    const submission = prepareScaleSubmission(scaleId, answers);
    return await write(submission);
}
