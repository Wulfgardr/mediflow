/* @Codex */
import { NextResponse } from 'next/server';
import { and, asc, isNotNull, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { drugs } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/local-api-auth';
import {
    buildValidationResponse,
    normalizeTerminologySystem,
    resolveStaticTerminology,
    type FseValidationIssue,
} from '@/lib/terminology';

/* @Codex */
type TherapyDocumentPayload = {
    drugName?: unknown;
    aic?: unknown;
    atc?: unknown;
};

/* @Codex */
type ObservationDocumentPayload = {
    codeSystem?: unknown;
    code?: unknown;
    unitSystem?: unknown;
    unitCode?: unknown;
    value?: unknown;
};

/* @Codex */
const PROFILE_THERAPY = 'therapy-medication-v1';
/* @Codex */
const PROFILE_OBSERVATION = 'observation-vitals-v1';

/* @Codex */
function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
async function hasAtcInCatalog(code: string): Promise<boolean> {
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
async function validateTherapyDocument(payload: TherapyDocumentPayload): Promise<{ errors: FseValidationIssue[]; warnings: FseValidationIssue[] }> {
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
        const exists = await hasAtcInCatalog(atc);
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
function validateObservationDocument(payload: ObservationDocumentPayload): { errors: FseValidationIssue[]; warnings: FseValidationIssue[] } {
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
export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const body = await request.json();
        const profile = asNonEmptyString(body?.profile);
        const payload = body?.document ?? body?.payload ?? {};

        if (!profile) {
            return NextResponse.json({ error: 'profile is required' }, { status: 400 });
        }

        if (profile === PROFILE_THERAPY) {
            const { errors, warnings } = await validateTherapyDocument(payload as TherapyDocumentPayload);
            return NextResponse.json(buildValidationResponse(profile, errors, warnings));
        }

        if (profile === PROFILE_OBSERVATION) {
            const { errors, warnings } = validateObservationDocument(payload as ObservationDocumentPayload);
            return NextResponse.json(buildValidationResponse(profile, errors, warnings));
        }

        return NextResponse.json({ error: 'Unsupported profile' }, { status: 400 });
    } catch (error) {
        console.error('API POST /api/v1/fse/validate-document error:', error);
        return NextResponse.json({ error: 'Failed to validate profile document' }, { status: 500 });
    }
}
