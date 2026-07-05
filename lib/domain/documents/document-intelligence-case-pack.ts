/* @Codex */
export const DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION = 'mediflow.document_case_pack.v1';

/* @Codex */
export const DOCUMENT_INTELLIGENCE_ARCHETYPES = [
    'mixed-profile',
    'discharge-letter',
    'emergency-report',
    'specialist-report',
    'clinical-relation',
    'referral',
    'rehab-adi',
] as const;

/* @Codex */
export type DocumentIntelligenceArchetype = typeof DOCUMENT_INTELLIGENCE_ARCHETYPES[number];

/* @Codex */
export const DOCUMENT_INTELLIGENCE_FACT_KINDS = [
    'problem',
    'medication',
    'followup',
    'care_setting',
    'functional_status',
] as const;

/* @Codex */
export type DocumentIntelligenceFactKind = typeof DOCUMENT_INTELLIGENCE_FACT_KINDS[number];

/* @Codex */
export const DOCUMENT_INTELLIGENCE_TEMPORALITIES = [
    'current',
    'historical',
    'planned',
    'unknown',
] as const;

/* @Codex */
export type DocumentIntelligenceFactTemporality = typeof DOCUMENT_INTELLIGENCE_TEMPORALITIES[number];

/* @Codex */
export const DOCUMENT_INTELLIGENCE_STATUSES = [
    'active',
    'suspended',
    'resolved',
    'planned',
    'uncertain',
    'unknown',
] as const;

/* @Codex */
export type DocumentIntelligenceFactStatus = typeof DOCUMENT_INTELLIGENCE_STATUSES[number];

/* @Codex */
export const DOCUMENT_INTELLIGENCE_ORIGINS = ['documented', 'inferred'] as const;

/* @Codex */
export type DocumentIntelligenceFactOrigin = typeof DOCUMENT_INTELLIGENCE_ORIGINS[number];

/* @Codex */
export const DOCUMENT_INTELLIGENCE_NEGATIVE_REASONS = [
    'negated',
    'family_history',
    'historical_only',
    'administrative_noise',
    'uncertain',
] as const;

/* @Codex */
export type DocumentIntelligenceNegativeReason = typeof DOCUMENT_INTELLIGENCE_NEGATIVE_REASONS[number];

/* @Codex */
export interface DocumentIntelligenceCodingHints {
    system?: string;
    code?: string;
    icdQuery?: string;
    aifaQuery?: string;
}

/* @Codex */
export interface DocumentIntelligenceGoldFact {
    kind: DocumentIntelligenceFactKind;
    label: string;
    excerpt?: string;
    temporality: DocumentIntelligenceFactTemporality;
    status: DocumentIntelligenceFactStatus;
    origin: DocumentIntelligenceFactOrigin;
    codingHints?: DocumentIntelligenceCodingHints;
}

/* @Codex */
export interface DocumentIntelligenceNegativeAssertion {
    label: string;
    reason: DocumentIntelligenceNegativeReason;
    note?: string;
}

/* @Codex */
export interface DocumentIntelligenceExpectedEvidencePack {
    requiredKinds: DocumentIntelligenceFactKind[];
}

/* @Codex */
export interface DocumentIntelligenceExpectedSmartImport {
    diagnosisLabels?: string[];
    therapyLabels?: string[];
    blockedLabels?: string[];
}

/* @Codex */
export interface DocumentIntelligenceCasePack {
    schemaVersion: typeof DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION;
    id: string;
    archetype: DocumentIntelligenceArchetype;
    title: string;
    sourceText: string;
    ocrVariant?: string;
    goldFacts: DocumentIntelligenceGoldFact[];
    expectedEvidencePack?: DocumentIntelligenceExpectedEvidencePack;
    expectedSmartImport?: DocumentIntelligenceExpectedSmartImport;
    negativeAssertions: DocumentIntelligenceNegativeAssertion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Expected non-empty string at ${path}`);
    }

    return value.trim();
}

function readOptionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Expected optional non-empty string at ${path}`);
    }

    return value.trim();
}

function readEnumValue<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
    const parsed = readRequiredString(value, path);
    if (!allowed.includes(parsed)) {
        throw new Error(`Expected one of ${allowed.join(', ')} at ${path}`);
    }

    return parsed as T[number];
}

