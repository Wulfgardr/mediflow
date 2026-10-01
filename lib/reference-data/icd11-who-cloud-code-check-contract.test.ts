import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseWhoCloudCodeInfo, parseWhoCloudCodeCheckResult, parseWhoCloudCodeCheckReceipt,
    WHO_CLOUD_CODE_CHECK_REFERENCE, WHO_CLOUD_CODE_CHECK_SCHEMA,
} from './icd11-who-cloud-code-check-contract';
import { parseWhoCodeInfo } from './icd11-who-code-check-contract';

// Invented values, shaped after WHO Swagger v2.6.0 CodeInfo / LinearizationEntity.
// No @id in CodeInfo; no title for the entire cluster. No live WHO response.
const stemUri = 'http://id.who.int/icd/release/11/2026-01/mms/123456789';
const codeInfo = (code = 'AA00') => ({ code, stemCode: 'AA00', stemId: stemUri });
const stemEntity = () => ({ '@id': stemUri, code: 'AA00', title: { '@language': 'en', '@value': 'Synthetic stem title' } });
const receipt = (found = true) => ({ ...WHO_CLOUD_CODE_CHECK_REFERENCE,
    schemaVersion: 'mediflow.reference-data.icd11-cloud-code-check-receipt.v1',
    operation: 'mediflow.reference_data.icd11.cloud_code_check.v1', source: 'live',
    found, checkedAt: '2026-10-01T00:00:00.000Z', latencyMs: 7,
});
const result = (code = 'AA00') => ({ schemaVersion: WHO_CLOUD_CODE_CHECK_SCHEMA, code,
    status: 'found', entry: parseWhoCloudCodeInfo(codeInfo(code), stemEntity(), code), receipt: receipt(),
});

for (const code of ['AA00', 'AA00&XY01', 'AA00/BB01', 'AA00&XY01/BB01']) {
    test(`preserves the full synthetic code and identifies only its first stem: ${code}`, () => {
        const entry = parseWhoCloudCodeInfo({ ...codeInfo(code), laterality: ['synthetic axis value'] }, stemEntity(), code);
        assert.deepEqual(entry, {
            codeInfoResourceUri: `http://id.who.int/icd/release/11/2026-01/mms/codeinfo/${encodeURIComponent(code)}`,
            codeInfoResourceUriProvenance: 'request', stemUri,
            stemUriProvenance: 'codeinfo.stemId+linearization.@id', stemCode: 'AA00',
            stemTitle: 'Synthetic stem title', simplifiedCode: null, simplifiedStemCode: null,
        });
        const parsed = parseWhoCloudCodeCheckResult({ ...result(code), entry }, code);
        assert.equal(parsed?.code, code);
        assert.equal(parsed?.status, 'found');
        assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed?.entry) && Object.isFrozen(parsed?.receipt));
        assert.equal(parseWhoCodeInfo(codeInfo(code), code), null, 'existing local parser still requires @id');
    });
}

test('keeps simplification separate, including a changed simplified stem', () => {
    const code = 'AA00&XY01/BB01';
    const entry = parseWhoCloudCodeInfo({ ...codeInfo(code), simplifiedCode: 'CC00&XY01', simplifiedStemCode: 'CC00' }, stemEntity(), code);
    assert.equal(entry?.simplifiedCode, 'CC00&XY01');
    assert.equal(entry?.simplifiedStemCode, 'CC00');
    assert.equal(entry?.stemCode, 'AA00');
    assert.equal(entry?.stemTitle, 'Synthetic stem title');
    assert.equal(parseWhoCloudCodeCheckResult({ ...result(code), entry }, code)?.code, code);
    assert.ok(parseWhoCloudCodeInfo({ ...codeInfo(), simplifiedCode: null, simplifiedStemCode: null }, stemEntity(), 'AA00'));
    assert.ok(parseWhoCloudCodeInfo({ ...codeInfo(), simplifiedCode: 'CC00' }, stemEntity(), 'AA00'));
    assert.ok(parseWhoCloudCodeInfo({ ...codeInfo(), simplifiedStemCode: 'CC00' }, stemEntity(), 'AA00'));
});

