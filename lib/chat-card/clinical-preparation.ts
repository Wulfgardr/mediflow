import 'server-only';
import { evidenceHash } from '../ai-redaction-evidence';
import { createGlinerRedactionRunner, readGlinerRuntimeObservation } from '../gliner-redaction-runner';
import type { PreparedContentRead, PreparationRunnerConfiguration } from '../ai-preparation/preparation-core';
import { clinicalIdentifierSpans, ClinicalRowDenied, type KnownClinicalIdentifiers } from './clinical-identifiers';
import { clinicalSchema, type ClinicalProfile } from './clinical-profile';
import { isClosedClinicalTerm } from './clinical-terms';

export type ClinicalPreparedRead = Readonly<Pick<PreparedContentRead, 'payloadSha256' | 'payloadBytes' | 'payload' | 'content' | 'redactionIdentity'>>;
const records = new WeakMap<object, ClinicalPreparedRead>();
const fail = (): never => { throw new Error('clinical_card_denied'); };
export function readPreparedContent(token: unknown): ClinicalPreparedRead {
    if (!token || typeof token !== 'object') return fail();
    return records.get(token) ?? fail();
}
export function createClinicalPreparation(expected: ClinicalProfile, configuration: PreparationRunnerConfiguration,
    signal: AbortSignal, known: KnownClinicalIdentifiers) {
    const runner = createGlinerRedactionRunner(configuration);
    const token = Object.freeze(Object.create(null));
    let closed = false, closing: Promise<void> | undefined;
    function close(): Promise<void> {
        closed = true; records.delete(token); signal.removeEventListener('abort', abort);
        return closing ??= runner.close();
    }
    const abort = () => { void close().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    const guard = () => { if (closed || signal.aborted) return fail(); };
    const ready = (async () => {
        try {
            guard();
            clinicalSchema.parse(expected);
            for (const section of ['diagnoses', 'noteExcerpts'] as const) for (const [index, row] of expected[section].entries()) {
                if (clinicalIdentifierSpans(row.text, known).length) throw new ClinicalRowDenied(section, index + 1);
            }
            if (clinicalIdentifierSpans([...expected.diagnoses, ...expected.noteExcerpts].map(r => r.text).join('\n'), known).length) return fail();
            const sentinel = 'Persona: Marta Valli. Nascita: 17/04/1972.';
            const health = await runner.extract(sentinel, signal);
            guard();
            if (!['Marta Valli', '17/04/1972'].every(value => health.some(e => e.start <= sentinel.indexOf(value) && e.end >= sentinel.indexOf(value) + value.length))) return fail();
            for (const section of ['diagnoses', 'noteExcerpts'] as const) for (const [index, row] of expected[section].entries()) {
                const entities = await runner.extract(row.text, signal);
                guard();
                if (clinicalIdentifierSpans(row.text, known).length || entities.some(e => !isClosedClinicalTerm(row.text.slice(e.start, e.end)))) throw new ClinicalRowDenied(section, index + 1);
            }
            const payload = JSON.stringify(expected);
            const entities = await runner.extract(payload, signal);
            guard();
            const ranges: { start: number; end: number; section: 'diagnoses' | 'noteExcerpts'; row: number }[] = [];
            let position = payload.indexOf('"diagnoses":');
            for (const section of ['diagnoses', 'noteExcerpts'] as const) for (const [index, row] of expected[section].entries()) {
                const encoded = JSON.stringify(row.text);
                const start = payload.indexOf(encoded, position);
                if (start < 0) return fail();
                ranges.push({ start: start + 1, end: start + encoded.length - 1, section, row: index + 1 });
                position = start + encoded.length;
                if (clinicalIdentifierSpans(row.text, known).length) throw new ClinicalRowDenied(section, index + 1);
            }
            for (const e of entities) {
                const range = ranges.find(r => e.start >= r.start && e.end <= r.end);
                // Only an exact, unescaped term inside a text field can be exempted.
                if (!range || !isClosedClinicalTerm(payload.slice(e.start, e.end))) {
                    if (range) throw new ClinicalRowDenied(range.section, range.row);
                    return fail();
                }
            }
            const read: ClinicalPreparedRead = Object.freeze({ payload, payloadSha256: evidenceHash(payload), payloadBytes: Buffer.byteLength(payload),
                content: Object.freeze(JSON.parse(payload)), redactionIdentity: readGlinerRuntimeObservation(runner) });
            await runner.close(); guard();
            records.set(token, read);
            return token;
        } catch (error) {
            await close();
            throw error;
        }
    })();
    void ready.catch(() => {});
    return Object.freeze({ ready, close });
}
