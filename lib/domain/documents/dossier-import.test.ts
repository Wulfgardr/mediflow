import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOSSIER_SCHEMA_VERSION, DossierArtifactConflictError, buildDossierReceipt, classifyDossierSource, collectDossierTaxCodes,
    dossierFactBlockers, dossierResidualSegments, evaluateDossierCoverage, evaluateDossierGroupIdentity, extractDossierCandidates, findExplicitDocumentDate,
    readDossierRecord, reconcileDossierFacts, resolveDossierText, splitDossierUnits, writeDossierRecordIntoSnapshot,
    type DossierFact, type DossierRecord,
} from './dossier-import';
import { parseDocumentParseEvidenceArtifactSnapshot } from './document-parse-evidence-artifact';
import { buildDocumentEvidenceBackfillPlan } from './document-evidence-backfill';

// Codici fiscali sintetici con carattere di controllo valido, calcolati per questo test.
const CF_A = 'RSSMRA80A01F205X';
const CF_B = 'RSSMRA85T10A562S';
const enc = new TextEncoder();
const empty = new Set<string>();

test('fixture tax codes are checksum-valid synthetic values', async () => {
    const { isValidItalianTaxCodeChecksum } = await import('./document-identity-resolution');
    assert.equal(isValidItalianTaxCodeChecksum(CF_A), true);
    assert.equal(isValidItalianTaxCodeChecksum(CF_B), true);
});

test('classification identifies p7m, archives and e-mail as preserved-only, PDFs by magic bytes', () => {
    const pdf = classifyDossierSource({ name: 'referto.bin', size: 10, head: enc.encode('%PDF-1.7') });
    assert.deepEqual([pdf.kind, pdf.extractable], ['pdf', true]);
    const p7m = classifyDossierSource({ name: 'referto.pdf.p7m', size: 10, head: new Uint8Array([0x30, 0x80]) });
    assert.deepEqual([p7m.kind, p7m.extractable], ['signed_p7m', false]);
    const zip = classifyDossierSource({ name: 'pacchetto.zip', size: 10, head: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });
    assert.deepEqual([zip.kind, zip.extractable], ['archive', false]);
    const docx = classifyDossierSource({ name: 'lettera.docx', size: 10, head: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });
    assert.deepEqual([docx.kind, docx.extractable], ['office', true]);
    assert.equal(classifyDossierSource({ name: 'vuoto.pdf', size: 0, head: new Uint8Array() }).kind, 'empty');
    assert.equal(classifyDossierSource({ name: 'x.eml', size: 3, head: enc.encode('Fro') }).extractable, false);
});

test('page units come only from sequential OCR markers; otherwise one document unit', () => {
    const text = '## Pagina 1\n\nuno\n\n---\n\n## Pagina 2\n\ndue';
    const pages = splitDossierUnits(text, 2);
    assert.equal(pages.unitBasis, 'pages');
    assert.equal(pages.units.length, 2);
    assert.match(text.slice(pages.units[1].start, pages.units[1].end), /due/u);
    assert.equal(splitDossierUnits(text, 3).unitBasis, 'document');
    assert.equal(splitDossierUnits('solo testo', null).units[0].kind, 'document');
});

test('identity: mixed codes block, discordant link blocks, absence requires confirmation, homonyms resolve only by code', () => {
    const patients = [{ id: 'pa', taxCode: CF_A }, { id: 'pb', taxCode: CF_B }];
    const doc = (code: string) => ({ taxCodes: collectDossierTaxCodes(`Paziente: Mario Rossi\nCodice fiscale paziente: ${code}`) });
    assert.equal(evaluateDossierGroupIdentity([doc(CF_A), doc(CF_B)], patients).status, 'mixed');
    assert.equal(evaluateDossierGroupIdentity([doc(CF_A), doc(CF_B)], patients).blocking, true);
    const mixedDocument = { taxCodes: collectDossierTaxCodes(`Paziente CF ${CF_A}\nAssistito codice fiscale ${CF_B}`) };
    assert.equal(evaluateDossierGroupIdentity([mixedDocument], patients).blocking, true);
    const suggested = evaluateDossierGroupIdentity([doc(CF_B)], patients);
    assert.deepEqual([suggested.status, suggested.candidatePatientIds, suggested.confirmationRequired], ['suggested', ['pb'], true]);
    const discordant = evaluateDossierGroupIdentity([doc(CF_B)], patients, 'pa');
    assert.deepEqual([discordant.status, discordant.blocking], ['discordant', true]);
    const none = evaluateDossierGroupIdentity([{ taxCodes: [] }], patients, 'pa');
    assert.deepEqual([none.status, none.blocking, none.confirmationRequired], ['no_document_cf', false, true]);
});

