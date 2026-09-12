/* @Codex: synchronous transaction encloses ALL owner checks, including post-callback denial. */
import type { patients } from './schema.ts';
import type { PatientCreateContextRegistry, PatientCreatePrecondition, PatientCreateSession } from './security/patient-create-context.ts';

type PatientValues = typeof patients.$inferInsert;
export type PatientCreateTransaction = Readonly<{
    targetExists: (id: string) => boolean;
    insertPatient: (values: PatientValues) => void;
    insertMembership: (patientId: string, ambulatoryId: string) => void;
}>;
/** A synchronous database port, implemented by Drizzle in the route and real SQL in tests. */
export type PatientCreateDatabase = Readonly<{
    transaction: (operation: (tx: PatientCreateTransaction) => string) => string;
}>;
export class PatientCreateFenceError extends Error {
    constructor() { super('Patient create precondition denied.'); this.name = 'PatientCreateFenceError'; }
}

export function createPatientAtPreviewDestination(database: PatientCreateDatabase,
    contexts: PatientCreateContextRegistry, session: PatientCreateSession,
    precondition: PatientCreatePrecondition, values: PatientValues): string {
    return database.transaction(tx => {
        let writeFailed = false;
        let writeError: unknown;
        const allowed = contexts.withCurrentBinding(session, precondition, ambulatoryId => {
            try {
                if (!tx.targetExists(ambulatoryId)) throw new PatientCreateFenceError();
                tx.insertPatient({ ...values, ambulatoryId });
                tx.insertMembership(values.id, ambulatoryId);
            } catch (error) {
                writeFailed = true;
                writeError = error;
                throw error;
            }
        });
        if (writeFailed) throw writeError;
        if (!allowed) throw new PatientCreateFenceError();
        // Drizzle/better-sqlite3 commits only AFTER this callback returns. No await.
        return values.id;
    });
}
