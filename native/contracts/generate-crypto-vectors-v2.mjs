// Claude 2026-07-03 (Stream F): generator for the v2 zero-knowledge crypto
// golden vectors. Identical primitives to the v1 generator (AES-256-GCM +
// PBKDF2-HMAC-SHA256), but the wrapped-master-key blob is derived at the v2 work
// factor (600,000 iterations, OWASP guidance) and serialized in the versioned
// "v2:<base64>" form. Every core (web TS reference / Swift MediFlowCore) MUST
// reproduce these byte-for-byte so paired clients stay in lockstep across the
// KDF upgrade. Field crypto is unchanged from v1 (it uses the master key, not
// the KEK), so this fixture focuses on the versioned wrap/unwrap.
//
// Run: node native/contracts/generate-crypto-vectors-v2.mjs
// Output: native/contracts/crypto-golden-vectors.v2.json (self-verified)

import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { subtle } = webcrypto;
const utf8 = new TextEncoder();
const ITERATIONS_V2 = 600000; // lib/security/security.ts KDF_ITERATIONS[2]
const KDF_VERSION = 2;

const hex = (b) => Buffer.from(b).toString('hex');
const b64 = (b) => Buffer.from(b).toString('base64');
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));

function assertEq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`SELF-CHECK FAILED [${label}]: ${actual} !== ${expected}`);
    }
}

// Fixed synthetic inputs (test-only PIN/keys; never real data). Reused from v1
// so the two fixtures differ only by iteration count and the versioned marker.
const PIN = '1357';
const SALT_HEX = '000102030405060708090a0b0c0d0e0f';                                  // 16 bytes
const RAW_MASTER_KEY_HEX = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f'; // 32 bytes
const WRAP_IV_HEX = 'a1a2a3a4a5a6a7a8a9aaabac';                                       // 12 bytes

// --- KEK from PIN (PBKDF2-HMAC-SHA256, 600k) ---
const pinKeyMaterial = await subtle.importKey('raw', utf8.encode(PIN), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
const kekBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(SALT_HEX), iterations: ITERATIONS_V2, hash: 'SHA-256' },
    pinKeyMaterial,
    256,
);
const kekHex = hex(kekBits);
const kek = await subtle.deriveKey(
    { name: 'PBKDF2', salt: fromHex(SALT_HEX), iterations: ITERATIONS_V2, hash: 'SHA-256' },
    pinKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
);

// --- wrapMasterKey: combined = iv(12) || AES-GCM(rawMasterKey, KEK) ; base64 ---
const wrapCt = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: fromHex(WRAP_IV_HEX) }, kek, fromHex(RAW_MASTER_KEY_HEX)));
const wrappedCombined = new Uint8Array(12 + wrapCt.length);
wrappedCombined.set(fromHex(WRAP_IV_HEX));
wrappedCombined.set(wrapCt, 12);
const wrappedMasterKeyB64 = b64(wrappedCombined);
const wrappedMasterKeyVersioned = `v${KDF_VERSION}:${wrappedMasterKeyB64}`;

// self-check: unwrap restores the raw master key
const unwrapped = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromHex(WRAP_IV_HEX) }, kek, wrappedCombined.slice(12)));
assertEq(hex(unwrapped), RAW_MASTER_KEY_HEX, 'unwrapMasterKey round-trip');

const out = {
    version: KDF_VERSION,
    purpose: 'Language-neutral byte-exact oracle for the MediFlow zero-knowledge wrapped-master-key at KDF v2 (PBKDF2-HMAC-SHA256 x600000). Every core (web TS reference / Swift MediFlowCore) must reproduce these exactly so paired clients survive the KDF upgrade.',
    reference: 'lib/security/security.ts (WebCrypto) and native/.../CryptoService.swift (CryptoKit)',
    algorithm: {
        kdf: 'PBKDF2-HMAC-SHA256',
        iterations: ITERATIONS_V2,
        masterKeyBits: 256,
        wrappedMasterKeyFormat: 'v2:base64(iv12 || AES-GCM(rawMasterKey, KEK))',
    },
    inputs: {
        pin: PIN,
        saltHex: SALT_HEX,
        rawMasterKeyHex: RAW_MASTER_KEY_HEX,
        wrapIvHex: WRAP_IV_HEX,
    },
    vectors: {
        kekFromPinHex: kekHex,
        wrappedMasterKeyB64,
        wrappedMasterKeyVersioned,
    },
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, 'crypto-golden-vectors.v2.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log('OK: all self-checks passed; wrote', outPath);
console.log('KEK(from PIN, 600k) hex :', kekHex);
console.log('wrapped master key (v2) :', wrappedMasterKeyVersioned);