test('document date: only labeled text dates or file-name hint, never a birth date or today', () => {
    assert.deepEqual(findExplicitDocumentDate('Data di nascita: 01/01/1950\nData referto: 12/03/2025', 'x.pdf'), { date: '2025-03-12', source: 'text' });
    assert.equal(findExplicitDocumentDate('Data di nascita: 01/01/1950', 'x.pdf'), null);
    assert.deepEqual(findExplicitDocumentDate('nessuna data', '2024-05-02__laboratorio__x.pdf'), { date: '2024-05-02', source: 'file_name' });
    assert.equal(findExplicitDocumentDate('Data referto: 31/02/2025', 'x.pdf'), null);
});

test('candidates: lab rows with evidence, explicit ICD with negation, catalog-only exemptions, full text kept', () => {
    const text = [
        'Referto di laboratorio', 'Glucosio 110 mg/dL 70-99 H', 'Creatinina 0,9 mg/dL 0,6-1,2',
        'Diagnosi: ICD-10 I10 Ipertensione essenziale', 'Nega diabete ICD-10 E11.9 diabete mellito tipo 2',
        'Esenzione 031 per ipertensione', 'Esenzione 999 inesistente', 'Note libere non strutturabili.',
    ].join('\n');
    const { units } = splitDossierUnits(text, null);
    const { facts } = extractDossierCandidates({ fileName: 'esami.pdf', text, units, documentDate: null, exemptionCodes: new Set(['031']) });
    const observations = facts.filter((fact) => fact.kind === 'observation');
    assert.deepEqual(observations.map((fact) => fact.values.display), ['Glucosio', 'Creatinina']);
    assert.equal(observations[0].values.observedAt, '', 'missing date stays missing');
    assert.equal(text.slice(observations[0].evidence!.start, observations[0].evidence!.end), 'Glucosio 110 mg/dL 70-99 H');
    const diagnoses = facts.filter((fact) => fact.kind === 'diagnosis');
    assert.deepEqual(diagnoses.map((fact) => [fact.values.code, fact.negated]), [['I10', false], ['E11.9', true]]);
    assert.deepEqual(facts.filter((fact) => fact.kind === 'exemption').map((fact) => fact.values.code), ['031']);
    const entry = facts.find((fact) => fact.origin === 'parser:document')!;
    assert.deepEqual([entry.values.textSource, entry.values.text], ['document', ''], 'the document entry refers to the single stored full text');
    assert.ok(dossierFactBlockers(observations[0]).some((item) => item.includes('Data mancante')));
    assert.ok(dossierFactBlockers(observations[0]).some((item) => item.includes('code')), 'LOINC code is never invented');
    assert.ok(dossierFactBlockers(diagnoses[1]).some((item) => item.includes('nega')));
});

function fact(kind: DossierFact['kind'], values: Record<string, string>, factId = `${kind}-${Object.values(values).join('-')}`): DossierFact {
    return { factId, kind, origin: 'manual', evidence: null, negated: false, values, decision: 'pending' };
}

test('lab rows rendered by AnyDoc as markdown headings keep exact evidence offsets', () => {
    const text = '## Referto di laboratorio\n\n## Glucosio 110 mg/dL 70-99 H\n\n- Creatinina 0,9 mg/dL 0,6-1,2';
    const { facts } = extractDossierCandidates({ fileName: 'x.pdf', text, units: splitDossierUnits(text, null).units, documentDate: '2025-01-10', exemptionCodes: empty });
    const observations = facts.filter((fact) => fact.kind === 'observation');
    assert.deepEqual(observations.map((fact) => fact.values.display), ['Glucosio', 'Creatinina']);
    assert.equal(text.slice(observations[0].evidence!.start, observations[0].evidence!.end), '## Glucosio 110 mg/dL 70-99 H');
    assert.equal(observations[0].values.observedAt, '2025-01-10');
});

test('ICD candidates stay separate and keep their own negation when the extractor merges lines', () => {
    const text = 'Diagnosi: ICD-10 I10 Ipertensione essenziale Nega diabete ICD-10 E11.9 diabete mellito. Non ICD-9 401.9 noto';
    const { facts } = extractDossierCandidates({ fileName: 'x.pdf', text, units: splitDossierUnits(text, null).units, documentDate: null, exemptionCodes: empty });
    const diagnoses = facts.filter((fact) => fact.kind === 'diagnosis');
    assert.deepEqual(diagnoses.map((fact) => [fact.values.code, fact.values.description, fact.negated]),
        [['I10', 'Ipertensione essenziale', false], ['E11.9', 'diabete mellito', true], ['401.9', 'noto', true]]);
});

