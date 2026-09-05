/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { types } from 'node:util';

import {
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME,
    CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA,
    snapshotClinicianSoapEntryCommitReceipt,
} from './clinician-soap-entry-commit-receipt.ts';
import { CLINICIAN_SOAP_OPERATION_ID } from './clinician-soap-write-contract.ts';

const RECEIPT_KEYS = [
    'schema', 'receiptRef', 'operationId', 'outcome', 'commandId', 'entryRef', 'auditEventRef',
    'patientVersion', 'entryVersion', 'committedAt', 'bindingDigest', 'entryDigest', 'auditDigest',
] as const;

function syntheticReceipt(): Record<(typeof RECEIPT_KEYS)[number], string | number> {
    return Object.assign(Object.create(null), {
        schema: 'mediflow.headless.soap-entry-commit-receipt.v1',
        receiptRef: `hser_${'a'.repeat(64)}`,
        operationId: 'mediflow.clinical_diary.append_soap.v1',
        outcome: 'entry_committed',
        commandId: `hsac_${'b'.repeat(64)}`,
        entryRef: `hsei_${'c'.repeat(64)}`,
        auditEventRef: `hsea_${'d'.repeat(64)}`,
        patientVersion: 7,
        entryVersion: 1,
        committedAt: '2026-08-31T23:45:12.000Z',
        bindingDigest: 'e'.repeat(64),
        entryDigest: 'f'.repeat(64),
        auditDigest: '0'.repeat(64),
    });
}

test('snapshots the exact synthetic H7b receipt as the shared byte-stable contract', () => {
    assert.equal(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_SCHEMA, 'mediflow.headless.soap-entry-commit-receipt.v1');
    assert.equal(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID, 'mediflow.clinical_diary.append_soap.v1');
    assert.equal(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OUTCOME, 'entry_committed');
    assert.equal(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_DIGEST_DOMAIN, 'mediflow.headless.soap-entry-commit-receipt-digest.v1');
    assert.deepEqual(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS, RECEIPT_KEYS);

    assert.equal(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_OPERATION_ID, CLINICIAN_SOAP_OPERATION_ID);
    const receipt = snapshotClinicianSoapEntryCommitReceipt(Object.freeze(syntheticReceipt()));
    assert.ok(receipt);
    assert.equal(Object.getPrototypeOf(receipt), null);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Reflect.ownKeys(receipt), RECEIPT_KEYS);
    assert.equal(JSON.stringify(receipt), '{"schema":"mediflow.headless.soap-entry-commit-receipt.v1","receiptRef":"hser_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","operationId":"mediflow.clinical_diary.append_soap.v1","outcome":"entry_committed","commandId":"hsac_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","entryRef":"hsei_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","auditEventRef":"hsea_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","patientVersion":7,"entryVersion":1,"committedAt":"2026-08-31T23:45:12.000Z","bindingDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","entryDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","auditDigest":"0000000000000000000000000000000000000000000000000000000000000000"}');
});

test('rejects every structural drift without invoking accessors or proxy traps', () => {
    const unfrozenNullPrototype = syntheticReceipt();
    const missing = syntheticReceipt() as Partial<ReturnType<typeof syntheticReceipt>>; delete missing.auditDigest;
    const extra = syntheticReceipt(); Object.defineProperty(extra, 'authority', { enumerable: true, value: 'forbidden' });
    const reordered = Object.create(null) as Record<string, unknown>;
    for (const key of [...RECEIPT_KEYS].reverse()) reordered[key] = syntheticReceipt()[key];
    let accessorReads = 0;
    const accessor = syntheticReceipt(); Object.defineProperty(accessor, 'auditDigest', {
        enumerable: true,
        get() { accessorReads += 1; return '0'.repeat(64); },
    });
    const inherited = Object.assign(Object.create({ authority: true }), syntheticReceipt());
    let proxyTraps = 0;
    const proxy = new Proxy(syntheticReceipt(), {
        getPrototypeOf() { proxyTraps += 1; throw new Error('trap'); },
        ownKeys() { proxyTraps += 1; throw new Error('trap'); },
        getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('trap'); },
    });
    const revoked = Proxy.revocable(syntheticReceipt(), {}); revoked.revoke();
    for (const value of [unfrozenNullPrototype, missing, extra, reordered, accessor, inherited, proxy, revoked.proxy]) {
        assert.equal(snapshotClinicianSoapEntryCommitReceipt(value), null);
    }
    assert.equal(accessorReads, 0);
    assert.equal(proxyTraps, 0);
});

