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

test('exports only the fixed capture, projection-ingest, owner-seal, and owner-private handoff boundaries with no production composition', () => {
    const source = readFileSync(TARGET, 'utf8');
    assert.equal((source.match(/^export /gmu) ?? []).length, 4);
    assert.match(source, /export async function captureDocumentSynthesisAuthenticatedAttachment/u);
    assert.match(source, /export async function ingestDocumentSynthesisAuthenticatedAttachmentProjection/u);
    assert.match(source, /export async function sealDocumentSynthesisAuthenticatedAttachmentSourceSet/u);
    assert.match(source, /export async function handoffDocumentSynthesisAuthenticatedAttachmentSourceSet/u);
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
const contexts = [primary, primary, primary, primary, primary, primary, other, other, other, other, poisoned];
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
const { captureDocumentSynthesisAuthenticatedAttachment: capture, ingestDocumentSynthesisAuthenticatedAttachmentProjection: ingest, sealDocumentSynthesisAuthenticatedAttachmentSourceSet: seal, handoffDocumentSynthesisAuthenticatedAttachmentSourceSet: handoff } = require(target);
const first = await capture({ attachmentId: 'attachment.synthetic.capture' });
assert.equal(first.status, 'available');
assert.equal(first.code, null);
assert.match(first.captureHandle, /^dsc_[0-9a-f]{32}$/u);
assert.deepEqual({ reviewOnly: first.reviewOnly, writesPerformed: first.writesPerformed, applyPolicy: first.applyPolicy }, { reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
const projection = await ingest(first.captureHandle, { sourceKind: 'native_text', sourceText: 'Synthetic projection' });
assert.deepEqual({ ...projection, projectionHandle: typeof projection.projectionHandle === 'string' ? 'opaque' : projection.projectionHandle }, { status: 'available', code: null, projectionHandle: 'opaque', reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.match(projection.projectionHandle, /^dsp_[0-9a-f]{32}$/u); assert.equal(Object.getPrototypeOf(projection), null); assert.equal(Object.isFrozen(projection), true);
const sourceSetSeal = await seal(projection.projectionHandle);
assert.deepEqual({ ...sourceSetSeal, sourceSetSealHandle: typeof sourceSetSeal.sourceSetSealHandle === 'string' ? 'opaque' : sourceSetSeal.sourceSetSealHandle }, { status: 'available', code: null, sourceSetSealHandle: 'opaque' });
assert.match(sourceSetSeal.sourceSetSealHandle, /^dss_[0-9a-f]{32}$/u); assert.equal(Object.getPrototypeOf(sourceSetSeal), null); assert.equal(Object.isFrozen(sourceSetSeal), true);
const handoffResult = await handoff(sourceSetSeal.sourceSetSealHandle);
assert.deepEqual({ ...handoffResult, handoffHandle: typeof handoffResult.handoffHandle === 'string' ? 'opaque' : handoffResult.handoffHandle }, { status: 'available', code: null, handoffHandle: 'opaque', reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.match(handoffResult.handoffHandle, /^dsh_[0-9a-f]{32}$/u); assert.equal(Object.getPrototypeOf(handoffResult), null); assert.equal(Object.isFrozen(handoffResult), true);
assert.deepEqual(Object.keys(handoffResult), ['status', 'code', 'handoffHandle', 'reviewOnly', 'writesPerformed', 'applyPolicy']);
assert.equal('providerProjection' in handoffResult, false); assert.equal('sourceSetDigestSha256' in handoffResult, false);
assert.deepEqual({ ...await handoff(sourceSetSeal.sourceSetSealHandle) }, { status: 'denied', code: 'unavailable', handoffHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.deepEqual({ ...await seal(projection.projectionHandle) }, { status: 'denied', code: 'unavailable', sourceSetSealHandle: null });
assert.deepEqual({ ...await seal(sourceSetSeal.sourceSetSealHandle) }, { status: 'denied', code: 'input_invalid', sourceSetSealHandle: null });
assert.deepEqual({ ...await ingest(first.captureHandle, { sourceKind: 'native_text', sourceText: 'replay' }) }, { status: 'denied', code: 'unavailable', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.deepEqual({ ...await ingest(sourceSetSeal.sourceSetSealHandle, { sourceKind: 'native_text', sourceText: 'wrong stage' }) }, { status: 'denied', code: 'input_invalid', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
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

test('post-callback fence failures leave no projection publication or fixed-entropy collision', () => {
    for (const mode of ['clock', 'currentness', 'expiry', 'channel']) {
        const directory = mkdtempSync(path.join(os.tmpdir(), `mediflow-i1b2-fence-${mode}-`));
        const mockAuth = path.join(directory, 'mock-server-auth.cjs'); const mockCrypto = path.join(directory, 'mock-crypto.mjs'); const worker = path.join(directory, 'fence.cjs');
        try {
            writeFileSync(mockCrypto, 'export const randomBytes = () => new Uint8Array(16).fill(90);\n');
            writeFileSync(mockAuth, `
const { createSession, deleteSession } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session.ts'))});
const { createServerSessionProjectionOwnerRegistry, ServerSessionProjectionOwnerError } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session-projection-owner.ts'))});
const session = createSession({ id: 'user.synthetic.fence', username: ['fen', 'ce'].join(''), role: 'admin' }, 'web');
const base = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze({ ...pair }) }).acquire(session);
base.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.fence', ambulatoryId: 'ambulatory.synthetic.fence' });
let failNext = false; const code = { clock: 'selection_unavailable', currentness: 'stale_selection', expiry: 'lease_expired', channel: 'session_unavailable' }[process.env.FENCE_MODE];
const owner = Object.freeze({
  snapshotSelectionEpoch: (value) => base.snapshotSelectionEpoch(value),
  snapshotReviewContextEpoch: (value) => base.snapshotReviewContextEpoch(value),
  mintDocumentSynthesisAttachmentCapturePort: (value) => base.mintDocumentSynthesisAttachmentCapturePort(value),
  withLeaseCriticalSection(value, callback) {
    const inject = failNext; failNext = false;
    return base.withLeaseCriticalSection(value, (selection) => { const result = callback(selection); if (inject) throw new ServerSessionProjectionOwnerError(code); return result; });
  },
});
let calls = 0;
module.exports = { acquireAuthenticatedWebSessionProjectionOwnerContext: async () => { calls += 1; failNext = calls === 2; return Object.freeze({ session, owner }); } };
`);
            writeFileSync(worker, `
(async () => {
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const { registerHooks } = require('node:module'); const { pathToFileURL } = require('node:url');
const target = ${JSON.stringify(TARGET)}; const mockAuth = ${JSON.stringify(mockAuth)}; const mockCrypto = ${JSON.stringify(mockCrypto)};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === pathToFileURL(target).href && specifier === '../../security/server-auth') return { shortCircuit: true, url: pathToFileURL(mockAuth).href, format: 'commonjs' };
  if (context.parentURL === pathToFileURL(target).href && specifier === 'node:crypto') return { shortCircuit: true, url: pathToFileURL(mockCrypto).href, format: 'module' };
  return nextResolve(specifier, context);
} });
const Database = require(${JSON.stringify(path.join(ROOT, 'node_modules/better-sqlite3'))}); fs.mkdirSync(process.env.MEDIFLOW_DATA_DIR, { recursive: true });
const bootstrap = new Database(path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db'));
for (const file of fs.readdirSync(${JSON.stringify(path.join(ROOT, 'drizzle'))}).filter((name) => name.endsWith('.sql')).sort()) bootstrap.exec(fs.readFileSync(path.join(${JSON.stringify(path.join(ROOT, 'drizzle'))}, file), 'utf8').replace(/^-->\\s+statement-breakpoint\\s*$/gmu, ''));
bootstrap.close(); const { dbServer } = require(${JSON.stringify(path.join(ROOT, 'lib/db-server.ts'))}); const { sql } = require(${JSON.stringify(path.join(ROOT, 'node_modules/drizzle-orm'))});
dbServer.run(sql.raw("INSERT INTO ambulatories (id, name, type) VALUES ('ambulatory.synthetic.fence', 'Synthetic fence', 'test')"));
dbServer.run(sql.raw("INSERT INTO patients (id, first_name, last_name, tax_code) VALUES ('patient.synthetic.fence', 'Fence', 'Synthetic', 'FENCESYNTHETIC01')"));
dbServer.run(sql.raw("INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES ('patient.synthetic.fence', 'ambulatory.synthetic.fence')"));
dbServer.run(sql.raw("INSERT INTO attachments (id, patient_id, name, type, size, path, document_source_ref, document_revision, document_freshness_epoch) VALUES ('attachment.synthetic.fence.1', 'patient.synthetic.fence', 'one.pdf', 'application/pdf', 1, 'one.pdf', '${'c'.repeat(64)}', 1, 1), ('attachment.synthetic.fence.2', 'patient.synthetic.fence', 'two.pdf', 'application/pdf', 1, 'two.pdf', '${'d'.repeat(64)}', 1, 1)"));
const { captureDocumentSynthesisAuthenticatedAttachment: capture, ingestDocumentSynthesisAuthenticatedAttachmentProjection: ingest } = require(target);
const first = await capture({ attachmentId: 'attachment.synthetic.fence.1' }); assert.equal(first.status, 'available');
const failed = await ingest(first.captureHandle, { sourceKind: 'native_text', sourceText: 'Failed synthetic projection' });
assert.deepEqual({ ...failed }, { status: 'denied', code: 'unavailable', projectionHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
const fresh = await capture({ attachmentId: 'attachment.synthetic.fence.2' }); assert.equal(fresh.captureHandle, first.captureHandle);
const success = await ingest(fresh.captureHandle, { sourceKind: 'native_text', sourceText: 'Fresh synthetic projection' });
assert.equal(success.status, 'available'); assert.equal(success.projectionHandle, 'dsp_' + '5a'.repeat(16));
assert.deepEqual({ ...await ingest(fresh.captureHandle, { sourceKind: 'native_text', sourceText: 'replay' }) }, { ...failed });
assert.equal((await ingest(success.projectionHandle, { sourceKind: 'native_text', sourceText: 'cross-stage' })).code, 'input_invalid');
})().catch((error) => { console.error(error); process.exitCode = 1; });
`);
            const result: ReturnType<typeof spawnSync> = spawnSync(NODE_24, ['--experimental-strip-types', '--import', RUNNER, worker], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FENCE_MODE: mode, MEDIFLOW_DATA_DIR: path.join(directory, 'data') } });
            assert.equal(result.status, 0, `${mode}\n${result.stdout}\n${result.stderr}`);
        } finally { rmSync(directory, { recursive: true, force: true }); }
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
    const ingest = source.slice(source.indexOf('export async function ingestDocumentSynthesisAuthenticatedAttachmentProjection'),
        source.indexOf('export async function sealDocumentSynthesisAuthenticatedAttachmentSourceSet'));

    assert.ok(ingest.indexOf('mapDelete(broker.records, captureHandle)') < ingest.indexOf('projectionCandidate(projection)'));
    assert.equal((ingest.match(/DbGet\(/gu) ?? []).length, 1);
    assert.ok(ingest.indexOf('projectionCandidate(projection)') < ingest.indexOf('DbGet('));
    assert.ok(ingest.indexOf('DbGet(') < ingest.indexOf('attachmentCapturePort.begin'));
    assert.ok(ingest.indexOf('const projectionHandle = mint(Entropy(16), \'dsp_\')') > ingest.indexOf('attachmentCapturePort.retain'));
    assert.equal((ingest.match(/broker\.publish\(/gu) ?? []).length, 1);
    assert.ok(ingest.indexOf('const prepared = context.owner.withLeaseCriticalSection') < ingest.indexOf('broker.publish(prepared.projectionHandle, prepared.state)'));
    assert.doesNotMatch(ingest.slice(ingest.indexOf('const prepared = context.owner.withLeaseCriticalSection')), /\bawait\b/u);
});

test('final DB disposal or reselection burns dss without an incomplete dsh publication', () => {
    for (const mode of ['dispose', 'reselect']) {
        const directory = mkdtempSync(path.join(os.tmpdir(), `mediflow-a3a2-${mode}-`));
        const mockAuth = path.join(directory, 'mock-server-auth.cjs'); const mockDb = path.join(directory, 'mock-db.cjs'); const worker = path.join(directory, 'handoff.cjs');
        try {
            writeFileSync(mockAuth, `
const { createSession } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session.ts'))});
const { createServerSessionProjectionOwnerRegistry } = require(${JSON.stringify(path.join(ROOT, 'lib/security/server-session-projection-owner.ts'))});
const session = createSession({ id: 'user.synthetic.a3a2', username: ['a3', 'a2'].join(''), role: 'admin' }, 'web');
const owner = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze({ ...pair }) }).acquire(session);
owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.a3a2', ambulatoryId: 'ambulatory.synthetic.a3a2' });
module.exports = { acquireAuthenticatedWebSessionProjectionOwnerContext: async () => Object.freeze({ session, owner }), trigger() {
  if (${JSON.stringify(mode)} === 'dispose') deleteSession(session.id);
  else owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.a3a2', ambulatoryId: 'ambulatory.synthetic.a3a2' });
} };
`);
            writeFileSync(mockDb, `
const auth = require(${JSON.stringify(mockAuth)}); let reads = 0;
module.exports = { dbServer: { get() { reads += 1; if (reads === 3) auth.trigger(); return { documentSourceRef: '${'e'.repeat(64)}', documentRevision: 1, documentFreshnessEpoch: 1 }; } }, reads: () => reads };
`);
            writeFileSync(worker, `
(async () => {
const assert = require('node:assert/strict'); const { registerHooks } = require('node:module'); const { pathToFileURL } = require('node:url');
const target = ${JSON.stringify(TARGET)}; const auth = ${JSON.stringify(mockAuth)}; const db = ${JSON.stringify(mockDb)};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === pathToFileURL(target).href && specifier === '../../security/server-auth') return { shortCircuit: true, url: pathToFileURL(auth).href, format: 'commonjs' };
  if (context.parentURL === pathToFileURL(target).href && specifier === '../../db-server') return { shortCircuit: true, url: pathToFileURL(db).href, format: 'commonjs' };
  return nextResolve(specifier, context);
} });
const { captureDocumentSynthesisAuthenticatedAttachment: capture, ingestDocumentSynthesisAuthenticatedAttachmentProjection: ingest, sealDocumentSynthesisAuthenticatedAttachmentSourceSet: seal, handoffDocumentSynthesisAuthenticatedAttachmentSourceSet: handoff } = require(target);
const captured = await capture({ attachmentId: 'attachment.synthetic.a3a2' }); assert.equal(captured.status, 'available');
const projected = await ingest(captured.captureHandle, { sourceKind: 'native_text', sourceText: 'Synthetic projection' }); assert.equal(projected.status, 'available');
const sealed = await seal(projected.projectionHandle); assert.equal(sealed.status, 'available');
const denied = await handoff(sealed.sourceSetSealHandle); assert.deepEqual({ ...denied }, { status: 'denied', code: 'unavailable', handoffHandle: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
assert.deepEqual({ ...await handoff(sealed.sourceSetSealHandle) }, { ...denied });
await Promise.resolve();
})().catch((error) => { console.error(error); process.exitCode = 1; });
`);
            const child: ReturnType<typeof spawnSync> = spawnSync(NODE_24, ['--experimental-strip-types', '--import', RUNNER, worker], { cwd: ROOT, encoding: 'utf8' });
            assert.equal(child.status, 0, `${mode}\n${child.stdout}\n${child.stderr}`);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    }
});

test('burns dss before the A3a2 handoff, rereads host currentness immediately before one final consume, and exposes no evidence', () => {
    const source = readFileSync(TARGET, 'utf8');
    const handoff = source.slice(source.indexOf('export async function handoffDocumentSynthesisAuthenticatedAttachmentSourceSet'));

    assert.ok(handoff.indexOf('mapDelete(broker.records, sourceSetSealHandle)') < handoff.indexOf('mintDocumentSynthesisSealedEvidencePort'));
    assert.equal((handoff.match(/DbGet\(/gu) ?? []).length, 1);
    assert.equal((handoff.match(/\.consume\(/gu) ?? []).length, 2);
    assert.ok(handoff.indexOf('const latest = currentness(DbGet(') < handoff.indexOf('const evidence = prepared.port.consume(prepared.grant)'));
    assert.ok(handoff.indexOf('const evidence = prepared.port.consume(prepared.grant)') < handoff.indexOf("const state = sealed<HandoffRecord>({ selected: true, scope: 'document_synthesis_attachment_handoff', evidence })"));
    assert.ok(handoff.indexOf("const state = sealed<HandoffRecord>({ selected: true, scope: 'document_synthesis_attachment_handoff', evidence })") < handoff.indexOf('broker.publish(prepared.handoffHandle, state)'));
    assert.doesNotMatch(handoff, /evidence: null|mapDelete\(broker\.records, prepared\.handoffHandle\)/u);
    assert.doesNotMatch(handoff, /providerProjection|sourceSetDigestSha256|raw32/u);
});
