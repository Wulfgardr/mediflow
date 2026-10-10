/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { ServerSession } from './security/server-session.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-w0b-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath); migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close(); process.env.MEDIFLOW_DATA_DIR = dataDir;
(await import('./db-server.ts')).openDbServer();

const route = await import('../app/api/attachments/[id]/route.ts');
const owners = await import('./security/server-session-projection-owner-production.ts');
const authorityModule = await import('./domain/documents/attachment-extraction-source-authority.ts');
const webFixtureModule = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const { issueSyntheticWebSession, retireSyntheticWebSession } = webFixtureModule;
const REF = 'b'.repeat(64); const PATIENT = 'patient.synthetic.w0b'; const OTHER = 'patient.synthetic.other';
const ATTACHMENT = 'attachment.synthetic.w0b'; const AMBULATORY = 'ambulatory.synthetic.w0b';
const auth = { id: 'session.synthetic', userId: 'user.synthetic', username: ['synthetic', 'auth'].join('.'), role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER };
const finalSessions: ServerSession[] = [];
let sessionSequence = 0;

function finalSession(userId: string, username: string): ServerSession {
    const session = issueSyntheticWebSession({ id: userId, username, role: 'clinician' },
        `attachment-metadata-${sessionSequence += 1}`);
    finalSessions.push(session);
    return session;
}

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
function observed() {
    const row = snapshot() as Record<string, unknown> | undefined;
    return { patientId: PATIENT, expected: { sourceRef: row?.document_source_ref ?? REF,
        revision: row?.document_revision ?? 1, freshnessEpoch: row?.document_freshness_epoch ?? 1 } };
}
async function invoke(method: 'PUT' | 'DELETE', body?: unknown, id = ATTACHMENT, session: unknown = auth, raw = false) {
    if (!raw) body = { ...observed(), ...(body as object) };
    const original = serverAuth.requireSession; serverAuth.requireSession = async () => session;
    try { return route[method](request(method, body), { params: Promise.resolve({ id }) }); }
    finally { serverAuth.requireSession = original; }
}
test.afterEach(() => {
    while (finalSessions.length > 0) retireSyntheticWebSession(finalSessions.pop()!);
});
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('authenticated metadata mutations advance the host tuple exactly once, with one winner for concurrent client preconditions', async () => {
    reset(); const beforeAudit = atomicSnapshot().audit.length;
    const first = await invoke('PUT', { summarySnapshot: 'old' });
    assert.equal(first.status, 200); assert.deepEqual(snapshot(), { patient_id: PATIENT, summary_snapshot: 'old', parse_evidence_artifact_snapshot: null,
        ocr_queue_state: 'pending', document_source_ref: REF, document_revision: 2, document_freshness_epoch: 2 });
    const audit = atomicSnapshot().audit;
    assert.equal(audit.length, beforeAudit + 1);
    const event = audit.at(-1)!;
    assert.equal(event.event_type, 'attachment.updated');
    assert.equal(event.actor_ref, auth.userId);
    assert.equal(event.source_surface, 'web');
    assert.equal(event.subject_ref, ATTACHMENT);
    assert.deepEqual(JSON.parse(event.redacted_metadata as string),
        { changedFields: ['summarySnapshot'], resourceVersion: 2, flags: ['auth:session'] });
    const changed = await invoke('PUT', { summarySnapshot: 'new' }); assert.equal(changed.status, 200);
    const responses = await Promise.all([invoke('PUT', { summarySnapshot: 'next' }), invoke('PUT', { parseEvidenceArtifactSnapshot: 'evidence' })]);
    assert.deepEqual(responses.map((response) => response.status), [200, 409]);
    assert.deepEqual(snapshot(), { patient_id: PATIENT, summary_snapshot: 'next', parse_evidence_artifact_snapshot: null,
        ocr_queue_state: 'pending', document_source_ref: REF, document_revision: 4, document_freshness_epoch: 4 });
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
    reset(); const selectedOther = finalSession('user.synthetic.other', ['synthetic', 'other'].join('.'));
    owners.serverSessionProjectionOwnerRegistry.acquire(selectedOther).issueSelection({ expectedEpoch: 0, patientId: OTHER, ambulatoryId: AMBULATORY });
    const wrong = authorityModule.createAttachmentExtractionSourceAuthority(selectedOther);
    assert.equal(wrong.issue({ attachmentId: ATTACHMENT }), null); wrong.dispose(); assert.ok(snapshot());

    const selected = finalSession('user.synthetic.w0b', ['synthetic', 'w0b'].join('.'));
    owners.serverSessionProjectionOwnerRegistry.acquire(selected).issueSelection({ expectedEpoch: 0, patientId: PATIENT, ambulatoryId: AMBULATORY });
    const authority = authorityModule.createAttachmentExtractionSourceAuthority(selected); const locator = authority.issue({ attachmentId: ATTACHMENT }); assert.ok(locator);
    const begun = authority.consume(locator); assert.equal(begun.status, 'begun'); if (begun.status !== 'begun') return;
    assert.equal((await invoke('DELETE')).status, 200); assert.equal(snapshot(), undefined);
    assert.equal(authority.finalize(begun.operation).status, 'denied'); authority.dispose();
    assert.equal((await invoke('DELETE')).status, 404);
});


