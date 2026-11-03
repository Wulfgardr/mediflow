'use client';

/**
 * Porte di produzione del dossier (ADR 0175): la sola facade cifrata `db` e la route
 * di estrazione in sola lettura. Ogni scrittura passa da un writer già in roster
 * (D-04, D-02, P-01, T-03, O-03, E-03, SP-06, SP-03, PR-03): nessun SQL, nessuna
 * nuova autorità.
 */

import { ApiConflictError, captureAttachmentWritePrecondition, db, type Attachment } from './db';
import { AttachmentCollectionChangedError, AttachmentCollectionView } from './attachment-collection-client';
import { decodeBase64, encodeBase64 } from './security/attachment-file-envelope';
import { isLockedDataPlaceholder } from './locked-field-guard';
import { entryFactRef, DossierCollectionChanged, DossierVersionConflict, DossierWriteRejected,
    type DossierAttachmentMeta, type DossierPatient, type DossierPorts, type DossierRecordTable } from './document-dossier-session';
import type { DossierHostExtraction } from './domain/documents/dossier-import';

const EXTRACTION_ENDPOINT = '/api/documents/dossier-extraction';
const CREATE_REQUEST_LIMIT = 25 * 1024 * 1024;
const UPDATE_REQUEST_LIMIT = 4 * 1024 * 1024 - 64 * 1024;

