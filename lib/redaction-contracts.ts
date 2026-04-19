/* @Codex */
export const REDACTION_SCHEMA_VERSION = 'mediflow.redaction.v1';

/* @Codex */
export type RedactionEntityType =
    | 'person'
    | 'date'
    | 'phone'
    | 'address'
    | 'tax_id'
    | 'email'
    | 'organization'
    | 'identifier'
    | 'other';

/* @Codex */
export interface RedactionEntity {
    type: RedactionEntityType;
    text: string;
    // JS/Node UTF-16 code-unit offsets, aligned with String.prototype.slice.
    start: number;
    end: number;
    replacement: string;
    confidence?: number;
}

/* @Codex */
export interface RedactionResult {
    schemaVersion: typeof REDACTION_SCHEMA_VERSION;
    redactedText: string;
    entities: RedactionEntity[];
}

/* @Codex */
export interface RedactionParseResult {
    value: RedactionResult;
    validContract: boolean;
}

const ENTITY_TYPES: RedactionEntityType[] = [
    'person',
    'date',
    'phone',
    'address',
    'tax_id',
    'email',
    'organization',
    'identifier',
    'other',
];

function normalizeEntityType(value: unknown): RedactionEntityType {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ENTITY_TYPES.includes(normalized as RedactionEntityType)
        ? normalized as RedactionEntityType
        : 'other';
}

function normalizeEntity(value: unknown): RedactionEntity | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const replacement = typeof record.replacement === 'string' ? record.replacement.trim() : '';
    const start = Number.isInteger(record.start) ? Number(record.start) : -1;
    const end = Number.isInteger(record.end) ? Number(record.end) : -1;
    const confidence = typeof record.confidence === 'number' ? record.confidence : undefined;

    if (!text || !replacement || start < 0 || end <= start) return null;

    return {
        type: normalizeEntityType(record.type),
        text,
        start,
        end,
        replacement,
        confidence,
    };
}

/* @Codex */
export function parseRedactionResult(value: unknown): RedactionParseResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            value: {
                schemaVersion: REDACTION_SCHEMA_VERSION,
                redactedText: '',
                entities: [],
            },
            validContract: false,
        };
    }

    const record = value as Record<string, unknown>;
    const hasRedactedText = typeof record.redactedText === 'string';
    const rawEntities = Array.isArray(record.entities) ? record.entities : null;
    const redactedText = hasRedactedText ? (record.redactedText as string) : '';
    const entities = rawEntities
        ? rawEntities.map((entry) => normalizeEntity(entry)).filter((entry): entry is RedactionEntity => Boolean(entry))
        : [];
    const validContract =
        record.schemaVersion === REDACTION_SCHEMA_VERSION
        && hasRedactedText
        && rawEntities !== null
        && entities.length === rawEntities.length;

    return {
        value: {
            schemaVersion: REDACTION_SCHEMA_VERSION,
            redactedText,
            entities,
        },
        validContract,
    };
}
