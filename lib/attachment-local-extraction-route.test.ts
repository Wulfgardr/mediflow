/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-anydoc-a0-route-'));
const migrationDb = new Database(path.join(dataDir, 'medical.db'));
migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const route = await import('../app/api/attachments/[id]/local-extraction/route.ts');
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const composition = requireCurrent('./domain/documents/anydoc-current-source-composition') as {
    composeAnyDocCurrentSourceExtraction: (session: unknown, selector: unknown) => Promise<unknown>;
};
const post = route.POST as (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

const ATTACHMENT = 'attachment.synthetic.anydoc.a0';
const session = Object.freeze({ id: 'session.synthetic.anydoc.a0', userId: 'user.synthetic.anydoc.a0', username: ['clinician', 'synthetic', 'anydoc', 'a0'].join('.'), role: 'clinician', authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER });
const RTF = Buffer.from('{\\rtf1\\ansi Synthetic AnyDoc route note.}', 'utf8');

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function extractedResult() {
    const markdown = 'Synthetic AnyDoc route note.';
    const sourceSha256 = sha256(RTF);
    const markdownSha256 = sha256(markdown);
    return {
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: { attachmentId: ATTACHMENT, sourceSha256, byteLength: RTF.byteLength },
        receipt: {
            receiptId: sha256(['mediflow.anydoc_local_extraction.v1', 'extracted', ATTACHMENT, sourceSha256, RTF.byteLength, markdownSha256].join('|')),
            parser: 'anydoc-local', outcome: 'extracted', sourceSha256, sourceByteLength: RTF.byteLength, markdownSha256, markdownByteLength: Buffer.byteLength(markdown),
        },
        review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
    } as const;
}

function reviewRequiredResult() {
    const bytes = Buffer.from([0, 1, 2, 3]);
    const sourceSha256 = sha256(bytes);
    return {
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: { attachmentId: ATTACHMENT, sourceSha256, byteLength: bytes.byteLength },
        receipt: {
            receiptId: sha256(['mediflow.anydoc_local_extraction.v1', 'review_required:unsupported_format', ATTACHMENT, sourceSha256, bytes.byteLength, 'no-markdown'].join('|')),
            parser: 'anydoc-local', outcome: 'review_required:unsupported_format', sourceSha256, sourceByteLength: bytes.byteLength, markdownByteLength: 0,
        },
        review: 'required', writes: 0, apply: 'none', status: 'review_required', reason: 'unsupported_local_extraction', detail: 'unsupported_format', markdown: '', candidateUse: 'blocked',
    } as const;
}

const deniedResult = Object.freeze({
    schemaVersion: 'mediflow.anydoc_local_extraction.v1', status: 'denied', reason: 'invalid_contract_input', field: 'source',
    review: 'required', writes: 0, apply: 'none', candidateUse: 'blocked',
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function invoke(request: Request, params: Promise<{ id: string }>, authenticated: unknown, result: unknown) {
    const originalAuth = serverAuth.requireSession;
    const originalCompose = composition.composeAnyDocCurrentSourceExtraction;
    serverAuth.requireSession = async () => authenticated;
    composition.composeAnyDocCurrentSourceExtraction = async () => result;
    try {
        return await post(request, { params });
    } finally {
        serverAuth.requireSession = originalAuth;
        composition.composeAnyDocCurrentSourceExtraction = originalCompose;
    }
}

test('authenticates before observing request or params and returns a sanitized no-store 401', async () => {
    let reads = 0;
    const request = new Proxy({}, { get() { reads += 1; throw new Error('synthetic request trap'); } }) as Request;
    const params = new Proxy({}, { get() { reads += 1; throw new Error('synthetic params trap'); } }) as Promise<{ id: string }>;

    const response = await invoke(request, params, null, extractedResult());

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(reads, 0);
});

test('returns the exact strict extracted result while ignoring body, query, and caller authority fields', async () => {
    const expected = extractedResult();
    const request = new Request(`http://localhost/api/attachments/${ATTACHMENT}/local-extraction?patientId=patient.other&provider=hosted&path=/raw&digest=${'f'.repeat(64)}&currentness=99`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patientId: 'patient.other', provider: 'hosted', path: '/raw', digest: 'f'.repeat(64), currentness: 99 }),
    });

    const response = await invoke(request, Promise.resolve({ id: ATTACHMENT }), session, expected);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), expected);
});

test('returns the exact strict finalized review-required result', async () => {
    const expected = reviewRequiredResult();
    const response = await invoke(new Request(`http://localhost/api/attachments/${ATTACHMENT}/local-extraction`, { method: 'POST' }), Promise.resolve({ id: ATTACHMENT }), session, expected);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), expected);
});

test('returns a generic no-store 409 without evidence when current host evidence is unavailable', async () => {
    const response = await invoke(new Request('http://localhost/api/attachments/missing.synthetic/local-extraction', { method: 'POST' }), Promise.resolve({ id: 'missing.synthetic' }), session, deniedResult);

    assert.equal(response.status, 409);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Local extraction unavailable' });
});
