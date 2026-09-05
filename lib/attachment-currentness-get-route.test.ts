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
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;
const requireCurrent = createRequire(import.meta.url);
const adapter = requireCurrent('./attachment-currentness-get-route') as typeof import('./attachment-currentness-get-route');
const ref = 'a'.repeat(64);
const session = { id: 'session.synthetic', userId: 'user.synthetic', username: ref.slice(0, 8), role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 2 } as const;
const invoke = adapter.getAttachmentCurrentness as (...args: unknown[]) => Response;

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }
function reset() {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients;');
        db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.1', 'Ada', 'Synthetic', 'SYNTHETIC00000000')").run();
        db.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('attachment.synthetic.1', 'patient.synthetic.1', 'synthetic.pdf', 'application/pdf', 1, 'attachments/synthetic.pdf', 'synthetic', ref, 1, 2);
    } finally { db.close(); }
}
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('gates unknown sessions and rejects hostile or invalid ids before observation', async () => {
    let calls = 0; let getterReads = 0; const hostile = () => { calls += 1; return Promise.reject(new Error('synthetic rejected observer')); };
    const accessor = { ...session }; Object.defineProperty(accessor, 'id', { enumerable: true, get() { getterReads += 1; return session.id; } });
    const sessions = [null, undefined, {}, { ...session, authChannel: 'native' }, Object.assign(Object.create(null), session), new Proxy(session, {}), accessor, { ...session, then() {} }];
    for (const value of sessions) assert.equal(invoke('attachment.synthetic.1', value, hostile).status, 401);
    for (const id of [undefined, '', ' attachment.synthetic.1', 'attachment.synthetic.1 ', 'x'.repeat(257), new Proxy({}, {})]) {
        const response = invoke(id, session, hostile);
        assert.equal(response.status, 400); assert.deepEqual(await body(response), { error: 'Invalid attachment id' });
    }
    assert.equal(calls, 0); assert.equal(getterReads, 0);
});

test('denies fully and partially non-enumerable sessions before observation', async () => {
    let calls = 0;
    const fullyHidden = Object.defineProperties({}, Object.fromEntries(Object.entries(session).map(([key, value]) => [key, { value, enumerable: false }])));
    const partiallyHidden = { ...session }; Object.defineProperty(partiallyHidden, 'id', { value: session.id, enumerable: false });
    for (const value of [fullyHidden, partiallyHidden]) {
        const response = invoke('attachment.synthetic.1', value, () => { calls += 1; return Promise.reject(new Error('synthetic rejected observer')); });
        assert.equal(response.status, 401); assert.deepEqual(await body(response), { error: 'Unauthorized' });
    }
    assert.equal(calls, 0);
});

test('reads only seeded production metadata and maps a missing attachment to sanitized 404', async () => {
    reset();
    const success = adapter.getAttachmentCurrentness('attachment.synthetic.1', session);
    assert.equal(success.status, 200); assert.deepEqual(await body(success), { currentness: { sourceRef: ref, revision: 1, freshnessEpoch: 2 } });
    assert.equal(adapter.getAttachmentCurrentness('missing.synthetic', session).status, 404);
});

test('ignores a hostile third argument without queued or rejected work', async () => {
    reset(); let calls = 0; let queued = false; let unhandled = false;
    const onUnhandled = () => { unhandled = true; };
    process.once('unhandledRejection', onUnhandled);
    try {
        const response = invoke('attachment.synthetic.1', session, () => { calls += 1; queueMicrotask(() => { queued = true; }); return Promise.reject(new Error('synthetic rejected observer')); });
        assert.equal(response.status, 200); assert.deepEqual(await body(response), { currentness: { sourceRef: ref, revision: 1, freshnessEpoch: 2 } });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
    } finally { process.removeListener('unhandledRejection', onUnhandled); }
    assert.equal(calls, 0); assert.equal(queued, false); assert.equal(unhandled, false);
});

test('keeps validation and serialization deterministic after ambient poison', async () => {
    reset();
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    try {
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value: () => ({ leaked: true }) });
        const response = adapter.getAttachmentCurrentness('attachment.synthetic.1', session);
        assert.equal(response.status, 200); assert.deepEqual(await body(response), { currentness: { sourceRef: ref, revision: 1, freshnessEpoch: 2 } });
    } finally {
        if (original) Object.defineProperty(Object.prototype, 'toJSON', original); else delete (Object.prototype as { toJSON?: unknown }).toJSON;
    }
});

test('route composes the session gate and exports only GET and PUT', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/attachments/[id]/content/route.ts'), 'utf8');
    assert.match(source, /export async function GET\(/u); assert.match(source, /export async function PUT\(/u);
    assert.doesNotMatch(source, /export (?!async function (?:GET|PUT)\b)/u);
    assert.doesNotMatch(source, /request\.json|ocr|provider|apply|dbServer/iu);
});
