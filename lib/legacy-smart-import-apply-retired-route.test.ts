/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-smart-import-retirement-'));
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const route = await import('../app/api/patients/[id]/smart-import/route.ts');
const post = route.POST as (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const session = Object.freeze({ id: 'session.synthetic.smart-import-retirement', userId: 'user.synthetic.smart-import-retirement', username: 'synthetic.smart-import.retirement', role: 'clinician', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER });
const retired = Object.freeze({ error: 'Smart Import legacy apply endpoint retired', code: 'SMART_IMPORT_LEGACY_APPLY_RETIRED' });

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function invoke(auth: unknown, reads: { count: number }) {
    const original = serverAuth.requireSession;
    serverAuth.requireSession = async () => auth;
    const request = new Proxy({}, { get() { reads.count += 1; throw new Error('hostile request read'); } }) as Request;
    const params = new Proxy({}, { get() { reads.count += 1; throw new Error('hostile params read'); } }) as Promise<{ id: string }>;
    try {
        return await post(request, { params });
    } finally {
        serverAuth.requireSession = original;
    }
}

test('authenticates before observation and returns one no-store retirement contract', async () => {
    for (const auth of [null, session]) {
        const reads = { count: 0 };
        const response = await invoke(auth, reads);
        assert.equal(response.status, auth ? 410 : 401);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), auth ? retired : { error: 'Unauthorized' });
        assert.equal(reads.count, 0);
    }
});

test('contains no parser, persistence, apply, audit or provider work after the auth gate', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/patients/[id]/smart-import/route.ts'), 'utf8');
    assert.match(source, /const session = await requireSession\(\);/u);
    assert.match(source, /SMART_IMPORT_LEGACY_APPLY_RETIRED/u);
    assert.match(source, /status:\s*410/u);
    assert.doesNotMatch(source, /\b_?request\.(?:json|text|arrayBuffer|formData|body|url)|\b_?context\.params|await\s+_?params|dbServer|commitPatientSmartImport|safeWriteAuditEventFromRequest|therapyCreateSchema|normalizeTherapyCreateInput|AIService|fetch\(/u);
});
