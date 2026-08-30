/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSource, compareInventory, CONTRACT, inventory, policyFindings } from './check-attachment-currentness-writers.mjs';

const kinds = (file, source) => analyzeSource(file, source).map((item) => item.kind);
const RETIRED_OCR_REPLAY_FINGERPRINTS = new Set([
    '0ff837037f51a8f7',
    '447ea8fb738c3800',
    'b09c961d357ca147',
    'cfe926ff66787d75',
]);

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

test('keeps retired OCR replay writers undeclared after the local preview migration', () => {
    const retiredReplay = [
        'async function replay(file) {',
        "  await db.attachments.update(file.id, { ocrQueueState: 'processing' });",
        "  await db.attachments.update(file.id, { ocrQueueState: 'ocr_failed' });",
        '}',
    ].join('\n');
    const observed = analyzeSource('components/document-upload.tsx', retiredReplay);
    assert.equal(observed.length, 2);
    assert.ok(observed.every((item) => item.kind === 'facade-update'));
    const findings = compareInventory(observed, CONTRACT);
    assert.equal(findings.filter((item) => item.code === 'UNDECLARED_WRITER').length, observed.length);
});

test('keeps every retired OCR replay fingerprint absent from the live contract and inventory', () => {
    assert.deepEqual(CONTRACT.filter((item) => RETIRED_OCR_REPLAY_FINGERPRINTS.has(item.fingerprint)), []);
    assert.deepEqual(inventory().filter((item) => RETIRED_OCR_REPLAY_FINGERPRINTS.has(item.fingerprint)), []);
});

test('exact repository inventory is classified with no currentness gaps', () => {
    const findings = compareInventory(inventory(), CONTRACT);
    assert.equal(CONTRACT.length, 22);
    assert.equal(inventory().length, 22);
    assert.deepEqual(findings.filter((item) => ['DUPLICATE_CONTRACT', 'MISSING_OR_DRIFTED_WRITER', 'WRITER_COUNT_DRIFT', 'UNDECLARED_WRITER'].includes(item.code)), []);
    assert.deepEqual([...new Set(findings.map((item) => item.code))].sort(), []);
    assert.equal(CONTRACT.find((item) => item.path === 'lib/seeder.ts' && item.kind === 'facade-add')?.disposition, 'delegated');
    assert.deepEqual([...findings, ...policyFindings()], []);
});
