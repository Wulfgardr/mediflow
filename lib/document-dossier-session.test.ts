import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import {
    DossierAbortedError, DossierCollectionChanged, DossierIdentityBlocked, DossierStaleError, DossierVersionConflict, DossierWriteRejected,
    acquireDossierGroup, applyDossierDocument, buildDossierInventory, evaluateDraftGroupIdentity, loadPatientDossier, saveDossierReview,
    type DossierAttachmentMeta, type DossierInputFile, type DossierPatient, type DossierPorts, type DossierRecordTable,
} from './document-dossier-session';
import { readDossierRecord, type DossierHostExtraction, type DossierRecord } from './domain/documents/dossier-import';
import { parseDocumentParseEvidenceArtifactSnapshot } from './domain/documents/document-parse-evidence-artifact';

// Archivio sintetico: stessa semantica dei writer (CAS currentness, collezione osservata,
// id duplicato 409, versione paziente). Nessun dato reale.
const CF_A = 'RSSMRA80A01F205X';
const CF_B = 'RSSMRA85T10A562S';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const enc = new TextEncoder();

type Stored = { meta: DossierAttachmentMeta; bytes: Uint8Array };
interface Knobs {
    commitThenThrowOnce?: DossierRecordTable;
    failArtifactUpdatesAfter?: number;
    rejectCreate?: DossierRecordTable;
    abortAfterCreates?: number;
}

function archive(patients: DossierPatient[], extractions: Map<string, DossierHostExtraction>) {
    const attachments = new Map<string, Stored>();
    const records = new Map<string, Record<string, unknown>>();
    const knobs: Knobs = {};
    let artifactUpdates = 0; let attachmentCreates = 0; let clinicalCreates = 0;
    let epoch = 1;
    const controller = new AbortController();
    const bump = (meta: DossierAttachmentMeta) => { meta.currentness = { ...meta.currentness!, revision: meta.currentness!.revision + 1 }; };
    const ports: DossierPorts = {
        sessionSignal: () => controller.signal,
        async extract(bytes) { return extractions.get(sha(bytes)) ?? { status: 'failed', detail: 'unsupported_format' }; },
        async sha256(bytes) { return sha(bytes); },
        async listPatients() { return patients.map((patient) => structuredClone(patient)); },
        async getPatient(id) { const patient = patients.find((item) => item.id === id); return patient ? structuredClone(patient) : undefined; },
        async updatePatientCodes(id, change) {
            const patient = patients.find((item) => item.id === id)!;
            if (patient.version !== change.version) throw new DossierVersionConflict();
            if (change.diagnoses) patient.diagnoses = change.diagnoses;
            if (change.exemptions) patient.exemptions = change.exemptions;
            patient.version! += 1;
        },
        async listAttachments(patientId) {
            return [...attachments.values()].filter((item) => item.meta.patientId === patientId).map((item) => structuredClone(item.meta));
        },
        async readAttachmentBytes(id, patientId) {
            const item = attachments.get(id);
            return item && item.meta.patientId === patientId ? new Uint8Array(item.bytes) : null;
        },
        async createAttachment(input, seen) {
            const current = [...attachments.values()].filter((item) => item.meta.patientId === input.patientId).map((item) => item.meta.id).sort();
            if (JSON.stringify(current) !== JSON.stringify(seen.map((item) => item.id).sort())) throw new DossierCollectionChanged();
            if (attachments.has(input.id)) throw new DossierWriteRejected(409);
            attachmentCreates += 1;
            attachments.set(input.id, { bytes: new Uint8Array(input.bytes), meta: { id: input.id, patientId: input.patientId, name: input.name, size: input.size,
                type: input.type, parseEvidenceArtifactSnapshot: input.parseEvidenceArtifactSnapshot,
                currentness: { sourceRef: 'c'.repeat(64), revision: 1, freshnessEpoch: epoch++ } } });
            if (knobs.abortAfterCreates !== undefined && attachmentCreates >= knobs.abortAfterCreates) controller.abort();
        },
        async updateArtifact(attachment, snapshot) {
            artifactUpdates += 1;
            if (knobs.failArtifactUpdatesAfter !== undefined && artifactUpdates > knobs.failArtifactUpdatesAfter) throw new Error('network');
            const stored = attachments.get(attachment.id);
            const now = stored?.meta.currentness; const expected = attachment.currentness;
            if (!stored || !now || !expected || now.revision !== expected.revision || now.freshnessEpoch !== expected.freshnessEpoch) throw new DossierVersionConflict();
            stored.meta.parseEvidenceArtifactSnapshot = snapshot; bump(stored.meta);
        },
        async measureCreate(input) { return { original: Math.ceil(input.bytes.byteLength * 16 / 9) + 64, artifact: input.parseEvidenceArtifactSnapshot.length * 2, request: input.bytes.byteLength * 2 + input.parseEvidenceArtifactSnapshot.length * 2 }; },
        async measureArtifact(snapshot) { return snapshot.length * 2; },
        async getRecord(table, id, patientId) { const record = records.get(`${table}:${id}`); return record && record.patientId === patientId ? structuredClone(record) : undefined; },
        async createRecord(table, record) {
            if (knobs.rejectCreate === table) throw new DossierWriteRejected(400);
            const key = `${table}:${record.id as string}`;
            if (records.has(key)) throw new DossierWriteRejected(409);
            records.set(key, structuredClone(record)); clinicalCreates += 1;
            if (knobs.commitThenThrowOnce === table) { knobs.commitThenThrowOnce = undefined; throw new Error('connection reset after commit'); }
        },
        async currentRecords(patientId) {
            const patient = patients.find((item) => item.id === patientId)!;
            const of = (table: string) => [...records.entries()].filter(([key, value]) => key.startsWith(`${table}:`) && value.patientId === patientId).map(([, value]) => value);
            return {
                diagnoses: patient.diagnoses.map((item) => ({ ...item, date: item.date.slice(0, 10) })), exemptions: patient.exemptions,
                therapies: of('therapies').map((item) => ({ id: item.id as string, drugName: item.drugName as string, dosage: item.dosage as string, status: item.status as string, startDate: String(item.startDate).slice(0, 10) })),
                observations: of('observations').map((item) => ({ id: item.id as string, code: item.code as string, display: item.display as string, value: String(item.value), observedAt: String(item.observedAt).slice(0, 10) })),
                entries: of('entries').map((item) => ({ id: item.id as string, dossierFactRef: (item.metadata as { dossier: { factRef: string } }).dossier.factRef })),
                servicePrescriptions: [], prostheticPrescriptions: [],
            };
        },
        async exemptionCodes() { return new Set(['031', '048']); },
        newId: () => randomUUID(),
        now: () => new Date('2026-11-03T10:00:00.000Z'),
        limits: { createRequestBytes: 25 * 1024 * 1024, updateRequestBytes: 4 * 1024 * 1024 },
    };
    return { ports, attachments, records, knobs, controller, counts: () => ({ artifactUpdates, attachmentCreates, clinicalCreates }) };
}