function atomicSnapshot() {
    const sql = new Database(dbPath);
    try { return {
        attachments: sql.prepare('SELECT * FROM attachments ORDER BY id').all(),
        audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Array<Record<string, unknown>>,
    }; } finally { sql.close(); }
}

test('required metadata audit FAIL and IGNORE roll back the nested currentness transaction', async () => {
    for (const fault of ["FAIL, 'synthetic update audit fault'", 'IGNORE']) {
        reset();
        const before = atomicSnapshot();
        const sql = new Database(dbPath);
        try {
            sql.exec(`CREATE TRIGGER synthetic_update_audit_fault BEFORE INSERT ON audit_events
                BEGIN SELECT RAISE(${fault}); END`);
            const response = await invoke('PUT', { summarySnapshot: 'synthetic updated summary' });
            assert.deepEqual(atomicSnapshot(), before, 'data, currentness and events must roll back together');
            assert.equal(response.status, 500);
        } finally {
            sql.exec('DROP TRIGGER IF EXISTS synthetic_update_audit_fault');
            sql.close();
        }
    }
});


test('metadata null clears only the supplied field and audits only its allowlisted name', async () => {
    reset();
    const sql = new Database(dbPath);
    try { sql.prepare('UPDATE attachments SET parse_evidence_artifact_snapshot = ? WHERE id = ?').run('synthetic preserved evidence', ATTACHMENT); }
    finally { sql.close(); }
    const response = await invoke('PUT', { summarySnapshot: null });
    assert.equal(response.status, 200);
    const row = snapshot() as Record<string, unknown>;
    assert.equal(row.summary_snapshot, null);
    assert.equal(row.parse_evidence_artifact_snapshot, 'synthetic preserved evidence');
    assert.equal(row.document_revision, 2);
    assert.deepEqual(JSON.parse(atomicSnapshot().audit.at(-1)!.redacted_metadata as string),
        { changedFields: ['summarySnapshot'], resourceVersion: 2, flags: ['auth:session'] });
});

test('metadata JSON is bounded at 4 MiB and rejects malformed or invalid shapes before effects', async () => {
    reset();
    const original = serverAuth.requireSession;
    serverAuth.requireSession = async () => auth;
    const send = (body: string, headers: HeadersInit = {}) => route.PUT(new Request(`http://localhost/api/attachments/${ATTACHMENT}`, {
        method: 'PUT', body, headers,
    }), { params: Promise.resolve({ id: ATTACHMENT }) });
    try {
        for (const body of ['{', 'null', '[]', 'true', '{"summarySnapshot":7}']) {
            const before = atomicSnapshot();
            assert.equal((await send(body)).status, 400);
            assert.deepEqual(atomicSnapshot(), before);
        }
        const maximum = 4 * 1024 * 1024;
        const json = JSON.stringify({ ...observed(), summarySnapshot: null });
        const atLimit = json + ' '.repeat(maximum - Buffer.byteLength(json));
        assert.equal((await send(atLimit)).status, 200);
        for (const headers of [{}, { 'content-length': '1' }, { 'content-length': String(maximum + 1) }] as HeadersInit[]) {
            const before = atomicSnapshot();
            assert.equal((await send(atLimit + ' ', headers)).status, 413);
            assert.deepEqual(atomicSnapshot(), before);
        }
    } finally { serverAuth.requireSession = original; }
});


