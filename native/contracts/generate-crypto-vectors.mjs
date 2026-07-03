// Claude 2026-06-30 (ADR 0071, Fase 0): generator for the language-neutral
// zero-knowledge crypto golden vectors. Produces DETERMINISTIC, byte-exact
// reference outputs using the same WebCrypto primitives lib/security.ts uses
// (AES-256-GCM, PBKDF2-HMAC-SHA256 x100000). Every core implementation
// (web TS reference, Swift MediFlowCore today, a possible Rust core tomorrow)
// MUST reproduce these on macOS, Windows-MSVC and Linux before any data flows.
//
// Run: node native/contracts/generate-crypto-vectors.mjs
// Output: native/contracts/crypto-golden-vectors.v1.json (self-verified)

import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { subtle } = webcrypto;
const utf8 = new TextEncoder();
const ITERATIONS = 100000; // lib/security.ts SECURITY_CONFIG.ITERATIONS

const hex = (b) => Buffer.from(b).toString('hex');
const b64 = (b) => Buffer.from(b).toString('base64');
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

function assertEq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`SELF-CHECK FAILED [${label}]: ${actual} !== ${expected}`);
    }
}

// Fixed inputs (chosen once; never change for v1 or the oracle drifts).
const PIN = '1357';
const SALT_HEX = '000102030405060708090a0b0c0d0e0f';                                  // 16 bytes
const RAW_MASTER_KEY_HEX = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f'; // 32 bytes
const FIELD_IV_HEX = '0a0b0c0d0e0f101112131415';                                     // 12 bytes
const WRAP_IV_HEX = 'a1a2a3a4a5a6a7a8a9aaabac';                                       // 12 bytes

// --- KEK from PIN (PBKDF2-HMAC-SHA256, 100k) ---
const pinKeyMaterial = await subtle.importKey('raw', utf8.encode(PIN), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
const kekBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(SALT_HEX), iterations: ITERATIONS, hash: 'SHA-256' },
    pinKeyMaterial,
    256,
);
const kekHex = hex(kekBits);
const kek = await subtle.deriveKey(
    { name: 'PBKDF2', salt: fromHex(SALT_HEX), iterations: ITERATIONS, hash: 'SHA-256' },
    pinKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
);

// --- Master key (AES-256-GCM) ---
const masterKey = await subtle.importKey('raw', fromHex(RAW_MASTER_KEY_HEX), 'AES-GCM', true, ['encrypt', 'decrypt']);

// --- wrapMasterKey: combined = iv(12) || AES-GCM(rawMasterKey, KEK) ; base64 ---
const wrapCt = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: fromHex(WRAP_IV_HEX) }, kek, fromHex(RAW_MASTER_KEY_HEX)));
const wrappedCombined = new Uint8Array(12 + wrapCt.length);
wrappedCombined.set(fromHex(WRAP_IV_HEX));
wrappedCombined.set(wrapCt, 12);
const wrappedMasterKeyB64 = b64(wrappedCombined);

// self-check: unwrap restores the raw master key
const unwrapped = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromHex(WRAP_IV_HEX) }, kek, wrappedCombined.slice(12)));
assertEq(hex(unwrapped), RAW_MASTER_KEY_HEX, 'unwrapMasterKey round-trip');

// --- Field encryption: plaintext = JSON.stringify(value); ENC:base64(iv):base64(ct+tag) ---
async function encField(name, value) {
    const json = JSON.stringify(value);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: fromHex(FIELD_IV_HEX) }, masterKey, utf8.encode(json)));
    const ivB64 = b64(fromHex(FIELD_IV_HEX));
    const dataB64 = b64(ct);
    // self-check: decrypt restores the JSON
    const back = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromHex(FIELD_IV_HEX) }, masterKey, fromB64(dataB64)));
    assertEq(back, json, `field ${name} round-trip`);
    return { name, value, json, ivB64, dataB64, enc: `ENC:${ivB64}:${dataB64}` };
}

const fields = [
    await encField('patient.address', 'Via Roma 1, Milano'),
    await encField('patient.phone', '+39 02 1234567'),
    await encField('patient.diagnoses', [{ code: 'E11.9', description: 'Diabete tipo 2', system: 'ICD-10', date: '2026-01-01T00:00:00.000Z' }]),
    await encField('checkup.notes.empty', ''),
    await encField('observation.value.number', 1.25),
];

const out = {
    version: 1,
    purpose: 'Language-neutral byte-exact oracle for the MediFlow zero-knowledge field crypto (ADR 0071, Fase 0). Every core (web TS reference / Swift MediFlowCore / future Rust) must reproduce these exactly on macOS, Windows-MSVC and Linux.',
    reference: 'lib/security.ts (WebCrypto) and native/.../CryptoService.swift (CryptoKit)',
    algorithm: {
        fieldCipher: 'AES-256-GCM, 12-byte IV, 16-byte tag appended to ciphertext',
        kdf: 'PBKDF2-HMAC-SHA256',
        iterations: ITERATIONS,
        masterKeyBits: 256,
        fieldFormat: 'ENC:base64(iv):base64(ciphertext||tag)',
        plaintextConvention: 'JSON.stringify(value) then UTF-8 bytes',
        wrappedMasterKeyFormat: 'base64(iv12 || AES-GCM(rawMasterKey, KEK))',
    },
    inputs: {
        pin: PIN,
        saltHex: SALT_HEX,
        rawMasterKeyHex: RAW_MASTER_KEY_HEX,
        fieldIvHex: FIELD_IV_HEX,
        wrapIvHex: WRAP_IV_HEX,
    },
    vectors: {
        kekFromPinHex: kekHex,
        wrappedMasterKeyB64,
        fields,
    },
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, 'crypto-golden-vectors.v1.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log('OK: all self-checks passed; wrote', outPath);
console.log('KEK(from PIN) hex   :', kekHex);
console.log('wrapped master key  :', wrappedMasterKeyB64);
for (const f of fields) console.log(`field ${f.name.padEnd(26)} -> ${f.enc}`);
