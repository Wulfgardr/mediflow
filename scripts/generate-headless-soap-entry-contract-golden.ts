/* @Codex */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CLINICIAN_SOAP_DRAFT_KEYS,
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    type ClinicianSoapDraftV1,
    validateClinicianSoapWriteDraft,
} from '../lib/headless/clinician-soap-write-contract.ts';
import {
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA,
    type ClinicianSoapEntryCommitReceiptV1,
    snapshotClinicianSoapEntryCommitReceipt,
} from '../lib/headless/clinician-soap-entry-commit-receipt.ts';

const CHECK_FLAG = '--check';
const ENTRY_REF_DOMAIN = 'mediflow.headless.soap-entry-id.v1';
const AUDIT_REF_DOMAIN = 'mediflow.headless.soap-entry-audit-id.v1';
const RECEIPT_REF_DOMAIN = 'mediflow.headless.soap-entry-receipt-ref.v1';
const COMMAND_ID = `hsac_${'b'.repeat(64)}`;
const EXPECTED_DRAFT_DIGEST = 'e4381d00469aad7bfd0d375d489d7c0989a87463b4b42202520330b74da2156f';
const EXPECTED_ENTRY_REF = 'hsei_36647f110c8e0f4271a40a0bff529323bb5dfcf83615d1384703560aaa82d19f';
const EXPECTED_AUDIT_REF = 'hsea_3be641fc6ff30e2cebb20f7cb14b3ce99dfab5065b3a7dc9b4d2130b6ef3fcce';
const EXPECTED_RECEIPT_REF = 'hser_e5bdc96f3ec004423c2ca2716bf49e40ade4e1f7ab196a6b7a3ac6699bf57b14';
const EXPECTED_RECEIPT_DIGEST = '4374289aaf2aff0ea046e7c3bc301d940d41f3fc38d905dee1496051139fe483';

function fail(message: string): never {
    throw new Error(`H9 golden self-check failed: ${message}`);
}

function assertEqual(actual: string, expected: string, label: string): void {
    if (actual !== expected) fail(`${label}: ${actual} !== ${expected}`);
}

function assertKeyOrder(actual: object, expected: readonly string[], label: string): void {
    assertEqual(JSON.stringify(Object.keys(actual)), JSON.stringify(expected), label);
}

function sha256DomainSeparated(domain: string, value: string): string {
    return createHash('sha256').update(domain, 'utf8').update('\0', 'utf8').update(value, 'utf8').digest('hex');
}

function deriveRef(prefix: string, domain: string): string {
    return `${prefix}${sha256DomainSeparated(domain, COMMAND_ID)}`;
}

function buildDraft(): Readonly<{ draft: ClinicianSoapDraftV1; digest: unknown }> {
    const input = Object.create(null) as Record<(typeof CLINICIAN_SOAP_DRAFT_KEYS)[number], string>;
    input.schema = CLINICIAN_SOAP_DRAFT_SCHEMA;
    input.operationId = CLINICIAN_SOAP_OPERATION_ID;
    input.subjective = 'Riferisce & controlla <valore> / "test"\nSeconda riga  ';
    input.objective = 'é 🩺';
    input.assessment = '';
    input.plan = 'Controllo\ttra 7 giorni';

    const accepted = validateClinicianSoapWriteDraft(input);
    if (accepted.status !== 'accepted') fail(`H1 rejected the canonical synthetic draft: ${accepted.code}`);
    assertEqual(accepted.digest.sha256.hex, EXPECTED_DRAFT_DIGEST, 'draft digest');

    const draft: ClinicianSoapDraftV1 = {
        schema: accepted.schema,
        operationId: accepted.operationId,
        subjective: accepted.subjective,
        objective: accepted.objective,
        assessment: accepted.assessment,
        plan: accepted.plan,
    };
    assertKeyOrder(draft, CLINICIAN_SOAP_DRAFT_KEYS, 'draft key order');
    return { draft, digest: accepted.digest };
}

function buildReceipt(): ClinicianSoapEntryCommitReceiptV1 {
    const entryRef = deriveRef('hsei_', ENTRY_REF_DOMAIN);
    const auditEventRef = deriveRef('hsea_', AUDIT_REF_DOMAIN);
    const receiptRef = deriveRef('hser_', RECEIPT_REF_DOMAIN);
    assertEqual(entryRef, EXPECTED_ENTRY_REF, 'entry ref');
    assertEqual(auditEventRef, EXPECTED_AUDIT_REF, 'audit ref');
    assertEqual(receiptRef, EXPECTED_RECEIPT_REF, 'receipt ref');

    const candidate: ClinicianSoapEntryCommitReceiptV1 = {
        schema: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA,
        receiptRef,
        operationId: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID,
        outcome: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME,
        commandId: COMMAND_ID,
        entryRef,
        auditEventRef,
        patientVersion: 7,
        entryVersion: 1,
        committedAt: '2026-08-31T23:45:12.000Z',
        bindingDigest: 'e'.repeat(64),
        entryDigest: 'f'.repeat(64),
        auditDigest: '0'.repeat(64),
    };
    assertKeyOrder(candidate, CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS, 'receipt key order');
    const receipt = snapshotClinicianSoapEntryCommitReceipt(candidate);
    if (!receipt) fail('H9 receipt codec rejected the canonical synthetic receipt');
    return receipt;
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== CHECK_FLAG)) {
    fail(`unsupported arguments: ${args.join(' ')}`);
}
const checkOnly = args[0] === CHECK_FLAG;
const { draft, digest: draftDigest } = buildDraft();
const receipt = buildReceipt();
const draftJSON = JSON.stringify(draft);
const receiptJSON = JSON.stringify(receipt);
const receiptDigest = sha256DomainSeparated(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN, receiptJSON);
assertEqual(receiptDigest, EXPECTED_RECEIPT_DIGEST, 'receipt digest');

const output = {
    version: 1,
    purpose: 'Byte-exact, language-neutral H9 SOAP draft and commit receipt oracle for ADR 0103.',
    draftKeyOrder: [...CLINICIAN_SOAP_DRAFT_KEYS],
    receiptKeyOrder: [...CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS],
    draft,
    draftDigest,
    receipt,
    canonical: {
        draftJSON,
        receiptJSON,
        receiptDigestCodec: CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN,
        receiptDigestHex: receiptDigest,
    },
};
assertKeyOrder(output, [
    'version', 'purpose', 'draftKeyOrder', 'receiptKeyOrder', 'draft', 'draftDigest', 'receipt', 'canonical',
], 'golden top-level key order');

const rendered = `${JSON.stringify(output, null, 2)}\n`;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(repositoryRoot, 'native', 'contracts', 'headless-soap-entry-contract-golden.v1.json');
if (checkOnly) {
    let current: string;
    try { current = readFileSync(outputPath, 'utf8'); } catch { fail(`missing fixture ${outputPath}`); }
    assertEqual(current, rendered, 'fixture drift');
    console.log('OK: H9 golden fixture is current and all self-checks passed');
} else {
    writeFileSync(outputPath, rendered);
    console.log(`OK: wrote ${outputPath}; all H9 self-checks passed`);
}
