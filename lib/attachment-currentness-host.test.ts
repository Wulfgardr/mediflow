/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import type { HostAttachmentContentMutation } from './attachment-currentness-host';

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
function rejects(action: () => unknown, code: 'input_invalid' | 'attachment_missing' | 'currentness_conflict' | 'currentness_overflow' | 'operation_invalid' | 'operation_failed' | 'reentry' | 'stored_state_invalid') {
    assert.throws(action, (error: unknown) => error instanceof host.AttachmentCurrentnessHostError && error.code === code && error.message === `Attachment currentness host rejected: ${code}`);
}
function worker(): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts/run-strip-types.mjs'), path.join(dataDir, 'worker.mjs')], { cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', (part) => { output += String(part); }); child.stderr.on('data', (part) => { output += String(part); });
        child.once('error', reject); child.once('close', () => resolve(output.trim()));
    });
}
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('mints only opaque host source refs with the initial tuple', () => {
    const first = host.createHostAttachmentCurrentness(); const second = host.createHostAttachmentCurrentness();
    assert.match(first.sourceRef, /^[0-9a-f]{64}$/u); assert.notEqual(first.sourceRef, second.sourceRef);
    assert.deepEqual({ revision: first.revision, freshnessEpoch: first.freshnessEpoch }, { revision: 1, freshnessEpoch: 1 });
});

test('atomically changes sealed data and advances the exact expected triple', () => {
    reset();
    const next = host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), (mutation) => mutation.replaceData('new'));
    assert.deepEqual(next, { sourceRef: ref, revision: 2, freshnessEpoch: 2 });
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: 'new', document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), (mutation) => mutation.replaceData('again')), 'currentness_conflict');
});

test('denies missing, malformed, stale, overflow, and caller-selected patient input without writes', () => {
    reset(); const before = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('missing.synthetic', expected(), () => undefined), 'attachment_missing');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), patientId: 'patient.other' }, () => undefined), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), revision: 0 }, () => undefined), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), sourceRef: 'A'.repeat(64) }, () => undefined), 'input_invalid');
    assert.deepEqual(snapshot(), before);
    reset({ revision: Number.MAX_SAFE_INTEGER }); const overflow = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), revision: Number.MAX_SAFE_INTEGER }, (mutation) => mutation.replaceData('new')), 'currentness_overflow');
    assert.deepEqual(snapshot(), overflow);
    reset({ freshnessEpoch: Number.MAX_SAFE_INTEGER }); const overflowEpoch = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { ...expected(), freshnessEpoch: Number.MAX_SAFE_INTEGER }, (mutation) => mutation.replaceData('new')), 'currentness_overflow');
    assert.deepEqual(snapshot(), overflowEpoch);
    reset(); const malformed = new Database(dbPath); malformed.pragma('ignore_check_constraints = ON'); malformed.prepare("UPDATE attachments SET document_source_ref = 'UPPER'").run(); malformed.close();
    const malformedBefore = snapshot(); rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => undefined), 'stored_state_invalid');
    assert.deepEqual(snapshot(), malformedBefore);
});

test('rolls back thrown, async, thenable, proxied, accessor, and reentrant host operations', () => {
    reset(); const before = snapshot(); let reads = 0;
    const accessor = Object.defineProperty({}, 'sourceRef', { enumerable: true, get() { reads += 1; return ref; } });
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', accessor, () => undefined), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => { throw new Error('synthetic secret'); }), 'operation_failed');
    let leaked: HostAttachmentContentMutation | null = null;
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), (mutation) => { leaked = mutation; return Promise.resolve(); }), 'operation_invalid');
    rejects(() => leaked!.replaceData('late'), 'operation_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => ({ then: () => undefined })), 'operation_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), new Proxy(() => undefined, {})), 'input_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => undefined)), 'reentry');
    assert.equal(reads, 0); assert.deepEqual(snapshot(), before);
});

test('requires exactly one sealed mutation and leaves the transaction reusable after every denial', () => {
    reset(); const before = snapshot();
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), () => undefined), 'operation_invalid');
    rejects(() => host.transitionAttachmentContentCurrentness('attachment.synthetic.1', expected(), (mutation) => { mutation.replaceData('one'); mutation.replaceData('two'); }), 'operation_invalid');
    assert.deepEqual(snapshot(), before);
    const db = new Database(dbPath); try { db.transaction(() => undefined).immediate(); } finally { db.close(); }
});

test('two process-level duplicate CAS attempts have one winner', { timeout: 30_000 }, async () => {
    reset();
    fs.writeFileSync(path.join(dataDir, 'worker.mjs'), `const host = await import('@/lib/attachment-currentness-host');\ntry { host.transitionAttachmentContentCurrentness('attachment.synthetic.1', { sourceRef: '${ref}', revision: 1, freshnessEpoch: 1 }, (mutation) => mutation.replaceData('winner')); console.log('winner'); } catch (error) { console.log(error instanceof host.AttachmentCurrentnessHostError ? error.code : 'unknown'); }\n`);
    assert.deepEqual((await Promise.all([worker(), worker()])).sort(), ['currentness_conflict', 'winner']);
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: 'winner', document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
});
