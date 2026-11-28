import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FABRIC_CAPABILITY_DESCRIPTORS, getFabricCapabilityDescriptor } from './catalog';
import { deriveCellQualification, LOCAL_RUN_RECEIPT_SCHEMA } from './release-register-qualification';

const root = new URL('../../../', import.meta.url);
const register = JSON.parse(readFileSync(new URL('docs/quality/intelligence/registro-0.9.1.json', root), 'utf8'));
const functions = ['patient_insight', 'smart_import', 'document_synthesis'];
const providers = ['ollama', 'chatgpt'];
const apiProviders = ['openai.responses.v1', 'anthropic.messages.v1'];

test('I-0 copre esattamente le sei celle del gate e separa API opzionali e Treatment Reasoning', () => {
    const contract = readFileSync(new URL(register.contract, root));
    assert.equal(register.contractSha256, createHash('sha256').update(contract).digest('hex'));
    for (const label of ['Patient Insight', 'Smart Import', 'Document Synthesis', 'Treatment Reasoning', 'AnyDoc', 'Apple Vision', 'ricerca', 'navigazione']) {
        assert.ok(contract.toString().includes(label), label);
    }
    const expected = functions.flatMap(id => providers.map(provider => `${id}/${provider}`));
    assert.deepEqual(register.cells.map((cell: { id: string }) => cell.id).sort(), expected.sort());
    assert.deepEqual(register.conditionalCells, []);
    assert.deepEqual(register.optionalCells?.map((cell: { id: string }) => cell.id).sort(),
        functions.flatMap(id => apiProviders.map(provider => `${id}/${provider}`)).sort());
    for (const cell of register.optionalCells) {
        assert.equal(cell.releaseDisposition, 'optional_outside_0.9.1_gate');
        assert.equal(cell.countsAsReleaseEvidence, false);
        assert.equal(cell.qualification, 'not_qualified');
        assert.equal(cell.proof, null);
        assert.equal(cell.modelIdentity, null);
        assert.ok(cell.blockedBy.includes('API_not_qualified_for_0.9.1'));
    }
    assert.deepEqual(register.deferredCells.map((cell: { id: string }) => cell.id).sort(),
        ['athena_mlx', ...apiProviders, 'chatgpt'].map(provider => `treatment_reasoning/${provider}`).sort());
    for (const cell of register.deferredCells) {
        assert.equal(cell.releaseDisposition, 'deferred_beyond_0.9.1');
        assert.equal(cell.qualification, 'not_qualified');
        assert.equal(cell.proof, null);
    }
    assert.equal(register.deferral.runtimeUnavailabilityVerified, false);
    for (const cell of [...register.cells, ...register.conditionalCells]) {
        assert.equal(cell.conditional, register.conditionalCells.includes(cell));
        const derived = deriveCellQualification(register, cell, (path: string) => readFileSync(new URL(path, root)));
        assert.equal(cell.qualification, derived.qualification, cell.id);
        assert.deepEqual([...cell.blockedBy].sort(), [...derived.blockedBy].sort(), cell.id);
        assert.deepEqual(cell.criteria, derived.criteria, cell.id);
        if (cell.provider === 'ollama') {
            const evidence = JSON.parse(readFileSync(new URL(cell.proof.path, root), 'utf8'));
            if (evidence.schema === LOCAL_RUN_RECEIPT_SCHEMA) {
                assert.ok(cell.receipts.some((ref: { path: string }) => ref.path === cell.proof.path), cell.id);
                assert.equal(evidence.modelIdentity.digest, cell.modelIdentity.digest);
                assert.equal(evidence.admission.status, 'passed');
                assert.equal(cell.proof.status, derived.qualification === 'qualified' ? 'executed' : 'executed_with_limits');
            } else {
                assert.deepEqual(cell.modelIdentity, evidence.modelIdentity);
                assert.equal(cell.proof.status, 'executed_with_limits');
                assert.equal(evidence.qualification, false);
                assert.equal(evidence.admission.status, 'passed');
            }
        } else {
            assert.equal(cell.modelIdentity, null);
            assert.equal(cell.proof, null);
        }
        assert.equal(cell.dataClass, 'synthetic_only');
        assert.ok(cell.blockedBy.length > 0);
        assert.ok(!('G-5' in cell.criteria), cell.id);
        assert.ok(!cell.blockedBy.includes('G-5_surface_not_proved'), cell.id);
        assert.equal(cell.surfaces.gpui, 'not_verified', cell.id);
        assert.ok(cell.blockedBy.every((criterion: string) => !['I-3', 'I-3b', 'I-7'].includes(criterion)));
        assert.deepEqual(cell.surfaces, derived.surfaces, cell.id);
    }
});

test('I-0 censisce ogni descriptor corrente senza cambiare ammissioni o mascherare OCR', () => {
    assert.deepEqual(register.capabilities.map((row: { descriptor: unknown }) => row.descriptor), Object.values(FABRIC_CAPABILITY_DESCRIPTORS));
    assert.equal(register.capabilities.filter((row: { descriptor: { class: string } }) => row.descriptor.class === 'generative').length, 5);
    assert.equal(register.capabilities.filter((row: { descriptor: { class: string } }) => row.descriptor.class === 'deterministic').length, 11);
    assert.equal(getFabricCapabilityDescriptor('ocr').availabilityDisposition, 'unavailable');
    assert.throws(() => getFabricCapabilityDescriptor('unknown_release_capability'), /capability_unknown/);
    for (const row of register.capabilities) {
        assert.deepEqual(row.chatCriteria, row.descriptor.id === 'treatment_reasoning' ? [] : ['C-7', 'C-8']);
        if (['patient_insight', 'smart_import', 'document_synthesis'].includes(row.descriptor.id)) {
            assert.equal(row.runtimeProof.qualification, false);
            assert.ok(existsSync(new URL(row.runtimeProof.path, root)));
        } else assert.equal(row.runtimeProof, null);
        if (row.descriptor.entryPoint) assert.ok(existsSync(new URL(row.descriptor.entryPoint, root)), row.descriptor.id);
    }
    assert.deepEqual(register.additionalContractRequirements.map((row: { id: string }) => row.id), ['search', 'navigation']);
    assert.deepEqual(register.extraction.map((row: { id: string }) => row.id), ['anydoc', 'apple_vision']);
    for (const row of [...register.extraction, ...register.additionalContractRequirements]) assert.ok(existsSync(new URL(row.source, root)), row.id);
    assert.equal(register.localProfile.memoryBudgetBytes, null);
    assert.equal(register.localProfile.latencyBudgetMs, null);
    assert.equal(register.purpose, 'coverage_only_no_runtime_admission');
});
