import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'mediflow-writer-composition-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const before = fixture.compositionSnapshot();

test.after(() => {
    dbServer.$client.close();
    rmSync(dir, { recursive: true, force: true });
});

test('ADR 0190 reproducer: failure of the service rolls back note, therapy and success audits', async () => {
    dbServer.$client.exec("CREATE TRIGGER synthetic_service_fault BEFORE INSERT ON service_prescriptions BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SERVICE_FAILURE'); END");
    let failure: unknown;
    try {
        const pending = fixture.composeOriginalThree('original');
        await Promise.all(pending);
    } catch (error) { failure = error; }
    finally { dbServer.$client.exec('DROP TRIGGER synthetic_service_fault'); }
    assert.match(String(failure), /SYNTHETIC_SERVICE_FAILURE/);
    assert.deepEqual(fixture.compositionSnapshot(), before, 'A5: zero clinical writes and zero success audit must remain after failure of any element');
});

for (const [index, step] of fixture.compositionSteps.entries()) {
    test(`failure after ${step} rolls back every clinical row, attachment bytes and success audit`, () => {
        assert.throws(() => fixture.composeAll(`failure-${index}`, { failAfter: index }), /SYNTHETIC_ELEMENT_FAILURE/);
        assert.deepEqual(fixture.compositionSnapshot(), before);
        assert.equal(readdirSync(dir).some(file => file.endsWith('.pdf')), false);
    });
    test(`audit failure at ${step} rolls back the entire transaction`, () => {
        const offset = before.counts.audit_events + index;
        dbServer.$client.exec(`CREATE TRIGGER synthetic_audit_fault BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events) = ${offset} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_AUDIT_FAILURE'); END`);
        try { assert.throws(() => fixture.composeAll(`audit-${index}`), /SYNTHETIC_AUDIT_FAILURE/); }
        finally { dbServer.$client.exec('DROP TRIGGER synthetic_audit_fault'); }
        assert.deepEqual(fixture.compositionSnapshot(), before);
    });
    test(`revoked caller at ${step} rolls back the entire transaction`, () => {
        assert.throws(() => fixture.composeAll(`denied-${index}`, { denyAt: index }), /SYNTHETIC_COMMIT_REVOKED/);
        assert.deepEqual(fixture.compositionSnapshot(), before);
    });
}

test('a changed patient revision denies the batch without writes', () => {
    assert.throws(() => fixture.composeAll('stale', { expectedRevision: 2 }), /SYNTHETIC_REVISION_CHANGED/);
    assert.deepEqual(fixture.compositionSnapshot(), before);
});

test('two independent applicators serialize on SQLite; failed attempt can retry and a successful batch cannot duplicate', { timeout: 15_000 }, async t => {
    const children: ReturnType<typeof spawn>[] = [];
    t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill('SIGTERM'); }));
    assert.throws(() => fixture.composeAll('retry', { failAfter: 7 }), /SYNTHETIC_ELEMENT_FAILURE/);
    assert.deepEqual(fixture.compositionSnapshot(), before);
    const ready: Array<() => void> = [];
    const run = (prefix: string) => new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/clinical-writer-composition-worker.ts', dir, prefix], {
            env: { ...process.env, MEDIFLOW_DATA_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'],
        });
        children.push(child);
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            if (chunk.toString().includes('SYNTHETIC_READY')) {
                ready.push(() => child.stdin.end('apply'));
                if (ready.length === 2) ready.forEach(start => start());
            }
        });
        child.stderr.on('data', chunk => { output += chunk; });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve(output) : reject(new Error(output)));
    });
    const results = await Promise.all([run('retry'), run('competitor')]);
    assert.equal(results.filter(result => result.includes('SYNTHETIC_APPLIED')).length, 1);
    assert.equal(results.filter(result => result.includes('SYNTHETIC_REVISION_CHANGED')).length, 1);
    const committed = fixture.compositionSnapshot();
    assert.equal(committed.counts.entries, 2);
    assert.equal(committed.counts.therapies, 1);
    assert.equal(committed.counts.service_prescriptions, 1);
    assert.equal(committed.counts.attachments, 1);
    assert.equal(committed.counts.observations, 1);
    assert.equal(committed.counts.audit_events - before.counts.audit_events, 8);
    assert.equal(committed.patient?.version, 3);
    assert.equal(committed.patient?.diagnoses, 'ENC:synthetic:diagnoses');
    assert.equal(committed.patient?.exemptions, 'ENC:synthetic:exemptions');
    assert.deepEqual(dbServer.$client.prepare('SELECT recorded_by FROM entries').all(), [{ recorded_by: 'Medico Sintetico' }, { recorded_by: 'Medico Sintetico' }]);
    assert.deepEqual(dbServer.$client.prepare('SELECT data FROM attachments').get(), { data: 'ENC:YQ==:Yg==' });
    assert.throws(() => fixture.composeAll('retry'), /SYNTHETIC_REVISION_CHANGED/);
    assert.deepEqual(fixture.compositionSnapshot(), committed);
});
