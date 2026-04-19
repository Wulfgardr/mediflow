/* @Codex */
import { REDACTION_SCHEMA_VERSION, type RedactionEntity, type RedactionEntityType } from '../lib/redaction-contracts.ts';

type BenchmarkCorpusEntry = {
    id: string;
    inputText: string;
};

type RedactionAdapter = {
    name: string;
    run(entry: BenchmarkCorpusEntry): Promise<unknown>;
};

type OpenMedHealthResponse = {
    status?: string;
    service?: string;
    version?: string;
    profile?: string;
};

type OpenMedPIIEntity = {
    text?: unknown;
    label?: unknown;
    entity_type?: unknown;
    start?: unknown;
    end?: unknown;
    confidence?: unknown;
    redacted_text?: unknown;
};

type OpenMedPIIDeidentifyResponse = {
    deidentified_text?: unknown;
    pii_entities?: unknown;
    mapping?: unknown;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_MODEL_NAME = 'OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;
const CLAUSE_BOUNDARY_PATTERN = /[.;:\n]/;
const STREET_PREFIX_PATTERN = /\b(?:via|viale|piazza|corso|largo|vicolo|piazzale|strada|contrada)\b/gi;
const ADDRESS_SUFFIX_PATTERN = /^\s*,?\s*(?:\d{5}\s+)?[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÿ' -]*[a-zà-ÿ][A-Za-zÀ-ÿ' -]*/;

function normalizeBaseUrl(value: string | undefined) {
    const candidate = (value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported OpenMed protocol: ${parsed.protocol}`);
    }
    return parsed.toString().replace(/\/+$/, '');
}

function parseEnvNumber(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function placeholderForType(type: RedactionEntityType) {
    return `[${type.toUpperCase()}]`;
}

function looksLikeItalianTaxId(text: string) {
    return /^[A-Z0-9]{16}$/i.test(text.trim());
}

function looksLikePhoneNumber(text: string) {
    const candidate = text.trim();
    const digits = candidate.replace(/\D/g, '');
    return /^\+?[0-9][0-9\s-]{5,18}$/.test(candidate) && digits.length >= 6 && digits.length <= 12;
}

function mapOpenMedLabelToType(value: unknown, text: string): RedactionEntityType {
    const label = typeof value === 'string' ? value.trim().toLowerCase() : '';

    if (
        label === 'name'
        || label === 'person'
        || label === 'patient'
        || label === 'doctor'
        || label === 'provider'
        || label === 'firstname'
        || label === 'lastname'
        || label === 'first_name'
        || label === 'last_name'
        || label === 'full_name'
    ) {
        return 'person';
    }

    if (
        label === 'date'
        || label === 'date_of_birth'
        || label === 'dateofbirth'
        || label === 'birth_date'
        || label === 'dob'
        || label === 'appointment_date'
    ) {
        return 'date';
    }

    if (label === 'phone' || label === 'phone_number' || label === 'fax') {
        return 'phone';
    }

    if (
        label === 'address'
        || label === 'street_address'
        || label === 'city'
        || label === 'state'
        || label === 'province'
        || label === 'region'
        || label === 'county'
        || label === 'postcode'
        || label === 'zip'
        || label === 'zip_code'
        || label === 'location'
    ) {
        return 'address';
    }

    if (label === 'email' || label === 'email_address') {
        return 'email';
    }

    if (
        label === 'organization'
        || label === 'hospital'
        || label === 'clinic'
        || label === 'facility'
        || label === 'company'
        || label === 'employer'
    ) {
        return 'organization';
    }

    if (
        label === 'tax_id'
        || label === 'codice_fiscale'
        || label === 'fiscal_code'
    ) {
        return 'tax_id';
    }

    if (label === 'national_id') {
        return looksLikeItalianTaxId(text) ? 'tax_id' : 'identifier';
    }

    if (label === 'bankaccount' || label === 'bank_account') {
        return looksLikePhoneNumber(text) ? 'phone' : 'identifier';
    }

    if (label === 'npi') {
        return looksLikePhoneNumber(text) ? 'phone' : 'identifier';
    }

    if (
        label === 'ssn'
        || label === 'id'
        || label === 'identifier'
        || label === 'medical_record_number'
        || label === 'mrn'
        || label === 'patient_id'
        || label === 'dni'
        || label === 'nie'
        || label === 'bsn'
    ) {
        return 'identifier';
    }

    return 'other';
}

function normalizeOpenMedEntity(value: unknown): RedactionEntity | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as OpenMedPIIEntity;
    const text = typeof record.text === 'string' ? record.text : '';
    const start = Number.isInteger(record.start) ? Number(record.start) : -1;
    const end = Number.isInteger(record.end) ? Number(record.end) : -1;
    const type = mapOpenMedLabelToType(record.entity_type ?? record.label, text);
    const replacement = typeof record.redacted_text === 'string' && record.redacted_text.trim()
        ? record.redacted_text
        : placeholderForType(type);
    const confidence = typeof record.confidence === 'number' ? record.confidence : undefined;

    if (!text || start < 0 || end <= start) return null;

    return {
        type,
        text,
        start,
        end,
        replacement,
        confidence,
    };
}

function canMergeEntities(left: RedactionEntity, right: RedactionEntity, sourceText: string) {
    if (left.type !== right.type) return false;
    if (left.end > right.start) return false;
    if (left.type !== 'person' && left.type !== 'address') return false;

    const gap = sourceText.slice(left.end, right.start);
    return /^[,\s]+$/.test(gap);
}

function mergeAdjacentEntities(entities: RedactionEntity[], sourceText: string): RedactionEntity[] {
    const sorted = [...entities].sort((left, right) => left.start - right.start);
    const merged: RedactionEntity[] = [];

    for (const entity of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || !canMergeEntities(previous, entity, sourceText)) {
            merged.push({ ...entity });
            continue;
        }

        previous.end = entity.end;
        previous.text = sourceText.slice(previous.start, previous.end);
        previous.replacement = placeholderForType(previous.type);
        if (typeof previous.confidence === 'number' && typeof entity.confidence === 'number') {
            previous.confidence = Number(((previous.confidence + entity.confidence) / 2).toFixed(4));
        } else if (typeof entity.confidence === 'number') {
            previous.confidence = entity.confidence;
        }
    }

    return merged;
}

function findClauseStart(sourceText: string, index: number) {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (CLAUSE_BOUNDARY_PATTERN.test(sourceText[cursor])) {
            return cursor + 1;
        }
    }

    return 0;
}

function findClauseEnd(sourceText: string, index: number) {
    for (let cursor = index; cursor < sourceText.length; cursor += 1) {
        if (CLAUSE_BOUNDARY_PATTERN.test(sourceText[cursor])) {
            return cursor;
        }
    }

    return sourceText.length;
}

function findLastStreetPrefix(sourceText: string, index: number) {
    const clauseStart = findClauseStart(sourceText, index);
    const context = sourceText.slice(clauseStart, index);
    STREET_PREFIX_PATTERN.lastIndex = 0;

    let candidateStart = -1;
    let match = STREET_PREFIX_PATTERN.exec(context);
    while (match) {
        candidateStart = clauseStart + match.index;
        match = STREET_PREFIX_PATTERN.exec(context);
    }

    return candidateStart;
}

function expandAddressEntity(entity: RedactionEntity, sourceText: string): RedactionEntity {
    if (entity.type !== 'address') return entity;

    let start = entity.start;
    let end = entity.end;
    const streetPrefixStart = findLastStreetPrefix(sourceText, start);

    if (streetPrefixStart >= 0) {
        const prefixSpan = sourceText.slice(streetPrefixStart, end);
        if (/\d/.test(prefixSpan) && !CLAUSE_BOUNDARY_PATTERN.test(prefixSpan)) {
            start = streetPrefixStart;
        }
    }

    const clauseEnd = findClauseEnd(sourceText, end);
    const suffix = sourceText.slice(end, clauseEnd);
    const suffixMatch = suffix.match(ADDRESS_SUFFIX_PATTERN);
    if (suffixMatch) {
        end += suffixMatch[0].length;
    }

    return {
        ...entity,
        start,
        end,
        text: sourceText.slice(start, end),
        replacement: placeholderForType('address'),
    };
}

function resolveOverlappingEntities(entities: RedactionEntity[]): RedactionEntity[] {
    const sorted = [...entities].sort((left, right) =>
        left.start - right.start
        || (right.end - right.start) - (left.end - left.start)
        || (right.confidence ?? 0) - (left.confidence ?? 0),
    );

    const resolved: RedactionEntity[] = [];

    for (const entity of sorted) {
        const previous = resolved[resolved.length - 1];
        if (!previous || entity.start >= previous.end) {
            resolved.push(entity);
            continue;
        }

        const previousLength = previous.end - previous.start;
        const currentLength = entity.end - entity.start;
        const keepCurrent =
            currentLength > previousLength
            || (
                currentLength === previousLength
                && (entity.confidence ?? 0) > (previous.confidence ?? 0)
            );

        if (keepCurrent) {
            resolved[resolved.length - 1] = entity;
        }
    }

    return resolved.sort((left, right) => left.start - right.start || left.end - right.end);
}

function buildRedactedText(sourceText: string, entities: RedactionEntity[]) {
    const sorted = [...entities].sort((left, right) => right.start - left.start);
    let output = sourceText;

    for (const entity of sorted) {
        output = output.slice(0, entity.start) + entity.replacement + output.slice(entity.end);
    }

    return output;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
    const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : null;

    if (!response.ok) {
        const error = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as { error?: { code?: string; message?: string } }).error
            : undefined;
        const message = error?.message || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return payload;
}

/* @Codex */
export function createAdapter(): RedactionAdapter {
    const baseUrl = normalizeBaseUrl(process.env.MEDIFLOW_OPENMED_BASE_URL);
    const modelName = (process.env.MEDIFLOW_OPENMED_PII_MODEL || DEFAULT_MODEL_NAME).trim();
    const timeoutMs = Math.max(1000, Math.round(parseEnvNumber(process.env.MEDIFLOW_OPENMED_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)));
    const confidenceThreshold = Math.min(
        1,
        Math.max(0, parseEnvNumber(process.env.MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD, DEFAULT_CONFIDENCE_THRESHOLD)),
    );

    let healthcheck: Promise<void> | null = null;

    async function ensureHealthy() {
        if (!healthcheck) {
            healthcheck = (async () => {
                const payload = await fetchJson(
                    `${baseUrl}/health`,
                    {
                        method: 'GET',
                        headers: {
                            Accept: 'application/json',
                        },
                    },
                    timeoutMs,
                ) as OpenMedHealthResponse;

                if (payload.status !== 'ok') {
                    throw new Error('OpenMed healthcheck did not return status=ok');
                }
            })().catch((error) => {
                healthcheck = null;
                throw error;
            });
        }

        return healthcheck;
    }

    return {
        name: `openmed:${modelName}`,
        async run(entry) {
            await ensureHealthy();

            const payload = await fetchJson(
                `${baseUrl}/pii/deidentify`,
                {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        text: entry.inputText,
                        method: 'mask',
                        model_name: modelName,
                        confidence_threshold: confidenceThreshold,
                        keep_mapping: true,
                        use_smart_merging: true,
                        lang: 'it',
                    }),
                },
                timeoutMs,
            ) as OpenMedPIIDeidentifyResponse;

            if (typeof payload.deidentified_text !== 'string') {
                throw new Error('OpenMed deidentify response is missing deidentified_text');
            }

            if (!Array.isArray(payload.pii_entities)) {
                throw new Error('OpenMed deidentify response is missing pii_entities');
            }

            const entities = payload.pii_entities.map((entity) => normalizeOpenMedEntity(entity));
            if (entities.some((entity) => entity === null)) {
                throw new Error('OpenMed deidentify response contains an entity without valid text/start/end offsets');
            }
            const normalizedEntities = resolveOverlappingEntities(mergeAdjacentEntities(
                entities.filter((entity): entity is RedactionEntity => entity !== null),
                entry.inputText,
            ).map((entity) => expandAddressEntity(entity, entry.inputText)));

            return {
                schemaVersion: REDACTION_SCHEMA_VERSION,
                redactedText: buildRedactedText(entry.inputText, normalizedEntities),
                entities: normalizedEntities,
            };
        },
    };
}

const adapter = createAdapter();

export default adapter;
