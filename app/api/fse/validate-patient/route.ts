/* @Codex */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { observations, patients, therapies } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
// WUL-306 (ADR 0066): soft-deleted patients are not addressable for FSE validation
import { activePatients } from '@/lib/patient-lifecycle';
import {
    PROFILE_OBSERVATION_VITALS,
    PROFILE_THERAPY_MEDICATION,
    validateProfileDocument,
} from '@/lib/fse-validation';
import type { FseValidationIssue } from '@/lib/terminology';

/* @Codex */
type ValidationItem = {
    id: string;
    ok: boolean;
    errors: FseValidationIssue[];
    warnings: FseValidationIssue[];
};

/* @Codex */
type ValidationSummary = {
    total: number;
    ok: number;
    withErrors: number;
    withWarnings: number;
    errorCount: number;
    warningCount: number;
    items: ValidationItem[];
};

/* @Codex */
function getPatientId(request: Request): string | null {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId')?.trim() ?? '';
    return patientId.length > 0 ? patientId : null;
}

/* @Codex */
function buildSummary(items: ValidationItem[]): ValidationSummary {
    return {
        total: items.length,
        ok: items.filter((item) => item.ok).length,
        withErrors: items.filter((item) => item.errors.length > 0).length,
        withWarnings: items.filter((item) => item.warnings.length > 0).length,
        errorCount: items.reduce((sum, item) => sum + item.errors.length, 0),
        warningCount: items.reduce((sum, item) => sum + item.warnings.length, 0),
        items,
    };
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const patientId = getPatientId(request);
        if (!patientId) {
            return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
        }

        const patient = await dbServer
            .select({ id: patients.id })
            .from(patients)
            .where(and(eq(patients.id, patientId), activePatients()))
            .get();
        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        const [therapyRows, observationRows] = await Promise.all([
            dbServer.select().from(therapies).where(eq(therapies.patientId, patientId)),
            dbServer.select().from(observations).where(eq(observations.patientId, patientId)),
        ]);

        const therapyItems = await Promise.all(therapyRows.map(async (therapy) => {
            const result = await validateProfileDocument(PROFILE_THERAPY_MEDICATION, {
                drugName: therapy.drugName,
                aic: therapy.aic,
                atc: therapy.atc,
            });
            if (!result) {
                return {
                    id: therapy.id,
                    ok: false,
                    errors: [{ field: 'profile', code: 'UNSUPPORTED_PROFILE', message: PROFILE_THERAPY_MEDICATION }],
                    warnings: [],
                } satisfies ValidationItem;
            }
            return {
                id: therapy.id,
                ok: result.ok,
                errors: result.errors,
                warnings: result.warnings,
            } satisfies ValidationItem;
        }));

        const observationItems = await Promise.all(observationRows.map(async (observation) => {
            const result = await validateProfileDocument(PROFILE_OBSERVATION_VITALS, {
                codeSystem: observation.codeSystem,
                code: observation.code,
                unitSystem: observation.unitSystem,
                unitCode: observation.unitCode,
                value: observation.value,
            });
            if (!result) {
                return {
                    id: observation.id,
                    ok: false,
                    errors: [{ field: 'profile', code: 'UNSUPPORTED_PROFILE', message: PROFILE_OBSERVATION_VITALS }],
                    warnings: [],
                } satisfies ValidationItem;
            }
            return {
                id: observation.id,
                ok: result.ok,
                errors: result.errors,
                warnings: result.warnings,
            } satisfies ValidationItem;
        }));

        const therapySummary = buildSummary(therapyItems);
        const observationSummary = buildSummary(observationItems);
        const hasErrors = therapySummary.errorCount + observationSummary.errorCount > 0;
        const hasWarnings = therapySummary.warningCount + observationSummary.warningCount > 0;

        return NextResponse.json({
            patientId,
            hasErrors,
            hasWarnings,
            therapyMedication: therapySummary,
            observationVitals: observationSummary,
        });
    } catch (error) {
        console.error('API GET /api/fse/validate-patient error:', error);
        return NextResponse.json({ error: 'Failed to validate patient export' }, { status: 500 });
    }
}