const invalidInfo: [string, Record<string, unknown>][] = [
    ['full code mismatch', { code: 'AA00' }],
    ['wrong first stem', { stemCode: 'BB01' }],
    ['missing stem code', { stemCode: undefined }],
    ['missing stem URI', { stemId: null }],
    ['wrong release', { stemId: stemUri.replace('2026-01', '2025-01') }],
    ['foundation namespace', { stemId: 'http://id.who.int/icd/entity/123456789' }],
    ['foreign host', { stemId: stemUri.replace('id.who.int', 'example.com') }],
    ['unqualified https alias', { stemId: stemUri.replace('http:', 'https:') }],
    ['query suffix', { stemId: `${stemUri}?x=1` }],
    ['fabricated CodeInfo @id', { '@id': 'http://id.who.int/icd/release/11/2026-01/mms/codeinfo/AA00%26XY01' }],
    ['malformed simplification', { simplifiedCode: 'AA00&&XY01' }],
    ['cluster as simplified stem', { simplifiedStemCode: 'AA00/BB01' }],
];
for (const [name, patch] of invalidInfo) test(`rejects CodeInfo ${name} with otherwise valid entity evidence`, () => {
    const code = 'AA00&XY01';
    assert.ok(parseWhoCloudCodeInfo(codeInfo(code), stemEntity(), code));
    assert.equal(parseWhoCloudCodeInfo({ ...codeInfo(code), ...patch }, stemEntity(), code), null);
});
test('rejects incompatible simplified code/stem pair', () => {
    const valid = { ...codeInfo(), simplifiedCode: 'CC00&XY01', simplifiedStemCode: 'CC00' };
    assert.ok(parseWhoCloudCodeInfo(valid, stemEntity(), 'AA00'));
    assert.equal(parseWhoCloudCodeInfo({ ...valid, simplifiedStemCode: 'DD00' }, stemEntity(), 'AA00'), null);
});

for (const [name, patch] of [
    ['entity URI mismatch', { '@id': stemUri.replace('123456789', '987654321') }],
    ['entity code mismatch', { code: 'BB01' }],
    ['wrong title language', { title: { '@language': 'it', '@value': 'Synthetic stem title' } }],
    ['missing title language', { title: { '@value': 'Synthetic stem title' } }],
    ['empty title', { title: { '@language': 'en', '@value': '' } }],
    ['noncanonical whitespace', { title: { '@language': 'en', '@value': ' Synthetic stem title' } }],
    ['markup title', { title: { '@language': 'en', '@value': '<b>Synthetic</b>' } }],
    ['bidi title', { title: { '@language': 'en', '@value': 'Synthetic\u202e' } }],
    ['oversized title', { title: { '@language': 'en', '@value': 'x'.repeat(4097) } }],
] as [string, Record<string, unknown>][]) test(`rejects ${name} with otherwise valid CodeInfo evidence`, () => {
    assert.ok(parseWhoCloudCodeInfo(codeInfo(), stemEntity(), 'AA00'));
    assert.equal(parseWhoCloudCodeInfo(codeInfo(), { ...stemEntity(), ...patch }, 'AA00'), null);
});

for (const code of ['', 'N/A', 'aa00', 'AA00&&XY01', 'AA00/', 'AA00?x=1', 'A'.repeat(33)]) {
    test(`rejects bounded-code grammar violation ${JSON.stringify(code)}`, () => {
        assert.equal(parseWhoCloudCodeInfo(codeInfo(code), stemEntity(), code), null);
        assert.equal(parseWhoCloudCodeCheckResult(result(), code), null);
    });
}
test('does not invoke accessors or accept inherited identity', () => {
    const raw = codeInfo();
    Object.defineProperty(raw, 'code', { enumerable: true, get() { throw new Error('must not execute'); } });
    assert.equal(parseWhoCloudCodeInfo(raw, stemEntity(), 'AA00'), null);
    assert.equal(parseWhoCloudCodeInfo(Object.create(codeInfo()), stemEntity(), 'AA00'), null);
});

test('rejects JSON CodeInfo identity supplied only under __proto__', () => {
    assert.ok(parseWhoCloudCodeInfo(codeInfo(), stemEntity(), 'AA00'));
    const poisoned = JSON.parse(JSON.stringify({ ['__proto__']: codeInfo() }));
    assert.equal(parseWhoCloudCodeInfo(poisoned, stemEntity(), 'AA00'), null);
});
test('rejects JSON LinearizationEntity identity/title supplied only under __proto__', () => {
    assert.ok(parseWhoCloudCodeInfo(codeInfo(), stemEntity(), 'AA00'));
    const poisoned = JSON.parse(JSON.stringify({ ['__proto__']: stemEntity() }));
    assert.equal(parseWhoCloudCodeInfo(codeInfo(), poisoned, 'AA00'), null);
});
test('rejects JSON simplifications supplied under __proto__ despite own valid identity', () => {
    const simplified = { simplifiedCode: 'CC00&XY01', simplifiedStemCode: 'CC00' };
    assert.ok(parseWhoCloudCodeInfo({ ...codeInfo(), ...simplified }, stemEntity(), 'AA00'));
    const poisoned = JSON.parse(JSON.stringify({ ...codeInfo(), ['__proto__']: simplified }));
    assert.equal(parseWhoCloudCodeInfo(poisoned, stemEntity(), 'AA00'), null);
});
test('preserves ordinary parsed JSON and own simplifications without prototype mutation', () => {
    const info = JSON.parse(JSON.stringify({ ...codeInfo(), simplifiedCode: 'CC00&XY01', simplifiedStemCode: 'CC00' }));
    const entity = JSON.parse(JSON.stringify(stemEntity()));
    const parsed = parseWhoCloudCodeInfo(info, entity, 'AA00');
    assert.equal(parsed?.simplifiedCode, 'CC00&XY01');
    assert.equal(parsed?.simplifiedStemCode, 'CC00');
    assert.equal(Object.getPrototypeOf(info), Object.prototype);
    assert.equal(Object.getPrototypeOf(entity), Object.prototype);
});

