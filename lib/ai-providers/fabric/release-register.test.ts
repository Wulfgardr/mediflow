import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FABRIC_CAPABILITY_DESCRIPTORS, getFabricCapabilityDescriptor } from './catalog';

const root = new URL('../../../', import.meta.url);
const register = JSON.parse(readFileSync(new URL('docs/quality/intelligence/registro-0.9.1.json', root), 'utf8'));
const functions = ['patient_insight', 'smart_import', 'document_synthesis'];
const providers = ['ollama', 'openai.responses.v1', 'anthropic.messages.v1', 'chatgpt'];

test('I-0 copre esattamente le 13 celle del contratto, con le tre condizionate separate', () => {
    const contract = readFileSync(new URL(register.contract, root));
    assert.equal(register.contractSha256, createHash('sha256').update(contract).digest('hex'));
    for (const label of ['Patient Insight', 'Smart Import', 'Document Synthesis', 'Treatment Reasoning', 'AnyDoc', 'Apple Vision', 'ricerca', 'navigazione']) {
        assert.ok(contract.toString().includes(label), label);
    }
    const expected = [...functions.flatMap(id => providers.map(provider => `${id}/${provider}`)), 'treatment_reasoning/athena_mlx'];
    assert.deepEqual(register.cells.map((cell: { id: string }) => cell.id).sort(), expected.sort());
    assert.deepEqual(register.conditionalCells.map((cell: { id: string }) => cell.id).sort(), providers.slice(1).map(provider => `treatment_reasoning/${provider}`).sort());
    for (const cell of [...register.cells, ...register.conditionalCells]) {
        assert.equal(cell.conditional, register.conditionalCells.includes(cell));
        assert.equal(cell.qualification, 'not_qualified');
        assert.equal(cell.modelIdentity, null);
        assert.equal(cell.proof, null);
        assert.equal(cell.dataClass, 'synthetic_only');
        assert.ok(cell.blockedBy.length > 0);
        assert.deepEqual(cell.surfaces, { web: 'not_verified', gpui: 'not_verified', chat: 'not_verified', headless: 'not_verified' });
    }
});

test('I-0 censisce ogni descriptor corrente senza cambiare ammissioni o mascherare OCR', () => {
    assert.deepEqual(register.capabilities.map((row: { descriptor: unknown }) => row.descriptor), Object.values(FABRIC_CAPABILITY_DESCRIPTORS));
    assert.equal(register.capabilities.filter((row: { descriptor: { class: string } }) => row.descriptor.class === 'generative').length, 5);
    assert.equal(register.capabilities.filter((row: { descriptor: { class: string } }) => row.descriptor.class === 'deterministic').length, 11);
    assert.equal(getFabricCapabilityDescriptor('ocr').availabilityDisposition, 'unavailable');
    assert.throws(() => getFabricCapabilityDescriptor('unknown_release_capability'), /capability_unknown/);
    for (const row of register.capabilities) {
        assert.deepEqual(row.chatCriteria, ['C-7', 'C-8']);
        assert.equal(row.runtimeProof, null);
        if (row.descriptor.entryPoint) assert.ok(existsSync(new URL(row.descriptor.entryPoint, root)), row.descriptor.id);
    }
    assert.deepEqual(register.additionalContractRequirements.map((row: { id: string }) => row.id), ['search', 'navigation']);
    assert.deepEqual(register.extraction.map((row: { id: string }) => row.id), ['anydoc', 'apple_vision']);
    for (const row of [...register.extraction, ...register.additionalContractRequirements]) assert.ok(existsSync(new URL(row.source, root)), row.id);
    assert.equal(register.localProfile.memoryBudgetBytes, null);
    assert.equal(register.localProfile.latencyBudgetMs, null);
    assert.equal(register.purpose, 'coverage_only_no_runtime_admission');
});
