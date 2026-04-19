/* @Codex */
import { patients } from '@/lib/schema';

type PatientInsertValues = typeof patients.$inferInsert;
type PatientUpdateValues = Partial<PatientInsertValues>;

type ValueResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

type PatientWriteResult<T> =
    | { ok: true; values: T }
    | { ok: false; error: string };

type NormalizePatientCreateOptions = {
    id: string;
    ambulatoryId?: string | null;
    allowArchivedOnCreate?: boolean;
    now?: Date;
};

type NormalizePatientUpdateOptions = {
    expectedVersion: number;
    now?: Date;
};

function normalizeStructuredPatientField(
    value: unknown,
    { allowUndefined }: { allowUndefined: boolean }
): string | null | undefined {
    if (value === undefined) {
        return allowUndefined ? undefined : null;
    }
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value);
    return null;
}

function normalizeBirthDateForCreate(value: unknown): ValueResult<Date | null> {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null };
    }

    const parsed = new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: 'Invalid birthDate' };
    }

    return { ok: true, value: parsed };
}

function normalizeBirthDateForUpdate(value: unknown): ValueResult<Date | null | undefined> {
    if (value === undefined) {
        return { ok: true, value: undefined };
    }
    if (value === null || value === '') {
        return { ok: true, value: null };
    }

    const parsed = new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: 'Invalid birthDate' };
    }

    return { ok: true, value: parsed };
}

function hasPatientUpdatableField(values: PatientUpdateValues): boolean {
    return Object.entries(values).some(
        ([key, value]) => key !== 'updatedAt' && key !== 'version' && value !== undefined
    );
}

/* @Codex */
export function normalizePatientCreateInput(
    body: Record<string, unknown>,
    options: NormalizePatientCreateOptions
): PatientWriteResult<PatientInsertValues> {
    const birthDate = normalizeBirthDateForCreate(body.birthDate);
    if (!birthDate.ok) {
        return birthDate;
    }

    const now = options.now ?? new Date();

    return {
        ok: true,
        values: {
            id: options.id,
            firstName: body.firstName as string,
            lastName: body.lastName as string,
            taxCode: body.taxCode as string,
            birthDate: birthDate.value,
            address: typeof body.address === 'string' ? body.address : null,
            phone: typeof body.phone === 'string' ? body.phone : null,
            caregiver: typeof body.caregiver === 'string' ? body.caregiver : null,
            exemptions: normalizeStructuredPatientField(body.exemptions, { allowUndefined: false }),
            diagnoses: normalizeStructuredPatientField(body.diagnoses, { allowUndefined: false }),
            monitoringProfile: typeof body.monitoringProfile === 'string' ? body.monitoringProfile : null,
            statusReason: typeof body.statusReason === 'string' ? body.statusReason : null,
            notes: typeof body.notes === 'string' && body.notes.length > 0 ? body.notes : null,
            isAdi: typeof body.isAdi === 'boolean' ? body.isAdi : false,
            isArchived: options.allowArchivedOnCreate && typeof body.isArchived === 'boolean'
                ? body.isArchived
                : false,
            version: 1,
            ambulatoryId: options.ambulatoryId ?? null,
            createdAt: now,
            updatedAt: now,
        },
    };
}

/* @Codex */
export function normalizePatientUpdateInput(
    body: Record<string, unknown>,
    options: NormalizePatientUpdateOptions
): PatientWriteResult<PatientUpdateValues> {
    const birthDate = normalizeBirthDateForUpdate(body.birthDate);
    if (!birthDate.ok) {
        return birthDate;
    }

    const updateValues: PatientUpdateValues = {
        firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
        lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
        taxCode: typeof body.taxCode === 'string' ? body.taxCode : undefined,
        address: typeof body.address === 'string' ? body.address : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        caregiver: typeof body.caregiver === 'string' ? body.caregiver : undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        monitoringProfile: typeof body.monitoringProfile === 'string'
            ? body.monitoringProfile
            : body.monitoringProfile === null
                ? null
                : undefined,
        statusReason: typeof body.statusReason === 'string'
            ? body.statusReason
            : body.statusReason === null
                ? null
                : undefined,
        aiSummary: typeof body.aiSummary === 'string' ? body.aiSummary : undefined,
        documentInsights: typeof body.documentInsights === 'string' ? body.documentInsights : undefined,
        isAdi: typeof body.isAdi === 'boolean' ? body.isAdi : undefined,
        isArchived: typeof body.isArchived === 'boolean' ? body.isArchived : undefined,
        ambulatoryId: typeof body.ambulatoryId === 'string'
            ? body.ambulatoryId
            : body.ambulatoryId === null
                ? null
                : undefined,
        version: options.expectedVersion + 1,
        birthDate: birthDate.value,
        updatedAt: options.now ?? new Date(),
    };

    const normalizedExemptions = normalizeStructuredPatientField(body.exemptions, { allowUndefined: true });
    if (normalizedExemptions !== undefined) {
        updateValues.exemptions = normalizedExemptions;
    }

    const normalizedDiagnoses = normalizeStructuredPatientField(body.diagnoses, { allowUndefined: true });
    if (normalizedDiagnoses !== undefined) {
        updateValues.diagnoses = normalizedDiagnoses;
    }

    if (!hasPatientUpdatableField(updateValues)) {
        return { ok: false, error: 'No valid fields to update' };
    }

    return {
        ok: true,
        values: updateValues,
    };
}
