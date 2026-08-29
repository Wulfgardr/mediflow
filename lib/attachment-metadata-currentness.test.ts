/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-w0b-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath); migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close(); process.env.MEDIFLOW_DATA_DIR = dataDir;

const route = await import('../app/api/attachments/[id]/route.ts');
const sessions = await import('./security/server-session.ts');
const owners = await import('./security/server-session-projection-owner-production.ts');
const authorityModule = await import('./domain/documents/attachment-extraction-source-authority.ts');
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const REF = 'b'.repeat(64); const PATIENT = 'patient.synthetic.w0b'; const OTHER = 'patient.synthetic.other';
const ATTACHMENT = 'attachment.synthetic.w0b'; const AMBULATORY = 'ambulatory.synthetic.w0b';
const auth = { id: 'session.synthetic', userId: 'user.synthetic', username: ['synthetic', 'auth'].join('.'), role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER };

function reset(values: { revision?: number; epoch?: number } = {}) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories;');
        db.prepare('INSERT INTO ambulatories (id, name, type) VALUES (?, ?, ?)').run(AMBULATORY, 'Synthetic', 'test');
        for (const id of [PATIENT, OTHER]) db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)').run(id, 'Ada', 'Synthetic', `${id}00000000`.slice(0, 16));
        for (const id of [PATIENT, OTHER]) db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(id, AMBULATORY);
        db.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, data, summary_snapshot, ocr_queue_state,
            document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            ATTACHMENT, PATIENT, 'synthetic.rtf', 'application/rtf', 1, 'synthetic.rtf', Buffer.from('{\\rtf1 Synthetic}').toString('base64'),
            'old', 'pending', REF, values.revision ?? 1, values.epoch ?? 1,
        );
    } finally { db.close(); }
}
function snapshot() { const db = new Database(dbPath); try { return db.prepare(`SELECT patient_id, summary_snapshot, parse_evidence_artifact_snapshot,
    ocr_queue_state, document_source_ref, document_revision, document_freshness_epoch FROM attachments WHERE id = ?`).get(ATTACHMENT); } finally { db.close(); } }
function request(method: 'PUT' | 'DELETE', body?: unknown) { return new Request(`http://localhost/api/attachments/${ATTACHMENT}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}); }
async function invoke(method: 'PUT' | 'DELETE', body?: unknown, id = ATTACHMENT, session: unknown = auth) {
    const original = serverAuth.requireSession; serverAuth.requireSession = async () => session;
    try { return route[method](request(method, body), { params: Promise.resolve({ id }) }); }
    finally { serverAuth.requireSession = original; }
}
test.afterEach(() => sessions.clearAllSessions());
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('authenticated metadata mutations advance the host tuple exactly once, including concurrent accepted updates', async () => {
    reset(); const first = await invoke('PUT', { summarySnapshot: 'old' });
    assert.equal(first.status, 200); assert.deepEqual(snapshot(), { patient_id: PATIENT, summary_snapshot: 'old', parse_evidence_artifact_snapshot: null,
        ocr_queue_state: 'pending', document_source_ref: REF, document_revision: 2, document_freshness_epoch: 2 });
    const changed = await invoke('PUT', { summarySnapshot: 'new' }); assert.equal(changed.status, 200);
    const responses = await Promise.all([invoke('PUT', { summarySnapshot: 'next' }), invoke('PUT', { parseEvidenceArtifactSnapshot: 'evidence' })]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.deepEqual(snapshot(), { patient_id: PATIENT, summary_snapshot: 'next', parse_evidence_artifact_snapshot: 'evidence',
        ocr_queue_state: 'pending', document_source_ref: REF, document_revision: 5, document_freshness_epoch: 5 });
});

test('no-op, auth, missing, overflow, transition, stale-CAS, and storage failures change nothing', async () => {
    const cases: Array<[unknown, string, unknown, number]> = [
        [{}, ATTACHMENT, auth, 400], [{ summarySnapshot: 'x' }, ATTACHMENT, null, 401],
        [{ summarySnapshot: 'x' }, 'missing.synthetic', auth, 404], [{ ocrQueueState: 'ocr_done' }, ATTACHMENT, auth, 409],
    ];
    for (const [body, id, session, status] of cases) { reset(); const before = snapshot(); assert.equal((await invoke('PUT', body, id, session)).status, status); assert.deepEqual(snapshot(), before); }
    reset({ revision: Number.MAX_SAFE_INTEGER }); const overflow = snapshot(); assert.equal((await invoke('PUT', { summarySnapshot: 'x' })).status, 409); assert.deepEqual(snapshot(), overflow);
    reset(); const stale = snapshot(); const db = new Database(dbPath); db.exec(`CREATE TRIGGER stale_w0b BEFORE UPDATE ON attachments BEGIN DELETE FROM attachments WHERE id = OLD.id; END;`); db.close();
    assert.equal((await invoke('PUT', { summarySnapshot: 'x' })).status, 409); assert.deepEqual(snapshot(), stale);
    const cleanup = new Database(dbPath); cleanup.exec('DROP TRIGGER stale_w0b'); cleanup.close();
    reset(); const rollback = snapshot(); const failing = new Database(dbPath); failing.exec(`CREATE TRIGGER fail_w0b BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT, 'synthetic'); END;`); failing.close();
    assert.equal((await invoke('PUT', { summarySnapshot: 'x' })).status, 500); assert.deepEqual(snapshot(), rollback);
    const cleanupFailure = new Database(dbPath); cleanupFailure.exec('DROP TRIGGER fail_w0b'); cleanupFailure.close();
});

test('wrong-patient source authority stays denied and DELETE makes an in-flight finalization fail closed', async () => {
    reset(); const selectedOther = sessions.createSession({ id: 'user.synthetic.other', username: ['synthetic', 'other'].join('.'), role: 'clinician' });
    owners.serverSessionProjectionOwnerRegistry.acquire(selectedOther).issueSelection({ expectedEpoch: 0, patientId: OTHER, ambulatoryId: AMBULATORY });
    const wrong = authorityModule.createAttachmentExtractionSourceAuthority(selectedOther);
    assert.equal(wrong.issue({ attachmentId: ATTACHMENT }), null); wrong.dispose(); assert.ok(snapshot());

    const selected = sessions.createSession({ id: 'user.synthetic.w0b', username: ['synthetic', 'w0b'].join('.'), role: 'clinician' });
    owners.serverSessionProjectionOwnerRegistry.acquire(selected).issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const authority = authorityModule.createAttachmentExtractionSourceAuthority(selected); const locator = authority.issue({ attachmentId: ATTACHMENT }); assert.ok(locator);
    const begun = authority.consume(locator); assert.equal(begun.status, 'begun'); if (begun.status !== 'begun') return;
    assert.equal((await invoke('DELETE')).status, 200); assert.equal(snapshot(), undefined);
    assert.equal(authority.finalize(begun.operation).status, 'denied'); authority.dispose();
    assert.equal((await invoke('DELETE')).status, 404);
});
