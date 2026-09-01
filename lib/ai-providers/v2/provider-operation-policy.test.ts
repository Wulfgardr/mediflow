/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';
import { authorizeProviderOperationV2, createProviderOperationReceiptV2, poweredByFromProviderReceiptV2 } from './provider-operation-policy.ts';

const BINDING = Object.freeze({ schemaVersion: 'mediflow.ai.provider-binding.v2', operation: 'document_synthesis',
    providerId: 'openai', kind: 'cloud', venue: 'cloud', model: 'gpt-5.4-mini', dataClass: 'synthetic_nonclinical',
    egressProfileRef: 'egress.synthetic.v1', retentionProfileRef: 'retention.standard.v1', consentRef: null,
    timeoutMs: 15_000, maxInputBytes: 32_768, maxOutputBytes: 16_384, fallback: 'none' });
const EVIDENCE = Object.freeze({ schemaVersion: 'mediflow.ai.provider-policy-evidence.v2',
    egressProfileRef: BINDING.egressProfileRef, retentionProfileRef: BINDING.retentionProfileRef, consentRef: null,
    egressPromoted: false, retentionEligible: false, consentCurrent: false, redactionReceiptSha256: null });
const RESPONSE = Object.freeze({ schemaVersion: 'mediflow.ai.provider-response-validation.v2', validated: true,
    payloadSha256: '1'.repeat(64), outputSha256: '2'.repeat(64), vendorRequestId: 'req_synthetic_1',
    latencyMs: 25, tokensIn: 12, tokensOut: 7, completedAt: '2026-09-01T12:00:00.000Z' });

function enabled(binding: unknown = BINDING) {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding });
    return transitionProviderLifecycleV2(transitionProviderLifecycleV2(configured, { type: 'validate' }), { type: 'enable' });
}

test('ammette synthetic_nonclinical e risolve il secret solo dopo il gate', () => {
    let secretResolutions = 0;
    const lease = Object.freeze(Object.create(null));
    const result = authorizeProviderOperationV2({ lifecycle: enabled(), evidence: EVIDENCE }, () => {
        secretResolutions += 1; return lease;
    });
    assert.equal(result.status, 'admitted');
    assert.equal(result.code, null);
    assert.equal(result.secretLease, lease);
    assert.equal(secretResolutions, 1);
    assert.equal(JSON.stringify(result), '{"status":"admitted","code":null,"secretLease":{}}');
});

test('ammette redacted_clinical solo con gate, retention, consenso e receipt di redazione', () => {
    const binding = { ...BINDING, dataClass: 'redacted_clinical', egressProfileRef: 'egress.redacted.v1',
        retentionProfileRef: 'retention.eligible.v1', consentRef: 'consent.synthetic.current' };
    const promoted = { ...EVIDENCE, egressProfileRef: binding.egressProfileRef,
        retentionProfileRef: binding.retentionProfileRef, consentRef: binding.consentRef,
        egressPromoted: true, retentionEligible: true, consentCurrent: true, redactionReceiptSha256: 'a'.repeat(64) };
    for (const [evidence, code] of [
        [{ ...promoted, egressPromoted: false }, 'egress_profile_unsatisfied'],
        [{ ...promoted, retentionEligible: false }, 'retention_profile_unsatisfied'],
        [{ ...promoted, consentCurrent: false }, 'consent_missing'],
        [{ ...promoted, redactionReceiptSha256: null }, 'redaction_receipt_missing'],
    ] as const) {
        let resolutions = 0;
        const result = authorizeProviderOperationV2({ lifecycle: enabled(binding), evidence }, () => { resolutions += 1; return Object.freeze(Object.create(null)); });
        assert.equal(result.status, 'denied'); assert.equal(result.code, code); assert.equal(resolutions, 0);
    }
    let resolutions = 0;
    const admitted = authorizeProviderOperationV2({ lifecycle: enabled(binding), evidence: promoted }, () => {
        resolutions += 1; return Object.freeze(Object.create(null));
    });
    assert.equal(admitted.status, 'admitted'); assert.equal(resolutions, 1);
});

test('emette receipt hash-only e powered-by solo dopo una risposta validata', () => {
    const authorization = authorizeProviderOperationV2({ lifecycle: enabled(), evidence: EVIDENCE }, () => Object.freeze(Object.create(null)));
    const receipt = createProviderOperationReceiptV2(authorization, RESPONSE);
    assert.ok(receipt);
    assert.deepEqual(receipt, { schemaVersion: 'mediflow.ai.provider-operation-receipt.v2', operation: 'document_synthesis',
        providerId: 'openai', model: 'gpt-5.4-mini', venue: 'cloud', endpointClass: 'official_api', fallbackCount: 0,
        dataClass: 'synthetic_nonclinical', egressProfileRef: 'egress.synthetic.v1',
        retentionProfileRef: 'retention.standard.v1', consentRefSha256: null, vendorRequestId: 'req_synthetic_1',
        latencyMs: 25, tokensIn: 12, tokensOut: 7, payloadSha256: '1'.repeat(64), outputSha256: '2'.repeat(64),
        outcome: 'complete', completedAt: '2026-09-01T12:00:00.000Z' });
    assert.equal(poweredByFromProviderReceiptV2(receipt), 'Powered by OpenAI');
    assert.equal(poweredByFromProviderReceiptV2(enabled()), null);
    assert.equal(createProviderOperationReceiptV2(authorization, RESPONSE), null);
});

