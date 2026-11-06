import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import {
    DossierAbortedError, DossierCollectionChanged, DossierIdentityBlocked, DossierStaleError, DossierVersionConflict, DossierWriteRejected,
    DossierWriteInFlight, acceptVerifiedAndApply, acquireDossierGroup, applyDossierDocument, buildDossierInventory, evaluateDraftGroupIdentity, loadPatientDossier,
    retryDossierExtraction, saveDossierReview,
    type DossierAcquireOutcome, type DossierAttachmentMeta, type DossierInputFile, type DossierPatient, type DossierPorts, type DossierRecordTable,
} from './document-dossier-session';
import { readDossierRecord, type DossierHostExtraction, type DossierRecord } from './domain/documents/dossier-import';
import { parseDocumentParseEvidenceArtifactSnapshot } from './domain/documents/document-parse-evidence-artifact';
import { DOSSIER_PREPARED_SCHEMA, parsePreparedExtraction, type PreparedExtraction } from './domain/documents/dossier-prepared';

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
        change: (record) => {
            const accepted: DossierRecord = { ...record, residualReview: { state: 'acknowledged', at: 'x' },
                facts: record.facts.map((fact) => ({ ...fact, decision: 'accepted' })) };
            const edited = (edit ?? ((value) => value))(accepted);
            // Una proposta esclusa dal caso di prova resta nel dossier come rifiutata: la revisione non elimina fatti.
            const kept = new Set(edited.facts.map((fact) => fact.factId));
            return { ...edited, facts: [...edited.facts, ...accepted.facts.filter((fact) => !kept.has(fact.factId)).map((fact) => ({ ...fact, decision: 'rejected' as const }))] };
        } });
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

test('reimport checks the current original bytes even after an earlier verified receipt', async () => {
    const { files, ports, attachments } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    attachments.get(attachmentId)!.bytes = enc.encode('different original after a later edit');
    const [again] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    assert.equal(again.status, 'failed');
    assert.equal(again.status === 'failed' && again.reason, 'readback_mismatch');
});

test('context retiring during the lookup before create prevents the clinical write', async () => {
    const { files, ports, counts } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    let current = true;
    const get = ports.getRecord;
    ports.getRecord = async (...args) => { const value = await get(...args); current = false; return value; };
    try {
        await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!,
            signal: live.signal, isCurrent: () => current });
    } catch (error) { assert.ok(error instanceof DossierAbortedError); }
    assert.equal(counts().clinicalCreates, 0);
});

test('review rejected in another client during lookup does not get applied or logged as applied', async () => {
    const { files, ports, attachments, counts } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    const get = ports.getRecord;
    let changed = false;
    ports.getRecord = async (...args) => {
        const value = await get(...args);
        if (!changed) {
            changed = true;
            const meta = attachments.get(attachmentId)!.meta;
            const snapshot = JSON.parse(meta.parseEvidenceArtifactSnapshot!);
            snapshot.dossier.facts[0].decision = 'rejected';
            meta.parseEvidenceArtifactSnapshot = JSON.stringify(snapshot);
            meta.currentness = { ...meta.currentness!, revision: meta.currentness!.revision + 1 };
        }
        return value;
    };
    await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(counts().clinicalCreates, 0);
    const final = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(final.record.applied.some((entry) => entry.outcome === 'applied'), false);
});

test('readback with a changed measurement unit is a conflict, not a verified write', async () => {
    const { files, ports, records } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'observation').map((fact) => ({ ...fact,
            values: { ...fact.values, code: '2345-7', unitCode: 'mg/dL' } })) }));
    const create = ports.createRecord;
    ports.createRecord = async (table, record) => {
        await create(table, record);
        if (table === 'observations') records.get(`${table}:${record.id}`)!.unitCode = 'mmol/L';
    };
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(result.outcomes[0].outcome, 'conflict');
    assert.equal(result.partial, true);
});

// ---------------------------------------------------------------------------
// Ripresa WUL-804: riprova OCR, attestazione, autorizzazione per fatto e voce, rilettura completa
// ---------------------------------------------------------------------------

async function storedDocument(text: string, extraction?: (text: string) => DossierHostExtraction) {
    const fixture = setup([['D/R/a.pdf', text]], extraction);
    const [group] = await buildDossierInventory(fixture.ports, fixture.files, live);
    const [stored] = await acquireDossierGroup(fixture.ports, { group, patientId: 'pa', confirmed: true, ...live });
    return { ...fixture, attachmentId: (stored as { attachmentId: string }).attachmentId };
}