const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const day = (value: unknown) => {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

function tableFor(name: DossierRecordTable) {
    switch (name) {
        case 'therapies': return db.therapies;
        case 'observations': return db.observations;
        case 'entries': return db.entries;
        case 'service_prescriptions': return db.servicePrescriptions;
        case 'service_prescription_items': return db.servicePrescriptionItems;
        case 'prosthetic_prescriptions': return db.prostheticPrescriptions;
    }
}

function patientView(patient: { id: string; firstName: string; lastName: string; taxCode: string; birthDate?: Date; version?: number;
    diagnoses?: Array<{ code: string; description: string; system: string; date: Date }>; exemptions?: string[] }): DossierPatient {
    return {
        id: patient.id, firstName: patient.firstName, lastName: patient.lastName, taxCode: patient.taxCode ?? '',
        ...(patient.birthDate ? { birthDate: day(patient.birthDate) } : {}), ...(typeof patient.version === 'number' ? { version: patient.version } : {}),
        diagnoses: Array.isArray(patient.diagnoses) ? patient.diagnoses.map((item) => ({ code: item.code ?? '', description: item.description ?? '',
            system: item.system ?? '', date: item.date instanceof Date ? item.date.toISOString() : String(item.date ?? '') })) : [],
        exemptions: Array.isArray(patient.exemptions) ? patient.exemptions.filter((code): code is string => typeof code === 'string') : [],
    };
}

function attachmentMeta(item: Attachment): DossierAttachmentMeta {
    const unreadable = isLockedDataPlaceholder(item.parseEvidenceArtifactSnapshot);
    return { id: item.id, patientId: item.patientId, name: item.name, size: item.size, type: item.type,
        ...(unreadable ? { artifactUnreadable: true } : item.parseEvidenceArtifactSnapshot ? { parseEvidenceArtifactSnapshot: item.parseEvidenceArtifactSnapshot } : {}),
        ...(item.currentness ? { currentness: item.currentness } : {}) };
}

function dataUrl(type: string, bytes: Uint8Array): string { return `data:${type || 'application/octet-stream'};base64,${encodeBase64(bytes)}`; }

export function createDossierPorts(): DossierPorts {
    return {
        sessionSignal: () => db.getSessionReadSignal(),
        async extract(bytes, signal): Promise<DossierHostExtraction | { status: 'busy' }> {
            try {
                const response = await fetch(EXTRACTION_ENDPOINT, { method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
                    headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
                if (response.status === 503) return { status: 'busy' };
                if (!response.ok) return { status: 'failed', detail: 'unavailable' };
                const value = await response.json() as DossierHostExtraction;
                if (value?.status === 'extracted' && typeof value.markdown === 'string') {
                    const ocr = value.ocr && Number.isSafeInteger(value.ocr.pageCount) && Number.isSafeInteger(value.ocr.ocrPageCount) ? value.ocr : null;
                    return { status: 'extracted', markdown: value.markdown, ocr };
                }
                return value?.status === 'failed' && typeof value.detail === 'string' ? value : { status: 'failed', detail: 'unavailable' };
            } catch (error) {
                if (signal.aborted) throw error;
                return { status: 'failed', detail: 'unavailable' };
            }
        },
        async sha256(bytes) { return toHex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))); },
        async listPatients(signal) {
            const patients = await db.patients.toArray({ signal, rejectAuthUnavailable: true });
            return patients.filter((patient) => !patient.deletedAt && !patient.isArchived).map(patientView);
        },
        async getPatient(id, signal) {
            const patient = await db.patients.get(id, { signal });
            return patient && !patient.deletedAt ? patientView(patient) : undefined;
        },
        async updatePatientCodes(id, change) {
            try {
                await db.patients.update(id, {
                    version: change.version,
                    ...(change.diagnoses ? { diagnoses: change.diagnoses.map((item) => ({ ...item, date: new Date(item.date) })) } : {}),
                    ...(change.exemptions ? { exemptions: change.exemptions } : {}),
                });
            } catch (error) {
                if (error instanceof ApiConflictError) throw new DossierVersionConflict();
                throw new DossierWriteRejected(null);
            }
        },
        async listAttachments(patientId, signal) {
            const rows = await db.attachments.query({ patientId, metadataOnly: true }).toArray({ signal, rejectAuthUnavailable: true });
            return rows.filter((row) => row.patientId === patientId).map(attachmentMeta);
        },
        async readAttachmentBytes(id, patientId, signal) {
            const file = await db.attachments.get(id, { signal });
            if (!file || file.patientId !== patientId || typeof file.data !== 'string' || isLockedDataPlaceholder(file.data)) return null;
            const header = /^data:[^,]{0,512};base64,/iu.exec(file.data);
            if (!header) return null;
            try { return decodeBase64(file.data.slice(header[0].length)); } catch { return null; }
        },
        async createAttachment(input, seen) {
            const collection = AttachmentCollectionView.capture(input.patientId, seen.map((item) => ({ id: item.id, patientId: item.patientId, currentness: item.currentness })));
            try {
                await db.attachments.add({ id: input.id, patientId: input.patientId, name: input.name, type: input.type, size: input.size,
                    path: `uploads/${input.name}`, data: dataUrl(input.type, input.bytes), parseEvidenceArtifactSnapshot: input.parseEvidenceArtifactSnapshot,
                    createdAt: new Date() }, { attachmentCollection: collection });
            } catch (error) {
                if (error instanceof AttachmentCollectionChangedError) throw new DossierCollectionChanged();
                throw error;
            }
        },
        async updateArtifact(attachment, snapshot) {
            const attachmentPrecondition = captureAttachmentWritePrecondition({ id: attachment.id, patientId: attachment.patientId, currentness: attachment.currentness });
            try {
                await db.attachments.update(attachment.id, { parseEvidenceArtifactSnapshot: snapshot }, { attachmentPrecondition });
            } catch {
                // D-02 risponde 409 su currentness cambiata: il chiamante rilegge sempre prima di riprovare.
                throw new DossierVersionConflict();
            }
        },
        async measureCreate(input) {
            const prepared = await db.attachments.prepareWritePayload({ name: input.name, path: `uploads/${input.name}`,
                data: dataUrl(input.type, input.bytes), parseEvidenceArtifactSnapshot: input.parseEvidenceArtifactSnapshot });
            const original = String(prepared.data ?? '').length;
            const artifact = String(prepared.parseEvidenceArtifactSnapshot ?? '').length;
            return { original, artifact, request: original + artifact + String(prepared.name ?? '').length + String(prepared.path ?? '').length + 4096 };
        },
        async measureArtifact(snapshot) {
            const prepared = await db.attachments.prepareWritePayload({ parseEvidenceArtifactSnapshot: snapshot }, true);
            return String(prepared.parseEvidenceArtifactSnapshot ?? '').length + 1024;
        },
        async getRecord(table, id, patientId, signal) {
            const rows = await tableFor(table).query({ patientId }).toArray({ signal, rejectAuthUnavailable: true });
            const record = (rows as unknown as Array<Record<string, unknown>>).find((row) => row.id === id);
            return record && record.patientId === patientId ? record : undefined;
        },
        async createRecord(table, record) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (tableFor(table) as any).add(record);
            } catch (error) {
                const status = /: (\d{3}) /u.exec(error instanceof Error ? error.message : '')?.[1];
                throw new DossierWriteRejected(status ? Number(status) : null);
            }
        },
        async currentRecords(patientId, signal) {
            const options = { signal, rejectAuthUnavailable: true };
            const [patient, therapies, observations, entries, servicePrescriptions, prosthetic] = await Promise.all([
                db.patients.get(patientId, { signal }),
                db.therapies.query({ patientId }).toArray(options),
                db.observations.query({ patientId }).toArray(options),
                db.entries.query({ patientId }).toArray(options),
                db.servicePrescriptions.query({ patientId }).toArray(options),
                db.prostheticPrescriptions.query({ patientId }).toArray(options),
            ]);
            const view = patient ? patientView(patient) : null;
            const own = <T extends { patientId?: string; deletedAt?: Date | null }>(rows: T[]) => rows.filter((row) => row.patientId === patientId && !row.deletedAt);
            return {
                diagnoses: view?.diagnoses.map((item) => ({ ...item, date: item.date.slice(0, 10) })) ?? [],
                exemptions: view?.exemptions ?? [],
                therapies: own(therapies).map((item) => ({ id: item.id, drugName: item.drugName, dosage: item.dosage, status: item.status, startDate: day(item.startDate), endDate: day(item.endDate) })),
                observations: own(observations).map((item) => ({ id: item.id, code: item.code, display: item.display, value: String(item.value), unitCode: item.unitCode, observedAt: day(item.observedAt) })),
                entries: own(entries).map((item) => ({ id: item.id, dossierFactRef: entryFactRef(item.metadata) })),
                servicePrescriptions: servicePrescriptions.filter((item) => item.patientId === patientId).map((item) => ({ id: item.id, serviceName: item.serviceName,
                    prescribedAt: day(item.prescribedAt), requestReference: item.requestReference, priority: item.priority })),
                prostheticPrescriptions: prosthetic.filter((item) => item.patientId === patientId).map((item) => ({ id: item.id, description: item.description, prescribedAt: day(item.prescribedAt), status: item.status, isoCode: item.isoCode })),
            };
        },
        async exemptionCodes(signal) {
            const rows = await db.exemptions.toArray({ signal, rejectAuthUnavailable: true });
            return new Set(rows.map((row) => String(row.code ?? '').toUpperCase()).filter(Boolean));
        },
        newId: () => crypto.randomUUID(),
        now: () => new Date(),
        limits: { createRequestBytes: CREATE_REQUEST_LIMIT, updateRequestBytes: UPDATE_REQUEST_LIMIT },
    };
}
