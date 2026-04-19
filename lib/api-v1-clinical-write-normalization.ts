/* @Codex */
import { parseCheckupStatus, parseTherapyStatus } from './status-normalization';

/* @Codex */
type WriteNormalizationResult<T> =
    | { ok: true; values: T }
    | { ok: false; error: string };

/* @Codex */
type EntryCreateValues = {
    id: string;
    patientId: string;
    type: string;
    date: Date;
    content: string;
    createdAt: Date;
};

/* @Codex */
type EntryUpdateValues = {
    type?: string;
    date?: Date;
    content?: string;
};

/* @Codex */
type TherapyCreateValues = {
    id: string;
    patientId: string;
    drugName: string;
    aic: string | null;
    atc: string | null;
    activePrinciple: string | null;
    dosage: string;
    motivation: string | null;
    diagnosisCode: string | null;
    diagnosisName: string | null;
    status: 'active' | 'suspended' | 'completed';
    startDate: Date;
    endDate: Date | null;
    createdAt: Date;
};

/* @Codex */
type CheckupCreateValues = {
    id: string;
    patientId: string;
    date: Date;
    title: string;
    notes: string | null;
    status: 'pending' | 'completed' | 'cancelled';
    source: string;
    createdAt: Date;
};

/* @Codex */
function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/* @Codex */
function parseRequiredString(value: unknown, field: string): WriteNormalizationResult<string> {
    if (!isNonEmptyString(value)) {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: value };
}

/* @Codex */
function parseRequiredDate(value: unknown, field: string): WriteNormalizationResult<Date> {
    const parsed = parseDate(value);
    if (!parsed) {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: parsed };
}

/* @Codex */
function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
function parseNullableString(value: unknown, field: string): WriteNormalizationResult<string | null> {
    if (value === undefined || value === null) {
        return { ok: true, values: null };
    }

    if (typeof value !== 'string') {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: value };
}

/* @Codex */
export function normalizeEntryCreateInput(
    input: Record<string, unknown>,
    context: { id: string; patientId: string; now?: Date }
): WriteNormalizationResult<EntryCreateValues> {
    const type = parseRequiredString(input.type, 'type');
    if (!type.ok) return type;

    const date = parseRequiredDate(input.date, 'date');
    if (!date.ok) return date;

    const content = parseRequiredString(input.content, 'content');
    if (!content.ok) return content;

    return {
        ok: true,
        values: {
            id: context.id,
            patientId: context.patientId,
            type: type.values,
            date: date.values,
            content: content.values,
            createdAt: context.now ?? new Date(),
        },
    };
}

/* @Codex */
export function normalizeEntryUpdateInput(
    input: Record<string, unknown>
): WriteNormalizationResult<EntryUpdateValues> {
    const hasDate = Object.prototype.hasOwnProperty.call(input, 'date');
    const nextDate = hasDate ? parseDate(input.date) : null;
    if (hasDate && nextDate === null) {
        return { ok: false, error: 'Invalid date' };
    }

    const nextType = typeof input.type === 'string' ? input.type : undefined;
    const nextContent = typeof input.content === 'string' ? input.content : undefined;

    if (nextType === undefined && nextContent === undefined && !hasDate) {
        return { ok: false, error: 'No valid fields to update' };
    }

    return {
        ok: true,
        values: {
            type: nextType,
            content: nextContent,
            date: nextDate ?? undefined,
        },
    };
}

/* @Codex */
export function normalizeTherapyCreateInput(
    input: Record<string, unknown>,
    context: { id: string; patientId: string; now?: Date }
): WriteNormalizationResult<TherapyCreateValues> {
    const drugName = parseRequiredString(input.drugName, 'drugName');
    if (!drugName.ok) return drugName;

    const dosage = parseRequiredString(input.dosage, 'dosage');
    if (!dosage.ok) return dosage;

    const startDate = parseRequiredDate(input.startDate, 'startDate');
    if (!startDate.ok) return startDate;

    const aic = parseNullableString(input.aic, 'aic');
    if (!aic.ok) return aic;

    const atc = parseNullableString(input.atc, 'atc');
    if (!atc.ok) return atc;

    const activePrinciple = parseNullableString(input.activePrinciple, 'activePrinciple');
    if (!activePrinciple.ok) return activePrinciple;

    const motivation = parseNullableString(input.motivation, 'motivation');
    if (!motivation.ok) return motivation;

    const diagnosisCode = parseNullableString(input.diagnosisCode, 'diagnosisCode');
    if (!diagnosisCode.ok) return diagnosisCode;

    const diagnosisName = parseNullableString(input.diagnosisName, 'diagnosisName');
    if (!diagnosisName.ok) return diagnosisName;

    const normalizedStatus = input.status === undefined ? 'active' : parseTherapyStatus(input.status);
    if (input.status !== undefined && !normalizedStatus) {
        return { ok: false, error: 'Invalid therapy status' };
    }

    const hasEndDate = Object.prototype.hasOwnProperty.call(input, 'endDate');
    const nextEndDate = parseDate(input.endDate);
    if (hasEndDate && input.endDate !== null && input.endDate !== '' && nextEndDate === null) {
        return { ok: false, error: 'Invalid endDate' };
    }

    return {
        ok: true,
        values: {
            id: context.id,
            patientId: context.patientId,
            drugName: drugName.values,
            aic: aic.values,
            atc: atc.values,
            activePrinciple: activePrinciple.values,
            dosage: dosage.values,
            motivation: motivation.values,
            diagnosisCode: diagnosisCode.values,
            diagnosisName: diagnosisName.values,
            status: normalizedStatus ?? 'active',
            startDate: startDate.values,
            endDate: nextEndDate,
            createdAt: context.now ?? new Date(),
        },
    };
}

/* @Codex */
export function normalizeCheckupCreateInput(
    input: Record<string, unknown>,
    context: { id: string; patientId: string; now?: Date }
): WriteNormalizationResult<CheckupCreateValues> {
    const date = parseRequiredDate(input.date, 'date');
    if (!date.ok) return date;

    const title = parseRequiredString(input.title, 'title');
    if (!title.ok) return title;

    const notes = parseNullableString(input.notes, 'notes');
    if (!notes.ok) return notes;

    const normalizedStatus = input.status === undefined ? 'pending' : parseCheckupStatus(input.status);
    if (input.status !== undefined && !normalizedStatus) {
        return { ok: false, error: 'Invalid checkup status' };
    }

    const source: WriteNormalizationResult<string> = input.source === undefined || input.source === null
        ? { ok: true, values: 'manual' }
        : parseRequiredString(input.source, 'source');
    if (!source.ok) return source;

    return {
        ok: true,
        values: {
            id: context.id,
            patientId: context.patientId,
            date: date.values,
            title: title.values,
            notes: notes.values,
            status: normalizedStatus ?? 'pending',
            source: source.values,
            createdAt: context.now ?? new Date(),
        },
    };
}
