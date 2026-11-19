import { createRedactionSession, type RedactionSessionEntity, type RedactionSessionInput } from './ai-redaction-session';
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
const KNOWN_VALUE_LIMIT = 256;

function unavailable(): never { throw new ProfileQueryError('query_unavailable'); }

function birthDay(value: string): string {
    const day = ISO_TIMESTAMP_DAY.exec(value);
    return day ? `${day[1]}-${day[2]}-${day[3]}` : value;
}

function knownValues(values: readonly (string | null)[]): string[] {
    return [...new Set(values.flatMap(value => {
        const trimmed = value?.trim();
        return trimmed && trimmed.length <= KNOWN_VALUE_LIMIT ? [trimmed] : [];
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

function preparationChunks(text: string): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > PREPARATION_TEXT_LIMIT) {
        let cut = Math.max(rest.lastIndexOf('\n', PREPARATION_TEXT_LIMIT - 1), rest.lastIndexOf(' ', PREPARATION_TEXT_LIMIT - 1)) + 1;
        if (cut <= 0) cut = PREPARATION_TEXT_LIMIT;
        const last = rest.charCodeAt(cut - 1);
        if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    chunks.push(rest);
    return chunks;
}

export function createProfilePseudonymizer(): ProfilePseudonymizer {
    const session = createRedactionSession();
    const released = new Map<string, string>();
    let closed = false;
    const prepare = (key: string, input: RedactionSessionInput): string => {
        const cached = released.get(key);
        if (cached !== undefined) return cached;
        let text: string;
        try { text = session.prepare(input).redactedText; } catch { return unavailable(); }
        released.set(key, text);
        return text;
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
        return preparationChunks(value).map(chunk => prepare(`text\u0000${chunk}`, { text: chunk, entities: [], knownIdentifiers: known })).join('');
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
