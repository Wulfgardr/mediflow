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
    /* @Codex */
    title: string;
    date: Date;
    content: string;
    /* @Codex */
    setting: string | null;
    /* @Codex */
    metadata: string | null;
    /* @Codex */
    attachments: string | null;
    /* @Codex */
    version: number;
    createdAt: Date;
    /* @Codex */
    updatedAt: Date;
};

/* @Codex */
type EntryUpdateValues = {
    type?: string;
    /* @Codex */
    title?: string;
    date?: Date;
    content?: string;
    /* @Codex */
    setting?: string | null;
    /* @Codex */
    metadata?: string | null;
    /* @Codex */
    attachments?: string | null;
    /* @Codex */
    deletedAt?: Date | null;
    /* @Codex */
    deletionReason?: string | null;
    /* @Codex */
    updatedAt?: Date;
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
    /* @Codex */
    version: number;
    createdAt: Date;
    /* @Codex */
    updatedAt: Date;
    /* @Codex */
    deletedAt: Date | null;
    /* @Codex */
    deletionReason: string | null;
};

/* @Codex */
type TherapyUpdateValues = {
    drugName?: string;
    aic?: string | null;
    atc?: string | null;
    activePrinciple?: string | null;
    dosage?: string;
    motivation?: string | null;
    diagnosisCode?: string | null;
    diagnosisName?: string | null;
    status?: 'active' | 'suspended' | 'completed';
    startDate?: Date;
    endDate?: Date | null;
    /* @Codex */
    updatedAt?: Date;
    /* @Codex */
    deletedAt?: Date | null;
    /* @Codex */
    deletionReason?: string | null;
};

/* @Codex */
type CheckupCreateValues = {
    id: string;
    patientId: string;
    date: Date;
    title: string;
    notes: string | null;
    status: 'pending' | 'completed' | 'cancelled';
    source: CheckupSource;
    createdAt: Date;
};

/* @Codex */
type CheckupUpdateValues = {
    date?: Date;
    title?: string;
    notes?: string | null;
    status?: 'pending' | 'completed' | 'cancelled';
    source?: CheckupSource | null;
};

/* @Codex */
export type CheckupSource = 'manual' | 'ai_suggestion';

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
function parseOptionalString(value: unknown, field: string): WriteNormalizationResult<string | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    if (typeof value !== 'string') {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: value };
}

/* @Codex */
function parseOptionalRequiredString(value: unknown, field: string): WriteNormalizationResult<string | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    const parsed = parseRequiredString(value, field);
    if (!parsed.ok) return parsed;

    return { ok: true, values: parsed.values };
}

/* @Codex */
function parseOptionalNullableString(value: unknown, field: string): WriteNormalizationResult<string | null | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    if (value === null || value === '') {
        return { ok: true, values: null };
    }

    if (typeof value !== 'string') {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: value };
}

/* @Codex */
function parseOptionalDate(value: unknown, field: string): WriteNormalizationResult<Date | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    const parsed = parseDate(value);
    if (!parsed) {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: parsed };
}

/* @Codex */
function parseOptionalNullableDate(value: unknown, field: string): WriteNormalizationResult<Date | null | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }
    if (value === null || value === '') {
        return { ok: true, values: null };
    }

    const parsed = parseDate(value);
    if (!parsed) {
        return { ok: false, error: `Invalid ${field}` };
    }

    return { ok: true, values: parsed };
}

/* @Codex */
function normalizeJsonText(value: unknown, field: string): WriteNormalizationResult<string | null> {
    if (value === undefined || value === null) {
        return { ok: true, values: null };
    }

    if (typeof value === 'string') {
        return { ok: true, values: value };
    }

    try {
        return { ok: true, values: JSON.stringify(value) };
    } catch {
        return { ok: false, error: `Invalid ${field}` };
    }
}

/* @Codex */
function normalizeOptionalJsonText(value: unknown, field: string): WriteNormalizationResult<string | null | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    return normalizeJsonText(value, field);
}

/* @Codex */
function normalizeEntrySetting(value: unknown): WriteNormalizationResult<string | null> {
    if (value === undefined || value === null || value === '') {
        return { ok: true, values: null };
    }

    if (value === 'home' || value === 'hospital' || value === 'ambulatory') {
        return { ok: true, values: value };
    }

    return { ok: false, error: 'Invalid setting' };
}

/* @Codex */
function normalizeOptionalEntrySetting(value: unknown): WriteNormalizationResult<string | null | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    return normalizeEntrySetting(value);
}

