import { createRedactionSession, type PreparedRedaction, type RedactionSessionEntity, type RedactionSessionInput } from './ai-redaction-session';
import { ProfileQueryError, PROFILE_FIELD_NAMES, type ProfileFields, type ProfileProjection } from '../packages/patient-profile-contracts/src/query';

export type ProfileRelease = 'identified' | 'pseudonymized';
export type ReleasedProfile = ProfileFields | Readonly<{ notes: string | null }>;
export type ProfilePseudonymizer = Readonly<{
    project(source: ProfileFields, projection: ProfileProjection): ReleasedProfile;
    close(): void;
}>;

const IDENTITY_FIELDS = Object.freeze({
    firstName: 'person', lastName: 'person', taxCode: 'tax_id', birthDate: 'date',
    address: 'address', phone: 'phone', caregiver: 'person',
} as const satisfies Partial<Record<keyof ProfileFields, RedactionSessionEntity['type']>>);
type IdentityField = keyof typeof IDENTITY_FIELDS;
const FREE_TEXT_FIELDS = Object.freeze(['diagnoses', 'exemptions', 'notes', 'statusReason', 'archiveReason', 'archiveNote'] as const);
const WHOLE_PLACEHOLDER = /^\[\[MF_(?:PAZ|PER|NAS|DAT|TEL|IND|CF|EML|ORG|ID|ALT)[1-9][0-9]{0,3}_[a-z2-7]{8}\]\]$/u;
const ISO_TIMESTAMP_DAY = /^((?:19|20)[0-9]{2})-([0-9]{2})-([0-9]{2})T/u;
const PREPARATION_TEXT_LIMIT = 12_000;
const WINDOW_CONTEXT = 1_024;
const KNOWN_VALUE_LIMIT = 256;

function unavailable(): never { throw new ProfileQueryError('query_unavailable'); }

function birthDay(value: string): string {
    const day = ISO_TIMESTAMP_DAY.exec(value);
    return day ? `${day[1]}-${day[2]}-${day[3]}` : value;
}

function knownValues(values: readonly (string | null)[]): string[] {
    return [...new Set(values.flatMap(value => {
        const trimmed = value?.trim();
        if (trimmed && trimmed.length > KNOWN_VALUE_LIMIT) unavailable();
        return trimmed ? [trimmed] : [];
    }))];
}

function identityKnowledge(source: ProfileFields): NonNullable<RedactionSessionInput['knownIdentifiers']> {
    const day = source.birthDate ? ISO_TIMESTAMP_DAY.exec(source.birthDate) : null;
    return Object.freeze({
        names: knownValues([source.firstName, source.lastName]),
        birthDates: day ? [`${day[1]}-${day[2]}-${day[3]}`, `${day[3]}/${day[2]}/${day[1]}`] : knownValues([source.birthDate]),
        identifiers: knownValues([source.taxCode, source.phone, source.address, source.caregiver]),
    });
}

type PreparedSpans = PreparedRedaction['spans'];

function crossing(spans: PreparedSpans, position: number): PreparedSpans {
    return spans.filter(span => span.start < position && position < span.end);
}

function redactedOffset(spans: PreparedSpans, position: number): number {
    let shift = 0;
    for (const span of spans) if (span.end <= position) shift += span.replacement.length - (span.end - span.start);
    return position + shift;
}

function preferredCut(window: string, from: number, limit: number): number {
    for (let index = limit - 1; index > from + (limit - from) / 2; index--) {
        if (window[index] === '\n') return index + 1;
    }
    for (let index = limit - 1; index > from; index--) if (/\s/u.test(window[index]!)) return index + 1;
    const last = window.charCodeAt(limit - 1);
    return last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
}

function uncrossedCut(spans: PreparedSpans, from: number, candidate: number): number {
    let cut = candidate;
    for (let found = crossing(spans, cut); found.length && cut > from; found = crossing(spans, cut)) {
        cut = Math.min(...found.map(span => span.start));
    }
    return cut > from ? cut : unavailable();
}

export function createProfilePseudonymizer(): ProfilePseudonymizer {
    const session = createRedactionSession();
    const released = new Map<string, string>();
    let closed = false;
    const prepareRaw = (input: RedactionSessionInput): PreparedRedaction => {
        try { return session.prepare(input); } catch { return unavailable(); }
    };
    const prepare = (key: string, input: RedactionSessionInput): string => {
        const cached = released.get(key);
        if (cached !== undefined) return cached;
        const text = prepareRaw(input).redactedText;
        released.set(key, text);
        return text;
    };
    const prepareLong = (text: string, known: NonNullable<RedactionSessionInput['knownIdentifiers']>): string => {
        const pieces: string[] = [];
        for (let start = 0; start < text.length;) {
            const windowStart = Math.max(0, start - WINDOW_CONTEXT);
            const final = windowStart + PREPARATION_TEXT_LIMIT >= text.length;
            const window = text.slice(windowStart, final ? text.length : windowStart + PREPARATION_TEXT_LIMIT);
            const { redactedText, spans } = prepareRaw({ text: window, entities: [], knownIdentifiers: known });
            const from = start - windowStart;
            if (crossing(spans, from).length) return unavailable();
            const to = final ? window.length : uncrossedCut(spans, from, preferredCut(window, from, window.length - WINDOW_CONTEXT));
            pieces.push(redactedText.slice(redactedOffset(spans, from), redactedOffset(spans, to)));
            start = windowStart + to;
        }
        return pieces.join('');
    };
    const identity = (field: IdentityField, value: string | null, known: NonNullable<RedactionSessionInput['knownIdentifiers']>): string | null => {
        if (value === null || !value.trim()) return value;
        const text = field === 'birthDate' ? birthDay(value) : value;
        const type = IDENTITY_FIELDS[field];
        const placeholder = prepare(`${type}\u0000${text}`, {
            text, entities: [{ type, start: 0, end: text.length, text, confidence: 1 }],
            knownIdentifiers: type === 'person' ? { names: known.names } : type === 'date' ? { birthDates: known.birthDates } : undefined,
        });
        return WHOLE_PLACEHOLDER.test(placeholder) ? placeholder : unavailable();
    };
    const freeText = (value: string | null, known: NonNullable<RedactionSessionInput['knownIdentifiers']>): string | null => {
        if (value === null || value === '') return value;
        const key = `text\u0000${value}`;
        if (value.length <= PREPARATION_TEXT_LIMIT) return prepare(key, { text: value, entities: [], knownIdentifiers: known });
        const cached = released.get(key);
        if (cached !== undefined) return cached;
        const text = prepareLong(value, known);
        released.set(key, text);
        return text;
    };
    return Object.freeze({
        project(source: ProfileFields, projection: ProfileProjection): ReleasedProfile {
            if (closed) return unavailable();
            const known = identityKnowledge(source);
            const identities = Object.fromEntries((Object.keys(IDENTITY_FIELDS) as IdentityField[])
                .map(field => [field, identity(field, source[field], known)]));
            if (projection === 'notes') return Object.freeze({ notes: freeText(source.notes, known) });
            const texts = Object.fromEntries(FREE_TEXT_FIELDS.map(field => [field, freeText(source[field], known)]));
            const released = { ...identities, ...texts, isAdi: source.isAdi, isArchived: source.isArchived } as Record<string, unknown>;
            return Object.freeze(Object.fromEntries(PROFILE_FIELD_NAMES.map(field => [field, released[field]]))) as ProfileFields;
        },
        close(): void {
            closed = true;
            released.clear();
            session.close();
        },
    });
}
