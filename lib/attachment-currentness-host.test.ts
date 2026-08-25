/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-o2a-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath);
migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;
const requireCurrent = createRequire(import.meta.url);
const host = requireCurrent('./attachment-currentness-host') as typeof import('./attachment-currentness-host');
const databaseHost = requireCurrent('./db-server') as typeof import('./db-server');

const ref = 'a'.repeat(64); const expected = () => ({ sourceRef: ref, revision: 1, freshnessEpoch: 1 });
function reset(values: { revision?: number; freshnessEpoch?: number; sourceRef?: string; data?: string | null } = {}) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients;');
        db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.1', 'Ada', 'Synthetic', 'SYNTHETIC00000000')").run();
        db.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run('attachment.synthetic.1', 'patient.synthetic.1', 'synthetic.pdf', 'application/pdf', 1, 'attachments/synthetic.pdf', values.data ?? 'old', values.sourceRef ?? ref, values.revision ?? 1, values.freshnessEpoch ?? 1);
    } finally { db.close(); }
}
function snapshot() {
    const db = new Database(dbPath); try { return db.prepare('SELECT patient_id, data, document_source_ref, document_revision, document_freshness_epoch FROM attachments').get(); } finally { db.close(); }
}
function rejects(action: () => unknown, code: 'input_invalid' | 'attachment_missing' | 'currentness_conflict' | 'currentness_overflow' | 'stored_state_invalid') {
    assert.throws(action, (error: unknown) => host.isAttachmentCurrentnessHostError(error) && error.code === code && error.message === `Attachment currentness host rejected: ${code}`);
}
function worker(workerPath = path.join(dataDir, 'worker.mjs')): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts/run-strip-types.mjs'), workerPath], { cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', (part) => { output += String(part); }); child.stderr.on('data', (part) => { output += String(part); });
        child.once('error', reject); child.once('close', () => { child.stdout.destroy(); child.stderr.destroy(); resolve(output.trim()); });
    });
}
function adversarialWorker(setup: string): Promise<string> {
    const workerPath = path.join(dataDir, 'adversarial-worker.mjs');
    fs.writeFileSync(workerPath, `const database = await import('@/lib/db-server');\nconst originalRun = database.dbServer.run.bind(database.dbServer);\nlet reads = 0;\n${setup}\nObject.defineProperty(database.dbServer, 'run', { value: (...args) => { originalRun(...args); return result; } });\nconst host = await import('@/lib/attachment-currentness-host');\ntry { host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { sourceRef: '${ref}', revision: 1, freshnessEpoch: 1 }, 'winner'); console.log('winner:' + reads); } catch (error) { console.log((host.isAttachmentCurrentnessHostError(error) ? error.code : 'unknown') + ':' + reads); }\n`);
    return worker(workerPath).finally(() => fs.rmSync(workerPath, { force: true }));
}
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('mints only opaque host source refs with the initial tuple', () => {
    const first = host.createHostAttachmentCurrentness(); const second = host.createHostAttachmentCurrentness();
    assert.match(first.sourceRef, /^[0-9a-f]{64}$/u); assert.notEqual(first.sourceRef, second.sourceRef);
    assert.deepEqual({ revision: first.revision, freshnessEpoch: first.freshnessEpoch }, { revision: 1, freshnessEpoch: 1 });
});

test('atomically replaces exact string or null data and advances the exact expected triple', () => {
    reset();
    const next = host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'new');
    assert.deepEqual(next, { sourceRef: ref, revision: 2, freshnessEpoch: 2 });
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: 'new', document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'again'), 'currentness_conflict');
    reset(); assert.deepEqual(host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), null), { sourceRef: ref, revision: 2, freshnessEpoch: 2 });
    assert.equal((snapshot() as { data: string | null }).data, null);
});

test('observes the canonical Drizzle SQLite run result shape', () => {
    reset();
    const result = databaseHost.dbServer.run(sql`UPDATE attachments SET data = ${'shape'} WHERE id = ${'attachment.synthetic.1'}`);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(Reflect.ownKeys(result), ['changes', 'lastInsertRowid']);
    const fields = Object.getOwnPropertyDescriptors(result);
    assert.equal(fields.changes?.enumerable, true); assert.equal(fields.lastInsertRowid?.enumerable, true);
    assert.equal(result.changes, 1); assert.ok(typeof result.lastInsertRowid === 'number' || typeof result.lastInsertRowid === 'bigint');
});