test('reconciliation: cross-document duplicates, value conflicts, already present and dosage variation', () => {
    const current = { diagnoses: [{ code: 'I10', system: 'ICD-10', description: 'Ipertensione', date: '2020-01-01' }], exemptions: ['031'],
        therapies: [{ id: 't1', drugName: 'Ramipril', dosage: '5 mg 1 cp', status: 'active', startDate: '2023-01-01' }],
        observations: [], entries: [], servicePrescriptions: [], prostheticPrescriptions: [] };
    const glucose = (value: string) => fact('observation', { display: 'Glucosio', code: '', value, unit: 'mg/dL', observedAt: '2025-01-10' }, `g-${value}`);
    const result = reconcileDossierFacts([
        { documentKey: 'd2', documentDate: '2025-02-01', facts: [glucose('110'), fact('exemption', { code: '031' })] },
        { documentKey: 'd1', documentDate: '2025-01-10', facts: [glucose('110'), fact('therapy', { drugName: 'ramipril', dosage: '10 mg', status: 'completed', startDate: '2022-01-01' })] },
        { documentKey: 'd3', documentDate: '2025-03-01', facts: [glucose('140')] },
    ], current);
    assert.equal(result.get('d1#g-110')!.status, 'new');
    assert.equal(result.get('d2#g-110')!.status, 'duplicate_in_dossier');
    assert.deepEqual(result.get('d2#g-110')!.relatedFactRefs, ['d1#g-110']);
    assert.equal(result.get('d3#g-140')!.status, 'conflict');
    assert.equal(result.get('d2#exemption-031')!.status, 'already_present');
    assert.equal([...result.entries()].find(([key]) => key.startsWith('d1#therapy'))![1].status, 'conflict');
});

function record(overrides: Partial<DossierRecord> = {}): DossierRecord {
    return {
        schemaVersion: DOSSIER_SCHEMA_VERSION, importId: 'imp-1',
        source: { sha256: 'a'.repeat(64), byteLength: 10, mediaType: 'application/pdf', kind: 'pdf', relativePath: 'Cartella/Paziente/x.pdf', fileName: 'x.pdf' },
        preservation: { state: 'verified', reusedExisting: false },
        extraction: { state: 'extracted', engine: 'anydoc', pageCount: null, ocrPageCount: 0, unitBasis: 'document',
            units: [{ index: 1, kind: 'document', start: 0, end: 9 }], text: { location: 'parse_bundle', sha256: 'b'.repeat(64), chars: 9 } },
        identity: { taxCodes: [], status: 'no_document_cf', confirmedAt: '2026-11-03T00:00:00.000Z' },
        documentDate: null, classification: 'unknown', facts: [], residualReview: { state: 'acknowledged' }, applied: [],
        updatedAt: '2026-11-03T00:00:00.000Z', ...overrides,
    };
}

test('artifact: dossier key added to a valid v1 artifact; existing consumers keep reading it', () => {
    const snapshot = writeDossierRecordIntoSnapshot(undefined, record(), { attachmentId: 'att-1', fileName: 'x.pdf', text: 'testo pieno' });
    const v1 = parseDocumentParseEvidenceArtifactSnapshot(snapshot);
    assert.ok(v1, 'v1 consumers still parse the artifact');
    assert.equal(v1!.parseBundle.rawMarkdownExcerpt, 'testo pieno');
    const read = readDossierRecord(snapshot);
    assert.equal(read.status, 'present');
    assert.equal(resolveDossierText(snapshot, (read as { record: DossierRecord }).record), 'testo pieno');
    const plan = buildDocumentEvidenceBackfillPlan([{ id: 'att-1', patientId: 'p', fileName: 'x.pdf', createdAt: new Date(), parseEvidenceArtifactSnapshot: snapshot }]);
    assert.equal(plan.items[0].decision, 'skip_existing_artifact', 'backfill does not rebuild (and drop) the dossier');
    const merged = writeDossierRecordIntoSnapshot(snapshot, record({ importId: 'imp-2' }), { attachmentId: 'att-1', fileName: 'x.pdf', text: null });
    assert.equal(parseDocumentParseEvidenceArtifactSnapshot(merged)!.parseBundle.rawMarkdownExcerpt, 'testo pieno', 'merge keeps v1 fields');
    assert.throws(() => writeDossierRecordIntoSnapshot('{"schemaVersion":"other"}', record(), { attachmentId: 'a', fileName: 'x', text: null }), DossierArtifactConflictError);
    assert.equal(readDossierRecord(JSON.stringify({ dossier: { schemaVersion: DOSSIER_SCHEMA_VERSION } })).status, 'invalid');
});

