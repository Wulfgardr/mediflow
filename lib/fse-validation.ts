/* @Codex */
import 'server-only';

import { and, asc, isNotNull, sql } from 'drizzle-orm';
import {
    buildValidationResponse,
    normalizeTerminologySystem,
    resolveStaticTerminology,
    type FseValidationIssue,
    type FseValidationResponse,
} from './terminology';

/* @Codex */
export const PROFILE_THERAPY_MEDICATION = 'therapy-medication-v1';
/* @Codex */
export const PROFILE_OBSERVATION_VITALS = 'observation-vitals-v1';

/* @Codex */
export type TherapyDocumentPayload = {
    drugName?: unknown;
    aic?: unknown;
    atc?: unknown;
};

/* @Codex */
export type ObservationDocumentPayload = {
    codeSystem?: unknown;
    code?: unknown;
    unitSystem?: unknown;
    unitCode?: unknown;
    value?: unknown;
};

/* @Codex */
export type TherapyAtcLookup = (code: string) => Promise<boolean>;

/* @Codex */
function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
async function hasAtcInCatalog(code: string): Promise<boolean> {
    const [{ dbServer }, { drugs }] = await Promise.all([
        import('./db-server'),
        import('./schema'),
    ]);
    const row = await dbServer
        .select({ atc: drugs.atc })
        .from(drugs)
        .where(and(
            isNotNull(drugs.atc),
            sql`upper(${drugs.atc}) = ${code.trim().toUpperCase()}`,
        ))
        .orderBy(asc(drugs.atc))
        .get();
    return Boolean(row?.atc);
}

/* @Codex */
export async function validateTherapyDocumentWithLookup(
    payload: TherapyDocumentPayload,
    hasAtcLookup: TherapyAtcLookup,
): Promise<{ errors: FseValidationIssue[]; warnings: FseValidationIssue[] }> {
    const errors: FseValidationIssue[] = [];
    const warnings: FseValidationIssue[] = [];

    const drugName = asNonEmptyString(payload.drugName);
    const aic = asNonEmptyString(payload.aic);
    const atc = asNonEmptyString(payload.atc);

    if (!drugName) {
        errors.push({
            field: 'drugName',
            code: 'REQUIRED',
            message: 'drugName is required for therapy-medication-v1',
        });
    }

    if (!aic) {
        warnings.push({
            field: 'aic',
            code: 'MISSING_AIC',
            message: 'AIC is recommended for medication traceability in FSE workflows',
        });
    }

    if (!atc) {
        warnings.push({
            field: 'atc',
            code: 'MISSING_ATC',
            message: 'ATC is recommended for therapeutic class compliance and analytics',
        });
    } else {
        const atcFormat = /^[A-Z][0-9]{2}[A-Z]{1,2}[0-9]{2}$/i;
        if (!atcFormat.test(atc)) {
            warnings.push({
                field: 'atc',
                code: 'ATC_FORMAT',
                message: 'ATC code format looks invalid',
            });
        }
        const exists = await hasAtcLookup(atc);
        if (!exists) {
            warnings.push({
                field: 'atc',
                code: 'ATC_NOT_FOUND',
                message: 'ATC code was not found in the local catalog',
            });
        }
    }

    return { errors, warnings };
}

/* @Codex */
export async function validateTherapyDocument(payload: TherapyDocumentPayload): Promise<{ errors: FseValidationIssue[]; warnings: FseValidationIssue[] }> {
    return validateTherapyDocumentWithLookup(payload, hasAtcInCatalog);
}

/* @Codex */
export function validateObservationDocument(payload: ObservationDocumentPayload): { errors: FseValidationIssue[]; warnings: FseValidationIssue[] } {
    const errors: FseValidationIssue[] = [];
    const warnings: FseValidationIssue[] = [];

    const codeSystem = normalizeTerminologySystem(payload.codeSystem);
    const code = asNonEmptyString(payload.code);
    const unitSystem = normalizeTerminologySystem(payload.unitSystem);
    const unitCode = asNonEmptyString(payload.unitCode);
    const numericValue = typeof payload.value === 'number' ? payload.value : Number(payload.value);

    if (codeSystem !== 'LOINC') {
        errors.push({
            field: 'codeSystem',
            code: 'LOINC_REQUIRED',
            message: 'codeSystem must be LOINC for observation-vitals-v1',
        });
    }
    if (!code) {
        errors.push({
            field: 'code',
            code: 'REQUIRED',
            message: 'code is required for observation-vitals-v1',
        });
    } else if (!resolveStaticTerminology('LOINC', code)) {
        errors.push({
            field: 'code',
            code: 'UNKNOWN_LOINC',
            message: 'LOINC code is not part of the current pilot subset',
        });
    }

    if (unitSystem !== 'UCUM') {
        errors.push({
            field: 'unitSystem',
            code: 'UCUM_REQUIRED',
            message: 'unitSystem must be UCUM for observation-vitals-v1',
        });
    }
    if (!unitCode) {
        errors.push({
            field: 'unitCode',
            code: 'REQUIRED',
            message: 'unitCode is required for observation-vitals-v1',
        });
    } else if (!resolveStaticTerminology('UCUM', unitCode)) {
        errors.push({
            field: 'unitCode',
            code: 'UNKNOWN_UCUM',
            message: 'UCUM unit is not part of the current pilot subset',
        });
    }

    if (!Number.isFinite(numericValue)) {
        errors.push({
            field: 'value',
            code: 'NUMERIC_REQUIRED',
            message: 'value must be numeric for observation-vitals-v1',
        });
    }

    return { errors, warnings };
}

/* @Codex */
function normalizePayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') return {};
    return payload as Record<string, unknown>;
}

/* @Codex */
export async function validateProfileDocument(profile: string, payload: unknown): Promise<FseValidationResponse | null> {
    return validateProfileDocumentWithLookup(profile, payload, hasAtcInCatalog);
}

/* @Codex */
export async function validateProfileDocumentWithLookup(
    profile: string,
    payload: unknown,
    hasAtcLookup: TherapyAtcLookup,
): Promise<FseValidationResponse | null> {
    const normalizedPayload = normalizePayload(payload);

    if (profile === PROFILE_THERAPY_MEDICATION) {
        const { errors, warnings } = await validateTherapyDocumentWithLookup(
            normalizedPayload as TherapyDocumentPayload,
            hasAtcLookup,
        );
        return buildValidationResponse(profile, errors, warnings);
    }

    if (profile === PROFILE_OBSERVATION_VITALS) {
        const { errors, warnings } = validateObservationDocument(normalizedPayload as ObservationDocumentPayload);
        return buildValidationResponse(profile, errors, warnings);
    }

    return null;
}
