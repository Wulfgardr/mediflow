/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-o2b2b-'));
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;
const requireCurrent = createRequire(import.meta.url);
const adapter = requireCurrent('./attachment-currentness-get-route') as typeof import('./attachment-currentness-get-route');
const ref = 'a'.repeat(64);
const session = { id: 'session.synthetic', userId: 'user.synthetic', username: ref.slice(0, 8), role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 2 } as const;
const tuple = () => Object.freeze(Object.assign(Object.create(null), { sourceRef: ref, revision: 1, freshnessEpoch: 2 }));

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('gates unknown sessions and rejects hostile or invalid ids before observation', async () => {
    let calls = 0; let getterReads = 0; const observe = () => { calls += 1; return tuple(); };
    const accessor = { ...session }; Object.defineProperty(accessor, 'id', { enumerable: true, get() { getterReads += 1; return session.id; } });
    const sessions = [null, undefined, {}, { ...session, authChannel: 'native' }, Object.assign(Object.create(null), session), new Proxy(session, {}), accessor, { ...session, then() {} }];
    for (const value of sessions) assert.equal(adapter.getAttachmentCurrentness('attachment.synthetic.1', value, observe).status, 401);
    for (const id of [undefined, '', ' attachment.synthetic.1', 'attachment.synthetic.1 ', 'x'.repeat(257), new Proxy({}, {})]) {
        const response = adapter.getAttachmentCurrentness(id, session, observe);
        assert.equal(response.status, 400); assert.deepEqual(await body(response), { error: 'Invalid attachment id' });
    }
    assert.equal(calls, 0); assert.equal(getterReads, 0);
});

test('observes once, exposes only the exact tuple, and maps null to sanitized 404', async () => {
    let calls = 0;
    const success = adapter.getAttachmentCurrentness('attachment.synthetic.1', session, (id) => { calls += 1; assert.equal(id, 'attachment.synthetic.1'); return tuple(); });
    assert.equal(success.status, 200); assert.deepEqual(await body(success), { currentness: { sourceRef: ref, revision: 1, freshnessEpoch: 2 } }); assert.equal(calls, 1);
    const missing = adapter.getAttachmentCurrentness('attachment.synthetic.1', session, () => null);
    assert.equal(missing.status, 404); assert.deepEqual(await body(missing), { error: 'Not found' });
    assert.equal(adapter.getAttachmentCurrentness('missing.synthetic', session).status, 404);
});

test('fails closed for hostile observer results and errors without leaking rows or error text', async () => {
    let reads = 0;
    const accessor = Object.create(null); Object.defineProperty(accessor, 'sourceRef', { enumerable: true, get() { reads += 1; return ref; } }); Object.defineProperties(accessor, { revision: { value: 1, enumerable: true }, freshnessEpoch: { value: 1, enumerable: true } });
    const cases = [undefined, {}, Object.assign(Object.create(null), { sourceRef: ref, revision: 1, freshnessEpoch: 1, extra: true }), accessor, new Proxy(tuple(), {}), Object.assign(Object.create({}), { sourceRef: ref, revision: 1, freshnessEpoch: 1 }), Promise.resolve(tuple())];
    for (const result of cases) {
        const response = adapter.getAttachmentCurrentness('attachment.synthetic.1', session, () => result);
        assert.equal(response.status, 503); assert.deepEqual(await body(response), { error: 'Attachment currentness unavailable' });
    }
    const error = adapter.getAttachmentCurrentness('attachment.synthetic.1', session, () => { throw new Error('SELECT patient.synthetic secret'); });
    assert.equal(error.status, 503); assert.doesNotMatch(JSON.stringify(await body(error)), /secret|patient/iu); assert.equal(reads, 0);
});

test('keeps validation and serialization deterministic after ambient poison', async () => {
    const original = { prototype: Object.getPrototypeOf, ownKeys: Reflect.ownKeys, toJSON: Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') };
    try {
        Object.getPrototypeOf = (() => { throw new Error('poison'); }) as typeof Object.getPrototypeOf;
        Reflect.ownKeys = (() => { throw new Error('poison'); }) as typeof Reflect.ownKeys;
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value: () => ({ leaked: true }) });
        const response = adapter.getAttachmentCurrentness('attachment.synthetic.1', session, () => tuple());
        assert.equal(response.status, 200); assert.deepEqual(await body(response), { currentness: { sourceRef: ref, revision: 1, freshnessEpoch: 2 } });
    } finally {
        Object.getPrototypeOf = original.prototype; Reflect.ownKeys = original.ownKeys;
        if (original.toJSON) Object.defineProperty(Object.prototype, 'toJSON', original.toJSON); else delete (Object.prototype as { toJSON?: unknown }).toJSON;
    }
});

test('route composes the session gate and exports only GET and PUT', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/attachments/[id]/content/route.ts'), 'utf8');
    assert.match(source, /export async function GET\(/u); assert.match(source, /export async function PUT\(/u);
    assert.doesNotMatch(source, /export (?!async function (?:GET|PUT)\b)/u);
    assert.doesNotMatch(source, /request\.json|ocr|provider|apply|dbServer/iu);
});