/* @Codex */
export function normalizeCheckupSource(value: unknown): WriteNormalizationResult<CheckupSource> {
    if (value === undefined || value === null || value === '') {
        return { ok: true, values: 'manual' };
    }

    if (value === 'manual' || value === 'ai_suggestion') {
        return { ok: true, values: value };
    }

    return { ok: false, error: 'Invalid source' };
}

/* @Codex */
export function normalizeOptionalCheckupSource(value: unknown): WriteNormalizationResult<CheckupSource | null | undefined> {
    if (value === undefined) {
        return { ok: true, values: undefined };
    }

    if (value === null || value === '') {
        return { ok: true, values: null };
    }

    return normalizeCheckupSource(value);
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

    const title = parseOptionalString(input.title, 'title');
    if (!title.ok) return title;

    const setting = normalizeEntrySetting(input.setting);
    if (!setting.ok) return setting;

    const metadata = normalizeJsonText(input.metadata, 'metadata');
    if (!metadata.ok) return metadata;

    const attachments = normalizeJsonText(input.attachments, 'attachments');
    if (!attachments.ok) return attachments;

    const updatedAt = parseOptionalDate(input.updatedAt, 'updatedAt');
    if (!updatedAt.ok) return updatedAt;

    const now = context.now ?? new Date();

    return {
        ok: true,
        values: {
            id: context.id,
            patientId: context.patientId,
            type: type.values,
            title: title.values ?? 'Voce clinica',
            date: date.values,
            content: content.values,
            setting: setting.values,
            metadata: metadata.values,
            attachments: attachments.values,
            version: 1,
            createdAt: now,
            updatedAt: updatedAt.values ?? now,
        },
    };
}

/* @Codex */
export function normalizeEntryUpdateInput(
    input: Record<string, unknown>
): WriteNormalizationResult<EntryUpdateValues> {
    const nextDate = parseOptionalDate(input.date, 'date');
    if (!nextDate.ok) return nextDate;

    const nextDeletedAt = parseOptionalNullableDate(input.deletedAt, 'deletedAt');
    if (!nextDeletedAt.ok) return nextDeletedAt;

    const nextUpdatedAt = parseOptionalDate(input.updatedAt, 'updatedAt');
    if (!nextUpdatedAt.ok) return nextUpdatedAt;

    const nextTitle = parseOptionalString(input.title, 'title');
    if (!nextTitle.ok) return nextTitle;

    const nextSetting = normalizeOptionalEntrySetting(input.setting);
    if (!nextSetting.ok) return nextSetting;

    const nextMetadata = normalizeOptionalJsonText(input.metadata, 'metadata');
    if (!nextMetadata.ok) return nextMetadata;

    const nextAttachments = normalizeOptionalJsonText(input.attachments, 'attachments');
    if (!nextAttachments.ok) return nextAttachments;

    const nextDeletionReason = parseNullableString(input.deletionReason, 'deletionReason');
    if (!nextDeletionReason.ok) return nextDeletionReason;

    const nextType = typeof input.type === 'string' ? input.type : undefined;
    const nextContent = typeof input.content === 'string' ? input.content : undefined;
    const hasDeletionReason = Object.prototype.hasOwnProperty.call(input, 'deletionReason');

    if (
        nextType === undefined &&
        nextContent === undefined &&
        nextDate.values === undefined &&
        nextTitle.values === undefined &&
        nextSetting.values === undefined &&
        nextMetadata.values === undefined &&
        nextAttachments.values === undefined &&
        nextDeletedAt.values === undefined &&
        !hasDeletionReason &&
        nextUpdatedAt.values === undefined
    ) {
        return { ok: false, error: 'No valid fields to update' };
    }

    return {
        ok: true,
        values: {
            type: nextType,
            title: nextTitle.values,
            content: nextContent,
            date: nextDate.values,
            setting: nextSetting.values,
            metadata: nextMetadata.values,
            attachments: nextAttachments.values,
            deletedAt: nextDeletedAt.values,
            deletionReason: hasDeletionReason ? nextDeletionReason.values : undefined,
            updatedAt: nextUpdatedAt.values ?? new Date(),
        },
    };
}

/* @Codex */
export function normalizeTherapyCreateInput(
    input: Record<string, unknown>,
    context: { id: string; patientId: string; now?: Date }
): WriteNormalizationResult<TherapyCreateValues> {
    const now = context.now ?? new Date();
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
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            deletionReason: null,
        },
    };
}

