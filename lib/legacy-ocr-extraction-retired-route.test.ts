/* @Codex */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { NextRequest } from 'next/server';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-legacy-ocr-retirement-'));
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;
const route = await import('../app/api/ocr/extract/route.ts');
const get = route.GET as (request: NextRequest) => Promise<Response>;
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as {
    requireSessionOrLocalToken: (request: Request) => Promise<unknown>;
};

const webSession = Object.freeze({ id: 'session.synthetic.ocr-retirement', userId: 'user.synthetic.ocr-retirement', username: ['synthetic', 'ocr', 'retirement'].join('.'), role: 'clinician', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER });
const localTokenSession = Object.freeze({ id: 'local-api', userId: 'local-api', username: 'local-api', role: 'admin', authChannel: 'system', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER });
const retiredBody = Object.freeze({ error: 'OCR extraction endpoint retired', code: 'OCR_EXTRACTION_RETIRED' });

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function withAuth(value: unknown | (() => Promise<unknown>), invoke: () => Promise<Response>) {
    const original = serverAuth.requireSessionOrLocalToken;
    serverAuth.requireSessionOrLocalToken = async () => typeof value === 'function'
        ? (value as () => Promise<unknown>)()
        : value;
    try {
        return await invoke();
    } finally {
        serverAuth.requireSessionOrLocalToken = original;
    }
}

function hostileRequest(reads: { count: number }) {
    return new Proxy({}, {
        get() {
            reads.count += 1;
            throw new Error('synthetic hostile request read');
        },
    }) as unknown as NextRequest;
}

test('returns a no-store 401 before observing a hostile request when authentication fails', async () => {
    const reads = { count: 0 };

    const response = await withAuth(null, () => get(hostileRequest(reads)));

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(reads.count, 0);
});

test('returns the same retired no-store contract for web-session and local-token authentication', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error('legacy OCR provider must not be called');
    };

    try {
        for (const authenticated of [webSession, localTokenSession]) {
            const reads = { count: 0 };
            const response = await withAuth(authenticated, () => get(hostileRequest(reads)));

            assert.equal(response.status, 410);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await response.json(), retiredBody);
            assert.equal(reads.count, 0);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(fetchCalls, 0);
});

test('does not read a hostile query or body and leaves an authentication throw visible', async () => {
    const reads = { count: 0 };
    const request = hostileRequest(reads);

    await assert.rejects(
        () => withAuth(async () => { throw new Error('synthetic auth throw'); }, () => get(request)),
        /synthetic auth throw/u,
    );

    assert.equal(reads.count, 0);
});

test('keeps GET as the authenticated retirement boundary with no diagnostics or provider work', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/ocr/extract/route.ts'), 'utf8');
    const getSource = source.slice(source.indexOf('export async function GET'));

    assert.match(getSource, /const session = await requireSessionOrLocalToken\(request\);/u);
    assert.match(getSource, /status:\s*410/u);
    assert.match(getSource, /OCR_EXTRACTION_RETIRED/u);
    assert.doesNotMatch(getSource, /request\.(?:json|text|arrayBuffer|formData|body|url|nextUrl|searchParams)/u);
    assert.doesNotMatch(getSource, /\bparams\b|loadOcrRuntimeSettings|validateLocalTarget|fetch\(|dbServer|settings|provider|readiness|fs\.|execFile|extractDocumentWithAI|AIService/iu);
});
