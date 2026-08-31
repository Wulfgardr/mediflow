/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHeadlessSoapActiveRoleEnrollmentStoreAdapter } from './headless-soap-active-role-enrollment-store-adapter.ts';

type Code = 'actor_invalid' | 'actor_missing' | 'attestation_conflict' | 'attestation_missing' | 'schema_incompatible' | 'storage_unavailable' | 'stored_state_invalid';
const branded = new WeakSet<object>();
function failure(code: Code, isBranded = true): Error & { code: Code } {
    const error = Object.assign(new Error(`sensitive:${code}`), { code });
    if (isBranded) branded.add(error);
    return error;
}
const isStoreError = (value: unknown): value is Error & { code: Code } => typeof value === 'object' && value !== null && branded.has(value);

test('adapts successful store calls without changing the host-owned value', () => {
    const value = Object.freeze(Object.create(null));
    const adapter = createHeadlessSoapActiveRoleEnrollmentStoreAdapter({
        read: () => value, createInactive: () => value, activate: () => value,
    }, isStoreError);
    assert.deepEqual(adapter.readAttestation('synthetic-actor'), { kind: 'ok', value });
    assert.deepEqual(adapter.createInactive('synthetic-actor'), { kind: 'ok', value });
    assert.deepEqual(adapter.activate('synthetic-actor'), { kind: 'ok', value });
    assert.equal(adapter.readAttestation.length, 1); assert.equal(adapter.createInactive.length, 1); assert.equal(adapter.activate.length, 1);
});

test('maps only branded store failures to bounded lifecycle outcomes', () => {
    const expected: ReadonlyArray<readonly [Code, string, string]> = [
        ['attestation_missing', 'missing', 'denied'],
        ['attestation_conflict', 'conflict', 'conflict'],
        ['actor_invalid', 'denied', 'denied'],
        ['actor_missing', 'denied', 'denied'],
        ['schema_incompatible', 'unavailable', 'unavailable'],
        ['stored_state_invalid', 'unavailable', 'unavailable'],
        ['storage_unavailable', 'unavailable', 'unavailable'],
    ];
    for (const [code, readKind, mutationKind] of expected) {
        const store = { read: () => { throw failure(code); }, createInactive: () => { throw failure(code); }, activate: () => { throw failure(code); } };
        const adapter = createHeadlessSoapActiveRoleEnrollmentStoreAdapter(store, isStoreError);
        assert.deepEqual(adapter.readAttestation('synthetic-actor'), { kind: readKind });
        assert.deepEqual(adapter.createInactive('synthetic-actor'), { kind: mutationKind });
        assert.deepEqual(adapter.activate('synthetic-actor'), { kind: mutationKind });
    }
});

test('maps unbranded lookalikes and arbitrary exceptions to unavailable without leaking details', () => {
    for (const thrown of [failure('attestation_missing', false), new Error('synthetic sqlite secret'), 'raw secret']) {
        const adapter = createHeadlessSoapActiveRoleEnrollmentStoreAdapter({
            read: () => { throw thrown; }, createInactive: () => { throw thrown; }, activate: () => { throw thrown; },
        }, isStoreError);
        for (const result of [adapter.readAttestation('synthetic-actor'), adapter.createInactive('synthetic-actor'), adapter.activate('synthetic-actor')]) {
            assert.deepEqual(result, { kind: 'unavailable' });
            assert.equal(JSON.stringify(result).includes('secret'), false);
        }
    }
});
