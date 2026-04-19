/* @Codex */
export const CLINICAL_ENTITIES_SCHEMA_VERSION = 'mediflow.clinical_entities.v1';

/* @Codex */
export type ClinicalEntityType = 'problem' | 'medication';

/* @Codex */
export interface ClinicalEntity {
    type: ClinicalEntityType;
    text: string;
    evidence: string;
    start: number;
    end: number;
    confidence?: number;
}

/* @Codex */
export interface ClinicalEntitiesResult {
    schemaVersion: typeof CLINICAL_ENTITIES_SCHEMA_VERSION;
    entities: ClinicalEntity[];
}

/* @Codex */
export interface ClinicalEntitiesParseResult {
    value: ClinicalEntitiesResult;
    validContract: boolean;
}

const ENTITY_TYPES: ClinicalEntityType[] = ['problem', 'medication'];

function normalizeEntityType(value: unknown): ClinicalEntityType | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ENTITY_TYPES.includes(normalized as ClinicalEntityType)
        ? normalized as ClinicalEntityType
        : null;
}

function normalizeEntity(value: unknown): ClinicalEntity | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const type = normalizeEntityType(record.type);
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const evidence = typeof record.evidence === 'string' ? record.evidence.trim() : '';
    const start = Number.isInteger(record.start) ? Number(record.start) : -1;
    const end = Number.isInteger(record.end) ? Number(record.end) : -1;
    const confidence = typeof record.confidence === 'number' ? record.confidence : undefined;

    if (!type || !text || !evidence || start < 0 || end <= start) return null;

    return {
        type,
        text,
        evidence,
        start,
        end,
        confidence,
    };
}

/* @Codex */
export function parseClinicalEntitiesResult(value: unknown): ClinicalEntitiesParseResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            value: {
                schemaVersion: CLINICAL_ENTITIES_SCHEMA_VERSION,
                entities: [],
            },
            validContract: false,
        };
    }

    const record = value as Record<string, unknown>;
    const rawEntities = Array.isArray(record.entities) ? record.entities : null;
    const entities = rawEntities
        ? rawEntities.map((entry) => normalizeEntity(entry)).filter((entry): entry is ClinicalEntity => Boolean(entry))
        : [];
    const validContract =
        record.schemaVersion === CLINICAL_ENTITIES_SCHEMA_VERSION
        && rawEntities !== null
        && entities.length === rawEntities.length;

    return {
        value: {
            schemaVersion: CLINICAL_ENTITIES_SCHEMA_VERSION,
            entities,
        },
        validContract,
    };
}