test('OCR retry from the preserved original: transient failure, then readable text; reviewed facts and history kept', async () => {
    const text = labText(CF_A);
    let available = false;
    const fixture = await storedDocument(text, () => ({ status: 'failed', detail: 'resource_limit' }));
    const { ports, attachmentId } = fixture;
    const original = ports.extract;
    ports.extract = async (bytes, signal) => available ? { status: 'extracted', markdown: text.replace('%PDF-1.4 sintetico\n', ''), ocr: { pageCount: 1, ocrPageCount: 1 } } : original(bytes, signal);
    let view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.ok(view.coverage.gaps.includes('extraction_failed'));
    // Una decisione presa a mano prima del recupero deve sopravvivere.
    await saveDossierReview(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live,
        change: (record) => ({ ...record, facts: [...record.facts, { factId: 'm-note', kind: 'care_context', origin: 'manual', evidence: null, negated: false,
            decision: 'accepted', values: { title: 'Contesto', date: '2025-01-10', text: 'Vive con la figlia (sintetico).' } }] }) });
    view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(await retryDossierExtraction(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live }), 'failed');
    view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.deepEqual(view.record.extractionAttempts!.map((attempt) => attempt.outcome), ['failed', 'failed']);
    available = true;
    assert.equal(await retryDossierExtraction(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live }), 'extracted');
    view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(view.record.extraction.state, 'extracted');
    assert.equal(view.textVerified, true);
    assert.equal(view.record.extraction.state === 'extracted' && view.record.extraction.engine, 'anydoc_ocr');
    assert.deepEqual(view.record.extractionAttempts!.map((attempt) => attempt.outcome), ['failed', 'failed', 'extracted']);
    assert.equal(view.record.facts.find((fact) => fact.factId === 'm-note')!.decision, 'accepted');
    assert.ok(view.record.facts.some((fact) => fact.kind === 'observation' && fact.decision === 'pending'), 'new proposals arrive undecided');
    assert.equal(view.record.residualReview.state, 'pending');
    assert.equal(await retryDossierExtraction(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live }), 'not_retryable');
});

test('a verified receipt is bound to the host source: another sourceRef is not preserved and blocks apply', async () => {
    const { ports, attachments, attachmentId, counts } = await storedDocument(labText(CF_A));
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    assert.equal(document.preservationCurrent, true);
    const meta = attachments.get(attachmentId)!.meta;
    meta.currentness = { ...meta.currentness!, sourceRef: 'e'.repeat(64) };
    const view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(view.preservationCurrent, false);
    assert.ok(view.coverage.gaps.includes('not_preserved'));
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live });
    assert.equal(result.stopped, 'identity');
    assert.equal(counts().clinicalCreates, 0);
});

test('a fact with a write in flight cannot be changed by another review; resume resolves it without a second record', async () => {
    const { ports, attachmentId, records } = await storedDocument(labText(CF_A));
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    const create = ports.createRecord;
    ports.createRecord = async (table, record) => { await create(table, record); throw new Error('connection lost after commit'); };
    const get = ports.getRecord;
    let lookups = 0;
    ports.getRecord = async (...args) => { lookups += 1; if (lookups === 2) throw new Error('reread unavailable'); return get(...args); };
    const first = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.deepEqual(first.outcomes.map((entry) => entry.outcome), ['uncertain']);
    ports.createRecord = create; ports.getRecord = get;
    let view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(view.record.pendingWrites!.length, 1, 'uncertain outcome keeps the authorization');
    assert.ok(view.coverage.gaps.includes('apply_uncertain'));
    await assert.rejects(saveDossierReview(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live,
        change: (record) => ({ ...record, facts: record.facts.map((fact) => fact.kind === 'document_entry' ? { ...fact, decision: 'rejected' } : fact) }) }), DossierWriteInFlight);
    const second = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: view.attachment.currentness!, ...live });
    assert.deepEqual(second.outcomes.map((entry) => entry.outcome), ['applied']);
    assert.equal([...records.keys()].filter((key) => key.startsWith('entries:')).length, 1);
    view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(view.record.pendingWrites!.length, 0);
});