/* @Codex */
export function normalizeTherapyUpdateInput(
    input: Record<string, unknown>
): WriteNormalizationResult<TherapyUpdateValues> {
    const drugName = parseOptionalRequiredString(input.drugName, 'drugName');
    if (!drugName.ok) return drugName;

    const dosage = parseOptionalRequiredString(input.dosage, 'dosage');
    if (!dosage.ok) return dosage;

    const startDate = parseOptionalDate(input.startDate, 'startDate');
    if (!startDate.ok) return startDate;

    const endDate = parseOptionalNullableDate(input.endDate, 'endDate');
    if (!endDate.ok) return endDate;

    const updatedAt = parseOptionalDate(input.updatedAt, 'updatedAt');
    if (!updatedAt.ok) return updatedAt;

    const deletedAt = parseOptionalNullableDate(input.deletedAt, 'deletedAt');
    if (!deletedAt.ok) return deletedAt;

    const deletionReason = parseOptionalNullableString(input.deletionReason, 'deletionReason');
    if (!deletionReason.ok) return deletionReason;

    const aic = parseOptionalNullableString(input.aic, 'aic');
    if (!aic.ok) return aic;

    const atc = parseOptionalNullableString(input.atc, 'atc');
    if (!atc.ok) return atc;

    const activePrinciple = parseOptionalNullableString(input.activePrinciple, 'activePrinciple');
    if (!activePrinciple.ok) return activePrinciple;

    const motivation = parseOptionalNullableString(input.motivation, 'motivation');
    if (!motivation.ok) return motivation;

    const diagnosisCode = parseOptionalNullableString(input.diagnosisCode, 'diagnosisCode');
    if (!diagnosisCode.ok) return diagnosisCode;

    const diagnosisName = parseOptionalNullableString(input.diagnosisName, 'diagnosisName');
    if (!diagnosisName.ok) return diagnosisName;

    const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
    const hasDeletionReason = Object.prototype.hasOwnProperty.call(input, 'deletionReason');
    let status: TherapyUpdateValues['status'];
    if (hasStatus) {
        const parsedStatus = parseTherapyStatus(input.status);
        if (!parsedStatus) {
            return { ok: false, error: 'Invalid therapy status' };
        }
        status = parsedStatus;
    }

    if (
        drugName.values === undefined &&
        aic.values === undefined &&
        atc.values === undefined &&
        activePrinciple.values === undefined &&
        dosage.values === undefined &&
        motivation.values === undefined &&
        diagnosisCode.values === undefined &&
        diagnosisName.values === undefined &&
        status === undefined &&
        startDate.values === undefined &&
        endDate.values === undefined &&
        updatedAt.values === undefined &&
        deletedAt.values === undefined &&
        !hasDeletionReason
    ) {
        return { ok: false, error: 'No valid fields to update' };
    }

    return {
        ok: true,
        values: {
            drugName: drugName.values,
            aic: aic.values,
            atc: atc.values,
            activePrinciple: activePrinciple.values,
            dosage: dosage.values,
            motivation: motivation.values,
            diagnosisCode: diagnosisCode.values,
            diagnosisName: diagnosisName.values,
            status,
            startDate: startDate.values,
            endDate: endDate.values,
            updatedAt: updatedAt.values ?? new Date(),
            deletedAt: deletedAt.values,
            deletionReason: hasDeletionReason ? deletionReason.values : undefined,
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

    const source = normalizeCheckupSource(input.source);
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

/* @Codex */
export function normalizeCheckupUpdateInput(
    input: Record<string, unknown>
): WriteNormalizationResult<CheckupUpdateValues> {
    const date = parseOptionalDate(input.date, 'date');
    if (!date.ok) return date;

    const title = parseOptionalRequiredString(input.title, 'title');
    if (!title.ok) return title;

    const notes = parseOptionalNullableString(input.notes, 'notes');
    if (!notes.ok) return notes;

    const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
    let status: CheckupUpdateValues['status'];
    if (hasStatus) {
        const parsedStatus = parseCheckupStatus(input.status);
        if (!parsedStatus) {
            return { ok: false, error: 'Invalid checkup status' };
        }
        status = parsedStatus;
    }

    const source = normalizeOptionalCheckupSource(input.source);
    if (!source.ok) return source;

    if (
        date.values === undefined &&
        title.values === undefined &&
        notes.values === undefined &&
        status === undefined &&
        source.values === undefined
    ) {
        return { ok: false, error: 'No valid fields to update' };
    }

    return {
        ok: true,
        values: {
            date: date.values,
            title: title.values,
            notes: notes.values,
            status,
            source: source.values,
        },
    };
}
