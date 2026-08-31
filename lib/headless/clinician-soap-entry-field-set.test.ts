/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from './clinician-soap-write-contract.ts';
import {
    CLINICIAN_SOAP_ENTRY_ATTACHMENTS_ABSENT_SENTINEL, CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA,
    CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC, CLINICIAN_SOAP_ENTRY_SETTING, CLINICIAN_SOAP_ENTRY_TITLE,
    CLINICIAN_SOAP_ENTRY_TYPE, createClinicianSoapEntryFieldSet,
} from './clinician-soap-entry-field-set.ts';

function acceptedSnapshot(overrides: Partial<Record<'subjective' | 'objective' | 'assessment' | 'plan', string>> = {}) {
    const input = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'A & B\n<segno> "x" \'y\'', objective: '', assessment: '\tValutazione / sintetica', plan: 'Piano 😀',
        ...overrides,
    });
    const result = validateClinicianSoapWriteDraft(input); assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('synthetic H1 fixture denied'); return result;
}

test('matches the language-neutral H4 field-set golden fixture byte for byte', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../native/contracts/headless-soap-entry-h4-golden.v1.json', import.meta.url), 'utf8')) as {
        inputs: { epochMilliseconds: number; subjective: string; objective: string; assessment: string; plan: string };
        h1Digest: { sha256: { hex: string } };
        fieldSet: unknown;
    };
    const source = acceptedSnapshot({
        subjective: fixture.inputs.subjective, objective: fixture.inputs.objective,
        assessment: fixture.inputs.assessment, plan: fixture.inputs.plan,
    });
    assert.equal(source.digest.sha256.hex, fixture.h1Digest.sha256.hex);
    const result = createClinicianSoapEntryFieldSet(source, fixture.inputs.epochMilliseconds); assert.ok(result);
    assert.equal(JSON.stringify(result), JSON.stringify(fixture.fieldSet));
});

test('creates the exact authority-free SOAP entry field set from one accepted H1 snapshot', () => {
    const source = acceptedSnapshot(); const result = createClinicianSoapEntryFieldSet(source, 1_704_067_200_987);
    assert.ok(result); assert.deepEqual(Reflect.ownKeys(result), [
        'schema', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'payloadDigest',
    ]);
    assert.equal(result.schema, CLINICIAN_SOAP_ENTRY_FIELD_SET_SCHEMA); assert.equal(result.type, CLINICIAN_SOAP_ENTRY_TYPE);
    assert.equal(result.title, CLINICIAN_SOAP_ENTRY_TITLE); assert.equal(result.setting, CLINICIAN_SOAP_ENTRY_SETTING);
    assert.equal(result.date, '2024-01-01T00:00:00.000Z');
    assert.equal(result.content, '<p>S: A &amp; B<br>&lt;segno&gt; &quot;x&quot; &#39;y&#39;</p><p>O:</p><p>A: \tValutazione / sintetica</p><p>P: Piano 😀</p>');
    assert.equal(Object.hasOwn(result, 'attachments'), false); assert.equal(Reflect.get(result, 'attachments'), undefined);
    assert.equal(CLINICIAN_SOAP_ENTRY_ATTACHMENTS_ABSENT_SENTINEL, 'mediflow.headless.attachments.absent.v1');
    assert.deepEqual(result.metadata, source.digest); assert.notEqual(result.metadata, source.digest);
    assert.notEqual(result.metadata.sha256, source.digest.sha256); assert.notEqual(result.metadata.sha256.bytes, source.digest.sha256.bytes);
    assert.deepEqual(Reflect.ownKeys(result.metadata), ['codec', 'sha256']);
    assert.deepEqual(Reflect.ownKeys(result.metadata.sha256), ['bytes', 'hex']);
    assert.equal(result.payloadDigest.codec, CLINICIAN_SOAP_ENTRY_PAYLOAD_DIGEST_CODEC);
    assert.equal(result.payloadDigest.sha256.bytes.length, 32); assert.match(result.payloadDigest.sha256.hex, /^[0-9a-f]{64}$/u);
    for (const value of [result, result.metadata, result.metadata.sha256, result.metadata.sha256.bytes,
        result.payloadDigest, result.payloadDigest.sha256, result.payloadDigest.sha256.bytes]) {
        assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : null); assert.equal(Object.isFrozen(value), true);
    }
});

