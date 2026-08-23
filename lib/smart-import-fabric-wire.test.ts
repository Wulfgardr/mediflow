/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { snapshotSmartImportFabricProvenance, snapshotSmartImportFabricResolutionReceipt, snapshotSmartImportProviderSelectionReceipt } from './smart-import-fabric-wire.ts';

const providerReceipt = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: 'qwen.synthetic:latest', execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0, ...overrides });
const receipt = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'smart_import', class: 'generative', venue: 'local_process', egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model: 'qwen.synthetic:latest', providerReceipt: providerReceipt(), fallbackCount: 0, ...overrides });
const provenance = (source = receipt(), overrides: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'smart_import', venue: 'local_process', provider: 'ollama', model: 'qwen.synthetic:latest', preprocessing: ['context_minimization', 'envelope_validation'], receipt: source, ...overrides });

test('snapshots coherent Smart Import receipt and provenance without retaining caller state', () => {
    const raw = receipt(); const parsed = snapshotSmartImportFabricResolutionReceipt(raw); assert.ok(parsed);
    const parsedProvenance = snapshotSmartImportFabricProvenance(provenance({ ...raw, egressProfile: { ...raw.egressProfile }, providerReceipt: { ...raw.providerReceipt } }), parsed); assert.ok(parsedProvenance);
    raw.model = 'mutated'; raw.providerReceipt.model = 'mutated';
    assert.deepEqual([parsed.model, parsed.providerReceipt.model, parsedProvenance.receipt.model], ['qwen.synthetic:latest', 'qwen.synthetic:latest', 'qwen.synthetic:latest']);
    assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.egressProfile), true); assert.equal(Object.isFrozen(parsed.providerReceipt), true); assert.equal(Object.isFrozen(parsedProvenance.preprocessing), true);
    assert.equal(snapshotSmartImportProviderSelectionReceipt(providerReceipt())?.model, 'qwen.synthetic:latest');
});

test('rejects closed-shape, model, provider-receipt, egress, and provenance mismatches', () => {
    const parsed = snapshotSmartImportFabricResolutionReceipt(receipt()); assert.ok(parsed);
    for (const value of [receipt({ extra: true }), receipt({ model: 'qwen:cloud' }), receipt({ model: ' other ' }), receipt({ class: 'deterministic' }),
        receipt({ egressProfile: { id: 'local_only', version: 'wrong', egress: 'none' } }), receipt({ providerReceipt: providerReceipt({ model: 'other' }) }), receipt({ providerReceipt: null })]) assert.equal(snapshotSmartImportFabricResolutionReceipt(value), null);
    for (const value of [provenance(receipt({ model: 'other' })), provenance(receipt(), { preprocessing: ['envelope_validation', 'context_minimization'] }), provenance(receipt(), { preprocessing: ['context_minimization'] }), provenance(receipt(), { extra: true })]) assert.equal(snapshotSmartImportFabricProvenance(value, parsed), null);
});

test('rejects hostile nested descriptors, symbols, cycles, and arrays without generic JSON handling', () => {
    const accessor = receipt(); Object.defineProperty(accessor, 'model', { enumerable: true, get() { throw new Error('synthetic raw marker'); } });
    const symbol = receipt(); Object.defineProperty(symbol, Symbol('synthetic'), { value: true });
    const cyclic = receipt(); (cyclic.egressProfile as Record<string, unknown>).self = cyclic.egressProfile;
    const sparse = provenance(receipt(), { preprocessing: ['context_minimization', , 'envelope_validation'] });
    for (const value of [accessor, symbol, cyclic]) assert.equal(snapshotSmartImportFabricResolutionReceipt(value), null);
    const parsed = snapshotSmartImportFabricResolutionReceipt(receipt()); assert.ok(parsed); assert.equal(snapshotSmartImportFabricProvenance(sparse, parsed), null);
    const source = readFileSync(new URL('./smart-import-fabric-wire.ts', import.meta.url), 'utf8'); const contract = readFileSync(new URL('./ai-providers/fabric/contract.ts', import.meta.url), 'utf8'); const locality = readFileSync(new URL('./ai-providers/ollama-locality.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|node:|JSON\.stringify|registry\.ts|provider\.ts/u);
    assert.doesNotMatch(`${source}\n${contract}\n${locality}`, /server-only|node:/u);
});
