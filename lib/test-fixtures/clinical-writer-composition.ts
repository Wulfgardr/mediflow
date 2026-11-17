import { eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import * as entryWriter from '../entry-write-operation';
import * as therapyWriter from '../therapy-write-operation';
import * as serviceWriter from '../service-prescription-write';
import { createObservationOperationInTransaction } from '../observation-write-operation';
import { createWebAttachmentInTransaction } from '../attachment-web-create';
import { updatePatientOperationInTransaction } from '../patient-update-operation';
import { PATIENT_PROFILE_UPDATE_OPERATION } from '../patient-profile-update-contract';
import { bindSyntheticArchiveSessions } from '../security/web-auth-lifecycle-owner-test-fixture';
import { patients, users } from '../schema';

export const patientId = 'synthetic-composition-patient';
export const session = { id: `synthetic-composition-session-${process.pid}`, userId: 'synthetic-composition-doctor',
    username: ['synthetic', 'doctor'].join('-'), role: 'admin', authChannel: 'web' as const,
    createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const generation = bindSyntheticArchiveSessions(session.id);
const audit = { actorType: 'user' as const, actorRef: session.userId, sourceSurface: 'web' as const,
    archiveGeneration: generation, flags: [] };
const request = new Request('http://127.0.0.1/synthetic-composition');
const date = new Date('2026-11-17');
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];

export function seedComposition(): void {
    dbServer.insert(users).values({ id: session.userId, username: session.username, displayName: 'Medico Sintetico',
        passwordHash: 'unused', encryptedMasterKey: 'synthetic', salt: 'synthetic' }).run();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Paziente', lastName: 'Sintetico', taxCode: 'SYNTHETIC' }).run();
}

export function compositionSnapshot() {
    return { counts: Object.fromEntries(['entries', 'therapies', 'service_prescriptions', 'attachments', 'observations', 'audit_events']
        .map(table => [table, (dbServer.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n])),
        patient: dbServer.select().from(patients).where(eq(patients.id, patientId)).get() };
}

export function composeOriginalThree(prefix: string): Promise<unknown>[] {
    const pending: Promise<unknown>[] = [];
    dbServer.transaction(tx => {
        const entryInput = { patientId, id: `${prefix}-note`, values: { id: `${prefix}-note`, patientId, type: 'visit',
            title: 'ENC:synthetic:title', content: 'ENC:synthetic:note', date }, changedFields: ['content'], mode: 'web' as const, audit };
        const therapyInput = { patientId, therapyId: `${prefix}-therapy`, values: { id: `${prefix}-therapy`, patientId,
            drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', startDate: date },
            changedFields: ['drugName'], mode: 'web' as const, audit };
        const body = { id: `${prefix}-service`, patientId, prescribedAt: '2026-11-17', serviceName: 'ENC:synthetic:service' };
        const entry = Reflect.has(entryWriter, 'createEntryOperationInTransaction')
            ? entryWriter.createEntryOperationInTransaction(tx, entryInput) : entryWriter.createEntryOperation(entryInput);
        if (entry.status !== 201) throw new Error('SYNTHETIC_ENTRY_DENIED');
        const therapy = Reflect.has(therapyWriter, 'createTherapyOperationInTransaction')
            ? therapyWriter.createTherapyOperationInTransaction(tx, therapyInput) : therapyWriter.createTherapyOperation(therapyInput);
        if (therapy.status !== 201) throw new Error('SYNTHETIC_THERAPY_DENIED');
        const service = Reflect.has(serviceWriter, 'createHostServicePrescriptionInTransaction')
            ? serviceWriter.createHostServicePrescriptionInTransaction(tx, { request, session }, body)
            : serviceWriter.createHostServicePrescription({ request, session }, body);
        if (service instanceof Promise) {
            pending.push(service);
            service.catch(() => undefined);
        } else if (service.status !== 201) throw new Error('SYNTHETIC_SERVICE_DENIED');
    }, { behavior: 'immediate' });
    return pending;
}

export const compositionSteps = ['note', 'transcript', 'attachment', 'therapy', 'service', 'diagnoses', 'exemptions', 'observation'] as const;

function steps(tx: Tx, prefix: string) {
    const entry = (kind: string) => entryWriter.createEntryOperationInTransaction(tx, { patientId, id: `${prefix}-${kind}`,
        values: { id: `${prefix}-${kind}`, patientId, type: 'visit', title: `ENC:synthetic:${kind}`, content: `ENC:synthetic:${kind}`, date },
        mode: 'web', audit, changedFields: ['content'] });
    const profile = (values: { diagnoses?: string; exemptions?: string }, expectedVersion: number) => updatePatientOperationInTransaction(tx, {
        operationId: PATIENT_PROFILE_UPDATE_OPERATION.id, contractVersion: PATIENT_PROFILE_UPDATE_OPERATION.version,
        patientId, expectedVersion, values, setPrimaryAmbulatory: false, audit });
    return [
        () => entry('note'),
        () => entry('transcript'),
        () => createWebAttachmentInTransaction(tx, request, session, { id: `${prefix}-attachment`, patientId,
            name: 'ENC:synthetic:pdf', type: 'application/pdf', size: 1, data: 'ENC:YQ==:Yg==' }),
        () => therapyWriter.createTherapyOperationInTransaction(tx, { patientId, therapyId: `${prefix}-therapy`,
            values: { id: `${prefix}-therapy`, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', startDate: date },
            mode: 'web', audit, changedFields: ['drugName'] }),
        () => serviceWriter.createHostServicePrescriptionInTransaction(tx, { request, session }, { id: `${prefix}-service`, patientId,
            prescribedAt: '2026-11-17', serviceName: 'ENC:synthetic:service' }),
        () => profile({ diagnoses: 'ENC:synthetic:diagnoses' }, 1),
        () => profile({ exemptions: 'ENC:synthetic:exemptions' }, 2),
        () => createObservationOperationInTransaction(tx, { patientId, observationId: `${prefix}-observation`,
            values: { id: `${prefix}-observation`, patientId, codeSystem: 'synthetic', code: 'synthetic', display: 'ENC:synthetic:observation', unitSystem: 'synthetic', unitCode: '1', value: 'ENC:synthetic:value', observedAt: date },
            mode: 'web', audit, changedFields: ['content'] }),
    ];
}

export function composeAll(prefix: string, options: { failAfter?: number; expectedRevision?: number; denyAt?: number } = {}): void {
    dbServer.transaction(tx => {
        const patient = tx.select().from(patients).where(eq(patients.id, patientId)).get();
        if (patient?.version !== (options.expectedRevision ?? 1)) throw new Error('SYNTHETIC_REVISION_CHANGED');
        for (const [index, apply] of steps(tx, prefix).entries()) {
            if (options.denyAt === index) throw new Error('SYNTHETIC_COMMIT_REVOKED');
            const result = apply();
            if (result.status !== 200 && result.status !== 201) throw new Error(`SYNTHETIC_ELEMENT_DENIED:${result.status}`);
            if (index === options.failAfter) throw new Error(`SYNTHETIC_ELEMENT_FAILURE:${index}`);
        }
    }, { behavior: 'immediate' });
}
