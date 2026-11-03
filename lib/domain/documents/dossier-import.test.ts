import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOSSIER_SCHEMA_VERSION, DossierArtifactConflictError, buildDossierReceipt, classifyDossierSource, collectDossierTaxCodes,
    dossierFactBlockers, evaluateDossierCoverage, evaluateDossierGroupIdentity, extractDossierCandidates, findExplicitDocumentDate,
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
    const receipt = buildDossierReceipt([{ record: r, coverage: evaluateDossierCoverage(r, true), storedBytes: { original: 100, artifact: 50 } }], new Date('2026-11-03T00:00:00Z'));
    const serialized = JSON.stringify(receipt);
    for (const forbidden of [CF_A, 'x.pdf', 'Cartella', 'imp-1', 'a'.repeat(64), '031']) assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.equal(receipt.sources, 1);
    assert.deepEqual(receipt.measuredStoredBytes, { originals: 100, artifacts: 50 });
});
