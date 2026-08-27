/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(__dirname, '../../..');
const TARGET = path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authenticated-attachment-capture.ts');
const RUNNER = path.join(ROOT, 'scripts/register-strip-types-loader.mjs');

function isNode2419(candidate: string | undefined): candidate is string {
    return typeof candidate === 'string' && candidate.length > 0
        && spawnSync(candidate, ['--version'], { encoding: 'utf8' }).stdout.trim() === 'v24.19.0';
}

const NODE_24 = [process.env.MEDIFLOW_STRIP_TYPES_NODE, process.execPath, path.join(os.homedir(), '.nvm/versions/node/v24.19.0/bin/node')]
    .find(isNode2419);

if (!NODE_24) throw new Error('Document Synthesis attachment capture tests require Node 24.19.0.');

test('exports only the fixed capture and projection-ingest boundaries with no production composition', () => {
    const source = readFileSync(TARGET, 'utf8');
    assert.equal((source.match(/^export /gmu) ?? []).length, 2);
    assert.match(source, /export async function captureDocumentSynthesisAuthenticatedAttachment/u);
    assert.match(source, /export async function ingestDocumentSynthesisAuthenticatedAttachmentProjection/u);
    assert.doesNotMatch(source, /createDocumentSynthesisAuthenticatedAttachmentCapture|Sources|acquireContext:|lookup\(|entropy:|export (?:type|interface|const|class|\{)/u);
    assert.match(source, /withLeaseCriticalSection[\s\S]*?INNER JOIN patients_to_ambulatories/u);
    assert.doesNotMatch(source, /production\.ts/u);
    assert.throws(() => readFileSync(path.join(ROOT, 'lib/ai-providers/fabric/document-synthesis-authenticated-attachment-capture-production.ts')),
        { code: 'ENOENT' });
});

test('uses the fixed server boundary with an isolated database, session, and selection', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'mediflow-i1b-capture-'));
    const mockAuth = path.join(directory, 'mock-server-auth.cjs');
    const worker = path.join(directory, 'capture-boundary.cjs');
    try {
        writeFileSync(mockAuth, `
const { createSession, deleteSession } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session.ts'))});
const { createServerSessionProjectionOwnerRegistry } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session-projection-owner.ts'))});
const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze({ ...pair }) });
const makeContext = (patientId) => {
  const session = createSession({ id: 'user.synthetic.capture', username: ['cap', 'ture'].join(''), role: 'admin' }, 'web');
  const owner = registry.acquire(session);
  owner.issueSelection({ expectedEpoch: 0, patientId, ambulatoryId: 'ambulatory.synthetic.capture' });
  return Object.freeze({ session, owner });
};
const primary = makeContext('patient.synthetic.capture');
const other = makeContext('patient.synthetic.other');
const poisoned = makeContext('patient.synthetic.capture');
const contexts = [primary, primary, primary, primary, other, other, other, poisoned];
let calls = 0;
module.exports = {
  acquireAuthenticatedWebSessionProjectionOwnerContext: async () => {
    const context = contexts[calls++] ?? null;
    return context;
  },
};
`);
        writeFileSync(worker, `
(async () => {
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const target = ${JSON.stringify(TARGET)};
const mockAuth = ${JSON.stringify(mockAuth)};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '../../security/server-auth' && context.parentURL === pathToFileURL(target).href) {
    return { shortCircuit: true, url: pathToFileURL(mockAuth).href, format: 'commonjs' };
  }
  return nextResolve(specifier, context);
} });
const fs = require('node:fs');
const path = require('node:path');
const Database = require(${JSON.stringify(path.join(ROOT, 'node_modules/better-sqlite3'))});
fs.mkdirSync(process.env.MEDIFLOW_DATA_DIR, { recursive: true });
const bootstrap = new Database(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
for (const file of fs.readdirSync(${JSON.stringify(path.join(ROOT, 'drizzle'))}).filter((name) => name.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(${JSON.stringify(path.join(ROOT, 'drizzle'))}, file), 'utf8').replace(/^-->\\s+statement-breakpoint\\s*$/gmu, ''));
}
bootstrap.close();
const { dbServer } = require(${JSON.stringify(path.join(ROOT, 'lib/db-server.ts'))});
const { sql } = require(${JSON.stringify(path.join(ROOT, 'node_modules/drizzle-orm'))});
dbServer.run(sql.raw("INSERT INTO ambulatories (id, name, type) VALUES ('ambulatory.synthetic.capture', 'Synthetic capture', 'test')"));
dbServer.run(sql.raw("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.capture', 'First', 'Synthetic', 'CAPTUREFIRST00001'), ('patient.synthetic.other', 'Other', 'Synthetic', 'CAPTUREOTHER00002')"));
dbServer.run(sql.raw("INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES ('patient.synthetic.capture', 'ambulatory.synthetic.capture'), ('patient.synthetic.other', 'ambulatory.synthetic.capture')"));
dbServer.run(sql.raw("INSERT INTO attachments (id, patient_id, name, type, size, path, document_source_ref, document_revision, document_freshness_epoch) VALUES ('attachment.synthetic.capture', 'patient.synthetic.capture', 'capture.pdf', 'application/pdf', 1, 'capture.pdf', '${'a'.repeat(64)}', 7, 11), ('attachment.synthetic.other', 'patient.synthetic.other', 'other.pdf', 'application/pdf', 1, 'other.pdf', '${'b'.repeat(64)}', 5, 13)"));
const { captureDocumentSynthesisAuthenticatedAttachment: capture, ingestDocumentSynthesisAuthenticatedAttachmentProjection: ingest } = require(target);
const first = await capture({ attachmentId: 'attachment.synthetic.capture' });
assert.equal(first.status, 'available');
assert.equal(first.code, null);
assert.match(first.captureHandle, /^dsc_[0-9a-f]{32}$/u);
assert.deepEqual({ reviewOnly: first.reviewOnly, writesPerformed: first.writesPerformed, applyPolicy: first.applyPolicy }, { reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
const projection = await ingest(first.captureHandle, { sourceKind: 'native_text', sourceText: 'Synthetic projection' });
assert.deepEqual({ ...projection, projectionHandle: typeof projection.projectionHandle === 'string' ? 'opaque' : projection.projectionHandle }, { status: 'available', code: null, projectionHandle: 'opaque', reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.match(projection.projectionHandle, /^dsp_[0-9a-f]{32}$/u); assert.equal(Object.getPrototypeOf(projection), null); assert.equal(Object.isFrozen(projection), true);
assert.deepEqual({ ...await ingest(first.captureHandle, { sourceKind: 'native_text', sourceText: 'replay' }) }, { status: 'denied', code: 'unavailable', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.deepEqual({ ...await ingest(projection.projectionHandle, { sourceKind: 'native_text', sourceText: 'wrong stage' }) }, { status: 'denied', code: 'input_invalid', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
const replay = await capture({ attachmentId: 'attachment.synthetic.capture' });
assert.deepEqual({ ...replay }, { status: 'denied', code: 'unavailable', captureHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
const invalidCapture = await capture({ attachmentId: 'attachment.synthetic.other' }); assert.match(invalidCapture.captureHandle, /^dsc_[0-9a-f]{32}$/u);
let projectionTraps = 0; const hostileProjection = new Proxy({ sourceKind: 'native_text', sourceText: 'synthetic' }, { get() { projectionTraps += 1; throw new Error('trap'); }, ownKeys() { projectionTraps += 1; throw new Error('trap'); } });
assert.deepEqual({ ...await ingest(invalidCapture.captureHandle, hostileProjection) }, { status: 'denied', code: 'input_invalid', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' }); assert.equal(projectionTraps, 0);
assert.deepEqual({ ...await ingest(invalidCapture.captureHandle, { sourceKind: 'native_text', sourceText: 'replay' }) }, { status: 'denied', code: 'unavailable', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
let traps = 0;
const hostile = new Proxy({ attachmentId: 'attachment.synthetic.capture' }, { get() { traps += 1; throw new Error('trap'); }, ownKeys() { traps += 1; throw new Error('trap'); } });
const hostileResult = await capture(hostile);
assert.deepEqual({ ...hostileResult }, { status: 'denied', code: 'input_invalid', captureHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.equal(traps, 0);
const missing = await capture({ attachmentId: 'attachment.synthetic.missing' });
const wrongPatient = await capture({ attachmentId: 'attachment.synthetic.capture' });
assert.deepEqual({ ...missing }, { ...wrongPatient });
assert.deepEqual({ ...missing }, { status: 'denied', code: 'unavailable', captureHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.deepEqual({ ...await capture({ attachmentId: first.captureHandle }) }, { ...missing });
assert.deepEqual({ ...await capture({ attachmentId: 'attachment.synthetic.other' }) }, { ...missing });
const originals = { assign: Object.assign, hasOwn: Object.hasOwn, array: Array.isArray, safe: Number.isSafeInteger, map: global.Map, weakMap: global.WeakMap, entropy: crypto.randomBytes };
const poison = () => { throw new Error('post-import poison'); };
Object.assign = poison; Object.hasOwn = poison; Array.isArray = poison; Number.isSafeInteger = poison; global.Map = poison; global.WeakMap = poison; crypto.randomBytes = poison;
let poisonedResult;
try { poisonedResult = await capture({ attachmentId: 'attachment.synthetic.capture' }); } finally {
  Object.assign = originals.assign; Object.hasOwn = originals.hasOwn; Array.isArray = originals.array; Number.isSafeInteger = originals.safe; global.Map = originals.map; global.WeakMap = originals.weakMap; crypto.randomBytes = originals.entropy;
}
assert.deepEqual({ ...poisonedResult }, { ...missing });
})().catch((error) => { console.error(error); process.exitCode = 1; });
`);
        const result = spawnSync(NODE_24, ['--experimental-strip-types', '--import', RUNNER, worker], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(directory, 'data') },
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('captures every runtime intrinsic before the boundary is called', () => {
    const source = readFileSync(TARGET, 'utf8');
    for (const token of [
        'ObjectAssign = Object.assign', 'ObjectHasOwn = Object.hasOwn', 'ArrayIsArray = Array.isArray',
        'NumberIsSafeInteger = Number.isSafeInteger', 'MapConstructor = Map', 'WeakMapConstructor = WeakMap',
        'DbGet = dbServer.get.bind(dbServer)', 'Entropy = randomBytes', "'input_invalid'", "'unavailable'",
        'reviewOnly: true', "applyPolicy: 'none'", 'mintDocumentSynthesisAttachmentCapturePort', 'observeCurrentness',
        'attachmentCapturePort', 'attachmentCaptureCapability', 'resolveDocumentSynthesisHostProjection', "'dsp_'", 'mapDelete', 'retain(', 'sameCurrentness',
    ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('burns the capture before projection observation and reads currentness once in the ingest P4 turn', () => {
    const source = readFileSync(TARGET, 'utf8');
    const ingest = source.slice(source.indexOf('export async function ingestDocumentSynthesisAuthenticatedAttachmentProjection'));

    assert.ok(ingest.indexOf('mapDelete(broker.records, captureHandle)') < ingest.indexOf('projectionCandidate(projection)'));
    assert.equal((ingest.match(/DbGet\(/gu) ?? []).length, 1);
    assert.ok(ingest.indexOf('const projectionHandle = mint(Entropy(16), \'dsp_\')') > ingest.indexOf('attachmentCapturePort.retain'));
});