test('nega clinical_identifiable, mismatch, fallback e zero-retention non provata prima del secret', () => {
    const valid = enabled(); const disabled = transitionProviderLifecycleV2(valid, { type: 'disable' });
    const cases = [
        [{ lifecycle: enabled({ ...BINDING, dataClass: 'clinical_identifiable' }), evidence: EVIDENCE }, 'data_class_forbidden'],
        [{ lifecycle: valid, evidence: { ...EVIDENCE, egressProfileRef: 'egress.other.v1' } }, 'egress_profile_unsatisfied'],
        [{ lifecycle: valid, evidence: { ...EVIDENCE, retentionProfileRef: 'retention.other.v1' } }, 'retention_profile_unsatisfied'],
        [{ lifecycle: disabled, evidence: EVIDENCE }, 'provider_disabled'],
        [{ lifecycle: { ...valid, binding: { ...valid.binding, fallback: 'priority' } }, evidence: EVIDENCE }, 'input_invalid'],
        [{ lifecycle: enabled({ ...BINDING, retentionProfileRef: 'zero_data_retention' }),
            evidence: { ...EVIDENCE, retentionProfileRef: 'zero_data_retention' } }, 'retention_profile_unsatisfied'],
    ] as const;
    for (const [policy, code] of cases) {
        let resolutions = 0;
        const result = authorizeProviderOperationV2(policy, () => { resolutions += 1; return Object.freeze(Object.create(null)); });
        assert.equal(result.status, 'denied'); assert.equal(result.code, code); assert.equal(resolutions, 0);
    }
});

test('nega response non validate o con payload extra e rende il tentativo terminale', () => {
    for (const response of [
        { ...RESPONSE, validated: false },
        { ...RESPONSE, outputSha256: 'invalid' },
        { ...RESPONSE, rawOutput: 'Synthetic output must not cross the receipt boundary' },
        Object.assign(Object.create({ readiness: 'forged' }), RESPONSE),
    ]) {
        const authorization = authorizeProviderOperationV2({ lifecycle: enabled(), evidence: EVIDENCE }, () => Object.freeze(Object.create(null)));
        assert.equal(createProviderOperationReceiptV2(authorization, response), null);
        assert.equal(createProviderOperationReceiptV2(authorization, RESPONSE), null);
        assert.equal(poweredByFromProviderReceiptV2(response), null);
    }
});

test('hasha il consentRef e deriva Anthropic solo dalla receipt emessa', () => {
    const binding = { ...BINDING, providerId: 'anthropic', model: 'claude-sonnet-4-6', dataClass: 'redacted_clinical',
        egressProfileRef: 'egress.redacted.v1', retentionProfileRef: 'retention.eligible.v1', consentRef: 'consent.synthetic.current' };
    const proof = { ...EVIDENCE, egressProfileRef: binding.egressProfileRef, retentionProfileRef: binding.retentionProfileRef,
        consentRef: binding.consentRef, egressPromoted: true, retentionEligible: true, consentCurrent: true,
        redactionReceiptSha256: 'a'.repeat(64) };
    const authorization = authorizeProviderOperationV2({ lifecycle: enabled(binding), evidence: proof }, () => Object.freeze(Object.create(null)));
    const receipt = createProviderOperationReceiptV2(authorization, RESPONSE);
    assert.ok(receipt);
    assert.equal(receipt.consentRefSha256, 'be1bc5c25bafab49db5bbb2f219dfab399bcde6aa320eec1a3abc7f16d212ef5');
    assert.equal(JSON.stringify(receipt).includes('consent.synthetic.current'), false);
    assert.equal(poweredByFromProviderReceiptV2(receipt), 'Powered by Anthropic');
    assert.equal(poweredByFromProviderReceiptV2({ ...receipt }), null);
});

test('materializza getter una volta e chiude lease o prototipi ostili senza leak', () => {
    let lifecycleReads = 0; let evidenceReads = 0; let profileReads = 0;
    const proof = Object.defineProperty({ ...EVIDENCE }, 'egressProfileRef', { enumerable: true, get() {
        profileReads += 1; return profileReads === 1 ? BINDING.egressProfileRef : 'egress.forged.v1';
    } });
    const policy = Object.defineProperties({}, {
        lifecycle: { enumerable: true, get() { lifecycleReads += 1; return enabled(); } },
        evidence: { enumerable: true, get() { evidenceReads += 1; return proof; } },
    });
    assert.equal(authorizeProviderOperationV2(policy, () => Object.freeze(Object.create(null))).status, 'admitted');
    assert.deepEqual([lifecycleReads, evidenceReads, profileReads], [1, 1, 1]);

    const sentinel = 'SYNTHETIC_SECRET_SENTINEL';
    const hostileLease = new Proxy(Object.freeze(Object.create(null)), { getPrototypeOf() { throw new Error(sentinel); } });
    const denied = authorizeProviderOperationV2({ lifecycle: enabled(), evidence: EVIDENCE }, () => hostileLease);
    assert.equal(denied.status, 'denied'); assert.equal(denied.code, 'secret_unavailable');
    assert.equal(JSON.stringify(denied).includes(sentinel), false);
    let resolutions = 0;
    const hostilePolicy = Object.assign(Object.create({ providerId: 'caller' }), { lifecycle: enabled(), evidence: EVIDENCE });
    assert.equal(authorizeProviderOperationV2(hostilePolicy, () => { resolutions += 1; return hostileLease; }).code, 'input_invalid');
    assert.equal(resolutions, 0);
});
