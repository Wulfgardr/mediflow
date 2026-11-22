import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    compareFakeSchemaRatchet,
    countProductionCreateTables,
    extractProductionTables,
    FAKE_SCHEMA_GUIDANCE,
    scanTestFakeSchemas,
} from './check-test-fake-schema-ratchet.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('live repository matches the fake-schema ratchet with zero unratcheted production CREATE TABLE in tests', () => {
    const tables = extractProductionTables(REPO_ROOT);
    assert.ok(tables.has('patients'));
    assert.ok(tables.has('exemptions'));
    assert.ok(tables.has('entries'));
    const counts = scanTestFakeSchemas(REPO_ROOT, tables);
    const ratchet = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts/check-test-fake-schema-ratchet.json'), 'utf8'));
    assert.deepEqual(compareFakeSchemaRatchet(counts, ratchet), []);
    assert.equal(Object.hasOwn(ratchet, 'lib/patient-ambulatory-membership.test.ts'), false);
    assert.equal(Object.hasOwn(ratchet, 'lib/security/server-session-clinical-context.test.ts'), false);
    assert.equal(ratchet['lib/exemption-import.test.ts'], 1);
});

test('rejects a new test file that hand-writes CREATE TABLE for a production table and names initializeSqliteSchema', () => {
    const tables = new Set(['patients', 'entries']);
    const count = countProductionCreateTables('sqlite.exec("CREATE TABLE patients (id TEXT PRIMARY KEY)");', tables);
    assert.equal(count, 1);
    const problems = compareFakeSchemaRatchet({ 'lib/new-patient.test.ts': count }, {});
    assert.equal(problems.length, 1);
    assert.ok(problems[0].includes('initializeSqliteSchema(sqlite)'));
    assert.ok(problems[0].includes(FAKE_SCHEMA_GUIDANCE));
});

test('allows synthetic non-production helper tables and enforces ratchet shrink when legacy statements are removed', () => {
    const tables = new Set(['patients', 'exemptions']);
    assert.equal(
        countProductionCreateTables('db.exec("CREATE TABLE synthetic_assignments (id TEXT PRIMARY KEY)")', tables),
        0,
    );
    const shrinkProblems = compareFakeSchemaRatchet({}, { 'lib/old-migrated.test.ts': 2 });
    assert.equal(shrinkProblems.length, 1);
    assert.match(shrinkProblems[0], /ratchet only shrinks/);
});