test('coverage: failed extraction, unverified text, pending decisions and uncertain writes are never complete', () => {
    assert.deepEqual(evaluateDossierCoverage(record(), true), { complete: true, gaps: [] });
    assert.ok(evaluateDossierCoverage(record({ extraction: { state: 'failed', detail: 'image_or_scan' } }), false).gaps.includes('extraction_failed'));
    assert.ok(evaluateDossierCoverage(record(), false).gaps.includes('text_unverified'));
    assert.ok(evaluateDossierCoverage(record({ preservation: { state: 'pending_readback', reusedExisting: false } }), true).gaps.includes('not_preserved'));
    const accepted = { ...fact('exemption', { code: '031' }), decision: 'accepted' as const };
    assert.ok(evaluateDossierCoverage(record({ facts: [accepted] }), true).gaps.includes('apply_pending'));
    const uncertain = record({ facts: [accepted], applied: [{ factId: accepted.factId, target: 'patient_exemptions', recordId: null, outcome: 'uncertain', at: 'x' }] });
    assert.ok(evaluateDossierCoverage(uncertain, true).gaps.includes('apply_uncertain'));
    assert.ok(evaluateDossierCoverage(record({ residualReview: { state: 'pending' } }), true).gaps.includes('residual_pending'));
    assert.equal(evaluateDossierCoverage(record({ extraction: { state: 'not_extracted', reason: 'signed_p7m' } }), false).complete, false);
});

test('receipt is aggregate: no names, paths, codes, text or identifiers', () => {
    const accepted = { ...fact('exemption', { code: '031' }), decision: 'accepted' as const };
    const r = record({ facts: [accepted], identity: { taxCodes: [{ value: CF_A, role: 'patient_cf', checksumValid: true }], status: 'matched', confirmedAt: 'x' } });
    const measured = { ...r, storage: { originalCiphertextChars: 100, measuredAt: 'x' } };
    const receipt = buildDossierReceipt([{ record: measured, coverage: evaluateDossierCoverage(measured, true), artifactCiphertextChars: 50 },
        { record: r, coverage: evaluateDossierCoverage(r, true), artifactCiphertextChars: null }], new Date('2026-11-03T00:00:00Z'));
    const serialized = JSON.stringify(receipt);
    for (const forbidden of [CF_A, 'x.pdf', 'Cartella', 'imp-1', 'a'.repeat(64), '031']) assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.equal(receipt.sources, 2);
    const stale = buildDossierReceipt([{ record: r, coverage: evaluateDossierCoverage(r, true, 'changed-source') }], new Date('2026-11-03T00:00:00Z'));
    assert.equal(stale.preservedVerified, 0, 'a receipt cannot count a readback of another source version');
    assert.deepEqual(receipt.measuredStoredBytes, { originals: 100, originalsUnmeasured: 1, artifacts: 50, artifactsUnmeasured: 1 }, 'unmeasured is counted, never shown as zero');
});

test('backfill rebuild cannot propose replacing an artifact that carries dossier decisions and provenance', () => {
    const text = 'Testo completo di un documento sintetico con informazioni da conservare.';
    const snapshot = writeDossierRecordIntoSnapshot(undefined, record(), { attachmentId: 'att-1', fileName: 'x.pdf', text });
    const plan = buildDocumentEvidenceBackfillPlan([{ id: 'att-1', patientId: 'p', fileName: 'x.pdf', createdAt: '2026-11-03',
        rawMarkdown: text, parseEvidenceArtifactSnapshot: snapshot }], { rebuildExisting: true });
    assert.equal(plan.items[0].decision, 'skip_existing_artifact');
    assert.equal(plan.items[0].candidateArtifact, undefined);
});

test('observations with opposite numeric sign or a different unit are not already present', () => {
    for (const changed of [{ value: '-5', unitCode: 'mmol/L' }, { value: '5', unitCode: 'mg/dL' }]) {
        const candidate = fact('observation', { code: 'base-excess', display: 'Base excess', value: '5', unitCode: 'mmol/L', observedAt: '2025-01-10' }, 'measurement');
        const current = { diagnoses: [], exemptions: [], therapies: [], entries: [], servicePrescriptions: [], prostheticPrescriptions: [],
            observations: [{ id: 'o1', code: 'base-excess', display: 'Base excess', observedAt: '2025-01-10', ...changed }] };
        const result = reconcileDossierFacts([{ documentKey: 'd1', documentDate: '2025-01-10', facts: [candidate] }], current);
        assert.equal(result.get('d1#measurement')!.status, 'conflict', JSON.stringify(changed));
    }
});

test('same drug and date with a different dosage across documents is a conflict, not a duplicate', () => {
    const candidate = (dosage: string) => fact('therapy', { drugName: 'Ramipril', dosage, status: 'completed', startDate: '2025-01-10' }, 'therapy');
    const current = { diagnoses: [], exemptions: [], therapies: [], observations: [], entries: [], servicePrescriptions: [], prostheticPrescriptions: [] };
    const result = reconcileDossierFacts([
        { documentKey: 'd1', documentDate: '2025-01-10', facts: [candidate('5 mg')] },
        { documentKey: 'd2', documentDate: '2025-01-11', facts: [candidate('10 mg')] },
    ], current);
    assert.equal(result.get('d2#therapy')!.status, 'conflict');
});

