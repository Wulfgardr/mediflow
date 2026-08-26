/* @Codex */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-o2b1-'));
const dbPath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(dbPath);
migrationDb.pragma('foreign_keys = OFF');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;
const requireCurrent = createRequire(import.meta.url);
const route = requireCurrent('../app/api/attachments/[id]/content/route') as typeof import('../app/api/attachments/[id]/content/route');

const ref = 'a'.repeat(64);
const sealed = 'ENC:c3ludGhldGlj:cmVwbGFjZW1lbnQ=';
const syntheticUsername = 'synthetic';
const session = { id: 'session.synthetic', userId: 'user.synthetic', username: syntheticUsername, role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER } as const;
const expected = (revision = 1, freshnessEpoch = 1) => ({ sourceRef: ref, revision, freshnessEpoch });

function reset(values: { revision?: number; freshnessEpoch?: number; sourceRef?: string; data?: string } = {}) {
    const db = new Database(dbPath); db.pragma('foreign_keys = ON');
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients;');
        db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.1', 'Ada', 'Synthetic', 'SYNTHETIC00000000')").run();
        db.prepare('INSERT INTO attachments (id, patient_id, name, type, size, path, data, document_source_ref, document_revision, document_freshness_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run('attachment.synthetic.1', 'patient.synthetic.1', 'synthetic.pdf', 'application/pdf', 1, 'attachments/synthetic.pdf', values.data ?? 'old', values.sourceRef ?? ref, values.revision ?? 1, values.freshnessEpoch ?? 1);
    } finally { db.close(); }
}

function snapshot() {
    const db = new Database(dbPath);
    try { return db.prepare('SELECT patient_id, data, document_source_ref, document_revision, document_freshness_epoch FROM attachments').get(); }
    finally { db.close(); }
}

function request(payload: unknown, headers: HeadersInit = {}) {
    return new Request('http://localhost/api/attachments/attachment.synthetic.1/content', {
        method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
    });
}

async function invoke(payload: unknown, id = 'attachment.synthetic.1', authenticated = true, headers: HeadersInit = {}) {
    return route.putAttachmentContent(request(payload, headers), id, authenticated ? session : null);
}

async function json(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

function routeWorker(workerPath = path.join(dataDir, 'route-worker.mjs')): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts/run-strip-types.mjs'), workerPath], {
            cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (part) => { output += String(part); });
        child.stderr.on('data', (part) => { output += String(part); });
        child.once('error', reject);
        child.once('close', () => { child.stdout.destroy(); child.stderr.destroy(); resolve(output.trim()); });
    });
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('authenticated route replaces only sealed data and returns a sanitized currentness receipt', async () => {
    reset();
    const response = await invoke({ expected: expected(), replacement: sealed });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { outcome: 'replaced', currentness: { sourceRef: ref, revision: 2, freshnessEpoch: 2 } });
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: sealed, document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
});

test('denies unauthenticated, malformed, extra, plaintext, null, and injected inputs without mutation', async () => {
    const invalid = [
        { expected: expected(), replacement: null },
        { expected: expected(), replacement: '' },
        { expected: expected(), replacement: 'c3ludGhldGlj' },
        { expected: { ...expected(), patientId: 'patient.other' }, replacement: sealed },
        { expected: expected(), replacement: sealed, patientId: 'patient.other' },
        { expected: expected(), replacement: sealed, id: 'attachment.other', actor: 'admin', role: 'admin', sql: 'UPDATE', transaction: true, callback: 'x', ocrQueueState: 'ready', provider: 'x', apply: true },
    ];
    for (const payload of invalid) {
        reset(); const before = snapshot(); const response = await invoke(payload);
        assert.equal(response.status, 400); assert.deepEqual(snapshot(), before);
    }
    reset(); const before = snapshot(); const response = await invoke({ expected: expected(), replacement: sealed }, 'attachment.synthetic.1', false);
    assert.equal(response.status, 401); assert.deepEqual(snapshot(), before);
});

test('maps missing, stale, replay, and overflow without raw host leakage or a false winner', async () => {
    reset(); const missing = await invoke({ expected: expected(), replacement: sealed }, 'missing.synthetic');
    assert.equal(missing.status, 404); assert.deepEqual(await json(missing), { error: 'Not found' });
    reset(); const first = await invoke({ expected: expected(), replacement: sealed }); assert.equal(first.status, 200);
    const replay = await invoke({ expected: expected(), replacement: sealed });
    assert.equal(replay.status, 409); assert.deepEqual(await json(replay), { error: 'Attachment changed; reload and retry' });
    reset({ revision: Number.MAX_SAFE_INTEGER }); const overflowBefore = snapshot();
    const overflow = await invoke({ expected: expected(Number.MAX_SAFE_INTEGER), replacement: sealed });
    assert.equal(overflow.status, 409); assert.deepEqual(await json(overflow), { error: 'Attachment currentness cannot advance' });
    assert.deepEqual(snapshot(), overflowBefore);
});

test('enforces declared and chunked payload limits before any host write', async () => {
    const configured = process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
    process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '32';
    try {
        reset(); const before = snapshot();
        const declared = await invoke({ expected: expected(), replacement: sealed }, 'attachment.synthetic.1', true, { 'content-length': '33' });
        assert.equal(declared.status, 413); assert.deepEqual(snapshot(), before);
        const oversized = `ENC:${'A'.repeat(64)}:QQ==`;
        const chunked = await invoke({ expected: expected(), replacement: oversized });
        assert.equal(chunked.status, 413); assert.deepEqual(snapshot(), before);
    } finally {
        if (configured === undefined) delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
        else process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = configured;
    }
});

test('contains no direct database writer or metadata fallback and delegates once', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/attachments/[id]/content/route.ts'), 'utf8');
    assert.doesNotMatch(source, /dbServer|runDbServerImmediateTransaction|attachmentUpdateSchema|ocrQueueState|provider|apply/iu);
    assert.equal((source.match(/transitionAttachmentContentCurrentness\(/gu) ?? []).length, 1);
    assert.doesNotMatch(source, /error\.message|json\([^\n]*error\.code/iu);
});

test('two process-level route contenders produce one receipt and one conflict', { timeout: 30_000 }, async () => {
    reset(); const workerPath = path.join(dataDir, 'route-worker.mjs');
    fs.writeFileSync(workerPath, `const route = await import('@/app/api/attachments/[id]/content/route');\nconst operatorLabel = 'synthetic';\nconst response = await route.putAttachmentContent(new Request('http://localhost/api/attachments/attachment.synthetic.1/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected: { sourceRef: '${ref}', revision: 1, freshnessEpoch: 1 }, replacement: '${sealed}' }) }), 'attachment.synthetic.1', { id: 'session.synthetic', userId: 'user.synthetic', username: operatorLabel, role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 2 });\nconsole.log(response.status);\n`);
    try {
        assert.deepEqual((await Promise.all([routeWorker(), routeWorker()])).sort(), ['200', '409']);
        assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: sealed, document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    } finally { fs.rmSync(workerPath, { force: true }); }
});