test('service items are authorized one by one: a fact changed between prescription and item stops the next item', async () => {
    const text = '%PDF-1.4 sintetico\nRicetta sintetica\nData prescrizione: 01/02/2025\nPrestazioni richieste:\n- Ecografia addome\n- Visita chirurgica\n';
    const { ports, attachments, attachmentId, records } = await storedDocument(text);
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'service_prescription').map((fact) => ({ ...fact, values: { ...fact.values, category: 'imaging' } })) }));
    const create = ports.createRecord;
    ports.createRecord = async (table, record) => {
        await create(table, record);
        if (table === 'service_prescriptions') {
            const meta = attachments.get(attachmentId)!.meta;
            const snapshot = JSON.parse(meta.parseEvidenceArtifactSnapshot!);
            const fact = snapshot.dossier.facts.find((item: { kind: string }) => item.kind === 'service_prescription');
            fact.values.items = 'Ecografia addome';
            meta.parseEvidenceArtifactSnapshot = JSON.stringify(snapshot);
            meta.currentness = { ...meta.currentness!, revision: meta.currentness!.revision + 1 };
        }
    };
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal([...records.keys()].filter((key) => key.startsWith('service_prescription_items:')).length, 0);
    assert.notEqual(result.outcomes[0]?.outcome, 'applied');
    assert.equal(result.partial, true);
});

test('readback compares every clinical field: therapy status, end date and diary content', async () => {
    for (const tamper of [
        (record: Record<string, unknown>) => { record.status = 'active'; },
        (record: Record<string, unknown>) => { record.endDate = '2024-01-01T00:00:00.000Z'; },
    ]) {
        const { ports, attachmentId, records } = await storedDocument(labText(CF_A));
        const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: [{ factId: 'm-rx', kind: 'therapy', origin: 'manual', evidence: null,
            negated: false, decision: 'accepted', values: { drugName: 'Metformina', dosage: '500 mg', status: 'completed', startDate: '2019-03-01', endDate: '' } }] }));
        const create = ports.createRecord;
        ports.createRecord = async (table, record) => { await create(table, record); tamper(records.get(`${table}:${record.id}`)!); };
        const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
        assert.deepEqual(result.outcomes.map((entry) => entry.outcome), ['conflict']);
    }
    const { ports, attachmentId, records } = await storedDocument(labText(CF_A));
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    const create = ports.createRecord;
    ports.createRecord = async (table, record) => { await create(table, record); records.get(`${table}:${record.id}`)!.content = 'testo diverso'; };
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.deepEqual(result.outcomes.map((entry) => entry.outcome), ['conflict']);
});

test('measured original ciphertext stays with its source; a reused original is reported as not measured', async () => {
    const { ports, attachmentId } = await storedDocument(labText(CF_A));
    const view = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.ok(view.record.storage && view.record.storage.originalCiphertextChars > 0);
    assert.equal(view.attachment.id, attachmentId);
    assert.ok((view.artifactCiphertextChars ?? 0) > 0);
    const text = labText(CF_A);
    const fixture = setup([['D/R/a.pdf', text]]);
    fixture.attachments.set('legacy', { bytes: enc.encode(text), meta: { id: 'legacy', patientId: 'pa', name: 'vecchio.pdf', size: enc.encode(text).byteLength, type: 'application/pdf',
        currentness: { sourceRef: 'd'.repeat(64), revision: 1, freshnessEpoch: 99 } } });
    const [group] = await buildDossierInventory(fixture.ports, fixture.files, live);
    await acquireDossierGroup(fixture.ports, { group, patientId: 'pa', confirmed: true, ...live });
    const reused = (await loadPatientDossier(fixture.ports, 'pa', live.signal))!.documents[0];
    assert.equal(reused.record.storage, undefined);
});


test('parent delta: retry OCR revealing another patient must block subsequent apply', async () => {
    const { files, ports } = setup([['D/R/a.pdf', labText(CF_B)]], () => ({ status: 'failed', detail: 'unavailable' }));
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    let document = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    ports.extract = async () => ({ status: 'extracted', markdown: labText(CF_B), ocr: null });
    await retryDossierExtraction(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'exemption') }));
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(result.stopped, 'identity');
    assert.deepEqual((await ports.getPatient('pa', live.signal))!.exemptions, []);
});