// ---------------------------------------------------------------------------
// Proposte strutturate da sezioni esplicite (WUL-804, ripresa)
// ---------------------------------------------------------------------------

function candidates(text: string, documentDate: string | null = '2025-03-01') {
    return extractDossierCandidates({ fileName: 'x.pdf', text, units: splitDossierUnits(text, null).units, documentDate, exemptionCodes: empty }).facts;
}

test('medications from an explicit therapy section: dose only if written, historical by default, negation kept', () => {
    const text = 'Lettera sintetica\nTerapia domiciliare:\n- Ramipril 5 mg 1 cp al mattino\n- Bisoprololo 2,5 mg 1 cp\n- Paracetamolo al bisogno\n- non assume anticoagulanti\n\nAltro testo.';
    const therapies = candidates(text).filter((fact) => fact.kind === 'therapy');
    assert.deepEqual(therapies.map((fact) => [fact.values.drugName, fact.values.dosage, fact.values.status, fact.values.startDate, fact.negated]), [
        ['Ramipril', '5 mg 1 cp al mattino', 'completed', '', false],
        ['Bisoprololo', '2,5 mg 1 cp', 'completed', '', false],
        ['Paracetamolo al bisogno', '', 'completed', '', false],
        ['non assume anticoagulanti', '', 'completed', '', true],
    ]);
    assert.equal(therapies[0].values.temporality, 'in atto secondo il documento');
    assert.equal(text.slice(therapies[0].evidence!.start, therapies[0].evidence!.end), 'Ramipril 5 mg 1 cp al mattino');
    assert.ok(dossierFactBlockers(therapies[0]).some((item) => item.includes('Data mancante')), 'start date is never invented');
    assert.ok(dossierFactBlockers(therapies[2]).some((item) => item.includes('dosage')));
});

test('service request with items, NRE, priority and question; prosthetics with explicit ISO code and status', () => {
    const text = 'Ricetta sintetica NRE: 0301A1234567890 Priorità: B\nQuesito diagnostico: dispnea da sforzo\nPrestazioni richieste:\n1) Ecocardiogramma\n2) Visita cardiologica\n\nAusili prescritti: deambulatore ISO 12.06.06; materasso antidecubito';
    const facts = candidates(text);
    const service = facts.find((fact) => fact.kind === 'service_prescription')!;
    assert.deepEqual([service.values.serviceName, service.values.items, service.values.requestReference, service.values.priority, service.values.clinicalQuestion, service.values.prescribedAt],
        ['Ecocardiogramma', 'Ecocardiogramma\nVisita cardiologica', '0301A1234567890', 'B', 'dispnea da sforzo', '2025-03-01']);
    assert.ok(dossierFactBlockers(service).some((item) => item.includes('category')), 'category is not invented');
    const aids = facts.filter((fact) => fact.kind === 'prosthetic');
    assert.deepEqual(aids.map((fact) => [fact.values.description, fact.values.isoCode, fact.values.status]),
        [['deambulatore', '12.06.06', 'prescribed'], ['materasso antidecubito', '', 'prescribed']]);
    assert.equal(facts.some((fact) => fact.kind === 'therapy'), false, 'requests are never medications');
});

test('merged paragraph: sections still separate; family history is not a patient diagnosis; uncertainty kept', () => {
    const text = 'Visita sintetica Anamnesi familiare: padre con infarto. Diagnosi: sospetta BPCO; ipertensione arteriosa Valutazione: paziente orientato, deambula con bastone Caregiver: figlia convivente';
    const facts = candidates(text);
    const family = facts.find((fact) => fact.kind === 'anamnesis')!;
    assert.equal(family.values.subject, 'familiare');
    const diagnoses = facts.filter((fact) => fact.kind === 'diagnosis');
    assert.deepEqual(diagnoses.map((fact) => [fact.values.description, fact.values.certainty, fact.values.code]),
        [['sospetta BPCO', 'incerta', ''], ['ipertensione arteriosa', '', '']]);
    assert.equal(facts.find((fact) => fact.kind === 'assessment')!.values.text, 'paziente orientato, deambula con bastone');
    assert.equal(facts.find((fact) => fact.kind === 'care_context')!.values.text, 'figlia convivente');
});