test('denies missing, malformed, stale, overflow, and caller-selected patient input without writes', () => {
    reset(); const before = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('missing.synthetic', expected(), 'new'), 'attachment_missing');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), patientId: 'patient.other' }, 'new'), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), revision: 0 }, 'new'), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), sourceRef: 'A'.repeat(64) }, 'new'), 'input_invalid');
    assert.deepEqual(snapshot(), before);
    reset({ revision: Number.MAX_SAFE_INTEGER }); const overflow = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), revision: Number.MAX_SAFE_INTEGER }, 'new'), 'currentness_overflow');
    assert.deepEqual(snapshot(), overflow);
    reset({ freshnessEpoch: Number.MAX_SAFE_INTEGER }); const overflowEpoch = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), freshnessEpoch: Number.MAX_SAFE_INTEGER }, 'new'), 'currentness_overflow');
    assert.deepEqual(snapshot(), overflowEpoch);
    reset(); const malformed = new Database(dbPath); malformed.pragma('ignore_check_constraints = ON'); malformed.prepare("UPDATE attachments SET document_source_ref = 'UPPER'").run(); malformed.close();
    const malformedBefore = snapshot(); rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'new'), 'stored_state_invalid');
    assert.deepEqual(snapshot(), malformedBefore);
});

test('rejects callback-era values before transaction work and never exposes forged errors', async () => {
    reset(); const before = snapshot(); let getterReads = 0; let queued = false;
    const forged = Object.assign(new Error('SELECT synthetic secret'), { code: 'currentness_conflict' });
    const thenable = Object.defineProperty({}, 'then', { get() { getterReads += 1; return () => undefined; } });
    const queuedFunction = () => { queueMicrotask(() => { queued = true; }); return 'new'; };
    for (const value of [undefined, forged, Promise.resolve('new'), thenable, queuedFunction, new Proxy({}, {})]) rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), value), 'input_invalid');
    await Promise.resolve();
    assert.equal(getterReads, 0); assert.equal(queued, false); assert.equal(host.isAttachmentCurrentnessHostError(forged), false);
    assert.equal(host.isAttachmentCurrentnessHostError(Object.create(forged)), false); assert.equal(host.isAttachmentCurrentnessHostError(new Proxy(forged, {})), false);
    assert.deepEqual(snapshot(), before);
});

test('prototype poisoning cannot alter the fixed data mutation or commit a zero replacement', () => {
    reset(); const before = snapshot();
    Object.defineProperty(Object.prototype, 'replaceData', { configurable: true, get() { throw new Error('synthetic secret'); } });
    try { assert.deepEqual(host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'new'), { sourceRef: ref, revision: 2, freshnessEpoch: 2 }); }
    finally { delete (Object.prototype as { replaceData?: unknown }).replaceData; }
    reset();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), undefined), 'input_invalid');
    assert.deepEqual(snapshot(), before);
});