test('parent delta: unknown dispatch error with no record yet must keep an uncertain claim', async () => {
    const { files, ports } = setup([['D/R/a.pdf', labText(CF_A)]]);
    const [group] = await buildDossierInventory(ports, files, live);
    const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    const attachmentId = (stored as { attachmentId: string }).attachmentId;
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record,
        facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    ports.createRecord = async () => { throw new DossierWriteRejected(null); };
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(result.outcomes[0].outcome, 'uncertain');
    const fresh = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.equal(fresh.record.pendingWrites!.length, 1);
});

for (const prefix of ['Lettera sintetica\nSig. Bianchi Luca C.F.:', 'ASST sintetica - Medicina\nSig. Bianchi Luca C.F.:',
    'Sig. Bianchi Luca, inviato dal medico\nC.F.:', 'Assistito Medico\nC.F.:']) {
    test(`ambiguous identity (${prefix.replace(/\n/gu, ' / ')}): acquire and OCR retry cannot write on the wrong patient`, async () => {
        const text = `%PDF-1.4 sintetico\n${prefix} ${CF_B}\nEsenzione 031\nData referto: 01/02/2025`;
        const first = setup([['D/R/a.pdf', text]]);
        const [draft] = await buildDossierInventory(first.ports, first.files, live);
        await assert.rejects(acquireDossierGroup(first.ports, { group: draft, patientId: 'pa', confirmed: true, ...live }), DossierIdentityBlocked);
        assert.equal(first.attachments.size, 0);
        const { files, ports, counts } = setup([['D/R/a.pdf', text]], () => ({ status: 'failed', detail: 'unavailable' }));
        const [group] = await buildDossierInventory(ports, files, live);
        const [stored] = await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
        const attachmentId = (stored as { attachmentId: string }).attachmentId;
        let document = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
        ports.extract = async () => ({ status: 'extracted', markdown: text, ocr: null });
        await retryDossierExtraction(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
        document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'exemption') }));
        assert.ok(document.coverage.gaps.includes('identity_conflict'));
        const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
        assert.equal(result.stopped, 'identity');
        assert.deepEqual((await ports.getPatient('pa', live.signal))!.exemptions, []);
        assert.equal(counts().clinicalCreates, 0);
    });
}

test('resume refuses the old multiline professional exemption before any clinical write', async () => {
    const { ports, attachments, attachmentId, counts } = await storedDocument(labText(CF_A));
    const document = await acceptAll(ports, 'pa', attachmentId, (record) => ({ ...record, facts: record.facts.filter((fact) => fact.kind === 'document_entry') }));
    const meta = attachments.get(attachmentId)!.meta;
    const snapshot = JSON.parse(meta.parseEvidenceArtifactSnapshot!);
    snapshot.dossier.identity.taxCodes = [{ value: CF_B, role: 'professional_cf', checksumValid: true, explicitProfessional: true }];
    snapshot.dossier.identity.status = 'no_document_cf';
    meta.parseEvidenceArtifactSnapshot = JSON.stringify(snapshot);
    const loaded = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0];
    assert.ok(loaded.coverage.gaps.includes('identity_conflict'));
    const result = await applyDossierDocument(ports, { patientId: 'pa', attachmentId, expected: document.attachment.currentness!, ...live });
    assert.equal(result.stopped, 'identity');
    assert.equal(counts().clinicalCreates, 0);
});

// ---------------------------------------------------------------------------
// Estrazione preparata (ADR 0176)
// ---------------------------------------------------------------------------

function letterText(cf: string, drug = 'Ramipril 5 mg 1 cp al mattino') {
    return `%PDF-1.4 sintetico\nLettera di dimissione\nPaziente: Mario Rossi codice fiscale ${cf}\nData: 20/10/2026\nDiagnosi: Ipertensione arteriosa essenziale\nTerapia: ${drug}\nIl paziente riferisce dispnea da sforzo da circa due mesi.`;
}