test('reported scales and invalidity are transcribed values; unperformed scales stay residual', () => {
    const text = 'Valutazione multidimensionale sintetica. Indice di Barthel 60/100. MMSE non eseguito 0. Invalidità civile riconosciuta al 100% con indennità di accompagnamento.';
    const facts = candidates(text);
    const scales = facts.filter((fact) => fact.kind === 'reported_scale');
    assert.deepEqual(scales.map((fact) => [fact.values.scaleName, fact.values.scaleTotal, fact.values.scaleMax, fact.negated]),
        [['Barthel', '60', '100', false]]);
    assert.ok(dossierResidualSegments(text, splitDossierUnits(text, null).units, facts).some((part) => part.excerpt.includes('MMSE non eseguito 0')));
    assert.equal(candidates('Non somministrato MMSE: 0').find((fact) => fact.kind === 'reported_scale')?.negated, true);
    const invalidity = facts.find((fact) => fact.kind === 'invalidity')!;
    assert.deepEqual([invalidity.values.percentage, invalidity.values.allowance], ['100', 'riconosciuta']);
});

test('lab LOINC/UCUM only from an exact local catalog match; ambiguous or unknown analytes stay uncoded', () => {
    const text = 'Creatinina 0,9 mg/dL 0,6-1,2\nGlicemia 110 mg/dL 70-99\nCreatinina 80 umol/L 50-110\nFerritina 30 ng/mL 15-150';
    const observations = candidates(text).filter((fact) => fact.kind === 'observation');
    assert.deepEqual(observations.map((fact) => [fact.values.display, fact.values.code, fact.values.unitCode]), [
        ['Creatinina', '2160-0', 'mg/dL'],
        ['Glicemia', '', ''],
        ['Creatinina', '', ''],
        ['Ferritina', '', ''],
    ]);
});

test('residual text is everything no proposal covers, per unit', async () => {
    const { dossierResidualSegments } = await import('./dossier-import');
    const text = 'Terapia: Ramipril 5 mg\n\nNota libera senza struttura.';
    const { units } = splitDossierUnits(text, null);
    const facts = candidates(text);
    const residual = dossierResidualSegments(text, units, facts);
    assert.deepEqual(residual.map((segment) => segment.excerpt), ['Nota libera senza struttura.']);
});

test('identity proposals only from explicit labels; birth date validated', async () => {
    const { proposeIdentityFields } = await import('./dossier-sections');
    const proposals = proposeIdentityFields('Cognome: Rossi Nome: Mario Data di nascita: 31/02/1950 nato il 01/01/1950', CF_A);
    assert.deepEqual(proposals.map((item) => [item.field, item.value]), [['taxCode', CF_A], ['lastName', 'Rossi'], ['firstName', 'Mario']]);
    assert.deepEqual(proposeIdentityFields('Assistito: Mario Rossi, nato il 01/01/1950', null).map((item) => [item.field, item.value]), [['birthDate', '1950-01-01']]);
});

test('lab table rows merged into one paragraph are rebuilt conservatively and marked; evidence offsets stay exact', () => {
    const text = 'Referto sintetico\n\nCreatinina 0,9 mg/dL 0,6-1,2 Sodio 150 mmol/L 135-145 H Potassio 4,1 mmol/L 3,5-5,1';
    const observations = candidates(text, '2025-01-10').filter((fact) => fact.kind === 'observation');
    assert.deepEqual(observations.map((fact) => [fact.values.display, fact.values.value, fact.values.unit, fact.values.code]),
        [['Creatinina', '0.9', 'mg/dL', '2160-0'], ['Sodio', '150', 'mmol/L', '2951-2'], ['Potassio', '4.1', 'mmol/L', '2823-3']]);
    assert.equal(text.slice(observations[1].evidence!.start, observations[1].evidence!.end), 'Sodio 150 mmol/L 135-145 H');
    assert.ok(observations[1].values.rowSource, 'a rebuilt row is labelled for the physician');
    assert.equal(observations[0].values.rowSource, undefined);
});


test('scale years and future intervals are not transcribed scores', async () => {
    const { findScaleMentions } = await import('./dossier-sections');
    for (const source of ['MMSE nel 2025', 'Ripetere MMSE fra 6 mesi', 'Barthel 2025']) assert.deepEqual(findScaleMentions(source), [], source);
    assert.deepEqual(findScaleMentions('MMSE: 24/30; Barthel 60; NRS punteggio 4').map((m) => m.total), ['24', '60', '4']);
});

test('explicit ICD in family history does not become the patient diagnosis', () => {
    const facts = candidates('Anamnesi familiare: madre con ICD-10 E11.9 diabete mellito');
    assert.equal(facts.filter((f) => f.kind === 'diagnosis').length, 0);
    assert.ok(facts.some((f) => f.kind === 'anamnesis' && f.values.subject === 'familiare'));
});

