/* @Codex */
import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { evaluateEgress } from './ai-egress-gate';
import type { RedactionEntityType } from './redaction-contracts';

export type RedactionSessionEntity = Readonly<{
    type: RedactionEntityType;
    start: number;
    end: number;
    text: string;
    confidence: number;
}>;

export interface RedactionSessionInput {
    readonly text: string;
    readonly entities: readonly RedactionSessionEntity[];
    readonly knownIdentifiers?: {
        readonly names?: readonly string[];
        readonly birthDates?: readonly string[];
    };
}

export interface PreparedRedaction {
    readonly redactedText: string;
    readonly spans: readonly Readonly<Span & { replacement: string }>[];
    /** Counts of merged occurrences, not unique values or runner detections. */
    readonly entityCounts: Readonly<Partial<Record<RedactionEntityType, number>>>;
    readonly rehydrate: (output: string) => string;
}

const ENTITY_TYPES = {
    person: true, date: true, phone: true, address: true, tax_id: true,
    email: true, organization: true, identifier: true, other: true,
} satisfies Record<RedactionEntityType, true>;
const NAMESPACE = '{{MF_PII_';
type Span = { start: number; end: number; type: RedactionEntityType };

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitsSurrogate(text: string, offset: number): boolean {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

// Inspect descriptors only after rejecting proxies. Never read caller-owned
// properties or iterators; validation and Layer 1 consume this local snapshot.
function dataProperties(value: unknown, array = false): Record<string, PropertyDescriptor> {
    if (!value || typeof value !== 'object' || types.isProxy(value)
        || Array.isArray(value) !== array) throw new Error('Invalid redaction data object');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
        if (!Object.hasOwn(descriptor, 'value')) throw new Error('Invalid redaction accessor');
    }
    return descriptors;
}

function dataValue(properties: Record<string, PropertyDescriptor>, key: string): unknown {
    return Object.getOwnPropertyDescriptor(properties, key)?.value.value;
}

function arraySnapshot(value: unknown, maximum: number): unknown[] {
    const properties = dataProperties(value, true);
    const length = dataValue(properties, 'length');
    if (typeof length !== 'number' || length > maximum) throw new Error('Invalid redaction array');
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(properties, String(index))) throw new Error('Invalid sparse redaction array');
        result.push(dataValue(properties, String(index)));
    }
    return result;
}

function snapshot(value: RedactionSessionInput): RedactionSessionInput {
    const properties = dataProperties(value);
    const entities = arraySnapshot(dataValue(properties, 'entities'), 512).map(value => {
        const fields = dataProperties(value);
        return {
            type: dataValue(fields, 'type'), start: dataValue(fields, 'start'),
            end: dataValue(fields, 'end'), text: dataValue(fields, 'text'),
            confidence: dataValue(fields, 'confidence'),
        };
    });
    const known = dataValue(properties, 'knownIdentifiers');
    let knownIdentifiers: RedactionSessionInput['knownIdentifiers'];
    if (known !== undefined) {
        const fields = dataProperties(known);
        const strings = (key: string): string[] | undefined => {
            const value = dataValue(fields, key);
            if (value === undefined) return undefined;
            return arraySnapshot(value, 64).map(entry => {
                if (typeof entry !== 'string' || entry.length > 256) throw new Error('Invalid known identifier');
                return entry;
            });
        };
        knownIdentifiers = { names: strings('names'), birthDates: strings('birthDates') };
    }
    // Primitive field types and span semantics are checked by validate below.
    return { text: dataValue(properties, 'text'), entities, knownIdentifiers } as RedactionSessionInput;
}

function validate(input: RedactionSessionInput): Span[] {
    if (!input || typeof input.text !== 'string' || input.text.length > 12000
        || input.text.includes(NAMESPACE) || !Array.isArray(input.entities)
        || input.entities.length > 512) throw new Error('Invalid redaction input');
    const spans: Span[] = [];
    for (const entity of input.entities) {
        if (!entity || typeof entity.type !== 'string'
            || !Object.hasOwn(ENTITY_TYPES, entity.type)
            || !Number.isInteger(entity.start) || !Number.isInteger(entity.end)
            || entity.start < 0 || entity.start >= entity.end || entity.end > input.text.length
            || splitsSurrogate(input.text, entity.start) || splitsSurrogate(input.text, entity.end)
            || typeof entity.text !== 'string' || input.text.slice(entity.start, entity.end) !== entity.text
            || typeof entity.confidence !== 'number' || !Number.isFinite(entity.confidence)
            || entity.confidence < 0 || entity.confidence > 1) throw new Error('Invalid redaction entity');
        spans.push({ start: entity.start, end: entity.end, type: entity.type });
    }
    if (input.knownIdentifiers !== undefined) {
        if (!input.knownIdentifiers || typeof input.knownIdentifiers !== 'object'
            || Array.isArray(input.knownIdentifiers)) throw new Error('Invalid known identifiers');
        for (const values of [input.knownIdentifiers.names, input.knownIdentifiers.birthDates]) {
            if (values !== undefined && (!Array.isArray(values)
                || Array.from(values).some(value => typeof value !== 'string'))) {
                throw new Error('Invalid known identifiers');
            }
        }
    }
    return spans;
}

