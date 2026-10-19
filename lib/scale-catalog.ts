/** ADR0153: serializable descriptors; all calculation remains in scale-submission. */
import { createHash } from 'node:crypto';
import { SCALES } from './scale-definitions';
import { SCALE_USE_CONTRACTS } from './scales/scale-use-contract';

// Bump when scoring, validation or canonical submission semantics change.
export const SCALE_PREPARATION_VERSION = 'mediflow.scales.prepare.v1';
export const SCALE_PREPARATION_MAX_BYTES = 64 * 1024;

function activeScaleDescriptors() {
    return Object.freeze(Object.values(SCALES).map(definition => {
        const useContract = SCALE_USE_CONTRACTS[definition.id as keyof typeof SCALE_USE_CONTRACTS];
        if (definition.retired || !useContract || !definition.questions.length) throw new Error('Scale catalog unavailable');
        const questions = Object.freeze(definition.questions.map(question => {
            if (question.type !== 'choice' || question.optional || !question.options?.length
                || question.options.some(option => !Number.isFinite(option.value))) throw new Error('Scale catalog unavailable');
            return Object.freeze({ id: question.id, text: question.text, type: 'choice' as const,
                options: Object.freeze(question.options.map(option => Object.freeze({ label: option.label, value: option.value }))) });
        }));
        return Object.freeze({ id: definition.id, title: definition.title, description: definition.description, questions,
            ...(definition.instrument ? { instrument: Object.freeze({ ...definition.instrument }) } : {}),
            useContract });
    }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function createScaleCatalog() {
    const content = { contractVersion: 1 as const, preparationVersion: SCALE_PREPARATION_VERSION, scales: activeScaleDescriptors() };
    const catalogRevision = `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
    return Object.freeze({ ...content, catalogRevision });
}

export type ScaleCatalog = ReturnType<typeof createScaleCatalog>;
let catalog: ScaleCatalog | undefined;

export function readScaleCatalog(): ScaleCatalog {
    return catalog ??= createScaleCatalog();
}
