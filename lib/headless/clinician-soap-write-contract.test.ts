/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from './clinician-soap-write-contract.ts';

type Draft = Record<'schema' | 'operationId' | 'subjective' | 'objective' | 'assessment' | 'plan', string>;
const keys = ['schema', 'operationId', 'subjective', 'objective', 'assessment', 'plan'] as const;
function draft(overrides: Partial<Draft> = {}): Draft {
    const value = Object.create(null) as Draft;
    Object.assign(value, { schema: CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID, subjective: 'S', objective: 'O', assessment: 'A', plan: 'P' }, overrides);
    return value;
}
function accepted(value: unknown) {
    const result = validateClinicianSoapWriteDraft(value);
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('expected accepted contract');
    return result;
}
function packet(fields: readonly string[]): Buffer {
    return Buffer.concat(fields.flatMap((field) => {
        const bytes = Buffer.from(field, 'utf8'); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
        return [length, bytes];
    }));
}

test('normalizes the four SOAP sections and emits golden digest bytes with the fixed codec order', () => {
    const result = accepted(draft({ subjective: 'A\r\n', objective: 'e\u0301', assessment: 'O', plan: 'P' }));
    const encoded = packet([CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, 'A\n', 'é', 'O', 'P']);
    const hex = createHash('sha256').update(encoded).digest('hex');
    assert.equal(encoded.toString('hex'), '000000166d656469666c6f772e736f61702d64726166742e7631000000266d656469666c6f772e636c696e6963616c5f64696172792e617070656e645f736f61702e763100000002410a00000002c3a9000000014f0000000150');
    assert.equal(hex, '1fe4a46f39f715ca783dc330dbaa503d7e8c1293895e7b4ed3f47ad5a2870328');
    assert.equal(result.subjective, 'A\n');
    assert.equal(result.objective, 'é');
    assert.equal(result.digest.sha256.hex, hex);
    assert.deepEqual(Buffer.from(result.digest.sha256.bytes).toString('hex'), hex);
});

test('changes the digest when one normalized SOAP section changes', () => {
    const first = accepted(draft({ plan: 'Piano uno' }));
    const second = accepted(draft({ plan: 'Piano due' }));
    assert.notEqual(first.digest.sha256.hex, second.digest.sha256.hex);
});

test('rejects malformed Unicode, forbidden controls, blank aggregate, and byte limits before hashing', () => {
    for (const value of ['\ud800', '\udc00', 'a\u0000b', 'a\u001fb']) {
        assert.equal(validateClinicianSoapWriteDraft(draft({ subjective: value })).status, 'denied');
    }
    assert.equal(validateClinicianSoapWriteDraft(draft({ subjective: '\t\n', objective: ' ', assessment: '', plan: '\r' })).status, 'denied');
    assert.equal(validateClinicianSoapWriteDraft(draft({ subjective: 'a'.repeat(16_385) })).status, 'denied');
    assert.equal(validateClinicianSoapWriteDraft(draft({ subjective: 'a'.repeat(16_384), objective: 'b'.repeat(16_384), assessment: 'c'.repeat(16_384), plan: 'd' })).status, 'denied');
});

test('accepts only a null-prototype record with six ordered enumerable own data fields', () => {
    const accessor = draft(); Object.defineProperty(accessor, 'plan', { enumerable: true, get: () => 'P' });
    const nonEnumerable = draft(); Object.defineProperty(nonEnumerable, 'plan', { enumerable: false, value: 'P' });
    const symbol = draft(); Object.defineProperty(symbol, Symbol('x'), { enumerable: true, value: 'x' });
    const inherited = Object.create({ plan: 'P' }) as Partial<Draft>; Object.assign(inherited, draft()); delete inherited.plan;
    const reordered = Object.create(null) as Draft; for (const key of [...keys].reverse()) reordered[key] = draft()[key];
    for (const value of [null, [], {}, new String('draft'), Promise.resolve(draft()), accessor, nonEnumerable, symbol, inherited, reordered, { ...draft(), extra: true }]) {
        assert.equal(validateClinicianSoapWriteDraft(value).status, 'denied');
    }
});

test('denies proxies without invoking traps or ambient thenables', () => {
    let traps = 0; let thenReads = 0;
    const proxy = new Proxy(draft(), {
        getPrototypeOf() { traps += 1; throw new Error('trap'); },
        ownKeys() { traps += 1; throw new Error('trap'); },
        getOwnPropertyDescriptor() { traps += 1; throw new Error('trap'); },
    });
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; throw new Error('then read'); } });
    try {
        const result = validateClinicianSoapWriteDraft(proxy);
        assert.equal(result.status, 'denied'); assert.equal(result.code, 'invalid_input');
        const thenable = draft(); Object.defineProperty(thenable, 'then', { enumerable: true, get() { thenReads += 1; return () => undefined; } });
        assert.equal(validateClinicianSoapWriteDraft(thenable).status, 'denied');
        const revoked = Proxy.revocable(draft(), {}); revoked.revoke();
        assert.equal(validateClinicianSoapWriteDraft(revoked.proxy).status, 'denied');
        assert.equal(traps, 0);
        assert.equal(thenReads, 0);
    } finally { delete (Object.prototype as { then?: unknown }).then; }
});

test('returns a deeply frozen, copy-isolated null-prototype snapshot without post-return drift', () => {
    const source = draft({ subjective: 'prima' });
    const result = accepted(source);
    const digest = result.digest.sha256.hex;
    source.subjective = 'dopo';
    assert.equal(result.subjective, 'prima');
    assert.equal(result.digest.sha256.hex, digest);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.getPrototypeOf(result.digest), null);
    assert.equal(Object.getPrototypeOf(result.digest.sha256), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.digest), true);
    assert.equal(Object.isFrozen(result.digest.sha256), true);
    assert.equal(Object.isFrozen(result.digest.sha256.bytes), true);
    assert.throws(() => { (result as { subjective: string }).subjective = 'mutated'; }, TypeError);
    assert.throws(() => { (result.digest.sha256.bytes as number[])[0] = 0; }, TypeError);
    assert.equal(result.digest.sha256.hex, digest);
});

test('uses only the six authorized fields and never returns raw SOAP in denials', () => {
    const hostile = draft(); Object.defineProperty(hostile, 'authority', { enumerable: true, value: 'forbidden' });
    const result = validateClinicianSoapWriteDraft(hostile);
    assert.equal(result.status, 'denied');
    assert.equal(JSON.stringify(result).includes('forbidden'), false);
});
