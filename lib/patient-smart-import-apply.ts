/* @Codex */
import { and, eq } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { activePatients } from './patient-lifecycle';
import {
    buildPatientVersionConflictPayload,
    type PatientVersionConflictPayload,
} from './patient-concurrency';
import { patients, therapies } from './schema';

export type PatientSmartImportTherapyValues = typeof therapies.$inferInsert;

type PatientSmartImportApplyInput = {
    patientId: string;
    expectedVersion: number;
    diagnoses?: string;
    therapies: PatientSmartImportTherapyValues[];
    now?: Date;
};

export type PatientSmartImportApplyResult =
    | {
        status: 200;
        value: {
            success: true;
            patientVersion: number;
            therapyIds: string[];
        };
    }
    | { status: 404; value: { error: 'Not found' } }
    | { status: 409; value: PatientVersionConflictPayload };

type TransactionDatabase = Pick<typeof dbServer, 'transaction'>;

export function commitPatientSmartImport(
    database: TransactionDatabase,
    input: PatientSmartImportApplyInput,
): PatientSmartImportApplyResult {
    return database.transaction((tx): PatientSmartImportApplyResult => {
        const current = tx.select({
            id: patients.id,
            version: patients.version,
            updatedAt: patients.updatedAt,
            isArchived: patients.isArchived,
        })
            .from(patients)
            .where(and(eq(patients.id, input.patientId), activePatients()))
            .get();

        if (!current) {
            return { status: 404, value: { error: 'Not found' } };
        }
        if (current.version !== input.expectedVersion) {
            return {
                status: 409,
                value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, current),
            };
        }

        const patientVersion = input.diagnoses === undefined
            ? current.version
            : current.version + 1;

        if (input.diagnoses !== undefined) {
            const updated = tx.update(patients)
                .set({
                    diagnoses: input.diagnoses,
                    version: patientVersion,
                    updatedAt: input.now ?? new Date(),
                })
                .where(and(
                    eq(patients.id, input.patientId),
                    eq(patients.version, input.expectedVersion),
                    activePatients(),
                ))
                .run();

            if (updated.changes === 0) {
                return {
                    status: 409,
                    value: buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, current),
                };
            }
        }

        for (const therapy of input.therapies) {
            tx.insert(therapies).values(therapy).run();
        }

        return {
            status: 200,
            value: {
                success: true,
                patientVersion,
                therapyIds: input.therapies.map((therapy) => therapy.id),
            },
        };
    });
}
