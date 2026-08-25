/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
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
function worker(): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts/run-strip-types.mjs'), path.join(dataDir, 'worker.mjs')], { cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', (part) => { output += String(part); }); child.stderr.on('data', (part) => { output += String(part); });
        child.once('error', reject); child.once('close', () => { child.stdout.destroy(); child.stderr.destroy(); resolve(output.trim()); });
    });
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
