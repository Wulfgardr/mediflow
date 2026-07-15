// ADR 0071 Fase 2: generate a deterministic fixture medical.db for the read-only
// SQLitePatientStore test. One patient with ENCRYPTED_FIELDS sealed as ENC:iv:data
// using a KNOWN test master key (the same raw key as the crypto golden vectors),
// so the Swift test can decrypt without an operator PIN and assert byte-equal
// plaintext. The patients table uses the real web schema verbatim.
//
// Run with Node 24 (matches the repository better-sqlite3 ABI contract):
//   nvm exec 24 node native/MediFlowMac/Tests/MediFlowCoreTests/Fixtures/generate-fixture.mjs

import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const { subtle } = webcrypto;
const utf8 = new TextEncoder();
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const b64 = (b) => Buffer.from(b).toString('base64');

// Same raw master key as native/contracts/crypto-golden-vectors.v1.json.
const RAW_MASTER_KEY_HEX = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f';
const masterKey = await subtle.importKey('raw', fromHex(RAW_MASTER_KEY_HEX), 'AES-GCM', false, ['encrypt']);

// Distinct fixed IVs per field keep the fixture byte-stable across regenerations.
let ivCounter = 1;
async function enc(value) {
    const iv = new Uint8Array(12);
    iv[11] = ivCounter++;
    const json = JSON.stringify(value);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, utf8.encode(json)));
    return `ENC:${b64(iv)}:${b64(ct)}`;
}

const patient = {
    id: 'fixture-1',
    first_name: 'Mario',
    last_name: 'Rossi',
    tax_code: 'RSSMRA80A01H501U',
    birth_date: 315532800, // 1980-01-01 (unixepoch seconds)
    address: await enc('Via Roma 1, Milano'),
    phone: await enc('+39 02 1234567'),
    caregiver: await enc('Caregiver Test'),
    notes: null,
    ai_summary: null,
    is_adi: 0,
    is_archived: 0,
    ambulatory_id: 'AMB-1',
    created_at: 1750000000,
    updated_at: 1750000000,
    document_insights: null,
    exemptions: await enc(['048', 'C01']),
    diagnoses: await enc([{ code: 'E11.9', description: 'Diabete tipo 2', system: 'ICD-10', date: '2026-01-01T00:00:00.000Z' }]),
    monitoring_profile: null,
    status_reason: null,
    version: 1,
    deleted_at: null,
    deletion_reason: null,
};

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'medical_fixture.db');
if (existsSync(dbPath)) rmSync(dbPath);

const require = createRequire(import.meta.url);
const Database = require(join(process.cwd(), 'node_modules/better-sqlite3'));
const db = new Database(dbPath);

// Real web schema for patients (verbatim from the live medical.db).
db.exec(`CREATE TABLE "patients" (
    \`id\` text PRIMARY KEY NOT NULL,
    \`first_name\` text NOT NULL,
    \`last_name\` text NOT NULL,
    \`tax_code\` text NOT NULL,
    \`birth_date\` integer,
    \`address\` text,
    \`phone\` text,
    \`caregiver\` text,
    \`notes\` text,
    \`ai_summary\` text,
    \`is_adi\` integer DEFAULT false,
    \`is_archived\` integer DEFAULT false,
    \`ambulatory_id\` text,
    \`created_at\` integer DEFAULT (unixepoch()),
    \`updated_at\` integer DEFAULT (unixepoch()), \`document_insights\` text, exemptions TEXT, diagnoses TEXT, monitoring_profile TEXT, status_reason TEXT, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER, deletion_reason TEXT
);`);