test('identity: unlabeled and facility-adjacent codes remain visible and block the wrong patient', () => {
    const patients = [{ id: 'pa', taxCode: CF_A }, { id: 'pb', taxCode: CF_B }];
    for (const text of [
        `Lettera di dimissione\nSig. Bianchi Luca nato il 10/12/1985\nC.F.: ${CF_B}`,
        `ASST Nord Milano - UO Medicina\nSig. Bianchi Luca nato il 10/12/1985 C.F. ${CF_B}`,
        `Medico curante Dott. Verdi\nAssistito Bianchi Luca\nCF ${CF_B}`,
    ]) {
        const document = { taxCodes: collectDossierTaxCodes(text) };
        const wrong = evaluateDossierGroupIdentity([document], patients, 'pa');
        assert.equal(wrong.blocking, true, text);
        assert.deepEqual(wrong.documentPatientCodes, [CF_B]);
        assert.doesNotMatch(wrong.message, /Nessun codice/u);
        assert.equal(evaluateDossierGroupIdentity([document], patients, 'pb').blocking, false);
        assert.deepEqual(evaluateDossierGroupIdentity([document], patients).candidatePatientIds, ['pb']);
    }
    // A previous artifact's heuristic professional role is not proof of attribution.
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [{ value: CF_B, role: 'professional_cf', checksumValid: true }] }], patients, 'pa').blocking, true);
    for (const label of ['CF medico:', 'Codice fiscale del medico prescrittore:', 'Medico CF:']) {
        const document = { taxCodes: collectDossierTaxCodes(`Paziente CF ${CF_A}\n${label} ${CF_B}`) };
        assert.equal(evaluateDossierGroupIdentity([document], patients, 'pa').blocking, false, label);
    }
    // Repeating the same code without a professional label must not hide that occurrence.
    const repeated = { taxCodes: collectDossierTaxCodes(`CF medico: ${CF_B}\nC.F.: ${CF_B}`) };
    assert.equal(evaluateDossierGroupIdentity([repeated], patients, 'pa').blocking, true);
});

test('ICD subject follows explicit sections; punctuation alone does not establish a new subject', () => {
    for (const text of [
        'Anamnesi familiare: madre diabetica. Diagnosi: ICD-10 E11 diabete mellito tipo 2',
        'Madre diabetica. Diagnosi: ICD-10 E11 diabete mellito tipo 2',
    ]) {
        const facts = candidates(text);
        assert.deepEqual(facts.filter((f) => f.kind === 'diagnosis').map((f) => f.values.code), ['E11'], text);
        assert.equal(facts.some((f) => f.kind === 'anamnesis' && f.values.text?.includes('ICD-10 E11')), false);
    }
    for (const text of ['Anamnesi familiare:\n- padre ICD-10 I21 infarto miocardico', 'Anamnesi familiare:\nICD-10 I21 infarto miocardico acuto',
        'Madre diabetica. ICD-10 E11 diabete mellito tipo 2', 'Diagnosi: madre diabetica. ICD-10 E11 diabete mellito tipo 2']) {
        const facts = candidates(text);
        assert.equal(facts.some((f) => f.kind === 'diagnosis'), false);
        assert.ok(facts.some((f) => f.kind === 'anamnesis' && f.values.subject === 'familiare'));
    }
});

test('scale dates do not become scores and explicit scores after dates retain their evidence', async () => {
    const { findScaleMentions } = await import('./dossier-sections');
    for (const [text, total, max] of [
        ['MMSE 03/2021: 22/30', '22', '30'],
        ['MMSE 12/2019 punteggio 24', '24', ''],
        ['Barthel 06/2023 = 45/100', '45', '100'],
        ['MMSE 01/03/2021: 22/30', '22', '30'],
        ['MMSE 24/30', '24', '30'], ['Barthel 60/100', '60', '100'], ['CDR 0,5', '0,5', ''],
    ]) {
        const mentions = findScaleMentions(text);
        assert.deepEqual(mentions.map((m) => [m.total, m.max]), [[total, max]], text);
        assert.equal(text.slice(mentions[0].start, mentions[0].end), text);
    }
    for (const text of ['MMSE 03/2021', 'MMSE 01/03/2021', 'MMSE 2019: 24/30']) assert.deepEqual(findScaleMentions(text), [], text);
});

