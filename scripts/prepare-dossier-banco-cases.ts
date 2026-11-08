import { readFileSync, writeFileSync } from 'node:fs';
import { parsePreparedExtraction, preparedDossierFacts } from '../lib/domain/documents/dossier-prepared';
import { collectDossierPatientNames, collectDossierTaxCodes, findExplicitDocumentDate, splitDossierUnits } from '../lib/domain/documents/dossier-import';
import type { DossierFact } from '../lib/domain/documents/dossier-import';
const root = 'native/contracts/dossier-conformance/';
const banco = JSON.parse(readFileSync(root + 'banco.json', 'utf8'));
const parser = JSON.parse(readFileSync(root + 'parser.json', 'utf8'));
const mutations = JSON.parse(readFileSync(root + 'mutations.json', 'utf8'));
const calls: Array<{ op: string; args: unknown[] }> = [];
const manifest: Array<{ name: string; facts: number; identity: number; eligible: number[]; mutation: boolean }> = [];
function add(input: { id: string; text: string; pages: number | null; fileName: string; extraction: unknown; parserFacts?: DossierFact[] }, mutation = false) {
    const parsed = parsePreparedExtraction(JSON.stringify(input.extraction));
    if (!parsed.ok || !parsed.value.sources.length) throw new Error(input.id);
    const source = parsed.value.sources[0];
    const units = splitDossierUnits(input.text, input.pages).units;
    const args = { source, text: input.text, units, documentDate: findExplicitDocumentDate(input.text, input.fileName)?.date ?? null, parserFacts: input.parserFacts ?? [], now: new Date('2026-11-05T12:00:00Z') };
    const facts = calls.length;
    calls.push({ op: 'preparedDossierFacts', args: [args] });
    const identity = calls.length;
    const patient = { id: 'synthetic-selected', taxCode: source.patient?.taxCode ?? '', firstName: source.patient?.firstName ?? 'Persona', lastName: source.patient?.lastName ?? 'Sintetica' };
    calls.push({ op: 'evaluateDossierGroupIdentity', args: [[{ taxCodes: collectDossierTaxCodes(input.text), patientNames: collectDossierPatientNames(input.text) }], [patient], patient.id] });
    const eligible: number[] = [];
    for (const fact of preparedDossierFacts(args).facts) {
        if (fact.origin !== 'prepared' || fact.values.preparedCheck === 'summary') continue;
        eligible.push(calls.length);
        calls.push({ op: 'preparedFactEligible', args: [fact, []] });
    }
    manifest.push({ name: input.id, facts, identity, eligible, mutation });
}
for (const row of banco.documents) {
    add({ ...row, parserFacts: parser.find((p: { id: string }) => p.id === row.id).result.facts });
    add({ ...row, id: row.id + '-candidate', extraction: banco.candidates.find((p: { id: string }) => p.id === row.id).extraction });
}
for (const mutation of mutations) add({ id: mutation.name, text: mutation.text, fileName: mutation.extraction.sources[0].fileName, pages: 1, extraction: mutation.extraction }, true);
writeFileSync(root + 'banco-cases.json', JSON.stringify(calls));
writeFileSync(root + 'banco-index.json', JSON.stringify(manifest));
console.log(`${calls.length} casi del banco, dieci falsificazioni esplicite`);
