import { readSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { buildDossierInventory, evaluateDraftGroupIdentity, acquireDossierGroup, acceptVerifiedAndApply, loadPatientDossier, entryFactRef,
    DossierVersionConflict, DossierCollectionChanged, DossierWriteRejected, DossierAbortedError,
    type DossierPorts, type DossierDraftGroup, type DossierInputFile, type DossierRecordTable } from '../../../lib/document-dossier-session';
import { parsePreparedExtraction } from '../../../lib/domain/documents/dossier-prepared';

const MAX_LINE = 64 * 1024 * 1024;
let pending = Buffer.alloc(0);
function readLine(): string {
    for (;;) {
        const end = pending.indexOf(10);
        if (end >= 0) { const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1); return line; }
        const chunk = Buffer.alloc(8192);
        const read = readSync(0, chunk, 0, chunk.length, null);
        if (!read || pending.length + read > MAX_LINE) throw new Error('Dossier channel closed');
        pending = Buffer.concat([pending, chunk.subarray(0, read)]);
    }
}
function send(value: unknown) { writeSync(1, JSON.stringify(value) + '\n'); }
function rpc(port: string, args: unknown[]): unknown {
    send({ port, args });
    const response = JSON.parse(readLine());
    if (response.error) {
        if (response.error === 'retired') { controller.abort(); throw new DossierAbortedError(); }
        if (response.error === 'version') throw new DossierVersionConflict();
        if (response.error === 'collection') throw new DossierCollectionChanged();
        if (response.error === 'rejected') throw new DossierWriteRejected(response.status ?? null);
        throw new Error('Dossier port unavailable');
    }
    return response.value;
}
// Le esportazioni del verificatore sono collegate qui dal bundler. Il processo non riceve chiavi né cookie.
(globalThis as unknown as { dossierVerify: (op: string, args: unknown[], result: unknown) => void }).dossierVerify = (op, args, result) => {
    const serialized = JSON.parse(JSON.stringify(args, (_key, value) => value instanceof Set ? [...value] : value));
    if (op === 'preparedBulkDecisions') {
        const input = args[0] as Parameters<typeof import('../../../lib/domain/documents/dossier-prepared').preparedBulkDecisions>[0];
        serialized[0].assessments = Object.fromEntries(input.record.facts.map(f => { const ref = input.documentKey + '#' + f.factId; return [ref, input.assessment(ref) ?? null]; }));
    }
    rpc('verify', [{ op, args: serialized }, result]);
};
const controller = new AbortController();
const remote = (port: string, ...args: unknown[]) => rpc(port, args);
const bytes = (value: unknown) => new Uint8Array(Buffer.from(value as string, 'base64'));
const day = (value: unknown) => typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : '';
const readRows = (table: DossierRecordTable, patient: string) => remote('records', table, patient) as Record<string, unknown>[];
const ports: DossierPorts = {
    sessionSignal: () => controller.signal,
    extract: async value => remote('extract', Buffer.from(value).toString('base64')) as Awaited<ReturnType<DossierPorts['extract']>>,
    sha256: async value => createHash('sha256').update(value).digest('hex'),
    listPatients: async () => remote('patients') as Awaited<ReturnType<DossierPorts['listPatients']>>,
    getPatient: async id => remote('patient', id) as Awaited<ReturnType<DossierPorts['getPatient']>>,
    updatePatientCodes: async (id, change) => { remote('patientCodes', id, change); },
    listAttachments: async id => remote('attachments', id) as Awaited<ReturnType<DossierPorts['listAttachments']>>,
    readAttachmentBytes: async (id, patient) => { const value = remote('attachmentBytes', id, patient); return value === null ? null : bytes(value); },
    createAttachment: async (input, seen) => { remote('createAttachment', { ...input, bytes: Buffer.from(input.bytes).toString('base64') }, seen); },
    updateArtifact: async (attachment, snapshot) => { remote('updateArtifact', attachment, snapshot); },
    measureCreate: async input => remote('measureCreate', { ...input, bytes: Buffer.from(input.bytes).toString('base64') }) as Awaited<ReturnType<DossierPorts['measureCreate']>>,
    measureArtifact: async snapshot => remote('measureArtifact', snapshot) as number,
    getRecord: async (table, id, patient) => readRows(table, patient).find(r => r.id === id && r.patientId === patient),
    createRecord: async (table, record) => { remote('createRecord', table, record); },
    currentRecords: async patientId => {
        const patient = await ports.getPatient(patientId, controller.signal);
        const own = (table: DossierRecordTable) => readRows(table, patientId).filter(r => r.patientId === patientId && !r.deletedAt);
        return {
            diagnoses: patient?.diagnoses.map(d => ({ ...d, date: d.date.slice(0, 10) })) ?? [], exemptions: patient?.exemptions ?? [],
            therapies: own('therapies').map(r => ({ ...r, startDate: day(r.startDate), endDate: day(r.endDate) })),
            observations: own('observations').map(r => ({ ...r, value: String(r.value), observedAt: day(r.observedAt) })),
            entries: own('entries').map(r => ({ ...r, dossierFactRef: entryFactRef(r.metadata) })),
            servicePrescriptions: own('service_prescriptions').map(r => ({ ...r, prescribedAt: day(r.prescribedAt) })),
            prostheticPrescriptions: own('prosthetic_prescriptions').map(r => ({ ...r, prescribedAt: day(r.prescribedAt) })),
        } as unknown as Awaited<ReturnType<DossierPorts['currentRecords']>>;
    },
    exemptionCodes: async () => new Set(remote('exemptions') as string[]),
    newId: randomUUID,
    now: () => new Date(),
    limits: { createRequestBytes: 25 * 1024 * 1024, updateRequestBytes: 4 * 1024 * 1024 - 64 * 1024 },
};
let groups: DossierDraftGroup[] = [];
const current = () => !controller.signal.aborted;
for (;;) {
    let command;
    try { command = JSON.parse(readLine()); } catch { break; }
    try {
        if (command.op === 'review') {
            const parsed = parsePreparedExtraction(command.prepared);
            if (!parsed.ok) throw new Error(parsed.error);
            const files: DossierInputFile[] = command.files.map((file: { name: string; size: number; type: string; key: number; relativePath: string }) => ({
                ...file, lastModified: 0, read: async () => bytes(remote('file', file.key)),
            }));
            groups = await buildDossierInventory(ports, files, { signal: controller.signal, isCurrent: current, prepared: parsed.value });
            const patients = await ports.listPatients(controller.signal);
            send({ result: { warnings: parsed.warnings, patients, groups: groups.map(group => ({ key: group.key,
                sources: group.sources.map(source => Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'file'))),
                identity: evaluateDraftGroupIdentity(group, patients, command.patientId ?? null) })) } });
        } else if (command.op === 'apply') {
            const group = groups.find(group => group.key === command.group);
            if (!group) throw new Error('Inventario non disponibile: rileggi i file.');
            const acquired = await acquireDossierGroup(ports, { group, patientId: command.patientId, confirmed: true, signal: controller.signal, isCurrent: current });
            const applied = await acceptVerifiedAndApply(ports, { patientId: command.patientId, signal: controller.signal, isCurrent: current, includeSummaries: command.includeSummaries === true });
            const view = await loadPatientDossier(ports, command.patientId, controller.signal);
            send({ result: { acquired, applied, documents: view?.documents.map(d => ({ coverage: d.coverage, name: d.attachment.name, facts: d.record.facts })) ?? [] } });
        } else if (command.op === 'cancel') { send({ result: { cancelled: true, writes: 0 } }); break; }
        else throw new Error('Comando dossier sconosciuto.');
    } catch (error) { send({ failure: error instanceof Error ? error.message : 'Operazione non riuscita', retired: controller.signal.aborted }); }
}
