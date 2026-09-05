/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { EGRESS_PROFILE_VERSION } from './ai-providers/fabric/contract.ts';
import {
    parseSmartImportPreviewWire,
    parseSmartImportPreviewWireRoot,
    serializeSmartImportPreviewWire,
    serializeSmartImportPreviewWireRoot,
} from './smart-import-preview-wire.ts';

const MODEL = 'mediflow/synthetic';
const PROVIDER_RECEIPT = Object.freeze({ schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: MODEL, execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0 });
const RECEIPT = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'smart_import', class: 'generative', venue: 'local_process', egressProfile: Object.freeze({ id: 'local_only', version: EGRESS_PROFILE_VERSION, egress: 'none' }), provider: 'ollama', model: MODEL, providerReceipt: PROVIDER_RECEIPT, fallbackCount: 0 });
const PROVENANCE = Object.freeze({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'smart_import', venue: 'local_process', provider: 'ollama', model: MODEL, preprocessing: Object.freeze(['context_minimization', 'envelope_validation']), receipt: RECEIPT });
const PROPOSAL = Object.freeze({ schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt: '2026-08-23T12:00:00.000Z', contract: Object.freeze({ validJson: true, validTask: true, legacyContract: false }), summary: '', diagnoses: Object.freeze([Object.freeze({ label: 'Synthetic', icdQuery: 'SYN', confidence: 'high', evidence: 'Synthetic evidence', sourceId: 'source.synthetic.1', explicitCode: undefined })]), therapies: Object.freeze([]), servicePrescriptions: Object.freeze([]), writesPerformed: 0 as const });
const AVAILABLE = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'available' as const, code: null, proposal: PROPOSAL, receipt: RECEIPT, provenance: PROVENANCE, reviewRef: `review_${'1'.repeat(32)}` });
const DENIED = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'denied' as const, code: 'projection_unavailable' as const, proposal: null, receipt: null, provenance: null, reviewRef: null });
const FAILED = Object.freeze({ writesPerformed: 0 as const, apply: 'denied' as const, status: 'failed' as const, code: 'provider_failed' as const, proposal: null, receipt: RECEIPT, provenance: PROVENANCE, reviewRef: null });

test('serializes and parses detached frozen available, denied, and failed Smart Import previews', () => {
    for (const input of [AVAILABLE, DENIED, FAILED]) {
        const output = serializeSmartImportPreviewWire(input);
        assert.ok(output); assert.equal(Object.isFrozen(output), true); assert.notEqual(output, input);
        assert.deepEqual(parseSmartImportPreviewWire(output), output);
        assert.deepEqual(parseSmartImportPreviewWireRoot({ preview: output }), Object.freeze({ preview: output }));
    }
    const available = serializeSmartImportPreviewWire(AVAILABLE);
    assert.ok(available && available.status === 'available');
    assert.equal('explicitCode' in available.proposal.diagnoses[0], false);
    assert.throws(() => { (available as { status: string }).status = 'denied'; }, TypeError);
});

test('does not retain mutable domain references in a preview wire snapshot', () => {
    const diagnosis: Record<string, unknown> = { ...PROPOSAL.diagnoses[0] }; const proposal = { ...PROPOSAL, diagnoses: [diagnosis] };
    const providerReceipt: Record<string, unknown> = { ...PROVIDER_RECEIPT }; const receipt = { ...RECEIPT, egressProfile: { ...RECEIPT.egressProfile }, providerReceipt };
    const provenance = { ...PROVENANCE, receipt }; const input = { ...AVAILABLE, proposal, receipt, provenance };
    const output = serializeSmartImportPreviewWire(input);
    assert.ok(output && output.status === 'available'); assert.notEqual(output.proposal, proposal); assert.notEqual(output.receipt, receipt);
    assert.equal(Object.isFrozen(output.proposal.diagnoses), true); assert.equal(Object.isFrozen(output.provenance.receipt), true);
    diagnosis.label = 'changed'; providerReceipt.model = 'changed/local';
    assert.equal(output.proposal.diagnoses[0].label, 'Synthetic'); assert.equal(output.receipt.providerReceipt.model, MODEL);
});

test('rejects hostile roots, invalid nullability, closed-code escapes, and mismatched Fabric metadata', () => {
    const accessor = { preview: AVAILABLE }; Object.defineProperty(accessor, 'extra', { enumerable: true, get() { throw new Error('marker'); } });
    const cyclic: { preview?: unknown } = {}; cyclic.preview = cyclic;
    const mismatched = { ...FAILED, provenance: { ...PROVENANCE, model: 'other/local' } };
    for (const value of [{ preview: AVAILABLE, extra: true }, Object.assign(Object.create({ inherited: true }), { preview: AVAILABLE }), accessor, cyclic,
        { ...AVAILABLE, reviewRef: null }, { ...DENIED, code: 'future' }, { ...FAILED, receipt: null }, mismatched]) {
        assert.equal(serializeSmartImportPreviewWireRoot(value), null);
    }
    const symbol = { preview: AVAILABLE, [Symbol('synthetic')]: true };
    assert.equal(serializeSmartImportPreviewWireRoot(symbol), null);
    assert.equal(parseSmartImportPreviewWire({ ...AVAILABLE, proposal: { ...PROPOSAL, generatedAt: 'invalid' } }), null);
});

test('keeps the preview wire module browser-safe and free of generic JSON canonicalization', () => {
    const source = readFileSync(new URL('./smart-import-preview-wire.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|node:|JSON\.stringify|\bfetch\b/u);
});