function readStringArray(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${path}`);
    }

    return value.map((entry, index) => readRequiredString(entry, `${path}[${index}]`));
}

function parseCodingHints(value: unknown, path: string): DocumentIntelligenceCodingHints | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    const hints: DocumentIntelligenceCodingHints = {};
    const system = readOptionalString(value.system, `${path}.system`);
    const code = readOptionalString(value.code, `${path}.code`);
    const icdQuery = readOptionalString(value.icdQuery, `${path}.icdQuery`);
    const aifaQuery = readOptionalString(value.aifaQuery, `${path}.aifaQuery`);

    if (system) hints.system = system;
    if (code) hints.code = code;
    if (icdQuery) hints.icdQuery = icdQuery;
    if (aifaQuery) hints.aifaQuery = aifaQuery;

    return Object.keys(hints).length > 0 ? hints : undefined;
}

function parseGoldFact(value: unknown, path: string): DocumentIntelligenceGoldFact {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        kind: readEnumValue(value.kind, DOCUMENT_INTELLIGENCE_FACT_KINDS, `${path}.kind`),
        label: readRequiredString(value.label, `${path}.label`),
        excerpt: readOptionalString(value.excerpt, `${path}.excerpt`),
        temporality: readEnumValue(value.temporality, DOCUMENT_INTELLIGENCE_TEMPORALITIES, `${path}.temporality`),
        status: readEnumValue(value.status, DOCUMENT_INTELLIGENCE_STATUSES, `${path}.status`),
        origin: readEnumValue(value.origin, DOCUMENT_INTELLIGENCE_ORIGINS, `${path}.origin`),
        codingHints: parseCodingHints(value.codingHints, `${path}.codingHints`),
    };
}

function parseNegativeAssertion(value: unknown, path: string): DocumentIntelligenceNegativeAssertion {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        label: readRequiredString(value.label, `${path}.label`),
        reason: readEnumValue(value.reason, DOCUMENT_INTELLIGENCE_NEGATIVE_REASONS, `${path}.reason`),
        note: readOptionalString(value.note, `${path}.note`),
    };
}

function parseExpectedEvidencePack(value: unknown, path: string): DocumentIntelligenceExpectedEvidencePack | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    const requiredKinds = readStringArray(value.requiredKinds, `${path}.requiredKinds`).map((kind, index) => (
        readEnumValue(kind, DOCUMENT_INTELLIGENCE_FACT_KINDS, `${path}.requiredKinds[${index}]`)
    ));

    return { requiredKinds };
}

function parseExpectedSmartImport(value: unknown, path: string): DocumentIntelligenceExpectedSmartImport | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    const expected: DocumentIntelligenceExpectedSmartImport = {};
    if (value.diagnosisLabels !== undefined) {
        expected.diagnosisLabels = readStringArray(value.diagnosisLabels, `${path}.diagnosisLabels`);
    }
    if (value.therapyLabels !== undefined) {
        expected.therapyLabels = readStringArray(value.therapyLabels, `${path}.therapyLabels`);
    }
    if (value.blockedLabels !== undefined) {
        expected.blockedLabels = readStringArray(value.blockedLabels, `${path}.blockedLabels`);
    }

    return Object.keys(expected).length > 0 ? expected : undefined;
}

/* @Codex */
export function collectDocumentIntelligenceFactKinds(casePack: DocumentIntelligenceCasePack): DocumentIntelligenceFactKind[] {
    return Array.from(new Set(casePack.goldFacts.map((fact) => fact.kind)));
}

/* @Codex */
export function parseDocumentIntelligenceCasePack(value: unknown): DocumentIntelligenceCasePack {
    if (!isRecord(value)) {
        throw new Error('Expected document intelligence case pack object');
    }

    const schemaVersion = readRequiredString(value.schemaVersion, 'schemaVersion');
    if (schemaVersion !== DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION) {
        throw new Error(`Unsupported schemaVersion: ${schemaVersion}`);
    }

    if (!Array.isArray(value.goldFacts) || value.goldFacts.length === 0) {
        throw new Error('Expected non-empty goldFacts array');
    }
    if (!Array.isArray(value.negativeAssertions)) {
        throw new Error('Expected negativeAssertions array');
    }

    const casePack: DocumentIntelligenceCasePack = {
        schemaVersion: DOCUMENT_INTELLIGENCE_CASE_PACK_SCHEMA_VERSION,
        id: readRequiredString(value.id, 'id'),
        archetype: readEnumValue(value.archetype, DOCUMENT_INTELLIGENCE_ARCHETYPES, 'archetype'),
        title: readRequiredString(value.title, 'title'),
        sourceText: readRequiredString(value.sourceText, 'sourceText'),
        ocrVariant: readOptionalString(value.ocrVariant, 'ocrVariant'),
        goldFacts: value.goldFacts.map((fact, index) => parseGoldFact(fact, `goldFacts[${index}]`)),
        expectedEvidencePack: parseExpectedEvidencePack(value.expectedEvidencePack, 'expectedEvidencePack'),
        expectedSmartImport: parseExpectedSmartImport(value.expectedSmartImport, 'expectedSmartImport'),
        negativeAssertions: value.negativeAssertions.map((assertion, index) => (
            parseNegativeAssertion(assertion, `negativeAssertions[${index}]`)
        )),
    };

    if (casePack.expectedEvidencePack) {
        const availableKinds = new Set(collectDocumentIntelligenceFactKinds(casePack));
        for (const requiredKind of casePack.expectedEvidencePack.requiredKinds) {
            if (!availableKinds.has(requiredKind)) {
                throw new Error(`expectedEvidencePack requires missing kind: ${requiredKind}`);
            }
        }
    }

    return casePack;
}
