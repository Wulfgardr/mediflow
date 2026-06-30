// ADR 0071 Fase 2: generate a deterministic fixture medical.db for the read-only
// SQLitePatientStore test. One patient with ENCRYPTED_FIELDS sealed as ENC:iv:data
// using a KNOWN test master key (the same raw key as the crypto golden vectors),
// so the Swift test can decrypt without an operator PIN and assert byte-equal
// plaintext. The patients table uses the real web schema verbatim.
//
// Run with Node 20 (matches better-sqlite3 ABI):
//   ~/.nvm/versions/node/v20.20.2/bin/node native/MediFlowMac/Tests/MediFlowCoreTests/Fixtures/generate-fixture.mjs

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

db.close();
console.log('OK: wrote', dbPath, '(1 patient, encrypted fields sealed with the golden-vector master key)');
