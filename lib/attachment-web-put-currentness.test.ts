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
const adapter = requireCurrent('./attachment-content-cas-route') as typeof import('./attachment-content-cas-route');
const attachmentSchemas = requireCurrent('./api-schemas/attachments') as typeof import('./api-schemas/attachments');
const boundedBody = requireCurrent('./bounded-request-body') as typeof import('./bounded-request-body');

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

function chunkedRequest(chunks: Uint8Array[], metrics: { delivered: number; pulls: number; cancelled: number }, headers: HeadersInit = {}) {
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            metrics.pulls += 1;
            const chunk = chunks.shift();
            if (!chunk) { controller.close(); return; }
            metrics.delivered += chunk.byteLength;
            controller.enqueue(chunk);
        },
        cancel() { metrics.cancelled += 1; },
    });
    const init = {
        method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: stream, duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    return new Request('http://localhost/api/attachments/attachment.synthetic.1/content', init);
}

async function invoke(payload: unknown, id = 'attachment.synthetic.1', authenticated = true, headers: HeadersInit = {}) {
    return adapter.putAttachmentContent(request(payload, headers), id, authenticated ? session : null);
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

test('descriptor-first request schema rejects ambient and exotic shapes without reads', () => {
    const valid = () => ({ expected: expected(), replacement: sealed });
    const rejects = (value: unknown) => assert.equal(attachmentSchemas.parseAttachmentContentCurrentnessPut(value), null);
    let getterReads = 0;
    let proxyReads = 0;
    const rootAccessor = { replacement: sealed } as Record<string, unknown>;
    Object.defineProperty(rootAccessor, 'expected', { enumerable: true, get() { getterReads += 1; return expected(); } });
    const nestedAccessor = { expected: { revision: 1, freshnessEpoch: 1 }, replacement: sealed } as { expected: Record<string, unknown>; replacement: string };
    Object.defineProperty(nestedAccessor.expected, 'sourceRef', { enumerable: true, get() { getterReads += 1; return ref; } });
    const nonEnumerable = valid(); Object.defineProperty(nonEnumerable, 'replacement', { enumerable: false, value: sealed });
    const inherited = Object.create(Object.prototype) as Record<string, unknown>; inherited.replacement = sealed;
    const customPrototype = Object.create({ expected: expected() }) as Record<string, unknown>; customPrototype.replacement = sealed;
    const nullPrototype = Object.assign(Object.create(null), valid());
    const proxy = new Proxy(valid(), { get() { proxyReads += 1; return undefined; }, ownKeys() { proxyReads += 1; return []; } });
    rejects(rootAccessor); rejects(nestedAccessor); rejects(nonEnumerable); rejects(inherited); rejects(customPrototype); rejects(nullPrototype); rejects(proxy);
    rejects({ ...valid(), then() { getterReads += 1; } });
    rejects({ ...valid(), [Symbol('synthetic')]: true });
    const toJson = valid(); Object.defineProperty(toJson, 'toJSON', { enumerable: true, get() { getterReads += 1; return () => valid(); } }); rejects(toJson);
    assert.equal(getterReads, 0); assert.equal(proxyReads, 0);

    const inheritedExpected = Object.getOwnPropertyDescriptor(Object.prototype, 'expected');
    const inheritedReplacement = Object.getOwnPropertyDescriptor(Object.prototype, 'replacement');
    const inheritedValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    const inheritedThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        Object.defineProperty(Object.prototype, 'expected', { configurable: true, get() { getterReads += 1; return expected(); } });
        rejects({ replacement: sealed });
        Object.defineProperty(Object.prototype, 'replacement', { configurable: true, get() { getterReads += 1; return sealed; } });
        rejects({ expected: expected() });
        Object.defineProperty(Object.prototype, 'value', { configurable: true, get() { getterReads += 1; return sealed; } });
        assert.deepEqual(attachmentSchemas.parseAttachmentContentCurrentnessPut(valid()), valid());
        Object.defineProperty(Object.prototype, 'then', { configurable: true, value: () => { getterReads += 1; } });
        rejects(valid());
    } finally {
        if (inheritedExpected) Object.defineProperty(Object.prototype, 'expected', inheritedExpected); else delete (Object.prototype as Record<string, unknown>).expected;
        if (inheritedReplacement) Object.defineProperty(Object.prototype, 'replacement', inheritedReplacement); else delete (Object.prototype as Record<string, unknown>).replacement;
        if (inheritedValue) Object.defineProperty(Object.prototype, 'value', inheritedValue); else delete (Object.prototype as Record<string, unknown>).value;
        if (inheritedThen) Object.defineProperty(Object.prototype, 'then', inheritedThen); else delete (Object.prototype as Record<string, unknown>).then;
    }
    const originalTest = RegExp.prototype.test;
    try {
        RegExp.prototype.test = (() => true) as typeof RegExp.prototype.test;
        rejects({ expected: { sourceRef: 'plaintext', revision: 1, freshnessEpoch: 1 }, replacement: 'plaintext' });
        assert.deepEqual(attachmentSchemas.parseAttachmentContentCurrentnessPut(valid()), valid());
    } finally { RegExp.prototype.test = originalTest; }
    assert.equal(getterReads, 0);
});

test('authenticated route replaces only sealed data and returns a sanitized currentness receipt', async () => {
    reset();
    const response = await invoke({ expected: expected(), replacement: sealed });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { outcome: 'replaced', currentness: { sourceRef: ref, revision: 2, freshnessEpoch: 2 } });
    assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: sealed, document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
});

