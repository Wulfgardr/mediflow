/* @Codex */
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = webcrypto;
const encoder = new TextEncoder();
const checkOnly = process.argv.includes('--check');

const DRAFT_SCHEMA = 'mediflow.soap-draft.v1';
const OPERATION_ID = 'mediflow.clinical_diary.append_soap.v1';
const H1_DIGEST_CODEC = 'mediflow.headless.soap-draft-digest.v1';
const FIELD_SET_SCHEMA = 'mediflow.headless.soap-entry-field-set.v1';
const PAYLOAD_DIGEST_CODEC = 'mediflow.headless.soap-entry-payload-digest.v1';
const SEAL_SCHEMA = 'mediflow.headless.soap-entry-seal.v1';
const SEAL_DIGEST_CODEC = 'mediflow.headless.soap-entry-seal-digest.v1';
const ABSENT_ATTACHMENTS = 'mediflow.headless.attachments.absent.v1';

const FIELD_SET_KEY_ORDER = ['schema', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'payloadDigest'];
const SEAL_KEY_ORDER = ['schema', 'type', 'date', 'setting', 'title', 'content', 'metadata', 'payloadDigest', 'sealDigest'];

const inputs = {
  epochMilliseconds: 1_700_000_000_999,
  rawMasterKeyHex: '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
  titleIVHex: '000102030405060708090a0b',
  contentIVHex: '0c0d0e0f1011121314151617',
  metadataIVHex: '18191a1b1c1d1e1f20212223',
  subjective: 'Riferisce & controlla <valore> / "test"\nSeconda riga  ',
  objective: 'é 🩺',
  assessment: '',
  plan: 'Controllo\ttra 7 giorni',
};

function fail(message) {
  throw new Error(`H4 golden self-check failed: ${message}`);
}

function fromHex(value) {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) fail(`invalid hex ${value}`);
  return new Uint8Array(Buffer.from(value, 'hex'));
}

function frame(fields) {
  const chunks = [];
  for (const field of fields) {
    const bytes = encoder.encode(field);
    if (bytes.byteLength > 0xffff_ffff) fail('framed field exceeds u32');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.byteLength);
    chunks.push(length, Buffer.from(bytes));
  }
  return Buffer.concat(chunks);
}

function digest(codec, fields) {
  const packet = frame(fields);
  const bytes = createHash('sha256').update(packet).digest();
  return {
    value: { codec, sha256: { bytes: [...bytes], hex: bytes.toString('hex') } },
    packet,
  };
}

function escapeContent(value) {
  let output = '';
  for (const scalar of value) {
    if (scalar === '&') output += '&amp;';
    else if (scalar === '<') output += '&lt;';
    else if (scalar === '>') output += '&gt;';
    else if (scalar === '"') output += '&quot;';
    else if (scalar === "'") output += '&#39;';
    else if (scalar === '\n') output += '<br>';
    else output += scalar;
  }
  return output;
}

function contentBlock(label, value) {
  return value === '' ? `<p>${label}:</p>` : `<p>${label}: ${escapeContent(value)}</p>`;
}

