/* @Codex — fixed host read model. No client projection, blob, path, decryption or write. */
import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { patients, entries, therapies, observations, attachments } from '../schema';
import { activePatients } from '../patient-lifecycle';
import type { NativeOrdinaryPreparation } from '../chatgpt-product/native-ordinary-wire';
import { ProductError } from '../chatgpt-product/product-contract';
export type NativeChartFunction = Exclude<NativeOrdinaryPreparation['functionId'], 'document_synthesis'>;
type Pair = Readonly<{ patientId: string; ambulatoryId: string }>;

/** Called only within an authentic owner's selected-patient critical section.
 * A read transaction gives one coherent SQLite snapshot, including child revisions.
 * Limits are deterministic source-selection policy, not completeness claims. */
export function readNativeOrdinarySourceRows(pair: Pair, functionId: NativeChartFunction) {
    return dbServer.transaction(database => {
        const patient = database.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, birthDate: patients.birthDate, version: patients.version, notes: patients.notes,
            diagnoses: patients.diagnoses, updatedAt: patients.updatedAt, deletedAt: patients.deletedAt,
            isArchived: patients.isArchived }).from(patients)
            .where(and(eq(patients.id, pair.patientId), activePatients())).get();
        if (!patient || patient.isArchived || !Number.isSafeInteger(patient.version) || patient.version < 1) throw new ProductError('revoked');
        const entryLimit = functionId === 'patient_insight' ? 12 : functionId === 'smart_import' ? 6 : 2;
        const clinicalEntries = database.select({ id: entries.id, title: entries.title, content: entries.content,
            date: entries.date, version: entries.version, updatedAt: entries.updatedAt, deletedAt: entries.deletedAt })
            .from(entries).where(and(eq(entries.patientId, pair.patientId), isNull(entries.deletedAt)))
            .orderBy(desc(entries.date), asc(entries.id)).limit(entryLimit).all();
        const activeTherapies = database.select({ id: therapies.id, drugName: therapies.drugName, dosage: therapies.dosage,
            activePrinciple: therapies.activePrinciple, aic: therapies.aic, atc: therapies.atc,
            updatedAt: therapies.updatedAt, startDate: therapies.startDate, version: therapies.version, deletedAt: therapies.deletedAt })
            .from(therapies).where(and(eq(therapies.patientId, pair.patientId), eq(therapies.status, 'active'), isNull(therapies.deletedAt)))
            .orderBy(desc(therapies.updatedAt), asc(therapies.id)).limit(functionId === 'smart_import' ? 65 : functionId === 'patient_insight' ? 12 : 4).all();
        if (activeTherapies.length > 64) throw new ProductError('invalid_state');
        const recentObservations = functionId !== 'treatment_reasoning' ? [] : database.select({ id: observations.id,
            display: observations.display, value: observations.value, unitCode: observations.unitCode,
            observedAt: observations.observedAt, version: observations.version, updatedAt: observations.updatedAt,
            deletedAt: observations.deletedAt }).from(observations)
            .where(and(eq(observations.patientId, pair.patientId), isNull(observations.deletedAt)))
            .orderBy(desc(observations.observedAt), asc(observations.id)).limit(3).all();
        const summaries = functionId === 'patient_insight' ? [] : database.select({ id: attachments.id, name: attachments.name,
            summarySnapshot: attachments.summarySnapshot, createdAt: attachments.createdAt,
            documentSourceRef: attachments.documentSourceRef, documentRevision: attachments.documentRevision,
            documentFreshnessEpoch: attachments.documentFreshnessEpoch }).from(attachments)
            .where(eq(attachments.patientId, pair.patientId)).orderBy(desc(attachments.createdAt), asc(attachments.id))
            .limit(functionId === 'smart_import' ? 3 : 1).all();
        return { patient, entries: clinicalEntries, therapies: activeTherapies, observations: recentObservations, attachments: summaries };
    });
}
export type NativeOrdinarySourceRows = ReturnType<typeof readNativeOrdinarySourceRows>;