test('matches the discriminating u32-BE payload golden for empty, escaped, whitespace, and Unicode sections', () => {
    const source = acceptedSnapshot(); const result = createClinicianSoapEntryFieldSet(source, 1_704_067_200_987); assert.ok(result);
    assert.equal(source.digest.sha256.hex, 'dee382cdd985c3fc3b911970a8bc0ff39456739af67ca194a64ea26295b1088b');
    assert.equal(result.payloadDigest.sha256.hex, 'ecb00c8f1acdea6a177feb37647ec66a8279d1aa4088f534ecf78000cc1827d3');
    assert.deepEqual(result.payloadDigest.sha256.bytes, [
        236, 176, 12, 143, 26, 205, 234, 106, 23, 127, 235, 55, 100, 126, 198, 106,
        130, 121, 209, 170, 64, 136, 245, 52, 236, 247, 128, 0, 204, 24, 39, 211,
    ]);
    const repeated = createClinicianSoapEntryFieldSet(source, 1_704_067_200_001); assert.ok(repeated);
    assert.deepEqual(repeated, result); assert.notEqual(repeated, result); assert.notEqual(repeated.metadata, result.metadata);
});

test('rejects invalid clocks and dates outside the canonical four-digit UTC range', () => {
    const source = acceptedSnapshot();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, '1704067200987', Number.MAX_SAFE_INTEGER]) {
        assert.equal(createClinicianSoapEntryFieldSet(source, value), null, String(value));
    }
    const last = createClinicianSoapEntryFieldSet(source, 253_402_300_799_999); assert.ok(last);
    assert.equal(last.date, '9999-12-31T23:59:59.000Z');
    assert.equal(createClinicianSoapEntryFieldSet(source, 253_402_300_800_000), null);
});

test('rejects non-exact or tampered H1 snapshots without executing accessors', () => {
    const source = acceptedSnapshot();
    const extra = Object.create(null); for (const key of Reflect.ownKeys(source)) extra[key] = source[key as keyof typeof source];
    extra.patientId = 'synthetic-forbidden'; Object.freeze(extra); assert.equal(createClinicianSoapEntryFieldSet(extra, 0), null);

    const foreignPrototype = Object.freeze(Object.assign({}, source));
    assert.equal(createClinicianSoapEntryFieldSet(foreignPrototype, 0), null);

    const tampered = Object.create(null); for (const key of Reflect.ownKeys(source)) {
        tampered[key] = key === 'subjective' ? 'Tamper sintetico' : source[key as keyof typeof source];
    }
    Object.freeze(tampered); assert.equal(createClinicianSoapEntryFieldSet(tampered, 0), null);

    let reads = 0; const accessor = Object.create(null);
    for (const key of Reflect.ownKeys(source)) Object.defineProperty(accessor, key, key === 'subjective'
        ? { enumerable: true, get() { reads += 1; return source.subjective; } }
        : { enumerable: true, value: source[key as keyof typeof source] });
    Object.freeze(accessor); assert.equal(createClinicianSoapEntryFieldSet(accessor, 0), null); assert.equal(reads, 0);

    const bytes = [...source.digest.sha256.bytes]; Object.defineProperty(bytes, Symbol('extra'), { value: 1 }); Object.freeze(bytes);
    const sha256 = Object.freeze(Object.assign(Object.create(null), { bytes, hex: source.digest.sha256.hex }));
    const digest = Object.freeze(Object.assign(Object.create(null), { codec: source.digest.codec, sha256 }));
    const forged = Object.create(null); for (const key of Reflect.ownKeys(source)) forged[key] = key === 'digest' ? digest : source[key as keyof typeof source];
    Object.freeze(forged); assert.equal(createClinicianSoapEntryFieldSet(forged, 0), null);
});
