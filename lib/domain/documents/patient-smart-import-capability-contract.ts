/* @Codex */
import type { SmartImportProjection } from '../../smart-import-projection';
import {
    buildSmartImportExtractionPrompt,
    isEnvelopeUsable,
    parseSmartImportExtractionResponse,
    type SmartImportDiagnosisExtraction,
    type SmartImportServicePrescriptionExtraction,
    type SmartImportServicePrescriptionItemExtraction,
    type SmartImportTherapyExtraction,
} from '../../ai-task-contracts';

export type PatientSmartImportCapabilityErrorCode =
    | 'prompt_input_invalid'
    | 'provider_output_invalid'
    | 'source_binding_invalid';

export class PatientSmartImportCapabilityError extends Error {
    constructor(readonly code: PatientSmartImportCapabilityErrorCode) {
        super(`Patient Smart Import capability rejected: ${code}`);
        this.name = 'PatientSmartImportCapabilityError';
    }
}

function fail(code: PatientSmartImportCapabilityErrorCode): never {
    throw new PatientSmartImportCapabilityError(code);
}

type Bound<T> = Readonly<T & { sourceId: string }>;
type BoundService = Bound<Omit<SmartImportServicePrescriptionExtraction, 'items'> & {
    items?: ReadonlyArray<Bound<SmartImportServicePrescriptionItemExtraction>>;
}>;

export type PatientSmartImportCapabilityProposal = Readonly<{
    schemaVersion: 'mediflow.smart-import.proposal.v1';
    generatedAt: string;
    contract: Readonly<{ validJson: true; validTask: true; legacyContract: boolean }>;
    summary: string;
    diagnoses: ReadonlyArray<Bound<SmartImportDiagnosisExtraction>>;
    therapies: ReadonlyArray<Bound<SmartImportTherapyExtraction>>;
    servicePrescriptions: ReadonlyArray<BoundService>;
    writesPerformed: 0;
}>;

export function buildPatientSmartImportCapabilityPrompt(projection: SmartImportProjection): string {
    try {
        return buildSmartImportExtractionPrompt({
            currentDiagnoses: projection.currentDiagnoses.map((item) => ({ ...item })),
            currentActiveTherapies: projection.currentActiveTherapies.map((item) => ({ ...item })),
            therapyCandidateHints: projection.therapyCandidateHints.map((item) => ({ ...item })),
            sources: projection.sources.map((item) => ({ ...item })),
        });
    } catch {
        return fail('prompt_input_invalid');
    }
}

function validIso(value: string): boolean {
    return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function requireSource(value: unknown, sourceIds: ReadonlySet<string>): string {
    if (typeof value !== 'string' || !sourceIds.has(value)) return fail('source_binding_invalid');
    return value;
}

function validateRawSourceBindings(rawJson: string | null, sourceIds: ReadonlySet<string>): void {
    if (!rawJson) return fail('provider_output_invalid');
    const root = record(JSON.parse(rawJson));
    const data = record(root?.data);
    if (!data) return fail('provider_output_invalid');
    for (const key of ['diagnoses', 'therapies', 'servicePrescriptions'] as const) {
        const values = data[key];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
            const item = record(value);
            if (!item) continue;
            requireSource(item.sourceId, sourceIds);
            if (key !== 'servicePrescriptions' || !Array.isArray(item.items)) continue;
            for (const nested of item.items) {
                const nestedItem = record(nested);
                if (nestedItem) requireSource(nestedItem.sourceId, sourceIds);
            }
        }
    }
}

export function parsePatientSmartImportCapabilityProposal(
    response: string,
    projection: SmartImportProjection,
    generatedAt: string,
): PatientSmartImportCapabilityProposal {
    try {
        if (!validIso(generatedAt)) return fail('prompt_input_invalid');
        const parsed = parseSmartImportExtractionResponse(response);
        if (!isEnvelopeUsable(parsed)) return fail('provider_output_invalid');
        const sourceIds = new Set(projection.sources.map(({ id }) => id));
        validateRawSourceBindings(parsed.rawJson, sourceIds);
        const diagnoses = Object.freeze(parsed.value.data.diagnoses.map((item) => Object.freeze({ ...item, sourceId: requireSource(item.sourceId, sourceIds) })));
        const therapies = Object.freeze(parsed.value.data.therapies.map((item) => Object.freeze({ ...item, sourceId: requireSource(item.sourceId, sourceIds) })));
        const servicePrescriptions = Object.freeze(parsed.value.data.servicePrescriptions.map((item) => {
            const { items: rawItems, ...service } = item;
            const items = rawItems?.map((nested) => Object.freeze({ ...nested, sourceId: requireSource(nested.sourceId, sourceIds) }));
            return Object.freeze({ ...service, sourceId: requireSource(service.sourceId, sourceIds), ...(items ? { items: Object.freeze(items) } : {}) });
        }));
        return Object.freeze({
            schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt,
            contract: Object.freeze({ validJson: true, validTask: true, legacyContract: parsed.legacyContract }),
            summary: parsed.value.summary, diagnoses, therapies, servicePrescriptions, writesPerformed: 0,
        });
    } catch (error) {
        if (error instanceof PatientSmartImportCapabilityError) throw error;
        return fail('provider_output_invalid');
    }
}
