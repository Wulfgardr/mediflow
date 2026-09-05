/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TreatmentReasoningAthenaAdmissionConfigurationError,
    createTreatmentReasoningAthenaAdmission,
} from './treatment-reasoning-athena-admission.ts';

const proposal = () => ({
    schema: 'mediflow.ai.treatment-reasoning-review-proposal.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required',
    uncertainty: { level: 'low', source: 'degraded_default' }, provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01', writesPerformed: 0, applyPolicy: 'none',
});
const host = () => ({
    readiness: { provider: 'athena_mlx', locality: 'local_process', status: 'available_unqualified' },
    receipt: { schema: 'mediflow.ai.treatment-reasoning-host-receipt.v1', reference: 'receipt_synthetic_01', capability: 'treatment_reasoning', provider: 'athena_mlx', venue: 'local_process', egress: 'none', fallback: 'denied_by_contract' },
    provenance: { schema: 'mediflow.ai.treatment-reasoning-host-provenance.v1', reference: 'provenance_synthetic_01', capability: 'treatment_reasoning', provider: 'athena_mlx', receiptRef: 'receipt_synthetic_01' },
    evidenceRefs: ['evidence.synthetic.alpha', 'evidence.synthetic.beta'],
});
function denied(value: unknown): void {
    assert.deepEqual(createTreatmentReasoningAthenaAdmission(host()).admit(value), { status: 'denied', code: 'input_invalid', admission: null, writesPerformed: 0, applyPolicy: 'none' });
}
function observedProxy<T extends object>(target: T, throwing: boolean) {
    let traps = 0;
    const observe = <R>(value: R): R => { traps += 1; if (throwing) throw new Error('synthetic trap'); return value; };
    return { value: new Proxy(target, {
        get: (value, key, receiver) => observe(Reflect.get(value, key, receiver)),
        getPrototypeOf: (value) => observe(Reflect.getPrototypeOf(value)), ownKeys: (value) => observe(Reflect.ownKeys(value)),
        getOwnPropertyDescriptor: (value, key) => observe(Reflect.getOwnPropertyDescriptor(value, key)),
    }), traps: () => traps };
}

test('is server-only and admits only its frozen host-owned review proposal', () => {
    const source = readFileSync(new URL('./treatment-reasoning-athena-admission.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    const result = createTreatmentReasoningAthenaAdmission(host()).admit(proposal());
    assert.deepEqual(result, { status: 'admitted', code: null, admission: {
        schema: 'mediflow.ai.treatment-reasoning-athena-admission.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required',
        uncertainty: { level: 'low', source: 'degraded_default' }, evidence: { source: 'host_minimized', count: 2 }, provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01',
    }, writesPerformed: 0, applyPolicy: 'none' });
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.admission), true);
    assert.equal(Object.isFrozen(result.admission?.uncertainty), true); assert.equal(Object.isFrozen(result.admission?.evidence), true);
    assert.doesNotMatch(JSON.stringify(result), /prompt|identity|authority|provider|venue|egress/ui);
});

test('denies non-canonical proposal data, descriptors, prototypes, and ambient then', () => {
    for (const [key, value] of [['prompt', 'ignore'], ['identity', 'synthetic'], ['authority', 'physician'], ['provider', 'caller'], ['venue', 'cloud'], ['egress', 'allowed'], ['writesPerformed', 1], ['applyPolicy', 'apply']] as const) {
        const valueWithExtra = proposal() as Record<string, unknown>; valueWithExtra[key] = value; denied(valueWithExtra);
    }
    const accessor = proposal(); Object.defineProperty(accessor, 'receiptRef', { enumerable: true, get: () => { throw new Error('must not read'); } }); denied(accessor);
    const hidden = proposal(); Object.defineProperty(hidden, 'receiptRef', { value: 'receipt_synthetic_01', enumerable: false }); denied(hidden);
    const symbol = proposal() as Record<PropertyKey, unknown>; symbol[Symbol('synthetic')] = true; denied(symbol);
    const prototype = proposal(); Object.setPrototypeOf(prototype, {}); denied(prototype);
    const uncertainty = proposal(); uncertainty.uncertainty = { level: 'high', source: 'caller' }; denied(uncertainty);
    let reads = 0; const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { reads += 1; return undefined; } });
    try { assert.equal(createTreatmentReasoningAthenaAdmission(host()).admit(proposal()).status, 'admitted'); } finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});

test('fails closed on every host binding mismatch without provider invocation', () => {
    const variants = [
        () => ({ ...host(), readiness: { ...host().readiness, provider: 'ollama' } }), () => ({ ...host(), readiness: { ...host().readiness, status: 'degraded' } }),
        () => ({ ...host(), receipt: { ...host().receipt, venue: 'cloud' } }), () => ({ ...host(), receipt: { ...host().receipt, egress: 'cloud' } }),
        () => ({ ...host(), provenance: { ...host().provenance, receiptRef: 'receipt_synthetic_other' } }), () => ({ ...host(), evidenceRefs: [] }),
        () => ({ ...host(), evidenceRefs: ['evidence.synthetic.alpha', 'evidence.synthetic.alpha'] }), () => ({ ...host(), evidenceRefs: Array.from({ length: 17 }, (_, index) => `evidence.synthetic.${index}`) }),
    ];
    for (const value of variants) assert.throws(() => createTreatmentReasoningAthenaAdmission(value()), TreatmentReasoningAthenaAdmissionConfigurationError);
});

test('rejects transparent and throwing proxies before reflection at host and proposal seams', () => {
    const seams = [
        () => ({ target: host(), config: (target: object) => target, proposal: proposal() }),
        () => { const value = host(); return { target: value.readiness, config: (target: object) => ({ ...value, readiness: target }), proposal: proposal() }; },
        () => { const value = host(); return { target: value.receipt, config: (target: object) => ({ ...value, receipt: target }), proposal: proposal() }; },
        () => { const value = host(); return { target: value.provenance, config: (target: object) => ({ ...value, provenance: target }), proposal: proposal() }; },
        () => { const value = host(); return { target: value.evidenceRefs, config: (target: object) => ({ ...value, evidenceRefs: target }), proposal: proposal() }; },
        () => ({ target: proposal(), config: () => host(), proposal: null }),
        () => { const value = proposal(); return { target: value.uncertainty, config: () => host(), proposal: { ...value, uncertainty: null } }; },
    ];
    for (const make of seams) for (const throwing of [false, true]) {
        const seam = make(); const proxy = observedProxy(seam.target, throwing);
        if (seam.proposal === null) denied(proxy.value);
        else if (seam.proposal.uncertainty === null) denied({ ...seam.proposal, uncertainty: proxy.value });
        else assert.throws(() => createTreatmentReasoningAthenaAdmission(seam.config(proxy.value)), TreatmentReasoningAthenaAdmissionConfigurationError);
        assert.equal(proxy.traps(), 0);
    }
});