function preparedFor(entries: Array<{ text: string; cf: string; facts?: unknown[]; complete?: boolean }>): PreparedExtraction {
    const parsed = parsePreparedExtraction(JSON.stringify({ schema: DOSSIER_PREPARED_SCHEMA, preparedAt: '2026-11-03T09:00:00Z', preparedBy: 'test',
        sources: entries.map((entry) => ({ sha256: sha(enc.encode(entry.text)), fileName: 'x.pdf', documentDate: '2026-10-20',
            patient: { taxCode: entry.cf, lastName: 'Rossi', firstName: 'Mario' },
            summary: { title: 'Dimissione', text: 'Ricovero per ipertensione; dispnea da sforzo da due mesi.' },
            coverage: { pages: 1, unreadablePages: [], complete: entry.complete ?? true },
            facts: entry.facts ?? [
                { kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' },
                { kind: 'therapy', values: { drugName: 'Ramipril', activePrinciple: 'ramipril', dosage: '5 mg 1 cp al mattino', status: 'active' }, quote: 'Ramipril 5 mg 1 cp al mattino' },
                { kind: 'therapy', values: { drugName: 'Metformina', dosage: '500 mg' }, quote: 'Metformina 500 mg due volte al giorno' },
            ] })) }));
    assert.ok(parsed.ok);
    return (parsed as { ok: true; value: PreparedExtraction }).value;
}

test('a mixed inbox folder groups by the prepared patient, and identity is still checked on the text', async () => {
    const a = letterText(CF_A); const b = letterText(CF_B, 'Bisoprololo 1,25 mg 1 cp');
    const { ports, files } = setup([['settimana/a.pdf', a], ['settimana/b.pdf', b]]);
    const plain = await buildDossierInventory(ports, files, live);
    assert.equal(plain.length, 1);
    assert.equal(evaluateDraftGroupIdentity(plain[0], patientsFixture(), null).status, 'mixed', 'senza estrazione la cartella mista è bloccata');
    const groups = await buildDossierInventory(ports, files, { ...live, prepared: preparedFor([{ text: a, cf: CF_A }, { text: b, cf: CF_B }]) });
    assert.deepEqual(groups.map((group) => group.key).sort(), [`cf:${CF_A}`, `cf:${CF_B}`]);
    for (const group of groups) {
        const identity = evaluateDraftGroupIdentity(group, patientsFixture(), null);
        assert.equal(identity.status, 'suggested');
        assert.deepEqual(identity.candidatePatientIds, [group.key.endsWith(CF_A) ? 'pa' : 'pb']);
    }
    // Un'estrazione che attribuisce il documento al paziente sbagliato non supera il CF letto da MediFlow.
    const wrong = await buildDossierInventory(ports, [files[0]], { ...live, prepared: preparedFor([{ text: a, cf: CF_B }]) });
    assert.equal(evaluateDraftGroupIdentity(wrong[0], patientsFixture(), 'pb').status, 'discordant');
});

test('a prepared patient that the document does not name does not group the source', async () => {
    // Banco sintetico 6/11/2026, falsificazione 10: nome scambiato in un documento senza CF.
    const text = '%PDF-1.4 sintetico\nReferto\nPaziente: PersonaUno SinteticoUno\nData: 20/10/2026\nIl paziente assume Ramipril 5 mg 1 cp al mattino.';
    const { ports, files } = setup([['settimana/a.pdf', text]]);
    const extraction = (lastName: string, firstName: string) => {
        const parsed = parsePreparedExtraction(JSON.stringify({ schema: DOSSIER_PREPARED_SCHEMA, preparedAt: '2026-11-03T09:00:00Z', preparedBy: 'test',
            sources: [{ sha256: sha(enc.encode(text)), fileName: 'a.pdf', documentDate: '2026-10-20', patient: { lastName, firstName },
                coverage: { pages: 1, unreadablePages: [], complete: true },
                facts: [{ kind: 'therapy', values: { drugName: 'Ramipril', dosage: '5 mg 1 cp al mattino', status: 'active' }, quote: 'Il paziente assume Ramipril 5 mg 1 cp al mattino' }] }] }));
        assert.ok(parsed.ok);
        return (parsed as { ok: true; value: PreparedExtraction }).value;
    };
    const [swapped] = await buildDossierInventory(ports, files, { ...live, prepared: extraction('SinteticoDue', 'PersonaDue') });
    assert.equal(swapped.key.startsWith('nome:'), false, 'il nome proposto non è nel documento');
    assert.ok(swapped.sources[0].prepared?.notes.some((note) => note.includes('non è scritto nel documento')));
    const [named] = await buildDossierInventory(ports, files, { ...live, prepared: extraction('SinteticoUno', 'PersonaUno') });
    assert.equal(named.key, 'nome:sinteticouno|personauno|');
    assert.equal(named.sources[0].prepared?.notes.some((note) => note.includes('non è scritto nel documento')), false);
});

test('accept verified and apply writes only what the source supports, with active principle and summary', async () => {
    const text = letterText(CF_A);
    const { ports, files, records } = setup([['settimana/a.pdf', text]]);
    const [group] = await buildDossierInventory(ports, files, { ...live, prepared: preparedFor([{ text, cf: CF_A }]) });
    const source = group.sources[0];
    assert.equal(source.prepared?.facts, 4);
    assert.ok(source.facts.some((fact) => fact.origin === 'parser:document'), 'le proposte del parser restano visibili');
    await acquireDossierGroup(ports, { group, patientId: 'pa', confirmed: true, ...live });
    // Senza la scelta esplicita sulle sintesi: solo il verificato; sintesi e residuo restano al medico.
    const cautious = await acceptVerifiedAndApply(ports, { patientId: 'pa', ...live });
    assert.equal(cautious.accepted, 2, 'diagnosi e terapia');
    assert.equal(cautious.residualAcknowledged, 0);
    assert.equal([...records.keys()].filter((key) => key.startsWith('entries:')).length, 0);
    const result = await acceptVerifiedAndApply(ports, { patientId: 'pa', includeSummaries: true, ...live });
    assert.equal(result.accepted, 1, 'la sintesi');
    assert.ok(result.superseded >= 1, 'la voce col testo intero lascia il posto alla sintesi');
    assert.equal(result.residualAcknowledged, 1);
    const pending = (await loadPatientDossier(ports, 'pa', live.signal))!.documents[0].record.facts.filter((fact) => fact.decision === 'pending');
    assert.deepEqual(pending.map((fact) => fact.values.drugName), ['Metformina'], 'la terapia con citazione inventata resta al medico');
    const therapies = [...records.entries()].filter(([key]) => key.startsWith('therapies:')).map(([, value]) => value);
    assert.equal(therapies.length, 1);
    assert.equal(therapies[0].drugName, 'Ramipril');
    assert.equal(therapies[0].activePrinciple, 'ramipril');
    assert.equal(therapies[0].status, 'active');
    const entries = [...records.entries()].filter(([key]) => key.startsWith('entries:')).map(([, value]) => value);
    assert.equal(entries.length, 1);
    assert.match(String(entries[0].content), /dispnea da sforzo/u);
    assert.match(String(entries[0].content), /testo completo resta nell’allegato/u);
    const view = (await loadPatientDossier(ports, 'pa', live.signal))!;
    assert.deepEqual(view.documents[0].coverage.gaps, ['facts_pending']);
    assert.ok((await ports.getPatient('pa', live.signal))!.diagnoses.some((item) => item.description === 'Ipertensione arteriosa essenziale'));
    // Ripetere non duplica nulla.
    const again = await acceptVerifiedAndApply(ports, { patientId: 'pa', includeSummaries: true, ...live });
    assert.equal(again.accepted, 0);
    assert.equal([...records.keys()].filter((key) => key.startsWith('therapies:')).length, 1);
});

test('a document already in the dossier receives prepared proposals and section proposals are superseded', async () => {
    const text = letterText(CF_A);
    const { ports, files, records } = setup([['a.pdf', text]]);
    const [plain] = await buildDossierInventory(ports, files, live);
    await acquireDossierGroup(ports, { group: plain, patientId: 'pa', confirmed: true, ...live });
    const [withPrepared] = await buildDossierInventory(ports, files, { ...live, prepared: preparedFor([{ text, cf: CF_A, complete: false }]) });
    const outcomes: DossierAcquireOutcome[] = [];
    await acquireDossierGroup(ports, { group: withPrepared, patientId: 'pa', confirmed: true, ...live, onProgress: (outcome) => outcomes.push(outcome) });
    assert.equal(outcomes[0].status, 'reused');
    const view = (await loadPatientDossier(ports, 'pa', live.signal))!;
    const facts = view.documents[0].record.facts;
    assert.ok(facts.some((fact) => fact.origin === 'parser:section'));
    assert.equal(facts.filter((fact) => fact.origin === 'prepared').length, 4);
    const result = await acceptVerifiedAndApply(ports, { patientId: 'pa', includeSummaries: true, ...live });
    assert.ok(result.superseded >= 2);
    assert.equal(result.residualAcknowledged, 0, 'copertura dichiarata parziale: il residuo resta al medico');
    assert.equal([...records.keys()].filter((key) => key.startsWith('entries:')).length, 1, 'una sola voce di diario: la sintesi');
});
