import { createHash, randomBytes, randomInt } from 'node:crypto';
import { types } from 'node:util';
import { evaluateEgress } from './ai-egress-gate';
import type { RedactionEntityType } from './redaction-contracts';
import { localIdentifierSpans } from './redaction-identifier-spans';
import { ANCHOR_SPREAD_DAYS, birthDateDays, clinicalDateDay, dayFromOffset, followsBirthCue, formatDay, inClinicalWindow, isoDay, nameWords, offsetFromAnchor, registryNameWords, writtenDateDay } from './redaction-date-offsets';

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
        readonly identifiers?: readonly string[];
    };
}

export interface PreparedRedaction {
    readonly redactedText: string;
    readonly spans: readonly PreparedSpan[];
    /** Counts of merged occurrences, not unique values or runner detections. */
    readonly entityCounts: Readonly<Partial<Record<RedactionEntityType, number>>>;
    readonly rehydrate: (output: string) => string;
}

const ENTITY_TYPES = {
    person: true, date: true, phone: true, address: true, tax_id: true,
    email: true, organization: true, identifier: true, other: true,
} satisfies Record<RedactionEntityType, true>;
const ROLE_BY_TYPE = {
    person: 'PER', date: 'DAT', phone: 'TEL', address: 'IND', tax_id: 'CF',
    email: 'EML', organization: 'ORG', identifier: 'ID', other: 'ALT',
} as const satisfies Record<RedactionEntityType, string>;
type NamedRole = (typeof ROLE_BY_TYPE)[RedactionEntityType] | 'PAZ' | 'NAS';
export type PlaceholderRole = NamedRole | 'GG';
export const PLACEHOLDER_PATTERN = /\[\[MF_(?:(PAZ|PER|DAT|NAS|TEL|IND|CF|EML|ORG|ID|ALT)([1-9][0-9]{0,3})|GG(\+0|[+-][1-9][0-9]{0,4}))_([a-z2-7]{8})\]\]/gu;
const DATE_OFFSET_PLACEHOLDER = /^\[\[MF_GG(\+0|[+-][1-9][0-9]{0,4})_([a-z2-7]{8})\]\]$/u;
export const RESERVED_PLACEHOLDER_NAMESPACE = /\[\[\s*MF|MF_(?:PAZ|PER|DAT|NAS|TEL|IND|CF|EML|ORG|ID|ALT)\s*[0-9]|MF_GG\s*[+-]/iu;
export type ResolvedPlaceholder = Readonly<{ role: PlaceholderRole; value: string }>;
type Span = { start: number; end: number; type: RedactionEntityType };
type PreparedSpan = Readonly<{ start: number; end: number; type: RedactionEntityType; replacement: string }>;
const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const liveNonces = new Set<string>();

function nonceText(bytes: Uint8Array): string {
    let bits = 0;
    for (const byte of bytes.subarray(0, 5)) bits = bits * 256 + byte;
    let text = '';
    for (let index = 7; index >= 0; index -= 1) text += NONCE_ALPHABET[Math.floor(bits / 32 ** index) % 32];
    return text;
}

function allocateLiveNonce(): string {
    const seed = randomBytes(16);
    for (let attempt = 0; ; attempt += 1) {
        const nonce = nonceText(createHash('sha256').update(seed).update(String(attempt)).digest());
        if (!liveNonces.has(nonce)) {
            liveNonces.add(nonce);
            return nonce;
        }
    }
}

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
        knownIdentifiers = { names: strings('names'), birthDates: strings('birthDates'), identifiers: strings('identifiers') };
    }
    // Primitive field types and span semantics are checked by validate below.
    return { text: dataValue(properties, 'text'), entities, knownIdentifiers } as RedactionSessionInput;
}

function validate(input: RedactionSessionInput): Span[] {
    if (!input || typeof input.text !== 'string' || input.text.length > 12000
        || RESERVED_PLACEHOLDER_NAMESPACE.test(input.text) || !Array.isArray(input.entities)
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
        for (const values of [input.knownIdentifiers.names, input.knownIdentifiers.birthDates, input.knownIdentifiers.identifiers]) {
            if (values !== undefined && (!Array.isArray(values)
                || Array.from(values).some(value => typeof value !== 'string'))) {
                throw new Error('Invalid known identifiers');
            }
        }
    }
    return spans;
}