function file(relativePath: string, content: Uint8Array | string): DossierInputFile & { replace(next: string): void } {
    let bytes = typeof content === 'string' ? enc.encode(content) : content;
    return {
        name: relativePath.split('/').pop()!, size: bytes.byteLength, type: '', relativePath, lastModified: 0,
        async read() { return new Uint8Array(bytes); },
        replace(next: string) { bytes = enc.encode(next); },
    };
}

const patientsFixture = (): DossierPatient[] => [
    // Omonimi: stesso nome e cognome, codici fiscali diversi.
    { id: 'pa', firstName: 'Mario', lastName: 'Rossi', taxCode: CF_A, version: 1, diagnoses: [], exemptions: [] },
    { id: 'pb', firstName: 'Mario', lastName: 'Rossi', taxCode: CF_B, version: 1, diagnoses: [], exemptions: [] },
];

const live = { signal: new AbortController().signal, isCurrent: () => true };

function labText(cf: string, date = 'Data prelievo: 10/01/2025') {
    return `%PDF-1.4 sintetico\nReferto di laboratorio\nPaziente: Mario Rossi codice fiscale ${cf}\n${date}\nGlucosio 110 mg/dL 70-99 H\nEsenzione 031\nTesto residuo sintetico.`;
}

function setup(sources: Array<[string, string]>, extraction: (text: string) => DossierHostExtraction = (text) => ({ status: 'extracted', markdown: text.replace('%PDF-1.4 sintetico\n', ''), ocr: null })) {
    const extractions = new Map<string, DossierHostExtraction>();
    const files = sources.map(([path, text]) => { extractions.set(sha(enc.encode(text)), extraction(text)); return file(path, text); });
    return { files, ...archive(patientsFixture(), extractions) };
}

