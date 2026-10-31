import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { publishScheduledBackup, serializeBackupArtifact } from './run-scheduled-backup.mjs';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseSource(relativePath, scriptKind) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function findVariableInitializer(sourceFile, variableName) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializer;
}

function extractStringArray(sourceFile, variableName) {
  const initializer = unwrapExpression(findVariableInitializer(sourceFile, variableName));
  assert(initializer && ts.isArrayLiteralExpression(initializer), `${variableName} must be a string array`);
  return initializer.elements.map((element) => {
    assert(ts.isStringLiteral(element), `${variableName} must contain only string literals`);
    return element.text;
  });
}

function extractObjectKeys(sourceFile, variableName) {
  const initializer = unwrapExpression(findVariableInitializer(sourceFile, variableName));
  assert(initializer && ts.isObjectLiteralExpression(initializer), `${variableName} must be an object literal`);
  return initializer.properties.map((property) => {
    assert(ts.isPropertyAssignment(property), `${variableName} entries must be property assignments`);
    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    throw new Error(`${variableName} contains a non-literal key`);
  });
}

function unwrapExpression(expression) {
  if (!expression) return undefined;
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

test('scheduled backup table map covers the canonical backup artifact collections', () => {
  const artifactSource = parseSource('lib/backup-artifact.ts', ts.ScriptKind.TS);
  const runnerSource = parseSource('scripts/run-scheduled-backup.mjs', ts.ScriptKind.JS);

  const canonicalCollections = extractStringArray(artifactSource, 'BACKUP_COLLECTIONS');
  const runnerTableKeys = extractObjectKeys(runnerSource, 'BACKUP_TABLES');

  assert.deepEqual([...runnerTableKeys].sort(), [...canonicalCollections].sort());
  assert.ok(canonicalCollections.includes('headlessSoapEntryCommits'));
  assert.ok(runnerTableKeys.includes('headlessSoapEntryCommits'));
});

test('scheduled backup runner does not keep a duplicated local collection list', () => {
  const runnerSource = parseSource('scripts/run-scheduled-backup.mjs', ts.ScriptKind.JS);
  const localCollections = findVariableInitializer(runnerSource, 'BACKUP_COLLECTIONS');

  assert.equal(localCollections, undefined);
});

test('scheduled backup canonicalizes SOAP attestations before artifact checksum', async () => {
  const firstRef = `hsar_${'f'.repeat(32)}`;
  const secondRef = `hsar_${'a'.repeat(32)}`;
  const first = {
    attestationRef: firstRef, actorRef: 'actor-z', schemaVersion: 'mediflow.headless-soap-active-role-attestation.v1',
    role: 'physician', operationId: 'mediflow.clinical_diary.append_soap.v1', policyVersion: 'clinician_confirmed_single_use.v1',
    status: 'inactive', attestationVersion: 1, issuerRef: null, expiresAt: null, activatedAt: null,
    revocationGeneration: 0, revokedAt: null, createdAt: '2026-08-26T08:00:00.000Z', updatedAt: '2026-08-26T08:00:00.000Z',
  };
  const second = { ...first, attestationRef: secondRef, actorRef: 'actor-a' };
  const createdAt = new Date('2026-08-26T08:00:00.000Z');
  const forward = JSON.parse(await serializeBackupArtifact({ headlessSoapActiveRoleAttestations: [first, second] }, createdAt));
  const reverse = JSON.parse(await serializeBackupArtifact({ headlessSoapActiveRoleAttestations: [second, first] }, createdAt));

  assert.deepEqual(forward.payload.headlessSoapActiveRoleAttestations.map((row) => row.attestationRef), [secondRef, firstRef]);
  assert.deepEqual(forward.payload, reverse.payload);
  assert.equal(forward.manifest.checksum, reverse.manifest.checksum);
});

test('scheduled serialization keeps general audit omitted when its source did not supply it', async () => {
  const later = { idempotencyKey: `hsai_${'f'.repeat(64)}`, auditSnapshot: '{"eventId":"synthetic-later"}' };
  const earlier = { idempotencyKey: `hsai_${'a'.repeat(64)}`, auditSnapshot: '{"eventId":"synthetic-earlier"}' };
  const createdAt = new Date('2026-08-26T08:00:00.000Z');
  const forward = JSON.parse(await serializeBackupArtifact({ headlessSoapEntryCommits: [later, earlier] }, createdAt));
  const reverse = JSON.parse(await serializeBackupArtifact({ headlessSoapEntryCommits: [earlier, later] }, createdAt));

  assert.deepEqual(forward.payload.headlessSoapEntryCommits.map((row) => row.idempotencyKey), [earlier.idempotencyKey, later.idempotencyKey]);
  assert.equal('auditEvents' in forward.payload, false);
  assert.deepEqual(forward.payload, reverse.payload);
  assert.equal(forward.manifest.checksum, reverse.manifest.checksum);
});

test('scheduled serialization preserves audit seconds, NULL, text and deterministic event order', async () => {
  const empty = Object.fromEntries(extractStringArray(parseSource('lib/backup-artifact.ts', ts.ScriptKind.TS), 'BACKUP_COLLECTIONS')
    .map(collection => [collection, []]));
  const first = { eventId: 'synthetic-a', schemaVersion: 2, eventType: 'patient.updated', occurredAt: 1783000001,
    outcome: 'success', actorType: 'user', actorRef: 'synthetic-actor', subjectType: 'patient', subjectRef: null,
    sourceSurface: 'api', requestId: '', redactedMetadata: '{ "counts": {} }', createdAt: null };
  const second = { ...first, eventId: 'synthetic-b', subjectRef: '', requestId: null, redactedMetadata: '', createdAt: 0 };
  const date = new Date('2026-10-04T00:00:00Z');
  const forward = JSON.parse(await serializeBackupArtifact({ ...empty, auditEvents: [second, first] }, date));
  const reverse = JSON.parse(await serializeBackupArtifact({ ...empty, auditEvents: [first, second] }, date));
  assert.deepEqual(forward.payload.auditEvents, [first, second]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.manifest.recordCounts.auditEvents, 2);
  assert.ok(forward.manifest.collections.includes('auditEvents'));
  await assert.rejects(() => serializeBackupArtifact({ ...empty, auditEvents: [first, first] }), /duplicate/i);
  await assert.rejects(() => serializeBackupArtifact({ ...empty, auditEvents: [],
    headlessSoapEntryCommits: [{ auditSnapshot: JSON.stringify(first) }] }), /missing or divergent/);
});


test('scheduled publication never overwrites an artifact or an interrupted temporary file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-g3-publish-'));
  try {
    const target = path.join(directory, 'mediflow-backup-v1-synthetic.mediflow');
    fs.writeFileSync(target, 'previous artifact');
    assert.throws(() => publishScheduledBackup(target, 'new artifact'), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous artifact');
    assert.equal(fs.existsSync(`${target}.tmp`), false);
    fs.writeFileSync(`${target}.tmp`, 'interrupted artifact');
    assert.throws(() => publishScheduledBackup(target, 'third artifact'), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(`${target}.tmp`, 'utf8'), 'interrupted artifact');
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous artifact');
    const fresh = path.join(directory, 'fresh.mediflow');
    publishScheduledBackup(fresh, 'complete synthetic artifact');
    assert.equal(fs.readFileSync(fresh, 'utf8'), 'complete synthetic artifact');
    assert.equal(fs.existsSync(`${fresh}.tmp`), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const phase of ['before-link', 'after-link', 'after-unlink']) {
  test(`real process kill ${phase} preserves earlier artifacts and a complete recovery copy`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-g3-crash-'));
    const target = path.join(directory, 'new.mediflow');
    const previous = path.join(directory, 'previous.mediflow');
    fs.writeFileSync(previous, 'previous backup');
    const artifact = 'synthetic backup content '.repeat(9000);
    const moduleUrl = pathToFileURL(path.join(ROOT_DIR, 'scripts/run-scheduled-backup.mjs')).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      const { publishScheduledBackup } = await import(${JSON.stringify(moduleUrl)});
      const wait = () => { process.stdout.write('READY\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
      const link = fs.linkSync, unlink = fs.unlinkSync;
      fs.linkSync = (...args) => { if (${JSON.stringify(phase)} === 'before-link') wait(); link(...args); if (${JSON.stringify(phase)} === 'after-link') wait(); };
      fs.unlinkSync = (...args) => { unlink(...args); if (${JSON.stringify(phase)} === 'after-unlink') wait(); };
      publishScheduledBackup(${JSON.stringify(target)}, 'synthetic backup content '.repeat(9000));
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    try {
      const ready = await Promise.race([
        once(child.stdout, 'data').then(([chunk]) => chunk.toString()),
        exited.then(() => { throw new Error(`child exited before checkpoint: ${stderr}`); }),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('crash checkpoint timed out')), 10000); timer.unref(); }),
      ]);
      assert.match(ready, /READY/);
      assert.equal(child.kill('SIGKILL'), true);
      const [code, signal] = await exited;
      assert.notEqual(code, 0);
      assert.ok(signal || process.platform === 'win32');
      assert.equal(fs.readFileSync(previous, 'utf8'), 'previous backup');
      const completePath = phase === 'before-link' ? `${target}.tmp` : target;
      assert.equal(fs.readFileSync(completePath, 'utf8'), artifact);
      assert.throws(() => publishScheduledBackup(target, 'replacement'), { code: 'EEXIST' });
      assert.equal(fs.readFileSync(completePath, 'utf8'), artifact);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
