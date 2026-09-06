/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFunctionStatus, parseFunctionStatus, FUNCTION_IDS, type FunctionStatusSources } from './function-status.ts';

const time = '2026-09-06T01:00:00.000Z';
const sources: FunctionStatusSources = {
    platform: 'darwin', enabled: { patient_insight: true, smart_import: true, document_synthesis: true, treatment_reasoning: true },
    ollamaLifecycle: 'available_unqualified', athenaLifecycle: 'available_unqualified',
    clinicalBinding: { state: 'configured', model: 'synthetic-local:latest' }, athenaArtifact: true, who: 'configured',
};
const row = (input: FunctionStatusSources, id: string) => buildFunctionStatus(input, time).functions.find(item => item.id === id)!;

test('a complete configuration never becomes an observed clinical execution', () => {
    const result = buildFunctionStatus(sources, time);
    assert.deepEqual(result.functions.map(item => item.id), FUNCTION_IDS);
    assert.ok(result.functions.every(item => item.state === 'unverified' && item.lastExecutionAt === null));
    assert.equal(result.check, 'configuration_only');
    assert.deepEqual(parseFunctionStatus(JSON.parse(JSON.stringify(result))), result);
});
test('off overrides provider configuration; missing and revoked providers stay distinct', () => {
    assert.equal(row({ ...sources, enabled: { ...sources.enabled, patient_insight: false } }, 'patient_insight').state, 'off');
    assert.equal(row({ ...sources, ollamaLifecycle: 'missing' }, 'patient_insight').state, 'needs_setup');
    for (const lifecycle of ['revoked', 'degraded', 'corrupt', 'unknown']) {
        assert.equal(row({ ...sources, ollamaLifecycle: lifecycle }, 'smart_import').state, 'blocked');
    }
    assert.equal(row({ ...sources, clinicalBinding: { state: 'invalid', model: null } }, 'document_synthesis').state, 'needs_setup');
    assert.equal(row({ ...sources, athenaArtifact: false }, 'treatment_reasoning').state, 'needs_setup');
});
test('OCR platform support and WHO configuration do not imply successful probes', () => {
    assert.equal(row({ ...sources, platform: 'linux' }, 'document_ocr').state, 'manual');
    assert.equal(row({ ...sources, platform: 'win32' }, 'document_ocr').state, 'manual');
    const expected = { disabled: 'off', credentials_absent: 'needs_setup', offline: 'blocked', configured: 'unverified', available: 'observed', unavailable: 'blocked' };
    for (const [who, state] of Object.entries(expected)) {
        const result = row({ ...sources, who: who as FunctionStatusSources['who'] }, 'icd11');
        assert.equal(result.state, state);
        assert.equal(result.lastExecutionAt, null);
    }
});
test('incomplete, duplicate, invalid and falsely timestamped snapshots are rejected', () => {
    const valid = buildFunctionStatus(sources, time);
    for (const value of [null, {}, { ...valid, checkedAt: 'yesterday' }, { ...valid, functions: valid.functions.slice(1) },
        { ...valid, functions: [...valid.functions.slice(1), valid.functions[1]] },
        { ...valid, functions: valid.functions.map(item => ({ ...item, state: 'available' })) },
        { ...valid, functions: valid.functions.map(item => ({ ...item, lastExecutionAt: time })) }]) {
        assert.throws(() => parseFunctionStatus(value));
    }
});

/* @Codex: observation failure cannot be presented as missing configuration. */
test('read failures remain unavailable even when another prerequisite is missing', () => {
    for (const lifecycle of ['missing', 'available_unqualified']) {
        const result = row({ ...sources, ollamaLifecycle: lifecycle, clinicalBinding: { state: 'unavailable', model: null } }, 'patient_insight');
        assert.equal(result.state, 'unavailable');
        assert.match(result.reason, /Rileggi lo stato/);
    }
    assert.equal(row({ ...sources, ollamaLifecycle: 'unavailable' }, 'smart_import').state, 'unavailable');
    const long = buildFunctionStatus({ ...sources, clinicalBinding: { state: 'configured', model: 'a'.repeat(674) } }, time);
    assert.doesNotThrow(() => parseFunctionStatus(long));
});