async function acceptAll(ports: DossierPorts, patientId: string, attachmentId: string, edit?: (record: DossierRecord) => DossierRecord) {
    const view = (await loadPatientDossier(ports, patientId, live.signal))!;
    const document = view.documents.find((item) => item.attachment.id === attachmentId)!;
    await saveDossierReview(ports, { patientId, attachmentId, expected: document.attachment.currentness!, ...live,
        change: (record) => (edit ?? ((value) => value))({ ...record, residualReview: { state: 'acknowledged', at: 'x' },
            facts: record.facts.map((fact) => ({ ...fact, decision: 'accepted' })) }) });
    return (await loadPatientDossier(ports, patientId, live.signal))!.documents.find((item) => item.attachment.id === attachmentId)!;
}

test('homonymous patients: the document code selects B; linking to A is refused before any storage', async () => {
    const { files, ports, attachments } = setup([['Dossier/Rossi/esami.pdf', labText(CF_B)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const patients = await ports.listPatients(live.signal);
    assert.deepEqual(evaluateDraftGroupIdentity(group, patients, null).candidatePatientIds, ['pb']);
    await assert.rejects(acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live }), DossierIdentityBlocked);
    assert.equal(attachments.size, 0);
    await assert.rejects(acquireDossierGroup(ports, { group, patientId: 'pb', confirmed: false, ...live }), /non confermato/u);
    const outcomes = await acquireDossierGroup(ports, { group, patientId: 'pb', confirmed: true, ...live });
    assert.deepEqual(outcomes.map((item) => [item.status, 'verified' in item && item.verified]), [['stored', true]]);
    assert.deepEqual([...attachments.values()].map((item) => item.meta.patientId), ['pb']);
});

test('mixed group (two patient codes) is blocked as a whole', async () => {
    const { files, ports, attachments } = setup([['Dossier/X/a.pdf', labText(CF_A)], ['Dossier/X/b.pdf', labText(CF_B)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    assert.equal(evaluateDraftGroupIdentity(group, await ports.listPatients(live.signal), 'pa').status, 'mixed');
    await assert.rejects(acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live }), DossierIdentityBlocked);
    assert.equal(attachments.size, 0);
});

test('re-selecting the folder reuses the verified original; a changed file on disk is refused; in-selection copies are skipped', async () => {
    const { files, ports, attachments, counts } = setup([['D/R/a.pdf', labText(CF_A)], ['D/R/copia.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    assert.deepEqual(group.sources.map((item) => item.status), ['ready', 'duplicate_in_selection']);
    await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const [again] = await buildDossierInventory(ports, files, live);
    const second = await acquireDossierGroup(ports, { group: again, patientId: 'pa', confirmed: true, ...live });
    assert.equal(second[0].status, 'reused');
    assert.equal(counts().attachmentCreates, 1);
    assert.equal(attachments.size, 1);
    files[0].replace(labText(CF_A, 'Data prelievo: 11/01/2025'));
    const changed = await acquireDossierGroup(ports, { group: again, patientId: 'pa', confirmed: true, ...live });
    assert.deepEqual(changed[0], { key: 's1', status: 'failed', reason: 'source_changed' });
});

test('an attachment already in the app with identical bytes is reused, not duplicated; v1 fields stay readable', async () => {
    const text = labText(CF_A);
    const { files, ports, attachments, counts } = setup([['D/R/a.pdf', text]]);
    attachments.set('legacy', { bytes: enc.encode(text), meta: { id: 'legacy', patientId: 'pa', name: 'vecchio.pdf', size: enc.encode(text).byteLength, type: 'application/pdf',
        currentness: { sourceRef: 'd'.repeat(64), revision: 1, freshnessEpoch: 99 } } });
    const [group] = await buildDossierInventory(ports, files, live);
    const [outcome] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    assert.deepEqual([outcome.status, 'attachmentId' in outcome && outcome.attachmentId], ['reused', 'legacy']);
    assert.equal(counts().attachmentCreates, 0);
    const snapshot = attachments.get('legacy')!.meta.parseEvidenceArtifactSnapshot!;
    assert.ok(parseDocumentParseEvidenceArtifactSnapshot(snapshot));
    const read = readDossierRecord(snapshot);
    assert.equal(read.status === 'present' && read.record.preservation.state, 'verified');
    assert.equal(read.status === 'present' && read.record.extraction.state === 'extracted' && read.record.extraction.text.location, 'inline');
});

test('failed OCR page and unsupported p7m are preserved but never complete; nothing is extracted from them', async () => {
    const scan = '%PDF-1.4 scansione sintetica illeggibile';
    const p7m = 'busta firmata sintetica';
    const { files, ports } = setup([['D/R/scan.pdf', scan], ['D/R/firmato.pdf.p7m', p7m]], () => ({ status: 'failed', detail: 'image_or_scan' }));
    const [group] = await buildDossierInventory(ports, files, live);
    assert.deepEqual(group.sources.map((item) => item.extraction.state), ['failed', 'not_extracted']);
    assert.deepEqual(group.sources.map((item) => item.facts.length), [0, 0]);
    await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const view = (await loadPatientDossier(ports, 'pa', live.signal))!;
    assert.equal(view.documents.length, 2);
    for (const document of view.documents) {
        assert.equal(document.record.preservation.state, 'verified');
        assert.equal(document.coverage.complete, false);
    }
    assert.ok(view.documents.some((item) => item.coverage.gaps.includes('extraction_failed')));
    assert.ok(view.documents.some((item) => item.coverage.gaps.includes('not_extracted')));
});

test('lock during acquisition stops the batch: no further originals are written', async () => {
    const { files, ports, attachments, knobs, controller } = setup([['D/R/a.pdf', labText(CF_A)], ['D/R/b.pdf', labText(CF_A, 'Data referto: 02/02/2025')]]);
    const [group] = await buildDossierInventory(ports, files, live);
    knobs.abortAfterCreates = 1;
    await assert.rejects(acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, signal: controller.signal, isCurrent: () => true }), DossierAbortedError);
    assert.equal(attachments.size, 1);
});

test('patient change mid-apply stops before the next write', async () => {
    const { files, ports, records } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, documentDate: record.documentDate,
        facts: record.facts.map((fact) => fact.kind === 'observation' ? { ...fact, values: { ...fact.values, code: '2345-7', unitCode: 'mg/dL' } } : fact) }));
    let calls = 0;
    await assert.rejects(applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!,
        signal: live.signal, isCurrent: () => (calls += 1) < 6 }), DossierAbortedError);
    assert.ok(records.size <= 1);
});

