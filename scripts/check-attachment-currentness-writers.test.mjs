/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSource, compareInventory, CONTRACT, inventory, policyFindings } from './check-attachment-currentness-writers.mjs';

const kinds = (file, source) => analyzeSource(file, source).map((item) => item.kind);

test('detects aliases, computed and dynamic facade calls, raw SQL, and generic restore variants', () => {
    assert.deepEqual(kinds('lib/alias.ts', 'const table = attachments; db.update(table).set({ data: x });'), ['orm-update']);
    assert.deepEqual(kinds('components/computed.tsx', "db['attachments']['delete']('synthetic');"), ['facade-delete']);
    assert.deepEqual(kinds('components/dynamic.tsx', 'const store = db.attachments; store[method](id);'), ['dynamic-method']);
    assert.deepEqual(kinds('scripts/raw.mjs', "db.prepare('DELETE FROM attachments WHERE id = ?').run(id);"), ['raw-delete-from']);
    assert.deepEqual(kinds('lib/backup-restore-executor.ts', 'runner.insert(table).values(rows).run();'), ['restore-insert']);
    assert.deepEqual(kinds('scripts/raw-template.mjs', 'db.prepare(`UPDATE attachments SET data = ?`).run(data);'), ['raw-update']);
    assert.deepEqual(kinds('scripts/raw-dynamic.mjs', "const table = 'attachments'; const query = 'INSERT INTO ' + table + ' (id) VALUES (?)'; db.prepare(query).run(id);"), ['raw-insert-into']);
});

test('fails closed on duplicate, missing, fingerprint, count, and undeclared drift', () => {
    const expected = { path: 'lib/x.ts', kind: 'orm-update', fingerprint: 'aaaaaaaaaaaaaaaa', count: 1, disposition: 'current' };
    assert.deepEqual(compareInventory([expected], [expected]), []);
    assert.ok(compareInventory([expected], [expected, expected]).some((item) => item.code === 'DUPLICATE_CONTRACT'));
    assert.ok(compareInventory([], [expected]).some((item) => item.code === 'MISSING_OR_DRIFTED_WRITER'));
    assert.ok(compareInventory([{ ...expected, fingerprint: 'bbbbbbbbbbbbbbbb' }], [expected]).some((item) => item.code === 'UNDECLARED_WRITER'));
    assert.ok(compareInventory([{ ...expected, count: 2 }], [expected]).some((item) => item.code === 'WRITER_COUNT_DRIFT'));
});

test('exact repository inventory is classified and keeps known gaps red', () => {
    const findings = compareInventory(inventory(), CONTRACT);
    assert.equal(CONTRACT.length, 26);
    assert.equal(inventory().length, 26);
    assert.deepEqual(findings.filter((item) => ['DUPLICATE_CONTRACT', 'MISSING_OR_DRIFTED_WRITER', 'WRITER_COUNT_DRIFT', 'UNDECLARED_WRITER'].includes(item.code)), []);
    assert.deepEqual([...new Set(findings.map((item) => item.code))].sort(), [
        'SYNTHETIC_SEED_CURRENTNESS_GAP',
    ]);
    assert.equal(CONTRACT.find((item) => item.path === 'lib/seeder.ts' && item.kind === 'facade-add')?.disposition, 'delegated');
    assert.deepEqual([...findings, ...policyFindings()], [
        { code: 'SYNTHETIC_SEED_CURRENTNESS_GAP', path: 'scripts/seed-performance-baseline.mjs', kind: 'raw-insert-into', fingerprint: 'd60b484518a09e8b', count: 1 },
        { code: 'PURGE_LOCATOR_REVOCATION_GAP', path: 'lib/patient-cascade.ts' },
    ]);
});
