/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd(); const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-w0c-')); const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath); migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort())
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close(); process.env.MEDIFLOW_DATA_DIR = dataDir;
const route = await import('../app/api/attachments/[id]/ocr-replay/route.ts');
const post = route.POST as (...args: unknown[]) => Promise<Response>;
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const ATTACHMENT = 'attachment.synthetic.w0c'; const PATIENT = 'patient.synthetic.w0c'; const REF = 'c'.repeat(64);
const session = { id: 'session.synthetic', userId: 'user.synthetic', username: ['synthetic', 'w0c'].join('.'), role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER };

function reset() { const db = new Database(dbPath); try {
    db.exec('DELETE FROM attachments; DELETE FROM patients;');
    db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)').run(PATIENT, 'Ada', 'Synthetic', 'SYNTHETIC00000000');
    db.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, data, ocr_queue_state, document_source_ref,
        document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`).run(
        ATTACHMENT, PATIENT, 'synthetic.pdf', 'application/pdf', 1, 'synthetic.pdf', 'synthetic', 'pending', REF,
    );
} finally { db.close(); } }
function snapshot() { const db = new Database(dbPath); try { return db.prepare('SELECT * FROM attachments WHERE id = ?').get(ATTACHMENT); } finally { db.close(); } }
async function invoke(request: Request, id: string, auth: unknown) {
    const original = serverAuth.requireSession; serverAuth.requireSession = async () => auth;
    try { return post(request, { params: Promise.resolve({ id }) }); } finally { serverAuth.requireSession = original; }
}
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('preserves the session gate and returns one sanitized authenticated retirement contract', async () => {
    reset(); const before = snapshot();
    const request = new Request(`http://localhost/api/attachments/${ATTACHMENT}/ocr-replay?patientId=patient.other`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ocrText: 'synthetic OCR', documentSha256: 'd'.repeat(64) }),
    });
    const unauthorized = await invoke(request.clone(), ATTACHMENT, null);
    assert.equal(unauthorized.status, 401); assert.deepEqual(await unauthorized.json(), { error: 'Unauthorized' }); assert.deepEqual(snapshot(), before);
    for (const id of [ATTACHMENT, 'attachment.synthetic.other', 'missing.synthetic']) {
        const response = await invoke(request.clone(), id, session);
        assert.equal(response.status, 410); assert.deepEqual(await response.json(), { error: 'OCR replay endpoint retired', code: 'OCR_REPLAY_RETIRED' });
        assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(snapshot(), before);
    }
});

test('does not observe hostile request, body, query, or params and performs no retry or fallback', async () => {
    reset(); const before = snapshot(); let reads = 0;
    const hostileRequest = new Proxy({}, { get() { reads += 1; throw new Error('synthetic request trap'); } }) as Request;
    const hostileParams = new Proxy({}, { get() { reads += 1; throw new Error('synthetic params trap'); } }) as Promise<{ id: string }>;
    const original = serverAuth.requireSession; let authCalls = 0;
    try {
        serverAuth.requireSession = async () => { authCalls += 1; return null; };
        const unauthorized = await post(hostileRequest, { params: hostileParams }); assert.equal(unauthorized.status, 401);
        serverAuth.requireSession = async () => { authCalls += 1; return session; };
        const response = await post(hostileRequest, { params: hostileParams });
        assert.equal(response.status, 410); assert.deepEqual(await response.json(), { error: 'OCR replay endpoint retired', code: 'OCR_REPLAY_RETIRED' });
    } finally { serverAuth.requireSession = original; }
    assert.equal(authCalls, 2); assert.equal(reads, 0); assert.deepEqual(snapshot(), before);
});

test('route source contains only the authenticated deny boundary', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/attachments/[id]/ocr-replay/route.ts'), 'utf8');
    assert.match(source, /requireSession\(\)/u); assert.match(source, /status:\s*410/u); assert.match(source, /OCR_REPLAY_RETIRED/u);
    assert.doesNotMatch(source, /dbServer|attachments|document-ocr|attachmentOcrReplaySchema|request\.json|await params|fetch\(|provider|fallback|console\.|\.update\(|\.insert\(|\.delete\(/iu);
});
