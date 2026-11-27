import 'server-only';
import { createRedactionSession, type RedactionSessionInput } from './ai-redaction-session';
import { identityKnowledge, type ProfileIdentity } from './patient-profile-pseudonymization';
import type { AgentPatientContextInput } from './agent-local-kit-context-contract';

const PREPARATION_TEXT_LIMIT = 12_000;
const SLOT_SEPARATOR = '\n\u0001\n';
const DATE_OFFSET_REPLACEMENT = /^\[\[MF_GG[+-]/u;

export class AgentContextPseudonymizationError extends Error {
    constructor() { super('agent_context_pseudonymization_failed'); }
}

type TextMap = (value: string) => string;

function mapFreeText(context: AgentPatientContextInput, text: TextMap): AgentPatientContextInput {
    const maybe = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> =>
        value === undefined ? {} : { [key]: text(value) } as Record<K, string>;
    return {
        patient: context.patient,
        diagnoses: context.diagnoses.map(item => ({
            ...item, description: text(item.description), ...maybe('code', item.code), ...maybe('system', item.system),
        })),
        therapies: context.therapies.map(item => ({
            ...item, drugName: text(item.drugName), ...maybe('activePrinciple', item.activePrinciple), dosage: text(item.dosage),
        })),
        exemptions: context.exemptions.map(item => ({ code: text(item.code) })),
        allergies: context.allergies.map(item => ({
            ...item, substance: text(item.substance), ...maybe('reaction', item.reaction), ...maybe('severity', item.severity),
        })),
        observations: context.observations.map(item => ({
            ...item, display: text(item.display), value: text(item.value), unit: text(item.unit), ...maybe('code', item.code),
        })),
        recentNotes: context.recentNotes.map(item => ({ ...item, ...maybe('title', item.title), text: text(item.text) })),
        openCheckups: context.openCheckups.map(item => ({ ...item, title: text(item.title), ...maybe('status', item.status) })),
    };
}

type Batch = { text: string; slots: Array<{ start: number; end: number }> };

function batches(values: readonly string[]): Batch[] {
    const output: Batch[] = [];
    for (const value of values) {
        if (value.length > PREPARATION_TEXT_LIMIT) throw new AgentContextPseudonymizationError();
        let batch = output[output.length - 1];
        const joined = batch ? batch.text.length + SLOT_SEPARATOR.length + value.length : value.length;
        if (!batch || joined > PREPARATION_TEXT_LIMIT) {
            batch = { text: '', slots: [] };
            output.push(batch);
        } else batch.text += SLOT_SEPARATOR;
        const start = batch.text.length;
        batch.text += value;
        batch.slots.push({ start, end: batch.text.length });
    }
    return output;
}

function pseudonymizeTexts(values: readonly string[], known: NonNullable<RedactionSessionInput['knownIdentifiers']>): string[] {
    const session = createRedactionSession();
    try {
        return batches(values).flatMap(batch => {
            const { spans } = session.prepare({ text: batch.text, entities: [], knownIdentifiers: known });
            return batch.slots.map(slot => {
                let value = '', position = slot.start;
                for (const span of spans) {
                    if (span.end <= slot.start || span.start >= slot.end) continue;
                    if (span.start < slot.start || span.end > slot.end) throw new AgentContextPseudonymizationError();
                    const replacement = DATE_OFFSET_REPLACEMENT.test(span.replacement)
                        ? batch.text.slice(span.start, span.end) : span.replacement;
                    value += batch.text.slice(position, span.start) + replacement;
                    position = span.end;
                }
                return value + batch.text.slice(position, slot.end);
            });
        });
    } catch {
        throw new AgentContextPseudonymizationError();
    } finally {
        session.close();
    }
}

export function pseudonymizeAgentPatientContext(context: AgentPatientContextInput, identity: ProfileIdentity): AgentPatientContextInput {
    let known: NonNullable<RedactionSessionInput['knownIdentifiers']>;
    try { known = identityKnowledge(identity); } catch { throw new AgentContextPseudonymizationError(); }
    const values: string[] = [];
    mapFreeText(context, value => { values.push(value); return value; });
    const released = pseudonymizeTexts(values, known);
    let next = 0;
    return mapFreeText(context, () => released[next++]!);
}
