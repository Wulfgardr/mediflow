/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA as schema } from './document-synthesis-json-schema.ts';

test('fixed schema is recursively frozen, closed and bounded without authority fields', () => {
    const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        assert.equal(Object.isFrozen(value), true);
        const node = value as typeof schema;
        if (node.type === 'object') {
            assert.equal(node.additionalProperties, false);
            assert.ok(node.required?.length);
            for (const key of Object.keys(node.properties!)) {
                assert.equal(['sourceId', 'patientId', 'documentId', 'sourceText', 'receipt', 'provenance', 'authority', 'startByte', 'endByte', 'quoteSha256'].includes(key), false);
            }
        }
        if (node.type === 'array') {
            assert.ok(Number.isInteger(node.minItems));
            assert.ok(Number.isInteger(node.maxItems));
            assert.ok(node.items);
        }
        if (node.type === 'string' && !node.const && !node.enum) {
            assert.ok(node.minLength! > 0);
            assert.ok(node.maxLength! >= node.minLength!);
        }
        for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    assert.equal(Reflect.set(schema.properties!.output.required!, '0', 'injected'), false);
    assert.equal(schema.properties!.output.required![0], 'schemaVersion');
});

test('requires both distinct version literals and the complete canonical output', () => {
    assert.deepEqual(schema.required, ['schemaVersion', 'output', 'citations', 'claims']);
    assert.equal(schema.properties!.schemaVersion.const, 'mediflow.document-synthesis.provider-envelope.v2');
    const output = schema.properties!.output;
    assert.deepEqual(output.required, ['schemaVersion', 'task', 'summary', 'data']);
    assert.equal(output.properties!.schemaVersion.const, 'mediflow.ai.extract.v1');
    assert.equal(output.properties!.task.const, 'document_synthesis');
    const data = output.properties!.data;
    assert.deepEqual(data.required, ['qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']);
    assert.deepEqual(data.properties!.qualityLevel.enum, ['green', 'yellow', 'red']);
    assert.equal(data.properties!.qualityReason.maxLength, 220);
    assert.equal(data.properties!.medications.maxItems, 64);
    for (const name of ['diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']) assert.equal(data.properties![name].maxItems, 32);
});

test('preserves full nested clinical fields, required subsets and enums', () => {
    const data = schema.properties!.output.properties!.data.properties!;
    const expected = {
        diagnoses: ['code', 'description', 'system', 'evidence', 'confidence'],
        problemStatements: ['label', 'icdQuery', 'confidence', 'evidence', 'explicitCode'],
        therapyCandidates: ['drugMention', 'drugQuery', 'confidence', 'evidence', 'activePrinciple', 'dosage', 'motivation', 'reviewNote', 'therapyState'],
        servicePrescriptions: ['serviceName', 'confidence', 'evidence', 'category', 'priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'items'],
    };
    for (const [name, fields] of Object.entries(expected)) assert.deepEqual(Object.keys(data[name].items!.properties!), fields);
    assert.deepEqual(data.diagnoses.items!.required, ['code', 'description', 'system']);
    assert.deepEqual(data.diagnoses.items!.properties!.system.enum, ['ICD-9', 'ICD-10', 'ICD-11']);
    assert.deepEqual(data.therapyCandidates.items!.properties!.therapyState.enum, ['active', 'transition', 'uncertain', 'inactive']);
    const service = data.servicePrescriptions.items!;
    assert.deepEqual(service.properties!.category.enum, ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);
    const item = service.properties!.items.items!;
    assert.deepEqual(item.required, ['serviceName', 'confidence', 'evidence']);
    assert.deepEqual(Object.keys(item.properties!), ['serviceName', 'confidence', 'evidence', 'category', 'codeSystem', 'serviceCode']);
    assert.equal(item.properties!.codeSystem.maxLength, 160);
    assert.equal(service.properties!.codeSystem.maxLength, 180);
});

test('bounds source labels and canonical claim paths while leaving quote matching to the host', () => {
    const citations = schema.properties!.citations;
    assert.deepEqual(citations.items!.required, ['label', 'quote']);
    assert.equal(citations.maxItems, 32);
    assert.equal(citations.items!.properties!.quote.maxLength, 12000);
    assert.equal(citations.items!.properties!.quote.pattern, undefined);
    const claims = schema.properties!.claims;
    assert.equal(claims.maxItems, 194);
    assert.deepEqual(claims.items!.required, ['claimPath', 'labels']);
    const path = new RegExp(claims.items!.properties!.claimPath.pattern!);
    for (const value of ['summary', 'data.qualityReason', 'data.medications[63]', 'data.servicePrescriptions[31].items[31]']) assert.equal(path.test(value), true);
    for (const value of ['data.medications[64]', 'data.diagnoses[32]', 'data.servicePrescriptions[0].items[32]', 'receipt', 'data.qualityLevel.extra']) assert.equal(path.test(value), false);
    const label = new RegExp(citations.items!.properties!.label.pattern!);
    for (const value of ['S1', 'S9', 'S10', 'S32']) assert.equal(label.test(value), true);
    for (const value of ['S0', 'S01', 'S33']) assert.equal(label.test(value), false);
});