const cols = Object.keys(patient);
db.prepare(`INSERT INTO patients (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => patient[c]));

// ADR 0071 membership-scope parity: the web scopes every read/write via the
// patients_to_ambulatories join table (WUL-309), not the denormalized
// patients.ambulatory_id. Seed fixture-1's membership in AMB-1 (matching its
// denormalized column) so the store's membership-join scope checks find it.
db.exec(`CREATE TABLE "patients_to_ambulatories" (
    \`patient_id\` text NOT NULL, \`ambulatory_id\` text NOT NULL,
    \`assigned_at\` integer DEFAULT (unixepoch()),
    PRIMARY KEY(\`patient_id\`, \`ambulatory_id\`)
);`);
db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
    .run('fixture-1', 'AMB-1', 1750000000);

// ADR 0071 Fase 3 slice 4: one row per clinical sub-resource, sealed under the same
// golden-vector master key, so SQLiteClinicalStore list-read tests (both the core
// target and the AppleShared adapter, which cannot construct tables itself - the
// SQLite wrapper is internal to MediFlowCore) can read a real on-disk fixture without
// regenerating tables in-test. Real web schema (verbatim from the live medical.db).
db.exec(`CREATE TABLE "entries" (
    \`id\` text PRIMARY KEY NOT NULL, \`patient_id\` text NOT NULL, \`type\` text NOT NULL,
    \`title\` text NOT NULL DEFAULT 'Voce clinica', \`date\` integer NOT NULL, \`content\` text NOT NULL,
    \`setting\` text, \`metadata\` text, \`attachments\` text, \`deleted_at\` integer, \`deletion_reason\` text,
    \`version\` integer NOT NULL DEFAULT 1, \`created_at\` integer DEFAULT (unixepoch()), \`updated_at\` integer DEFAULT (unixepoch())
);`);
db.exec(`CREATE TABLE "therapies" (
    \`id\` text PRIMARY KEY NOT NULL, \`patient_id\` text NOT NULL, \`drug_name\` text NOT NULL,
    \`aic\` text, \`atc\` text, \`active_principle\` text, \`dosage\` text NOT NULL, \`motivation\` text,
    \`diagnosis_code\` text, \`diagnosis_name\` text, \`status\` text NOT NULL DEFAULT 'active',
    \`start_date\` integer NOT NULL, \`end_date\` integer, \`version\` integer NOT NULL DEFAULT 1,
    \`created_at\` integer DEFAULT (unixepoch()), \`updated_at\` integer DEFAULT (unixepoch()),
    \`deleted_at\` integer, \`deletion_reason\` text
);`);
db.exec(`CREATE TABLE "checkups" (
    \`id\` text PRIMARY KEY NOT NULL, \`patient_id\` text NOT NULL, \`date\` integer NOT NULL,
    \`title\` text NOT NULL, \`notes\` text, \`status\` text DEFAULT 'pending', \`source\` text,
    \`version\` integer NOT NULL DEFAULT 1, \`created_at\` integer DEFAULT (unixepoch()),
    \`updated_at\` integer DEFAULT (unixepoch()), \`deleted_at\` integer, \`deletion_reason\` text
);`);
db.exec(`CREATE TABLE "observations" (
    \`id\` text PRIMARY KEY NOT NULL, \`patient_id\` text NOT NULL, \`code_system\` text NOT NULL,
    \`code\` text NOT NULL, \`display\` text NOT NULL, \`unit_system\` text NOT NULL, \`unit_code\` text NOT NULL,
    \`value\` text NOT NULL, \`notes\` text, \`observed_at\` integer NOT NULL, \`source\` text DEFAULT 'manual',
    \`version\` integer NOT NULL DEFAULT 1, \`created_at\` integer DEFAULT (unixepoch()),
    \`updated_at\` integer DEFAULT (unixepoch()), \`deleted_at\` integer, \`deletion_reason\` text
);`);

const entry = {
    id: 'fixture-entry-1', patient_id: 'fixture-1', type: 'note', title: await enc('Visita di controllo'),
    date: 1751000000, content: await enc('Paziente stabile, nessuna variazione terapeutica.'),
    setting: 'ambulatory', metadata: null, attachments: null, deleted_at: null, deletion_reason: null,
    version: 1, created_at: 1751000000, updated_at: 1751000000,
};
db.prepare(`INSERT INTO entries (${Object.keys(entry).map((c) => `"${c}"`).join(',')}) VALUES (${Object.keys(entry).map(() => '?').join(',')})`)
    .run(...Object.values(entry));

const therapy = {
    id: 'fixture-therapy-1', patient_id: 'fixture-1', drug_name: 'Metformina', aic: null, atc: 'A10BA02',
    active_principle: 'Metformina cloridrato', dosage: '500mg 2x/die', motivation: await enc('Diabete tipo 2'),
    diagnosis_code: 'E11.9', diagnosis_name: 'Diabete mellito tipo 2', status: 'active',
    start_date: 1748000000, end_date: null, version: 1, created_at: 1748000000, updated_at: 1748000000,
    deleted_at: null, deletion_reason: null,
};
db.prepare(`INSERT INTO therapies (${Object.keys(therapy).map((c) => `"${c}"`).join(',')}) VALUES (${Object.keys(therapy).map(() => '?').join(',')})`)
    .run(...Object.values(therapy));

const checkup = {
    id: 'fixture-checkup-1', patient_id: 'fixture-1', date: 1749000000, title: 'Controllo glicemico',
    notes: await enc('Valori nella norma'), status: 'completed', source: 'manual',
    version: 1, created_at: 1749000000, updated_at: 1749000000, deleted_at: null, deletion_reason: null,
};
db.prepare(`INSERT INTO checkups (${Object.keys(checkup).map((c) => `"${c}"`).join(',')}) VALUES (${Object.keys(checkup).map(() => '?').join(',')})`)
    .run(...Object.values(checkup));

const observation = {
    id: 'fixture-observation-1', patient_id: 'fixture-1', code_system: 'LOINC', code: '4548-4',
    display: 'Emoglobina glicata', unit_system: 'UCUM', unit_code: '%', value: '6.8',
    notes: await enc('Buon controllo glicemico'), observed_at: 1747000000, source: 'manual',
    version: 1, created_at: 1747000000, updated_at: 1747000000, deleted_at: null, deletion_reason: null,
};
db.prepare(`INSERT INTO observations (${Object.keys(observation).map((c) => `"${c}"`).join(',')}) VALUES (${Object.keys(observation).map(() => '?').join(',')})`)
    .run(...Object.values(observation));

db.close();
console.log('OK: wrote', dbPath, '(1 patient + 1 entry/therapy/checkup/observation, encrypted fields sealed with the golden-vector master key)');