test('captures mutable intrinsics before post-import poisoning', () => {
    reset();
    const before = snapshot();
    const originals = {
        getPrototypeOf: Object.getPrototypeOf, getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors, hasOwn: Object.hasOwn,
        defineProperties: Object.defineProperties, freeze: Object.freeze, ownKeys: Reflect.ownKeys, isArray: Array.isArray,
        every: Array.prototype.every, isSafeInteger: Number.isSafeInteger, trim: String.prototype.trim, test: RegExp.prototype.test,
        weakSetAdd: WeakSet.prototype.add, weakSetHas: WeakSet.prototype.has, bufferToString: Buffer.prototype.toString, then: Promise.prototype.then,
    };
    let minted: ReturnType<typeof host.createHostAttachmentCurrentness> | undefined;
    let denial: unknown;
    let denialIsHost = false;
    try {
        const poison = () => { throw new Error('synthetic intrinsic poison'); };
        Object.getPrototypeOf = poison as typeof Object.getPrototypeOf; Object.getOwnPropertyDescriptors = poison as typeof Object.getOwnPropertyDescriptors; Object.hasOwn = poison as typeof Object.hasOwn; Object.defineProperties = poison as typeof Object.defineProperties; Object.freeze = poison as typeof Object.freeze;
        Reflect.ownKeys = poison as typeof Reflect.ownKeys; Array.isArray = poison as unknown as typeof Array.isArray; Array.prototype.every = poison as unknown as typeof Array.prototype.every; Number.isSafeInteger = poison as typeof Number.isSafeInteger;
        String.prototype.trim = poison as typeof String.prototype.trim; RegExp.prototype.test = poison as typeof RegExp.prototype.test; WeakSet.prototype.add = poison as typeof WeakSet.prototype.add; WeakSet.prototype.has = poison as typeof WeakSet.prototype.has;
        Buffer.prototype.toString = poison as typeof Buffer.prototype.toString; Promise.prototype.then = poison as typeof Promise.prototype.then;
        minted = host.createHostAttachmentCurrentness();
        try { host.transitionAttachmentContentCurrentness(' attachment.synthetic.1', expected(), 'new'); } catch (error) { denial = error; }
        denialIsHost = host.isAttachmentCurrentnessHostError(denial);
    } finally {
        Object.getPrototypeOf = originals.getPrototypeOf; Object.getOwnPropertyDescriptors = originals.getOwnPropertyDescriptors; Object.hasOwn = originals.hasOwn;
        Object.defineProperties = originals.defineProperties; Object.freeze = originals.freeze; Reflect.ownKeys = originals.ownKeys; Array.isArray = originals.isArray;
        Array.prototype.every = originals.every; Number.isSafeInteger = originals.isSafeInteger; String.prototype.trim = originals.trim; RegExp.prototype.test = originals.test;
        WeakSet.prototype.add = originals.weakSetAdd; WeakSet.prototype.has = originals.weakSetHas; Buffer.prototype.toString = originals.bufferToString; Promise.prototype.then = originals.then;
    }
    assert.ok(minted); assert.match(minted.sourceRef, /^[0-9a-f]{64}$/u); assert.equal(Object.isFrozen(minted), true);
    assert.equal(denialIsHost, true);
    assert.equal((denial as { code?: unknown }).code, 'input_invalid');
    assert.deepEqual(snapshot(), before);
    const advanced = host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), null);
    assert.deepEqual(advanced, { sourceRef: ref, revision: 2, freshnessEpoch: 2 }); assert.equal(Object.isFrozen(advanced), true);
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: null, document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    assert.notDeepEqual(snapshot(), before);
});

test('rejects inherited or non-data expected fields without reads or a transaction', () => {
    let accessorReads = 0;
    let prototypeReads = 0;
    const inheritedValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    const prototypeValue = (value: unknown) => {
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.configurable = true; descriptor.value = value;
        Object.defineProperty(Object.prototype, 'value', descriptor);
    };
    const prototypeGetter = (getter: () => unknown) => {
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.configurable = true; descriptor.get = getter;
        Object.defineProperty(Object.prototype, 'value', descriptor);
    };
    const accessor = () => {
        const value = { revision: 1, freshnessEpoch: 1 };
        const descriptor = Object.create(null) as PropertyDescriptor;
        descriptor.enumerable = true; descriptor.get = () => { accessorReads += 1; return ref; };
        Object.defineProperty(value, 'sourceRef', descriptor);
        return value;
    };
    const rejectsWithoutMutation = (value: unknown) => {
        reset(); const before = snapshot();
        rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', value, 'new'), 'input_invalid');
        assert.deepEqual(snapshot(), before);
    };
    reset(); const poisonedBefore = snapshot();
    try {
        prototypeValue(ref); rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', accessor(), 'new'), 'input_invalid');
        prototypeGetter(() => { prototypeReads += 1; return ref; }); rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', accessor(), 'new'), 'input_invalid');
        prototypeGetter(() => { prototypeReads += 1; throw new Error('synthetic prototype getter'); }); rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', accessor(), 'new'), 'input_invalid');
    } finally {
        if (inheritedValue) Object.defineProperty(Object.prototype, 'value', inheritedValue);
        else delete (Object.prototype as { value?: unknown }).value;
    }
    assert.deepEqual(snapshot(), poisonedBefore);
    const inherited = Object.create(Object.prototype) as Record<string, unknown>;
    inherited.revision = 1; inherited.freshnessEpoch = 1;
    rejectsWithoutMutation(inherited);
    rejectsWithoutMutation({ ...expected(), [Symbol('synthetic')]: true });
    const nonEnumerable = { ...expected() }; Object.defineProperty(nonEnumerable, 'sourceRef', { enumerable: false, value: ref }); rejectsWithoutMutation(nonEnumerable);
    rejectsWithoutMutation(accessor());
    rejectsWithoutMutation(new Proxy(expected(), { get() { accessorReads += 1; return ref; }, ownKeys() { accessorReads += 1; return []; } }));
    assert.equal(accessorReads, 0); assert.equal(prototypeReads, 0);
    reset(); assert.deepEqual(host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'new'), { sourceRef: ref, revision: 2, freshnessEpoch: 2 });
});

