/* @Codex */
import type { TherapySuggestionState } from './ai-task-contracts';

/* @Codex */
export const CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION = 'mediflow.cloud_comparator_case_pack.v1';

/* @Codex */
export const CLOUD_COMPARATOR_STORAGE_MODES = ['private-shadow-vault'] as const;

/* @Codex */
export type CloudComparatorStorageMode = typeof CLOUD_COMPARATOR_STORAGE_MODES[number];

/* @Codex */
export const CLOUD_COMPARATOR_SOURCE_KINDS = [
    'single-document',
    'document-bundle',
    'mixed-chart-review',
    'single-note',
] as const;

const CLOUD_COMPARATOR_THERAPY_STATES = ['active', 'transition', 'uncertain', 'inactive'] as const;

/* @Codex */
export type CloudComparatorSourceKind = typeof CLOUD_COMPARATOR_SOURCE_KINDS[number];

/* @Codex */
export type ExpectedTokenMatcher = string[] | string[][];

/* @Codex */
export interface CloudComparatorOrigin {
    storage: CloudComparatorStorageMode;
    sourceKind: CloudComparatorSourceKind;
    createdAt: string;
    operatorRef: string;
}

/* @Codex */
export interface CloudComparatorPrivacyGate {
    directIdentifiersRemoved: boolean;
    quasiIdentifiersMinimized: boolean;
    operatorReviewed: boolean;
    cloudExportApproved: boolean;
    minimizationSummary: string;
    approvedAt?: string;
}

/* @Codex */
export interface CloudComparatorPatientInsightExpected {
    currentStateAny?: ExpectedTokenMatcher[];
    alertsAny?: ExpectedTokenMatcher[];
    nextStepsAny?: ExpectedTokenMatcher[];
    gapsAny?: ExpectedTokenMatcher[];
    preferredSourceIds?: string[];
    forbiddenSourceIds?: string[];
    forbiddenTokens?: string[][];
    maxIncompleteClaims?: number;
}

/* @Codex */
export interface CloudComparatorPatientInsightCase {
    context: string;
    expected: CloudComparatorPatientInsightExpected;
    maxTokens?: number;
}

/* @Codex */
export interface CloudComparatorExpectedDiagnosis {
    labelTokens: string[];
    icdQueryTokens?: string[];
}

/* @Codex */
export interface CloudComparatorExpectedTherapy {
    drugTokens: string[];
    dosageTokens?: string[];
    therapyState?: TherapySuggestionState;
}

/* @Codex */
export interface CloudComparatorSmartImportExpected {
    diagnoses?: CloudComparatorExpectedDiagnosis[];
    therapies?: CloudComparatorExpectedTherapy[];
    forbiddenDiagnosisTokens?: string[][];
    forbiddenTherapyTokens?: string[][];
}

/* @Codex */
export interface CloudComparatorSmartImportCase {
    payload: Record<string, unknown>;
    expected: CloudComparatorSmartImportExpected;
    maxTokens?: number;
}

/* @Codex */
export interface CloudComparatorDistillationPlan {
    syntheticArchetypeHints: string[];
    followupQuestions: string[];
    learningObjectives?: string[];
    hypothesisTags?: string[];
}

/* @Codex */
export interface CloudComparatorCasePack {
    schemaVersion: typeof CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION;
    id: string;
    title: string;
    origin: CloudComparatorOrigin;
    privacy: CloudComparatorPrivacyGate;
    patientInsight?: CloudComparatorPatientInsightCase;
    smartImport?: CloudComparatorSmartImportCase;
    distillation?: CloudComparatorDistillationPlan;
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

function readRequiredBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`Expected boolean at ${path}`);
    }

    return value;
}

function readOptionalPositiveInteger(value: unknown, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`Expected positive integer at ${path}`);
    }

    return value;
}

function readStringArray(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${path}`);
    }

    return value.map((entry, index) => readRequiredString(entry, `${path}[${index}]`));
}

function readIsoDate(value: unknown, path: string): string {
    const parsed = readRequiredString(value, path);
    if (!Number.isFinite(Date.parse(parsed))) {
        throw new Error(`Expected ISO date string at ${path}`);
    }

    return parsed;
}

function readEnumValue<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
    const parsed = readRequiredString(value, path);
    if (!allowed.includes(parsed)) {
        throw new Error(`Expected one of ${allowed.join(', ')} at ${path}`);
    }

    return parsed as T[number];
}

function parseExpectedTokenMatcher(value: unknown, path: string): ExpectedTokenMatcher {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Expected non-empty matcher array at ${path}`);
    }

    if (Array.isArray(value[0])) {
        return value.map((group, index) => readStringArray(group, `${path}[${index}]`));
    }

    return readStringArray(value, path);
}