function canonicalDate(epochMilliseconds) {
  if (!Number.isSafeInteger(epochMilliseconds) || epochMilliseconds < 0) fail('invalid epoch milliseconds');
  const value = new Date(Math.trunc(epochMilliseconds / 1_000) * 1_000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u.test(value)) fail('date is outside four-digit UTC form');
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: ${actual} !== ${expected}`);
}

async function encryptRawJSON(rawJSON, key, ivHex) {
  const iv = fromHex(ivHex);
  if (iv.byteLength !== 12) fail('IV is not 12 bytes');
  const combined = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(rawJSON)));
  const encoded = `ENC:${Buffer.from(iv).toString('base64')}:${Buffer.from(combined).toString('base64')}`;
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  assertEqual(new TextDecoder().decode(decrypted), rawJSON, 'AES-GCM round-trip');
  return encoded;
}

const h1 = digest(H1_DIGEST_CODEC, [
  DRAFT_SCHEMA,
  OPERATION_ID,
  inputs.subjective,
  inputs.objective,
  inputs.assessment,
  inputs.plan,
]);
assertEqual(h1.value.sha256.hex, 'e4381d00469aad7bfd0d375d489d7c0989a87463b4b42202520330b74da2156f', 'H1 digest');

const date = canonicalDate(inputs.epochMilliseconds);
const content = [
  contentBlock('S', inputs.subjective),
  contentBlock('O', inputs.objective),
  contentBlock('A', inputs.assessment),
  contentBlock('P', inputs.plan),
].join('');
const metadata = h1.value;
const metadataJSON = JSON.stringify(metadata);
const payload = digest(PAYLOAD_DIGEST_CODEC, [
  PAYLOAD_DIGEST_CODEC,
  FIELD_SET_SCHEMA,
  H1_DIGEST_CODEC,
  h1.value.sha256.hex,
  'visit',
  'Voce clinica',
  date,
  content,
  'ambulatory',
  metadataJSON,
  ABSENT_ATTACHMENTS,
]);
assertEqual(payload.value.sha256.hex, '790e2ed177fe1fb0ea800ded23d6488864b20243b41934ae53c1ddfda07d2d4d', 'payload digest');

const fieldSet = {
  schema: FIELD_SET_SCHEMA,
  type: 'visit',
  title: 'Voce clinica',
  date,
  content,
  setting: 'ambulatory',
  metadata,
  payloadDigest: payload.value,
};
assertEqual(JSON.stringify(Object.keys(fieldSet)), JSON.stringify(FIELD_SET_KEY_ORDER), 'field-set key order');

const masterKey = await subtle.importKey('raw', fromHex(inputs.rawMasterKeyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
const titleJSON = JSON.stringify(fieldSet.title);
const contentJSON = JSON.stringify(fieldSet.content);
const title = await encryptRawJSON(titleJSON, masterKey, inputs.titleIVHex);
const encryptedContent = await encryptRawJSON(contentJSON, masterKey, inputs.contentIVHex);
const encryptedMetadata = await encryptRawJSON(metadataJSON, masterKey, inputs.metadataIVHex);
const sealDigest = digest(SEAL_DIGEST_CODEC, [
  SEAL_DIGEST_CODEC,
  SEAL_SCHEMA,
  PAYLOAD_DIGEST_CODEC,
  payload.value.sha256.hex,
  'visit',
  date,
  'ambulatory',
  title,
  encryptedContent,
  encryptedMetadata,
  ABSENT_ATTACHMENTS,
]);
assertEqual(sealDigest.value.sha256.hex, '2de81ffb663723336648b65267d24b599565d3a4c9c13be66816c2f071786248', 'seal digest');

const seal = {
  schema: SEAL_SCHEMA,
  type: fieldSet.type,
  date: fieldSet.date,
  setting: fieldSet.setting,
  title,
  content: encryptedContent,
  metadata: encryptedMetadata,
  payloadDigest: fieldSet.payloadDigest,
  sealDigest: sealDigest.value,
};
assertEqual(JSON.stringify(Object.keys(seal)), JSON.stringify(SEAL_KEY_ORDER), 'seal key order');

const output = {
  version: 1,
  purpose: 'Byte-exact, language-neutral H4 SOAP entry field-set and AES-256-GCM seal oracle for ADR 0103.',
  fieldSetKeyOrder: FIELD_SET_KEY_ORDER,
  sealKeyOrder: SEAL_KEY_ORDER,
  inputs,
  h1Digest: h1.value,
  fieldSet,
  canonical: {
    metadataJSON,
    titleJSON,
    contentJSON,
    payloadPacketHex: payload.packet.toString('hex'),
    sealPacketHex: sealDigest.packet.toString('hex'),
  },
  seal,
};

const rendered = `${JSON.stringify(output, null, 2)}\n`;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(repositoryRoot, 'native', 'contracts', 'headless-soap-entry-h4-golden.v1.json');
if (checkOnly) {
  let current;
  try { current = readFileSync(outputPath, 'utf8'); } catch { fail(`missing fixture ${outputPath}`); }
  assertEqual(current, rendered, 'fixture drift');
  console.log('OK: H4 golden fixture is current and all self-checks passed');
} else {
  writeFileSync(outputPath, rendered);
  console.log(`OK: wrote ${outputPath}; all H4 self-checks passed`);
}
