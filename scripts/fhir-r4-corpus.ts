import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildFhirBundleFromRecords } from '../lib/fhir/bundle-mapper';
import type { FhirBundleInput } from '../lib/fhir/types';

const date = '2026-01-15T10:00:00.000Z';
const base = (): FhirBundleInput => ({
  generatedAt: date,
  patient: { id: 'synthetic-patient', firstName: 'Synthetic', lastName: 'Fixture', taxCode: 'SYNTHETIC-ONLY' },
  entries: [], therapies: [], checkups: [], observations: [],
});
export function corpusInputs(): Array<{ id: string; covers: string[]; input: FhirBundleInput }> {
  const cases: ReturnType<typeof corpusInputs> = [];
  const add = (id: string, covers: string[], mutate: (input: FhirBundleInput) => void) => {
    const input = base(); mutate(input); cases.push({ id, covers, input });
  };
  add('patient-minimal', ['patient:optional-absent'], () => {});
  add('patient-full', ['patient:optional-present', 'id:sanitize'], i => Object.assign(i.patient, {
    id: 'synthetic / patient', birthDate: '1980-01-01', address: 'Synthetic address', phone: '+39000000000', caregiver: 'Synthetic caregiver',
  }));
  add('patient-archived', ['patient:archived', 'id:empty-normalized'], i => Object.assign(i.patient, { isArchived: true, id: '///' }));
  for (const system of ['ICD-9', 'ICD-10', 'ICD-11', 'UNKNOWN']) {
    add(`diagnosis-${system.toLowerCase()}`, [`diagnosis:${system}`, 'id:derived'], i => {
      i.patient.diagnoses = [{ code: system === 'ICD-9' ? '250.00' : system === 'ICD-11' ? '5A11' : 'E11.9', description: 'Synthetic diagnosis', system, date }];
    });
  }
  add('diagnosis-id', ['diagnosis:persistent-id', 'id:long'], i => {
    i.patient.diagnoses = [{ id: 'synthetic'.repeat(12), code: 'I10', description: 'Synthetic diagnosis', system: 'ICD-10', date }];
  });
  add('encounters', ['entry:home', 'entry:ambulatory', 'entry:missing-setting', 'entry:deleted', 'entry:non-scale'], i => {
    i.entries = ['home', 'ambulatory', undefined].map((setting, n) => ({ id: `visit-${n}`, patientId: i.patient.id, date, type: 'visit', content: 'Synthetic visit', setting: setting as 'home' | 'ambulatory' | undefined }));
    i.entries.push({ id: 'deleted-entry', patientId: i.patient.id, date, type: 'note', content: 'Synthetic deleted', deletedAt: date });
  });
  for (const [id, score] of Object.entries({ zero: 0, integer: 6, numeric: '3' })) {
    add(`scale-${id}`, [`scale:${id}`], i => { i.entries = [{ id: 'scale', patientId: i.patient.id, date, type: 'scale', content: 'Synthetic scale note', metadata: { title: 'Synthetic scale', score, interpretation: 'Synthetic interpretation' } }]; });
  }
  for (const status of ['active', 'suspended', 'completed'] as const) {
    add(`therapy-${status}`, [`therapy:${status}`, `therapy:end-${status !== 'active'}`], i => {
      i.therapies = [{ id: 'therapy', patientId: i.patient.id, drugName: 'Synthetic medication', dosage: 'Synthetic dose', status, startDate: date, ...(status !== 'active' ? { endDate: date, motivation: 'Synthetic note' } : {}) }];
    });
  }
  for (const [id, value] of Object.entries({ numeric: 7.2, text: 'Synthetic text', zero: 0 })) {
    add(`observation-${id}`, [`observation:${id}`], i => { i.observations = [{ id: 'observation', patientId: i.patient.id, codeSystem: 'LOINC', code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood', unitSystem: 'UCUM', unitCode: '%', value, observedAt: date, ...(id === 'numeric' ? { notes: 'Synthetic note' } : {}) }]; });
  }
  return cases;
}
export function generateCorpus(directory: string) {
  mkdirSync(directory, { recursive: true });
  return corpusInputs().map(({ id, covers, input }) => {
    const file = `${id}.json`;
    const bundle = JSON.parse(JSON.stringify(buildFhirBundleFromRecords(input)));
    writeFileSync(path.join(directory, file), JSON.stringify(bundle, null, 2) + '\n');
    return { id, producer: 'web', file, covers, bundle };
  });
}
if (process.argv[1]?.endsWith('/fhir-r4-corpus.ts') && process.argv[2]) {
  const artifacts = generateCorpus(process.argv[2]);
  writeFileSync(path.join(process.argv[2], 'manifest.txt'), JSON.stringify(artifacts.map(({ bundle: _bundle, ...artifact }) => artifact), null, 2));
}