function parseExpectedTokenMatchers(value: unknown, path: string): ExpectedTokenMatcher[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${path}`);
    }

    return value.map((matcher, index) => parseExpectedTokenMatcher(matcher, `${path}[${index}]`));
}

function parseTokenGroups(value: unknown, path: string): string[][] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${path}`);
    }

    return value.map((group, index) => readStringArray(group, `${path}[${index}]`));
}

function parseOrigin(value: unknown, path: string): CloudComparatorOrigin {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        storage: readEnumValue(value.storage, CLOUD_COMPARATOR_STORAGE_MODES, `${path}.storage`),
        sourceKind: readEnumValue(value.sourceKind, CLOUD_COMPARATOR_SOURCE_KINDS, `${path}.sourceKind`),
        createdAt: readIsoDate(value.createdAt, `${path}.createdAt`),
        operatorRef: readRequiredString(value.operatorRef, `${path}.operatorRef`),
    };
}

function parsePrivacyGate(value: unknown, path: string): CloudComparatorPrivacyGate {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        directIdentifiersRemoved: readRequiredBoolean(value.directIdentifiersRemoved, `${path}.directIdentifiersRemoved`),
        quasiIdentifiersMinimized: readRequiredBoolean(value.quasiIdentifiersMinimized, `${path}.quasiIdentifiersMinimized`),
        operatorReviewed: readRequiredBoolean(value.operatorReviewed, `${path}.operatorReviewed`),
        cloudExportApproved: readRequiredBoolean(value.cloudExportApproved, `${path}.cloudExportApproved`),
        minimizationSummary: readRequiredString(value.minimizationSummary, `${path}.minimizationSummary`),
        approvedAt: value.approvedAt === undefined ? undefined : readIsoDate(value.approvedAt, `${path}.approvedAt`),
    };
}

function parsePatientInsightExpected(value: unknown, path: string): CloudComparatorPatientInsightExpected {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    const expected: CloudComparatorPatientInsightExpected = {
        currentStateAny: parseExpectedTokenMatchers(value.currentStateAny, `${path}.currentStateAny`),
        alertsAny: parseExpectedTokenMatchers(value.alertsAny, `${path}.alertsAny`),
        nextStepsAny: parseExpectedTokenMatchers(value.nextStepsAny, `${path}.nextStepsAny`),
        gapsAny: parseExpectedTokenMatchers(value.gapsAny, `${path}.gapsAny`),
        preferredSourceIds: value.preferredSourceIds === undefined ? undefined : readStringArray(value.preferredSourceIds, `${path}.preferredSourceIds`),
        forbiddenSourceIds: value.forbiddenSourceIds === undefined ? undefined : readStringArray(value.forbiddenSourceIds, `${path}.forbiddenSourceIds`),
        forbiddenTokens: parseTokenGroups(value.forbiddenTokens, `${path}.forbiddenTokens`),
        maxIncompleteClaims: readOptionalPositiveInteger(value.maxIncompleteClaims, `${path}.maxIncompleteClaims`),
    };

    return expected;
}

function parsePatientInsightCase(value: unknown, path: string): CloudComparatorPatientInsightCase {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        context: readRequiredString(value.context, `${path}.context`),
        expected: parsePatientInsightExpected(value.expected, `${path}.expected`),
        maxTokens: readOptionalPositiveInteger(value.maxTokens, `${path}.maxTokens`),
    };
}

function parseExpectedDiagnosis(value: unknown, path: string): CloudComparatorExpectedDiagnosis {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        labelTokens: readStringArray(value.labelTokens, `${path}.labelTokens`),
        icdQueryTokens: value.icdQueryTokens === undefined ? undefined : readStringArray(value.icdQueryTokens, `${path}.icdQueryTokens`),
    };
}