for (const key of ['error', 'errors', 'status', 'partial', 'resultChopped']) {
    test(`rejects mixed identity and ${key} envelope metadata in either upstream body`, () => {
        assert.ok(parseWhoCloudCodeInfo(codeInfo(), stemEntity(), 'AA00'));
        for (const flag of [false, true, null, 200, 404, 'upstream_unavailable']) {
            assert.equal(parseWhoCloudCodeInfo({ ...codeInfo(), [key]: flag }, stemEntity(), 'AA00'), null);
            assert.equal(parseWhoCloudCodeInfo(codeInfo(), { ...stemEntity(), [key]: flag }, 'AA00'), null);
        }
    });
}

test('not_found is an explicit coherent host result, separate from errors and missing evidence', () => {
    const absent = { ...result(), status: 'not_found', entry: null, receipt: receipt(false) };
    assert.equal(parseWhoCloudCodeCheckResult(absent, 'AA00')?.status, 'not_found');
    assert.equal(parseWhoCloudCodeCheckResult({ ...absent, entry: result().entry }, 'AA00'), null);
    assert.equal(parseWhoCloudCodeCheckResult({ ...absent, receipt: receipt(true) }, 'AA00'), null);
    assert.equal(parseWhoCloudCodeCheckResult({ ...result(), entry: null }, 'AA00'), null);
    assert.equal(parseWhoCloudCodeCheckResult({ ...result(), receipt: receipt(false) }, 'AA00'), null);
    for (const error of [null, undefined, {}, { status: 401 }, { status: 429 }, { status: 404 },
        { status: 'error' }, { error: 'request_timeout' }, { error: 'upstream_unavailable' }]) {
        assert.equal(parseWhoCloudCodeInfo(error, stemEntity(), 'AA00'), null);
        assert.equal(parseWhoCloudCodeCheckResult(error, 'AA00'), null);
    }
    assert.equal(parseWhoCloudCodeInfo(codeInfo(), null, 'AA00'), null);
});

for (const [name, patch] of [
    ['request URI mismatch', { codeInfoResourceUri: 'http://id.who.int/icd/release/11/2026-01/mms/codeinfo/BB01' }],
    ['unsupported body provenance', { codeInfoResourceUriProvenance: 'response' }],
    ['unverified stem provenance', { stemUriProvenance: 'request' }],
    ['stem code mismatch', { stemCode: 'BB01' }],
    ['invented full title', { title: 'Synthetic cluster title' }],
    ['claimed canonical URI', { canonicalUri: stemUri }],
    ['missing nullable field', { simplifiedCode: undefined }],
] as [string, Record<string, unknown>][]) test(`rejects projected ${name}`, () => {
    const valid = result();
    assert.ok(parseWhoCloudCodeCheckResult(valid, 'AA00'));
    assert.equal(parseWhoCloudCodeCheckResult({ ...valid, entry: { ...valid.entry, ...patch } }, 'AA00'), null);
});

for (const [key, value] of Object.entries({
    apiVersion: 'v3', releaseId: '2025-01', linearization: 'foundation', language: 'it',
    bindingId: 'who.icd11.v2.2026-01.mms.en.local.v1', attribution: 'Unknown',
    schemaVersion: 'mediflow.reference-data.icd11-code-check-receipt.v1', operation: 'search',
    source: 'cache', found: 'true', checkedAt: 'not-a-date', latencyMs: -1,
    imageDigest: `sha256:${'a'.repeat(64)}`, datasetSnapshotId: `sha256:${'b'.repeat(64)}`,
})) test(`rejects cloud receipt ${key} mismatch`, () => {
    assert.ok(parseWhoCloudCodeCheckReceipt(receipt()));
    assert.equal(parseWhoCloudCodeCheckReceipt({ ...receipt(), [key]: value }), null);
    assert.equal(parseWhoCloudCodeCheckResult({ ...result(), receipt: { ...receipt(), [key]: value } }, 'AA00'), null);
});
test('rejects envelope version, code, extra fields, and noncanonical timing', () => {
    for (const patch of [{ schemaVersion: 'mediflow.reference-data.icd11-code-check.v1' }, { code: 'BB01' }, { error: 'timeout' }]) {
        assert.equal(parseWhoCloudCodeCheckResult({ ...result(), ...patch }, 'AA00'), null);
    }
    for (const patch of [{ latencyMs: 1.5 }, { latencyMs: Infinity }, { checkedAt: '2026-10-01' }]) {
        assert.equal(parseWhoCloudCodeCheckReceipt({ ...receipt(), ...patch }), null);
    }
});