test('changed source revision: review save and apply refuse with zero clinical writes', async () => {
    const { files, ports, attachments, counts } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const shown = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    const meta = attachments.get(attachmentId)!.meta; meta.currentness = { ...meta.currentness!, revision: meta.currentness!.revision + 1 }; // un altro writer ha cambiato l'artefatto
    await assert.rejects(saveDossierReview(ports, { patientId: 'pa', attachmentId, expected: shown.attachment.currentness!, ...live, change: (r) => r }), DossierStaleError);
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: shown.attachment.currentness!, ...live });
    assert.equal(result.stopped, 'stale');
    assert.equal(counts().clinicalCreates, 0);
});

test('failure after the first write: partial result is declared, resume completes without duplicates', async () => {
    const text = labText(CF_A);
    const { files, ports, records, knobs, counts } = setup([['D/R/a.pdf', text]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    let document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.map((fact) => fact.kind === 'observation' ? { ...fact, values: { ...fact.values, code: '2345-7', unitCode: 'mg/dL' } } : fact) }));
    const accepted = document.record.facts.filter((fact) => fact.decision === 'accepted');
    assert.deepEqual(accepted.map((fact) => fact.kind).sort(), ['document_entry', 'exemption', 'observation']);
    // Le identità opache si persistono (1 update), poi la prima scrittura e il suo registro (1 update); il secondo registro fallisce.
    knobs.failArtifactUpdatesAfter = counts().artifactUpdates + 2;
    const first = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(first.partial, true);
    assert.equal(first.stopped, 'registry');
    document = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(document.coverage.complete, false);
    knobs.failArtifactUpdatesAfter = undefined;
    const createsBefore = counts().clinicalCreates;
    const second = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(second.partial, false, JSON.stringify(second));
    document = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.deepEqual(document.coverage, { complete: true, gaps: [] });
    const patient = (await ports.getPatient('pa', live.signal))!;
    assert.deepEqual(patient.exemptions, ['031']);
    // Una sola osservazione e una sola voce di diario: la ripresa ha riletto, non riscritto.
    assert.equal([...records.keys()].filter((key) => key.startsWith('observations:')).length, 1);
    assert.equal([...records.keys()].filter((key) => key.startsWith('entries:')).length, 1);
    assert.ok(counts().clinicalCreates - createsBefore <= 1);
    const third = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.deepEqual(third.outcomes, []);
    assert.equal(records.size, 2);
});