test('client preconditions are required before any metadata or delete effect', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
        reset(); const before = atomicSnapshot();
        assert.equal((await invoke(method, method === 'PUT' ? { summarySnapshot: 'changed' } : {}, ATTACHMENT, auth, true)).status, 400);
        assert.deepEqual(atomicSnapshot(), before);
    }
});


test('wrong parent, stale and replay preconditions cannot mutate data or audit', async () => {
    reset(); const initial = observed();
    for (const method of ['PUT', 'DELETE'] as const) {
        for (const [condition, status] of [
            [{ ...initial, patientId: OTHER }, 404],
            [{ ...initial, expected: { ...initial.expected, revision: 2 } }, 409],
            [{ ...initial, expected: { ...initial.expected, extra: true } }, 400],
            [{ ...initial, expected: { ...initial.expected, freshnessEpoch: 0 } }, 400],
        ] as const) {
            const before = atomicSnapshot();
            assert.equal((await invoke(method, { ...condition, summarySnapshot: 'new' })).status, status);
            assert.deepEqual(atomicSnapshot(), before);
        }
    }
    assert.equal((await invoke('PUT', { ...initial, summarySnapshot: 'new', ignoredRootField: true })).status, 200);
    const committed = atomicSnapshot();
    for (const method of ['PUT', 'DELETE'] as const) {
        assert.equal((await invoke(method, { ...initial, summarySnapshot: 'replay' })).status, 409);
        assert.deepEqual(atomicSnapshot(), committed);
    }
    const current = observed();
    assert.equal((await invoke('DELETE', current)).status, 200);
    const deleted = atomicSnapshot();
    assert.equal((await invoke('DELETE', current)).status, 404);
    assert.deepEqual(atomicSnapshot(), deleted);
    reset();
    const sql = new Database(dbPath);
    try { sql.prepare('UPDATE attachments SET document_source_ref = ? WHERE id = ?').run('c'.repeat(64), ATTACHMENT); }
    finally { sql.close(); }
    const recreated = atomicSnapshot();
    assert.equal((await invoke('DELETE', initial)).status, 409);
    assert.deepEqual(atomicSnapshot(), recreated);
});

test('matching client snapshot preserves tombstoned-parent admission and OCR transition', async () => {
    reset(); const sql = new Database(dbPath);
    try { sql.prepare('UPDATE patients SET deleted_at = 1 WHERE id = ?').run(PATIENT); } finally { sql.close(); }
    assert.equal((await invoke('PUT', { ocrQueueState: 'processing', summarySnapshot: '' })).status, 200);
    const row = snapshot() as Record<string, unknown>;
    assert.equal(row.ocr_queue_state, 'processing'); assert.equal(row.summary_snapshot, null);
    assert.equal((await invoke('DELETE')).status, 200);
});


test('content replacement invalidates earlier metadata and delete snapshots', async () => {
    reset(); const earlier = observed();
    const { putAttachmentContent } = await import('./attachment-content-cas-route.ts');
    const replaced = await putAttachmentContent(new Request(`http://localhost/api/attachments/${ATTACHMENT}/content`, {
        method: 'PUT', body: JSON.stringify({ expected: earlier.expected, replacement: 'ENC:c3ludGhldGlj:cmVwbGFjZW1lbnQ=' }),
    }), ATTACHMENT, auth as ServerSession);
    assert.equal(replaced.status, 200);
    const committed = atomicSnapshot();
    for (const method of ['PUT', 'DELETE'] as const) {
        assert.equal((await invoke(method, { ...earlier, summarySnapshot: 'stale' })).status, 409);
        assert.deepEqual(atomicSnapshot(), committed);
    }
});