test('binds original Drizzle methods before hostile post-import replacements', () => {
    reset();
    const prototype = Object.getPrototypeOf(databaseHost.dbServer) as Record<string, unknown>;
    const originalGet = Object.getOwnPropertyDescriptor(prototype, 'get');
    const originalRun = Object.getOwnPropertyDescriptor(prototype, 'run');
    let hostileCalls = 0;
    const hostile = new Proxy(() => undefined, { apply() { hostileCalls += 1; throw new Error('synthetic db redirect'); } });
    try {
        Object.defineProperty(prototype, 'get', { configurable: true, value: hostile });
        Object.defineProperty(prototype, 'run', { configurable: true, value: hostile });
        assert.deepEqual(host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), 'captured'), { sourceRef: ref, revision: 2, freshnessEpoch: 2 });
    } finally {
        if (originalGet) Object.defineProperty(prototype, 'get', originalGet); else delete prototype.get;
        if (originalRun) Object.defineProperty(prototype, 'run', originalRun); else delete prototype.run;
    }
    assert.equal(hostileCalls, 0);
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: 'captured', document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
});

test('rolls back every hostile Drizzle run result without reads or a false winner', { timeout: 30_000 }, async () => {
    const cases = [
        { expected: 'storage_unavailable', setup: "const result = Object.create({ changes: 1, lastInsertRowid: 1 });" },
        { expected: 'storage_unavailable', setup: "const result = { lastInsertRowid: 1 }; Object.defineProperty(result, 'changes', { enumerable: true, get() { reads += 1; return 1; } });" },
        { expected: 'storage_unavailable', setup: "const result = new Proxy({ changes: 1, lastInsertRowid: 1 }, { get() { reads += 1; return 1; }, ownKeys() { reads += 1; return ['changes', 'lastInsertRowid']; } });" },
        { expected: 'storage_unavailable', setup: "const result = { changes: 1, lastInsertRowid: 1 }; Object.defineProperty(result, 'changes', { enumerable: false, value: 1 });" },
        { expected: 'storage_unavailable', setup: "const result = { changes: 1, lastInsertRowid: 1, [Symbol('synthetic')]: true };" },
        { expected: 'storage_unavailable', setup: "const result = Object.assign(Object.create(null), { changes: 1, lastInsertRowid: 1 });" },
        { expected: 'storage_unavailable', setup: "const result = Object.assign(Object.create({}), { changes: 1, lastInsertRowid: 1 });" },
        { expected: 'storage_unavailable', setup: "const result = { changes: 1, lastInsertRowid: 1, then() { reads += 1; } };" },
        { expected: 'storage_unavailable', setup: "const result = { changes: 1, lastInsertRowid: 1, extra: true };" },
        { expected: 'currentness_conflict', setup: "const result = { changes: 0, lastInsertRowid: 1 };" },
    ];
    for (const candidate of cases) {
        reset(); const before = snapshot();
        assert.equal(await adversarialWorker(candidate.setup), `${candidate.expected}:0`);
        assert.deepEqual(snapshot(), before);
    }
});

test('leaves the immediate transaction reusable after every denial', () => {
    reset(); const before = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), { value: 'new' }), 'input_invalid');
    assert.deepEqual(snapshot(), before);
    const db = new Database(dbPath); try { db.transaction(() => undefined).immediate(); } finally { db.close(); }
});

test('two process-level duplicate CAS attempts have one winner', { timeout: 30_000 }, async () => {
    reset(); const workerPath = path.join(dataDir, 'worker.mjs');
    fs.writeFileSync(workerPath, `const host = await import('@/lib/attachment-currentness-host');\ntry { host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { sourceRef: '${ref}', revision: 1, freshnessEpoch: 1 }, 'winner'); console.log('winner'); } catch (error) { console.log(host.isAttachmentCurrentnessHostError(error) ? error.code : 'unknown'); }\n`);
    try {
        assert.deepEqual((await Promise.all([worker(), worker()])).sort(), ['currentness_conflict', 'winner']);
        assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: 'winner', document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    } finally { fs.rmSync(workerPath, { force: true }); }
});