test('professional identity labels cannot cross lines or be taken from narrative prose', () => {
    const patients = [{ id: 'pa', taxCode: CF_A }, { id: 'pb', taxCode: CF_B }];
    for (const prefix of [
        'Assistito Medico\nC.F.', 'Sig. Bianchi Luca, inviato dal medico\nC.F.:',
        "Paziente Bianchi Luca, preso in carico dall'operatore\nCF",
        'CF medico:\n', 'CF\nmedico:', 'Codice fiscale del\nmedico:',
        'Medico\r\nCF:', 'Medico\u2028CF:',
        'Sig. Bianchi Luca, inviato dal medico C.F.:', 'Assistito Medico C.F.:',
    ]) {
        const taxCodes = collectDossierTaxCodes(`${prefix} ${CF_B}`);
        assert.equal(evaluateDossierGroupIdentity([{ taxCodes }], patients, 'pa').blocking, true, prefix);
        assert.equal(taxCodes.some((code) => code.explicitProfessional), false, prefix);
    }
    // A stored attribution from the old, multiline rule must not survive as an exemption.
    const old = { taxCodes: [{ value: CF_B, role: 'professional_cf' as const, checksumValid: true, explicitProfessional: true }] };
    assert.equal(evaluateDossierGroupIdentity([old], patients, 'pa').blocking, true);
    for (const prefix of ['CF medico:', 'Codice fiscale del medico prescrittore:', 'Medico CF:', '  CF\toperatore:']) {
        const taxCodes = collectDossierTaxCodes(`Paziente CF ${CF_A}\n${prefix} ${CF_B}`);
        assert.equal(evaluateDossierGroupIdentity([{ taxCodes }], patients, 'pa').blocking, false, prefix);
    }
});

test('clinical abbreviations do not detach an ICD diagnosis from its family subject', () => {
    for (const text of [
        'Madre deceduta per ca. mammella ICD-10 C50',
        'Madre deceduta per ca. Mammella ICD-10 C50',
        'Padre: dec. per IMA ICD-10 I21 infarto',
        'Padre: dec. IMA ICD-10 I21 infarto',
        'Anamnesi: madre con diab. mell. ICD-10 E11',
        'Anamnesi: madre con diab. mell. tipo 2 ICD-10 E11',
        'Madre con npl. Mammella ICD-10 C50',
        'Madre ICD-10 E11 diabete; ICD-10 I10 ipertensione',
        'Madre deceduta per carcinoma mammella ICD-10 C50',
    ]) {
        const facts = candidates(text);
        assert.equal(facts.some((f) => f.kind === 'diagnosis'), false, text);
        assert.ok(facts.some((f) => f.kind === 'anamnesis' && f.values.subject === 'familiare' && f.values.text?.includes('ICD-10')), text);
    }
    const own = candidates('Madre deceduta per ca. mammella. Diagnosi: ICD-10 E11 diabete');
    assert.deepEqual(own.filter((f) => f.kind === 'diagnosis').map((f) => f.values.code), ['E11']);
});

test('patient names are read only from a labelled line, as capitalised words', async () => {
    const { collectDossierPatientNames, evaluateDossierGroupIdentity } = await import('./dossier-import');
    assert.deepEqual(collectDossierPatientNames([
        'Paziente: **Mario Rossi**, codice fiscale RSSMRA80A01F205X',
        'Cognome e nome: ROSSI MARIO nato il 01/01/1980',
        'Assistita: Nicolò D’Amico',
        'Paziente: vigile, collaborante, orientato',
        'Paziente: Collaborante e vigile',
        'PAZIENTE: VIGILE E COLLABORANTE',
        'Paziente: Vigile Collaborante',
        'PAZIENTE: ALLETTATO, NON DEAMBULANTE',
        'Assistito: Anziano Fragile',
        'Il paziente: riferisce dolore',
        'Ricoverato il paziente Mario Rossi',
    ].join('\n')), [['mario', 'rossi'], ['rossi', 'mario'], ['nicolo', 'd', 'amico']]);
    const linked = [{ id: 'p', taxCode: '', firstName: 'Nicolò', lastName: "D'Amico" }];
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [], patientNames: [['nicolo', 'd', 'amico']] }], linked, 'p').status, 'no_document_cf');
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [], patientNames: [['mario', 'rossi']] }], linked, 'p').status, 'discordant_name');
    // Prescrizione con due riquadri «Cognome e nome» (assistita e prescrittore), come nei moduli di protesica reali.
    const twoBoxes = collectDossierPatientNames('COGNOME E NOME: D’AMICO NICOLÒ          DATA DI NASCITA:\nCOGNOME E NOME: BIANCHI LUCA          CODICE FISCALE: BN');
    assert.deepEqual(twoBoxes, [['d', 'amico', 'nicolo'], ['bianchi', 'luca']]);
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [], patientNames: twoBoxes }], linked, 'p').blocking, false);
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [], patientNames: twoBoxes }, { taxCodes: [], patientNames: [['mario', 'rossi']] }], linked, 'p').status, 'discordant_name');
    // Un'anagrafica senza nome completo non permette il confronto: resta la conferma.
    assert.equal(evaluateDossierGroupIdentity([{ taxCodes: [], patientNames: [['mario', 'rossi']] }], [{ id: 'p', taxCode: '', lastName: 'D’Amico' }], 'p').blocking, false);
});