function parseExpectedTherapy(value: unknown, path: string): CloudComparatorExpectedTherapy {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        drugTokens: readStringArray(value.drugTokens, `${path}.drugTokens`),
        dosageTokens: value.dosageTokens === undefined ? undefined : readStringArray(value.dosageTokens, `${path}.dosageTokens`),
        therapyState: value.therapyState === undefined
            ? undefined
            : readEnumValue(value.therapyState, CLOUD_COMPARATOR_THERAPY_STATES, `${path}.therapyState`),
    };
}

function parseSmartImportExpected(value: unknown, path: string): CloudComparatorSmartImportExpected {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        diagnoses: value.diagnoses === undefined
            ? undefined
            : readArrayOfRecords(value.diagnoses, `${path}.diagnoses`).map((entry, index) => (
                parseExpectedDiagnosis(entry, `${path}.diagnoses[${index}]`)
            )),
        therapies: value.therapies === undefined
            ? undefined
            : readArrayOfRecords(value.therapies, `${path}.therapies`).map((entry, index) => (
                parseExpectedTherapy(entry, `${path}.therapies[${index}]`)
            )),
        forbiddenDiagnosisTokens: parseTokenGroups(value.forbiddenDiagnosisTokens, `${path}.forbiddenDiagnosisTokens`),
        forbiddenTherapyTokens: parseTokenGroups(value.forbiddenTherapyTokens, `${path}.forbiddenTherapyTokens`),
    };
}

function readArrayOfRecords(value: unknown, path: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        throw new Error(`Expected array at ${path}`);
    }

    return value.map((entry, index) => {
        if (!isRecord(entry)) {
            throw new Error(`Expected object at ${path}[${index}]`);
        }
        return entry;
    });
}

function parseSmartImportCase(value: unknown, path: string): CloudComparatorSmartImportCase {
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }
    if (!isRecord(value.payload)) {
        throw new Error(`Expected object at ${path}.payload`);
    }

    return {
        payload: value.payload,
        expected: parseSmartImportExpected(value.expected, `${path}.expected`),
        maxTokens: readOptionalPositiveInteger(value.maxTokens, `${path}.maxTokens`),
    };
}

function parseDistillationPlan(value: unknown, path: string): CloudComparatorDistillationPlan | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
        throw new Error(`Expected object at ${path}`);
    }

    return {
        syntheticArchetypeHints: readStringArray(value.syntheticArchetypeHints, `${path}.syntheticArchetypeHints`),
        followupQuestions: readStringArray(value.followupQuestions, `${path}.followupQuestions`),
        learningObjectives: value.learningObjectives === undefined
            ? undefined
            : readStringArray(value.learningObjectives, `${path}.learningObjectives`),
        hypothesisTags: value.hypothesisTags === undefined
            ? undefined
            : readStringArray(value.hypothesisTags, `${path}.hypothesisTags`),
    };
}

/* @Codex */
export function hasCloudComparatorApproval(casePack: CloudComparatorCasePack): boolean {
    return casePack.privacy.directIdentifiersRemoved
        && casePack.privacy.quasiIdentifiersMinimized
        && casePack.privacy.operatorReviewed
        && casePack.privacy.cloudExportApproved;
}

/* @Codex */
export function parseCloudComparatorCasePack(value: unknown): CloudComparatorCasePack {
    if (!isRecord(value)) {
        throw new Error('Expected cloud comparator case pack object');
    }

    const schemaVersion = readRequiredString(value.schemaVersion, 'schemaVersion');
    if (schemaVersion !== CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION) {
        throw new Error(`Unsupported schemaVersion: ${schemaVersion}`);
    }

    const casePack: CloudComparatorCasePack = {
        schemaVersion: CLOUD_COMPARATOR_CASE_PACK_SCHEMA_VERSION,
        id: readRequiredString(value.id, 'id'),
        title: readRequiredString(value.title, 'title'),
        origin: parseOrigin(value.origin, 'origin'),
        privacy: parsePrivacyGate(value.privacy, 'privacy'),
        patientInsight: value.patientInsight === undefined ? undefined : parsePatientInsightCase(value.patientInsight, 'patientInsight'),
        smartImport: value.smartImport === undefined ? undefined : parseSmartImportCase(value.smartImport, 'smartImport'),
        distillation: parseDistillationPlan(value.distillation, 'distillation'),
    };

    if (!casePack.patientInsight && !casePack.smartImport) {
        throw new Error('Expected at least one target lane: patientInsight or smartImport');
    }

    return casePack;
}