test('uncertain outcome is reread; a 409 on an id with different content is a conflict, never success', async () => {
    const { files, ports, records, knobs } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind !== 'exemption').map((fact) => fact.kind === 'observation' ? { ...fact, values: { ...fact.values, code: '2345-7', unitCode: 'mg/dL' } } : fact) }));
    knobs.commitThenThrowOnce = 'observations';
    const view = await loadPatientDossier(ports, 'pa', live.signal);
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: view!.documents[0].attachment.currentness!, ...live });
    const observation = result.outcomes.find((item) => item.target === 'observations')!;
    assert.equal(observation.outcome, 'applied', 'commit-then-throw resolved by reread');
    assert.equal([...records.keys()].filter((key) => key.startsWith('observations:')).length, 1);
    void document;

    // Conflitto: stesso id, contenuto diverso.
    const { files: f2, ports: p2, records: r2 } = setup([['D/R/b.pdf', labText(CF_A)]]);
    const [g2] = await buildDossierInventory(p2, f2, live);
    const [s2] = await acquireDossierGroup(p2, { group: g2, patientId: 'pa', confirmed: true, ...live });
    const id2 = (s2 as { attachmentId: string }).attachmentId;
    await acceptAll(p2, 'pa', id2, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    const v2 = (await loadPatientDossier(p2, 'pa', live.signal))!.documents[0];
    // Assegna l'id senza scrivere: la scrittura delle voci viene rifiutata.
    const preset = randomUUID();
    await saveDossierReview(p2, { patientId: 'pa', attachmentId: id2, expected: v2.attachment.currentness!, ...live,
        change: (record) => ({ ...record, facts: record.facts.map((fact) => ({ ...fact, recordId: preset })) }) });
    r2.set(`entries:${preset}`, { id: preset, patientId: 'pa', metadata: { dossier: { factRef: 'other#x' } } });
    const v3 = (await loadPatientDossier(p2, 'pa', live.signal))!.documents[0];
    const conflict = await applyDossierDocument(p2, { patientId: 'pa', attachmentId: id2, expected: v3.attachment.currentness!, ...live });
    assert.equal(conflict.outcomes[0].outcome, 'conflict');
    assert.equal(conflict.partial, true);
    assert.equal((await loadPatientDossier(p2, 'pa', live.signal))!.documents[0].coverage.gaps.includes('apply_conflict'), true);
});

test('patient version conflict (409) is not success and is not retried blindly', async () => {
    const { files, ports } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'exemption') }));
    const original = ports.updatePatientCodes;
    ports.updatePatientCodes = async () => { throw new DossierVersionConflict(); };
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.deepEqual(result.outcomes.map((item) => item.outcome), ['conflict']);
    assert.deepEqual((await ports.getPatient('pa', live.signal))!.exemptions, []);
    ports.updatePatientCodes = original;
    const fresh = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    const retry = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: fresh.attachment.currentness!, ...live });
    assert.deepEqual(retry.outcomes.map((item) => item.outcome), ['applied']);
});

test('missing date and negation block application; historical therapy stays non-active; reported scale is not an administered scale', async () => {
    const text = 'Lettera sintetica\nNega diabete ICD-10 E11.9 diabete tipo 2\nGlucosio 110 mg/dL 70-99';
    const { files, ports, records, counts } = setup([['D/R/lettera.txt', text]]);
    const [group] = await buildDossierInventory(ports, files, live);
    assert.equal(group.sources[0].documentDate, null);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: [...record.facts,
        { factId: 'm-therapy-1', kind: 'therapy', origin: 'manual', evidence: null, negated: false, decision: 'accepted',
            values: { drugName: 'Metformina', dosage: '500 mg', status: 'completed', startDate: '2019-03-01', endDate: '' } },
        { factId: 'm-scale-1', kind: 'reported_scale', origin: 'manual', evidence: null, negated: false, decision: 'accepted',
            values: { scaleName: 'Barthel', scaleTotal: '60', date: '2024-06-01', text: '' } }] }));
    const before = counts().clinicalCreates;
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.deepEqual(result.outcomes.map((item) => item.target).sort(), ['entries', 'therapies']);
    assert.equal(counts().clinicalCreates - before, 2);
    assert.deepEqual((await ports.getPatient('pa', live.signal))!.diagnoses, [], 'negated diagnosis never written');
    const therapy = [...records.entries()].find(([key]) => key.startsWith('therapies:'))![1];
    assert.equal(therapy.status, 'completed');
    const scale = [...records.entries()].find(([key]) => key.startsWith('entries:'))![1];
    assert.equal(scale.type, 'note');
    assert.match(String(scale.content), /non una somministrazione/u);
    const after = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(after.coverage.complete, false, 'undated observation and negated diagnosis keep the document incomplete');
});
