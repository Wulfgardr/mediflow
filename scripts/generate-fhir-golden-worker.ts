import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { buildFhirBundleFromRecords } from '../lib/fhir/bundle-mapper';
import type { FhirBundleInput } from '../lib/fhir/types';

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, '..', 'native', 'contracts');
const inputPath = join(contractsDir, 'fhir-golden-input.v1.json');
const bundlePath = join(contractsDir, 'fhir-golden-bundle.v1.json');

const input: FhirBundleInput = {
    generatedAt: '2026-07-08T09:00:00.000Z',
    patient: {
        id: 'patient-fhir-golden',
        firstName: 'Giulia',
        lastName: 'Bianchi',
        taxCode: 'BNCGLI80A41F205X',
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Via Verdi 12, Milano',
        phone: '+39 02 1234567',
        isArchived: false,
        caregiver: 'Marco Bianchi, marito',
        exemptions: ['013', 'E30'],
        diagnoses: [
            {
                id: 'condition-golden-diabetes',
                code: 'E11.9',
                description: 'Diabete mellito tipo 2 senza complicanze',
                system: 'ICD-10',
                date: '2025-01-15T08:30:00.000Z',
            },
            {
                id: 'condition-golden-hypertension',
                code: 'I10',
                description: 'Ipertensione essenziale',
                system: 'ICD-10',
                date: '2024-11-20T10:15:00.000Z',
            },
        ],
    },
    entries: [
        {
            id: 'entry-visit-2026-01-10',
            patientId: 'patient-fhir-golden',
            date: '2026-01-10T08:45:00.000Z',
            type: 'visit',
            title: 'Visita ambulatoriale diabetologica',
            content: 'Controllo periodico. Compenso glicemico in miglioramento.',
            setting: 'ambulatory',
        },
        {
            id: 'entry-scale-adl-2026-02-05',
            patientId: 'patient-fhir-golden',
            date: '2026-02-05T14:30:00.000Z',
            type: 'scale',
            title: 'Scala ADL',
            content: 'Somministrata ADL con autonomia conservata.',
            setting: 'home',
            metadata: {
                title: 'ADL (Indice di Katz)',
                score: 6,
                interpretation: 'Autonomia Conservata (6/6)',
            },
        },
    ],
    therapies: [
        {
            id: 'therapy-metformin',
            patientId: 'patient-fhir-golden',
            drugName: 'Metformina 500 mg',
            dosage: '1 compressa dopo pranzo e cena',
            motivation: 'Controllo glicemico nel diabete tipo 2',
            status: 'active',
            startDate: '2025-02-01T00:00:00.000Z',
        },
        {
            id: 'therapy-ramipril',
            patientId: 'patient-fhir-golden',
            drugName: 'Ramipril 5 mg',
            dosage: '1 compressa al mattino',
            motivation: 'Ipertensione arteriosa',
            status: 'suspended',
            startDate: '2024-12-01T00:00:00.000Z',
            endDate: '2026-03-01T00:00:00.000Z',
        },
    ],
    checkups: [
        {
            id: 'checkup-hba1c',
            patientId: 'patient-fhir-golden',
            date: '2026-04-15T07:30:00.000Z',
            title: 'Controllo HbA1c',
            status: 'pending',
        },
    ],
    observations: [
        {
            id: 'observation-hba1c',
            patientId: 'patient-fhir-golden',
            codeSystem: 'LOINC',
            code: '4548-4',
            display: 'Hemoglobin A1c/Hemoglobin.total in Blood',
            unitSystem: 'UCUM',
            unitCode: '%',
            value: 7.2,
            notes: 'Valore da laboratorio territoriale.',
            observedAt: '2026-03-10T07:15:00.000Z',
        },
        {
            id: 'observation-creatinine',
            patientId: 'patient-fhir-golden',
            codeSystem: 'LOINC',
            code: '2160-0',
            display: 'Creatinine [Mass/volume] in Serum or Plasma',
            unitSystem: 'UCUM',
            unitCode: 'mg/dL',
            value: 'non dosabile',
            notes: 'Campione emolizzato, ripetere.',
            observedAt: '2026-03-10T07:16:00.000Z',
        },
    ],
};

const bundle = buildFhirBundleFromRecords(input);
const inputJson = JSON.stringify(input, null, 2) + '\n';
const bundleJson = JSON.stringify(bundle, null, 2) + '\n';
const scaleObservation = bundle.entry
    ?.map((entry) => entry.resource)
    .find((resource) => resource?.resourceType === 'Observation' && resource.id === 'obs-entry-scale-adl-2026-02-05') as
    | { valueInteger?: number; code?: { text?: string } }
    | undefined;

assert.deepEqual(
    buildFhirBundleFromRecords(JSON.parse(inputJson) as FhirBundleInput),
    bundle,
    'FHIR golden self-check failed after JSON round-trip',
);
assert.equal(scaleObservation?.valueInteger, 6, 'FHIR golden self-check must include scale Observation score');
assert.equal(scaleObservation?.code?.text, 'ADL (Indice di Katz)', 'FHIR golden self-check must include scale Observation title');

writeFileSync(inputPath, inputJson);
writeFileSync(bundlePath, bundleJson);

assert.equal(readFileSync(inputPath, 'utf8'), inputJson, 'FHIR input write/read mismatch');
assert.equal(readFileSync(bundlePath, 'utf8'), bundleJson, 'FHIR bundle write/read mismatch');

console.log('OK: all self-checks passed; wrote', inputPath);
console.log('OK: wrote', bundlePath);
