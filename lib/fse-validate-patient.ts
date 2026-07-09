/* @Codex */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { dbServer } from './db-server';
import { observations, patients, therapies } from './schema';
import { activePatients } from './patient-lifecycle';
import {
    PROFILE_OBSERVATION_VITALS,
    PROFILE_THERAPY_MEDICATION,
    validateProfileDocument,
} from './fse-validation';
import type {
    ValidatePatientExportResponse,
    ValidationItem,
    ValidationSummary,
} from './fse-validate-patient-contract';

/* @Codex */
export function getFseValidatePatientId(request: Request): string | null {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId')?.trim() ?? '';
    return patientId.length > 0 ? patientId : null;
}

/* @Codex */
export function buildFseValidationSummary(items: ValidationItem[]): ValidationSummary {
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

/* @Codex */
export async function validatePatientExport(patientId: string): Promise<ValidatePatientExportResponse | null> {
    const patient = await dbServer
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, patientId), activePatients()))
        .get();
    if (!patient) return null;

    const [therapyRows, observationRows] = await Promise.all([
        dbServer.select().from(therapies).where(and(eq(therapies.patientId, patientId), isNull(therapies.deletedAt))),
        dbServer.select().from(observations).where(and(eq(observations.patientId, patientId), isNull(observations.deletedAt))),
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

    const therapyMedication = buildFseValidationSummary(therapyItems);
    const observationVitals = buildFseValidationSummary(observationItems);

    return {
        patientId,
        hasErrors: therapyMedication.errorCount + observationVitals.errorCount > 0,
        hasWarnings: therapyMedication.warningCount + observationVitals.warningCount > 0,
        therapyMedication,
        observationVitals,
    };
}