test('post-import regex poisoning cannot admit plaintext through the route', async () => {
    reset(); const before = snapshot(); const originalTest = RegExp.prototype.test;
    try {
        RegExp.prototype.test = (() => true) as typeof RegExp.prototype.test;
        const rejected = await invoke({ expected: expected(), replacement: 'plaintext' });
        assert.equal(rejected.status, 400); assert.deepEqual(snapshot(), before);
        const accepted = await invoke({ expected: expected(), replacement: sealed });
        assert.equal(accepted.status, 200);
    } finally { RegExp.prototype.test = originalTest; }
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

test('bounded reader cancels before unbounded JSON allocation and rejects duplicate keys', async () => {
    const configured = process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
    process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '32';
    try {
        reset(); const before = snapshot();
        const declaredMetrics = { delivered: 0, pulls: 0, cancelled: 0 };
        const declared = await adapter.putAttachmentContent(chunkedRequest([new Uint8Array(8)], declaredMetrics, { 'content-length': '33' }), 'attachment.synthetic.1', session);
        assert.equal(declared.status, 413); assert.ok(declaredMetrics.pulls <= 1); assert.equal(declaredMetrics.cancelled, 1); assert.deepEqual(snapshot(), before);

        const chunkMetrics = { delivered: 0, pulls: 0, cancelled: 0 };
        const chunks = Array.from({ length: 8 }, () => new Uint8Array(8));
        const chunked = await adapter.putAttachmentContent(chunkedRequest(chunks, chunkMetrics), 'attachment.synthetic.1', session);
        assert.equal(chunked.status, 413); assert.ok(chunkMetrics.delivered <= 40); assert.equal(chunkMetrics.cancelled, 1); assert.deepEqual(snapshot(), before);

        const hostileMetrics = { delivered: 0, pulls: 0, cancelled: 0 };
        const hostile = await adapter.putAttachmentContent(chunkedRequest([new Uint8Array(4096)], hostileMetrics), 'attachment.synthetic.1', session);
        assert.equal(hostile.status, 413); assert.equal(hostileMetrics.pulls, 1); assert.equal(hostileMetrics.cancelled, 1); assert.deepEqual(snapshot(), before);

        const malformed = await boundedBody.readBoundedJsonBody(chunkedRequest([new Uint8Array([0xff])], { delivered: 0, pulls: 0, cancelled: 0 }), 32);
        assert.deepEqual(malformed, { ok: false, status: 400 });
        const failedStream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('synthetic stream failure')); } });
        const failed = await adapter.putAttachmentContent(new Request('http://localhost/api/attachments/attachment.synthetic.1/content', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: failedStream, duplex: 'half',
        } as RequestInit & { duplex: 'half' }), 'attachment.synthetic.1', session);
        assert.equal(failed.status, 400); assert.deepEqual(snapshot(), before);
        process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = '1024';
        const duplicate = await adapter.putAttachmentContent(new Request('http://localhost/api/attachments/attachment.synthetic.1/content', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: `{"expected":${JSON.stringify(expected())},"expected":${JSON.stringify(expected())},"replacement":"${sealed}"}`,
        }), 'attachment.synthetic.1', session);
        assert.equal(duplicate.status, 400); assert.deepEqual(snapshot(), before);
    } finally {
        if (configured === undefined) delete process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES;
        else process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES = configured;
    }
});

test('route exports only the allowed GET and PUT symbols and adapter owns the one CAS delegation', () => {
    const source = fs.readFileSync(path.join(root, 'app/api/attachments/[id]/content/route.ts'), 'utf8');
    const adapterSource = fs.readFileSync(path.join(root, 'lib/attachment-content-cas-route.ts'), 'utf8');
    assert.match(source, /export async function GET\(/u);
    assert.match(source, /export async function PUT\(/u);
    assert.doesNotMatch(source, /export (?!async function (?:GET|PUT)\b)/u);
    assert.doesNotMatch(source, /dbServer|runDbServerImmediateTransaction|attachmentUpdateSchema|ocrQueueState|provider|apply|request\.json/iu);
    assert.equal((adapterSource.match(/transitionAttachmentContentCurrentness\(/gu) ?? []).length, 1);
    assert.doesNotMatch(adapterSource, /error\.message|json\([^\n]*error\.code/iu);
});

test('two process-level route contenders produce one receipt and one conflict', { timeout: 30_000 }, async () => {
    reset(); const workerPath = path.join(dataDir, 'route-worker.mjs');
    fs.writeFileSync(workerPath, `const adapter = await import('@/lib/attachment-content-cas-route');\nconst operatorLabel = 'synthetic';\nconst response = await adapter.putAttachmentContent(new Request('http://localhost/api/attachments/attachment.synthetic.1/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected: { sourceRef: '${ref}', revision: 1, freshnessEpoch: 1 }, replacement: '${sealed}' }) }), 'attachment.synthetic.1', { id: 'session.synthetic', userId: 'user.synthetic', username: operatorLabel, role: 'admin', authChannel: 'web', createdAt: 1, expiresAt: 2 });\nconsole.log(response.status);\n`);
    try {
        assert.deepEqual((await Promise.all([routeWorker(), routeWorker()])).sort(), ['200', '409']);
        assert.deepEqual(snapshot(), { patient_id: 'patient.synthetic.1', data: sealed, document_source_ref: ref, document_revision: 2, document_freshness_epoch: 2 });
    } finally { fs.rmSync(workerPath, { force: true }); }
});