function layerOneType(token: string): RedactionEntityType {
    if (/^\{\{CF(?:_CANDIDATO)?_/.test(token)) return 'tax_id';
    if (token.startsWith('{{DATA_NASCITA_')) return 'date';
    if (token.startsWith('{{PERSONA_')) return 'person';
    if (token.startsWith('{{TELEFONO_')) return 'phone';
    if (token.startsWith('{{EMAIL_')) return 'email';
    return 'identifier';
}

function mergeSpans(text: string, spans: Span[]): Span[] {
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
    // Resolve exact-range specificity before merging partial overlaps, so the
    // result does not depend on the ordering of duplicate neural detections.
    const exact: Span[] = [];
    for (const span of spans) {
        const previous = exact[exact.length - 1];
        if (previous && previous.start === span.start && previous.end === span.end) {
            if (previous.type !== span.type) {
                previous.type = (previous.type === 'tax_id' && span.type === 'identifier')
                    || (previous.type === 'identifier' && span.type === 'tax_id') ? 'tax_id' : 'other';
            }
        } else exact.push({ ...span });
    }
    const merged: Span[] = [];
    for (const span of exact) {
        const previous = merged[merged.length - 1];
        const adjacentAddress = previous?.type === 'address' && span.type === 'address'
            && /^[\s,]{1,3}$/u.test(text.slice(previous.end, span.start));
        if (previous && (span.start < previous.end || adjacentAddress)) {
            previous.end = Math.max(previous.end, span.end);
            if (previous.type !== span.type) previous.type = 'other';
        } else merged.push({ ...span });
    }
    return merged;
}

// Server-side RAM composition only: this object grants no admission or egress.
export function createRedactionSession(): Readonly<{
    prepare: (input: RedactionSessionInput) => PreparedRedaction;
    close: () => void;
}> {
    const nonce = randomBytes(16).toString('hex');
    const tokensByValue = new Map<string, string>();
    const preparations = new Set<Map<string, string>>();
    let closed = false;
    const assertOpen = () => {
        if (closed) throw new Error('Redaction session closed');
    };
    return Object.freeze({
        prepare(rawInput: RedactionSessionInput): PreparedRedaction {
            assertOpen();
            if (preparations.size >= 64) throw new Error('Redaction preparation budget exceeded');
            const input = snapshot(rawInput);
            const spans = validate(input);
            const layerOne = evaluateEgress({
                text: input.text, lane: 'clinical',
                knownIdentifiers: input.knownIdentifiers ? {
                    names: input.knownIdentifiers.names ? [...input.knownIdentifiers.names] : undefined,
                    birthDates: input.knownIdentifiers.birthDates ? [...input.knownIdentifiers.birthDates] : undefined,
                } : undefined,
            });
            for (const [token, value] of layerOne.rehydrationMap ?? []) {
                if (!value) continue;
                // Layer 1 coalesces case variants; locate all of them on the
                // original text, including overlapping literal occurrences.
                const pattern = new RegExp(`(?=(${escapeRegex(value)}))`, 'giu');
                for (const match of input.text.matchAll(pattern)) {
                    spans.push({ start: match.index, end: match.index + match[1].length, type: layerOneType(token) });
                }
            }
            const merged = mergeSpans(input.text, spans);
            const newValues = new Set(merged.map(span => input.text.slice(span.start, span.end))
                .filter(value => !tokensByValue.has(value)));
            if (tokensByValue.size + newValues.size > 4096) throw new Error('Redaction value budget exceeded');
            const values = new Map<string, string>();
            const entityCounts: Partial<Record<RedactionEntityType, number>> = {};
            const metadata: Readonly<Span & { replacement: string }>[] = [];
            let redactedText = '';
            let cursor = 0;
            for (const span of merged) {
                const raw = input.text.slice(span.start, span.end);
                const key = raw;
                let token = tokensByValue.get(key);
                if (!token) {
                    token = `${NAMESPACE}${nonce}_${tokensByValue.size + 1}}}`;
                    tokensByValue.set(key, token);
                }
                // Exact raw identity preserves every original Unicode spelling.
                if (!values.has(token)) values.set(token, raw);
                entityCounts[span.type] = (entityCounts[span.type] ?? 0) + 1;
                metadata.push(Object.freeze({ ...span, replacement: token }));
                redactedText += input.text.slice(cursor, span.start) + token;
                cursor = span.end;
            }
            redactedText += input.text.slice(cursor);
            preparations.add(values);
            const pattern = values.size ? new RegExp([...values.keys()].map(escapeRegex).join('|'), 'g') : null;
            return Object.freeze({
                redactedText,
                spans: Object.freeze(metadata),
                entityCounts: Object.freeze(entityCounts),
                rehydrate(output: string): string {
                    assertOpen();
                    if (typeof output !== 'string') throw new Error('Invalid redaction output');
                    return pattern ? output.replace(pattern, token => values.get(token)!) : output;
                },
            });
        },
        close(): void {
            closed = true;
            tokensByValue.clear();
            for (const values of preparations) values.clear();
            preparations.clear();
        },
    });
}
