import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';

for (const mode of ['before-commit', 'after-commit']) test(`process killed ${mode}: durable receipt, no partial record, no duplicate after restart`, () => {
    const data = mkdtempSync(path.join(tmpdir(), 'mediflow-patient-create-crash-')), scope = randomUUID();
    const run = (args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(path.resolve('scripts/register-strip-types-loader.mjs')).href, 'lib/patient-document-create-process.fixture.ts', ...args], {
        cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' }, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
    });
    const killed = run([mode, scope]);
    assert.match(killed.signal ?? killed.stderr, /SIGKILL/u);
    const frame = killed.stdout.split('\n').find(line => line.startsWith('{"commandId"')); assert(frame, killed.stderr);
    const { commandId } = JSON.parse(frame) as { commandId: string };
    const recovered = run(['receipt', scope, commandId]);
    assert.equal(recovered.status, 0, recovered.stderr);
    const resultFrame = recovered.stdout.split('\n').find(line => line.startsWith('{"result"')); assert(resultFrame, recovered.stdout);
    const result = JSON.parse(resultFrame);
    assert.deepEqual(result.result, { outcome: mode === 'before-commit' ? 'unknown' : 'applied' });
    assert.deepEqual(result.before, result.after);
    const db = new Database(path.join(data, 'medical.db'), { readonly: true });
    try {
        for (const table of ['patients', 'attachments', 'patients_to_ambulatories']) {
            assert.equal((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n, mode === 'before-commit' ? 0 : 1);
        }
    } finally { db.close(); }
});

test('native PIN denial killed before terminal durability: new process retires then creates one patient on the same client', () => {
    const data = mkdtempSync(path.join(tmpdir(), 'mediflow-native-denial-crash-')), scope = randomUUID();
    const run = (args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(path.resolve('scripts/register-strip-types-loader.mjs')).href, 'lib/native-patient-document-crash.fixture.ts', ...args], {
        cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' }, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
    });
    const killed = run(['crash', scope]);
    assert.equal(killed.signal, 'SIGKILL', killed.stderr);
    const frame = killed.stdout.split('\n').find(line => line.startsWith('{"commandId"')); assert(frame, killed.stderr);
    const { commandId, before } = JSON.parse(frame);
    assert.deepEqual(before, [0, 0, 0]);
    const recovered = run(['receipt', scope, commandId]);
    assert.equal(recovered.status, 0, recovered.stderr);
    const resultFrame = recovered.stdout.split('\n').find(line => line.startsWith('{"receipt"')); assert(resultFrame, recovered.stdout);
    const result = JSON.parse(resultFrame);
    assert.deepEqual(result.receipt, { outcome: 'unknown' });
    assert.deepEqual(result.revoked, { outcome: 'retired' });
    assert.deepEqual(result.again, { outcome: 'retired' });
    assert.equal(result.executeDenied, true);
    assert.deepEqual(result.before, [0, 0, 0]);
    assert.deepEqual(result.afterRetirement, [0, 0, 0]);
    assert.deepEqual(result.after, [1, 1, 1]);
    assert.equal(result.created.outcome, 'applied');
    const db = new Database(path.join(data, 'medical.db'), { readonly: true });
    try {
        assert.equal((db.prepare('SELECT event_type FROM audit_events WHERE event_id=?').get(commandId) as { event_type: string }).event_type, 'patient.create.retired');
        assert.equal((db.prepare('SELECT count(*) n FROM patients').get() as { n: number }).n, 1);
    } finally { db.close(); }
});