function layerOneSpanType(token: string): RedactionEntityType {
    if (/^\{\{CF(?:_CANDIDATO)?_/.test(token)) return 'tax_id';
    if (token.startsWith('{{DATA_NASCITA_')) return 'date';
    if (token.startsWith('{{PERSONA_')) return 'person';
    if (token.startsWith('{{TELEFONO_')) return 'phone';
    if (token.startsWith('{{EMAIL_')) return 'email';
    return 'identifier';
}

function mergeSpans(text: string, spans: Span[]): Span[] {
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
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

function roleOf(span: Span, raw: string, registryWords: ReadonlySet<string>): NamedRole {
    const words = nameWords(raw);
    return span.type === 'person' && words.length > 0 && words.every(word => registryWords.has(word)) ? 'PAZ' : ROLE_BY_TYPE[span.type];
}

function withoutNeuralDatesAroundClinicalDates(text: string, neural: Span[], local: Span[]): Span[] {
    const dates = local.filter(span => clinicalDateDay(text.slice(span.start, span.end)) !== null);
    return neural.filter(span => {
        if (span.type !== 'date') return true;
        const inside = dates.filter(date => date.start < span.end && span.start < date.end);
        if (!inside.length || inside.some(date => date.start < span.start || date.end > span.end)) return true;
        let residual = '', cursor = span.start;
        for (const date of inside.sort((a, b) => a.start - b.start)) { residual += text.slice(cursor, date.start); cursor = date.end; }
        return /[0-9]/u.test(residual + text.slice(cursor, span.end));
    });
}

export function createRedactionSession(): Readonly<{
    prepare: (input: RedactionSessionInput) => PreparedRedaction;
    resolve: (placeholder: string) => ResolvedPlaceholder;
    close: () => void;
}> {
    const nonce = allocateLiveNonce();
    const tokensByValue = new Map<string, string>();
    const valuesByToken = new Map<string, ResolvedPlaceholder>();
    const roleCounts = new Map<NamedRole, number>();
    const rawByOffset = new Map<number, string>();
    let anchor: number | undefined;
    let reference: number | undefined;
    const preparations = new Set<Map<string, string>>();
    let closed = false;
    const assertOpen = () => {
        if (closed) throw new Error('Redaction session closed');
    };
    const resolve = (placeholder: string): ResolvedPlaceholder => {
        assertOpen();
        if (typeof placeholder !== 'string') throw new Error('Unknown redaction placeholder');
        const named = valuesByToken.get(placeholder);
        if (named) return named;
        const offset = DATE_OFFSET_PLACEHOLDER.exec(placeholder);
        const day = offset && offset[2] === nonce && anchor !== undefined ? dayFromOffset(anchor, Number(offset[1])) : null;
        if (day === null || !offset) throw new Error('Unknown redaction placeholder');
        return Object.freeze({ role: 'GG', value: rawByOffset.get(Number(offset[1])) ?? formatDay(day) });
    };
    return Object.freeze({
        prepare(rawInput: RedactionSessionInput): PreparedRedaction {
            assertOpen();
            if (preparations.size >= 64) throw new Error('Redaction preparation budget exceeded');
            const input = snapshot(rawInput);
            const neural = validate(input);
            const spans: Span[] = [];
            const layerOne = evaluateEgress({
                text: input.text, lane: 'clinical',
                knownIdentifiers: input.knownIdentifiers ? {
                    names: input.knownIdentifiers.names ? [...input.knownIdentifiers.names] : undefined,
                    birthDates: input.knownIdentifiers.birthDates ? [...input.knownIdentifiers.birthDates] : undefined,
                    identifiers: input.knownIdentifiers.identifiers ? [...input.knownIdentifiers.identifiers] : undefined,
                } : undefined,
            });
            for (const [token, value] of layerOne.rehydrationMap ?? []) {
                if (!value) continue;
                const pattern = new RegExp(`(?=(${escapeRegex(value)}))`, 'giu');
                for (const match of input.text.matchAll(pattern)) {
                    spans.push({ start: match.index, end: match.index + match[1].length, type: layerOneSpanType(token) });
                }
            }
            spans.push(...localIdentifierSpans(input.text));
            for (const match of input.text.matchAll(/\b(?:luogo|indirizzo|residenza|domicilio)\s*:\s*([^\r\n;]+?)(?=\.(?:\s|$)|;|\r?\n|$)/giu)) {
                const start = match.index + match[0].lastIndexOf(match[1]);
                spans.push({ start, end: start + match[1].length, type: 'address' });
            }
            const birthDays = birthDateDays(input.knownIdentifiers?.birthDates);
            for (const day of birthDays) {
                for (const match of input.text.matchAll(new RegExp(`(?<![0-9])${isoDay(day)}(?![0-9])`, 'gu'))) {
                    spans.push({ start: match.index, end: match.index + match[0].length, type: 'date' });
                }
            }
            const merged = mergeSpans(input.text, [...withoutNeuralDatesAroundClinicalDates(input.text, neural, spans), ...spans]);
            const registryWords = registryNameWords(input.knownIdentifiers?.names);
            const dates = new Map(merged.map(span => {
                const raw = input.text.slice(span.start, span.end);
                const day = clinicalDateDay(raw);
                const written = day ?? writtenDateDay(raw);
                const birth = written !== null && (birthDays.has(written) || followsBirthCue(input.text.slice(0, span.start)));
                return [span, { day, birth }] as const;
            }));
            const clinicalDays = [...dates.values()].flatMap(({ day, birth }) => day !== null && !birth ? [day] : []);
            if (reference === undefined && clinicalDays.length) {
                reference = Math.max(...clinicalDays);
                anchor = reference + randomInt(-ANCHOR_SPREAD_DAYS, ANCHOR_SPREAD_DAYS + 1);
            }
            const newValues = new Set(merged.map(span => input.text.slice(span.start, span.end))
                .filter(value => !tokensByValue.has(value)));
            if (tokensByValue.size + newValues.size > 4096) throw new Error('Redaction value budget exceeded');
            const values = new Map<string, string>();
            const entityCounts: Partial<Record<RedactionEntityType, number>> = {};
            const metadata: PreparedSpan[] = [];
            let redactedText = '';
            let cursor = 0;
            for (const span of merged) {
                const raw = input.text.slice(span.start, span.end);
                const { day, birth } = dates.get(span)!;
                let token = tokensByValue.get(raw);
                if (token && birth && DATE_OFFSET_PLACEHOLDER.test(token)) throw new Error('Redaction birth date already offset');
                if (!token && day !== null && !birth && anchor !== undefined && reference !== undefined && inClinicalWindow(day, reference)) {
                    const offset = offsetFromAnchor(day, anchor);
                    if (offset !== null) {
                        token = `[[MF_GG${offset < 0 ? '-' : '+'}${Math.abs(offset)}_${nonce}]]`;
                        tokensByValue.set(raw, token);
                        if (!rawByOffset.has(offset)) rawByOffset.set(offset, raw);
                    }
                }
                if (!token) {
                    const role: NamedRole = birth ? 'NAS' : day !== null ? 'DAT' : roleOf(span, raw, registryWords);
                    const ordinal = (roleCounts.get(role) ?? 0) + 1;
                    roleCounts.set(role, ordinal);
                    token = `[[MF_${role}${ordinal}_${nonce}]]`;
                    tokensByValue.set(raw, token);
                    valuesByToken.set(token, Object.freeze({ role, value: raw }));
                }
                if (!values.has(token)) values.set(token, raw);
                entityCounts[span.type] = (entityCounts[span.type] ?? 0) + 1;
                metadata.push(Object.freeze({ start: span.start, end: span.end, type: span.type, replacement: token }));
                redactedText += input.text.slice(cursor, span.start) + token;
                cursor = span.end;
            }
            redactedText += input.text.slice(cursor);
            preparations.add(values);
            return Object.freeze({
                redactedText,
                spans: Object.freeze(metadata),
                entityCounts: Object.freeze(entityCounts),
                rehydrate(output: string): string {
                    assertOpen();
                    if (typeof output !== 'string') throw new Error('Invalid redaction output');
                    return output.replace(PLACEHOLDER_PATTERN, token => {
                        const own = values.get(token);
                        if (own !== undefined) return own;
                        if (!DATE_OFFSET_PLACEHOLDER.test(token)) return token;
                        try { return resolve(token).value; } catch { return token; }
                    });
                },
            });
        },
        resolve,
        close(): void {
            if (!closed) liveNonces.delete(nonce);
            closed = true;
            tokensByValue.clear();
            valuesByToken.clear();
            rawByOffset.clear();
            anchor = undefined;
            reference = undefined;
            for (const values of preparations) values.clear();
            preparations.clear();
        },
    });
}
