/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import { createClinicianSoapEntryFieldSet } from '../headless/clinician-soap-entry-field-set.ts';
import {
    HEADLESS_SOAP_ENTRY_PRESENTATION_SCHEMA, createHeadlessSoapEntryPresentationHandoff,
} from './headless-soap-entry-presentation-handoff.ts';

function fieldSet() {
    const draft = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico',
        objective: 'Parametro sintetico',
        assessment: 'Valutazione sintetica',
        plan: 'Piano sintetico',
    });
    const accepted = validateClinicianSoapWriteDraft(draft);
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('synthetic H1 fixture denied');
    const result = createClinicianSoapEntryFieldSet(accepted, 1_704_067_200_987);
    assert.ok(result);
    return result;
}

function entropy(): Uint8Array {
    return Uint8Array.from({ length: 32 }, (_, index) => index);
}

test('creates the exact authority-free H5a presentation handoff from canonical H4 material', () => {
    const source = fieldSet();
    const result = createHeadlessSoapEntryPresentationHandoff(source, entropy());
    assert.ok(result);
    assert.deepEqual(Reflect.ownKeys(result), ['schema', 'correlationToken', 'fieldSet']);
    assert.equal(result.schema, HEADLESS_SOAP_ENTRY_PRESENTATION_SCHEMA);
    assert.equal(result.schema, 'mediflow.headless.soap-entry-presentation.v1');
    assert.equal(result.correlationToken, 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
    for (const key of Reflect.ownKeys(result)) {
        const descriptor = Object.getOwnPropertyDescriptor(result, key);
        assert.ok(descriptor); assert.equal(descriptor.enumerable, true); assert.equal('value' in descriptor, true);
    }

    assert.deepEqual(result.fieldSet, source); assert.notEqual(result.fieldSet, source);
    assert.deepEqual(Reflect.ownKeys(result.fieldSet), [
        'schema', 'type', 'title', 'date', 'content', 'setting', 'metadata', 'payloadDigest',
    ]);
    assert.deepEqual(Reflect.ownKeys(result.fieldSet.metadata), ['codec', 'sha256']);
    assert.deepEqual(Reflect.ownKeys(result.fieldSet.metadata.sha256), ['bytes', 'hex']);
    assert.deepEqual(Reflect.ownKeys(result.fieldSet.payloadDigest), ['codec', 'sha256']);
    assert.deepEqual(Reflect.ownKeys(result.fieldSet.payloadDigest.sha256), ['bytes', 'hex']);
    assert.notEqual(result.fieldSet.metadata, source.metadata);
    assert.notEqual(result.fieldSet.metadata.sha256, source.metadata.sha256);
    assert.notEqual(result.fieldSet.metadata.sha256.bytes, source.metadata.sha256.bytes);
    assert.notEqual(result.fieldSet.payloadDigest, source.payloadDigest);
    assert.notEqual(result.fieldSet.payloadDigest.sha256, source.payloadDigest.sha256);
    assert.notEqual(result.fieldSet.payloadDigest.sha256.bytes, source.payloadDigest.sha256.bytes);

    for (const value of [
        result, result.fieldSet, result.fieldSet.metadata, result.fieldSet.metadata.sha256,
        result.fieldSet.metadata.sha256.bytes, result.fieldSet.payloadDigest,
        result.fieldSet.payloadDigest.sha256, result.fieldSet.payloadDigest.sha256.bytes,
    ]) {
        assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : null);
        assert.equal(Object.isFrozen(value), true);
    }
});

test('denies invalid entropy and hostile proxies without invoking their traps', () => {
    const source = fieldSet(); let traps = 0;
    const proxy = new Proxy(entropy(), {
        getPrototypeOf() { traps += 1; throw new Error('hostile entropy'); },
        get() { traps += 1; throw new Error('hostile entropy'); },
    });
    const fieldSetProxy = new Proxy(source, {
        getPrototypeOf() { traps += 1; throw new Error('hostile field set'); },
        ownKeys() { traps += 1; throw new Error('hostile field set'); },
    });
    assert.equal(createHeadlessSoapEntryPresentationHandoff(source, new Uint8Array(31)), null);
    assert.equal(createHeadlessSoapEntryPresentationHandoff(source, new Uint8Array(33)), null);
    assert.equal(createHeadlessSoapEntryPresentationHandoff(source, proxy), null);
    assert.equal(createHeadlessSoapEntryPresentationHandoff(fieldSetProxy, entropy()), null);
    assert.equal(traps, 0);
});

test('denies field sets that are not an exact canonical H4 snapshot', () => {
    const source = fieldSet();
    assert.equal(createHeadlessSoapEntryPresentationHandoff(Object.freeze({ ...source }), entropy()), null);
    const tampered = Object.create(null) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(source)) {
        tampered[key] = key === 'content' ? '<p>S: contenuto alterato</p>' : source[key as keyof typeof source];
    }
    Object.freeze(tampered);
    assert.equal(createHeadlessSoapEntryPresentationHandoff(tampered, entropy()), null);
});
