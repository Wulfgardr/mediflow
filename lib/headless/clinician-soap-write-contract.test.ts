/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { types } from 'node:util';
import {
    CLINICIAN_SOAP_DRAFT_KEYS,
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    type ClinicianSoapDraftV1,
    validateClinicianSoapWriteDraft,
} from './clinician-soap-write-contract.ts';

type Draft = { -readonly [Key in keyof ClinicianSoapDraftV1]: ClinicianSoapDraftV1[Key] };
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

test('exports the six-key draft DTO order without changing the H1 contract', () => {
    const typed: ClinicianSoapDraftV1 = draft();
    assert.deepEqual(CLINICIAN_SOAP_DRAFT_KEYS, keys);
    assert.equal(Object.isFrozen(CLINICIAN_SOAP_DRAFT_KEYS), true);
    assert.equal(validateClinicianSoapWriteDraft(typed).status, 'accepted');
});

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
    const reorderedRecord = Object.create(null) as Record<string, string>;
    for (const key of [...keys].reverse()) reorderedRecord[key] = draft()[key];
    const reordered = reorderedRecord as Draft;
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

function poison(owner: object, key: PropertyKey): () => void {
    const ownDescriptor = Object.getOwnPropertyDescriptor(owner, key); let cursor: object | null = owner; let descriptor = ownDescriptor;
    while (!descriptor && cursor) { cursor = Object.getPrototypeOf(cursor); descriptor = cursor ? Object.getOwnPropertyDescriptor(cursor, key) : undefined; }
    if (!descriptor) throw new Error('missing intrinsic');
    Object.defineProperty(owner, key, { configurable: true, enumerable: descriptor.enumerable, writable: true, value: () => { throw new Error('poisoned intrinsic'); } });
    return () => { if (ownDescriptor) Object.defineProperty(owner, key, ownDescriptor); else Reflect.deleteProperty(owner, key); };
}

test('uses captured intrinsics after import and never leaks or defers hostile SOAP', () => {
    let traps = 0; let unhandled = 0; const source = draft();
    const proxy = new Proxy(draft({ subjective: 'RAW_SECRET_SOAP' }), { getPrototypeOf() { traps += 1; throw new Error('trap'); } });
    const hashPrototype = Object.getPrototypeOf(createHash('sha256'));
    const valueDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    const restores = [
        poison(types, 'isProxy'), poison(Object, 'assign'), poison(Object, 'hasOwn'), poison(TextEncoder.prototype, 'encode'),
        poison(String.prototype, 'charCodeAt'), poison(String.prototype, 'normalize'), poison(String.prototype, 'trim'), poison(String.prototype, 'replace'),
        poison(Array.prototype, 'map'), poison(Array, 'from'), poison(Uint8Array, 'of'), poison(hashPrototype, 'update'), poison(hashPrototype, 'digest'), poison(Buffer, 'from'), poison(Buffer.prototype, 'toString'),
    ];
    Object.defineProperty(Object.prototype, 'value', { configurable: true, get() { throw new Error('poisoned value'); } });
    const onUnhandled = () => { unhandled += 1; }; process.on('unhandledRejection', onUnhandled);
    let result: ReturnType<typeof validateClinicianSoapWriteDraft> | undefined; let denial: ReturnType<typeof validateClinicianSoapWriteDraft> | undefined;
    try { result = validateClinicianSoapWriteDraft(source); source.subjective = 'post-return'; denial = validateClinicianSoapWriteDraft(proxy); } finally {
        process.off('unhandledRejection', onUnhandled);
        if (valueDescriptor) Object.defineProperty(Object.prototype, 'value', valueDescriptor); else delete (Object.prototype as { value?: unknown }).value;
        for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]!();
    }
    if (!result || !denial) throw new Error('missing result');
    assert.equal(result.status, 'accepted'); assert.equal(result.subjective, 'S'); assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(denial.status, 'denied'); assert.equal(JSON.stringify(denial).includes('RAW_SECRET_SOAP'), false);
    assert.equal(traps, 0); assert.equal(unhandled, 0);
});

test('captures the TypedArray byteLength getter before post-import poisoning', () => {
    const prototype = Object.getPrototypeOf(Uint8Array.prototype); const descriptor = Object.getOwnPropertyDescriptor(prototype, 'byteLength');
    if (!descriptor) throw new Error('missing byteLength descriptor');
    const expected = accepted(draft()).digest.sha256.hex; const normal = draft(); const oversized = draft({ subjective: 'a'.repeat(16_385) });
    const getters = [() => 0, () => 100_000, () => { throw new Error('poisoned byteLength'); }]; let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; }; process.on('unhandledRejection', onUnhandled);
    try {
        for (let index = 0; index < getters.length; index += 1) {
            let acceptedResult: ReturnType<typeof validateClinicianSoapWriteDraft> | undefined; let deniedResult: ReturnType<typeof validateClinicianSoapWriteDraft> | undefined;
            Object.defineProperty(prototype, 'byteLength', { configurable: true, get: getters[index]! });
            try { acceptedResult = validateClinicianSoapWriteDraft(normal); deniedResult = validateClinicianSoapWriteDraft(oversized); } finally { Object.defineProperty(prototype, 'byteLength', descriptor); }
            if (!acceptedResult || !deniedResult) throw new Error('missing result');
            assert.equal(acceptedResult.status, 'accepted'); if (acceptedResult.status === 'accepted') assert.equal(acceptedResult.digest.sha256.hex, expected);
            assert.equal(deniedResult.status, 'denied'); assert.equal(JSON.stringify(deniedResult).includes('a'.repeat(32)), false);
        }
    } finally { process.off('unhandledRejection', onUnhandled); }
    assert.equal(unhandled, 0);
});

test('does not use Array iteration after module initialization', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator); const source = draft(); let result: ReturnType<typeof validateClinicianSoapWriteDraft> | undefined;
    if (!descriptor) throw new Error('missing array iterator');
    Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value: () => { throw new Error('poisoned iterator'); } });
    try { result = validateClinicianSoapWriteDraft(source); } finally { Object.defineProperty(Array.prototype, Symbol.iterator, descriptor); }
    if (!result) throw new Error('missing result'); assert.equal(result.status, 'accepted'); assert.equal(Object.getPrototypeOf(result), null);
});