test('rejects non-canonical identifiers, hashes, versions and timestamps', () => {
    const invalid = [
        { schema: 'mediflow.headless.soap-entry-commit-receipt.v2' },
        { receiptRef: `receipt_${'a'.repeat(64)}` },
        { operationId: 'mediflow.clinical_diary.append_soap.v2' },
        { outcome: 'entry_replayed' },
        { commandId: `hsaa_${'b'.repeat(64)}` },
        { entryRef: `entry_${'c'.repeat(64)}` },
        { auditEventRef: `audit_${'d'.repeat(64)}` },
        { bindingDigest: 'E'.repeat(64) },
        { entryDigest: 'f'.repeat(63) },
        { auditDigest: `0${'g'.repeat(63)}` },
        { patientVersion: 0 },
        { patientVersion: 1.5 },
        { patientVersion: Number.MAX_SAFE_INTEGER + 1 },
        { entryVersion: 2 },
        { committedAt: '2026-08-31T23:45:12.123Z' },
        { committedAt: '2026-08-31T23:45:12+00:00' },
        { committedAt: '2026-02-30T23:45:12.000Z' },
    ] as const;
    for (const override of invalid) {
        const value = Object.assign(syntheticReceipt(), override);
        assert.equal(snapshotClinicianSoapEntryCommitReceipt(value), null);
    }
});

test('returns a copy-isolated frozen null-prototype receipt from JSON or null-prototype input', () => {
    const source = JSON.parse(JSON.stringify(syntheticReceipt())) as Record<string, string | number>;
    const first = snapshotClinicianSoapEntryCommitReceipt(source);
    assert.ok(first);
    source.receiptRef = `hser_${'1'.repeat(64)}`;
    assert.equal(first.receiptRef, `hser_${'a'.repeat(64)}`);
    assert.throws(() => { (first as { receiptRef: string }).receiptRef = `hser_${'2'.repeat(64)}`; }, TypeError);
    for (const key of RECEIPT_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(first, key);
        assert.ok(descriptor);
        assert.equal(descriptor.enumerable, true);
        assert.equal(descriptor.writable, false);
        assert.equal(descriptor.configurable, false);
    }
    const frozenNullPrototype = Object.freeze(syntheticReceipt());
    const second = snapshotClinicianSoapEntryCommitReceipt(frozenNullPrototype);
    assert.ok(second);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    assert.equal(Object.getPrototypeOf(second), null);
    assert.equal(Object.isFrozen(second), true);
    assert.equal(Object.isFrozen(CLINICIAN_SOAP_ENTRY_COMMIT_RECEIPT_KEYS), true);
});

function poison(owner: object, key: PropertyKey): () => void {
    const ownDescriptor = Object.getOwnPropertyDescriptor(owner, key);
    let cursor: object | null = owner;
    let descriptor = ownDescriptor;
    while (!descriptor && cursor) {
        cursor = Object.getPrototypeOf(cursor);
        descriptor = cursor ? Object.getOwnPropertyDescriptor(cursor, key) : undefined;
    }
    if (!descriptor) throw new Error('missing intrinsic');
    Object.defineProperty(owner, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        writable: true,
        value: () => { throw new Error('poisoned intrinsic'); },
    });
    return () => {
        if (ownDescriptor) Object.defineProperty(owner, key, ownDescriptor);
        else Reflect.deleteProperty(owner, key);
    };
}

test('uses captured intrinsics after import and rejects proxies without observing traps', () => {
    const source = Object.freeze(syntheticReceipt());
    let proxyTraps = 0;
    const proxy = new Proxy(syntheticReceipt(), {
        getPrototypeOf() { proxyTraps += 1; throw new Error('trap'); },
        ownKeys() { proxyTraps += 1; throw new Error('trap'); },
        getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('trap'); },
    });
    const restores = [
        poison(types, 'isProxy'),
        poison(Object, 'create'),
        poison(Object, 'freeze'),
        poison(Object, 'getPrototypeOf'),
        poison(Object, 'getOwnPropertyDescriptors'),
        poison(Object, 'isFrozen'),
        poison(Reflect, 'apply'),
        poison(Reflect, 'ownKeys'),
        poison(RegExp.prototype, 'test'),
        poison(Number, 'isSafeInteger'),
        poison(Date.prototype, 'toISOString'),
        poison(globalThis, 'Date'),
    ];
    let accepted: ReturnType<typeof snapshotClinicianSoapEntryCommitReceipt> | undefined;
    let denied: ReturnType<typeof snapshotClinicianSoapEntryCommitReceipt> | undefined;
    try {
        accepted = snapshotClinicianSoapEntryCommitReceipt(source);
        denied = snapshotClinicianSoapEntryCommitReceipt(proxy);
    } finally {
        for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]!();
    }
    assert.ok(accepted);
    assert.equal(accepted.receiptRef, `hser_${'a'.repeat(64)}`);
    assert.equal(denied, null);
    assert.equal(proxyTraps, 0);
});
