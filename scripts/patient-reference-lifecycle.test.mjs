/* @Codex: post-fix ADR 0066 tests. Real Drizzle + better-sqlite3 and unchanged
 * production schema mappings, synthetic :memory: tables only; no bootstrap.
 * DB composition/schema-readiness/auth/provider factories are declared doubles.
 * Transactions use real SQLite IMMEDIATE; no fallback ORM or dependency skip.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const Database = nativeRequire('better-sqlite3');
const { drizzle } = nativeRequire('drizzle-orm/better-sqlite3');
const STORE = 'lib/security/durable-review-patient-link-store.ts';
const PORTABLE = 'lib/security/portable-supervisor-patient-version-production.ts';
const TREATMENT = 'lib/ai-providers/fabric/treatment-reasoning-production-root.ts';
const pair = Object.freeze({ reviewId: `review_${'1'.repeat(32)}`, patientId: 'synthetic-active' });

function fixture(t) {
    const sqlite = new Database(':memory:'); t.after(() => sqlite.close());
    sqlite.exec(`CREATE TABLE patients(id TEXT PRIMARY KEY, version INTEGER, deleted_at INTEGER, is_archived INTEGER);
        INSERT INTO patients VALUES ('synthetic-active', 7, NULL, 0), ('synthetic-archived', 8, NULL, 1),
        ('synthetic-deleted', 9, 1893456001, 0), ('synthetic-no-membership', 10, NULL, 0);
        CREATE TABLE ambulatories(id TEXT PRIMARY KEY);
        INSERT INTO ambulatories VALUES ('synthetic-ambulatory'), ('other-ambulatory');
        CREATE TABLE patients_to_ambulatories(patient_id TEXT, ambulatory_id TEXT);
        INSERT INTO patients_to_ambulatories VALUES ('synthetic-active', 'synthetic-ambulatory'),
        ('synthetic-archived', 'synthetic-ambulatory'), ('synthetic-deleted', 'synthetic-ambulatory');
        CREATE TABLE durable_review_records(review_id TEXT PRIMARY KEY);
        CREATE TABLE durable_review_patient_links(review_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));`);
    sqlite.prepare('INSERT INTO durable_review_records VALUES (?)').run(pair.reviewId);
    const dbServer = drizzle(sqlite);
    const databasePort = { dbServer, hasCanonicalDurableReviewPatientLinkSchema: () => true,
        runDbServerImmediateTransaction: callback => sqlite.transaction(callback).immediate() };
    const unavailable = () => { throw new Error('fixture denies auth/provider/service execution'); };
    let readTreatment;
    const doubles = {
        'server-only': {}, '../db-server': databasePort, '../../db-server': databasePort,
        '../../athena-mlx-runtime': { generateWithAthenaMlx: unavailable, isAthenaMlxModelAvailable: unavailable },
        '../../security/server-auth': { acquireAuthenticatedWebSessionProjectionOwnerContext: unavailable },
        '../../security/server-session': { registerServerSessionResource: unavailable },
        './provider-lifecycle-service': { createHostProviderLifecycleService: () => ({ service: Object.freeze({}) }) },
        './treatment-reasoning-authenticated-projection': { createTreatmentReasoningAuthenticatedProjectionBroker(sources) {
            readTreatment = sources.readPatientVersion; return Object.freeze({});
        } },
        './treatment-reasoning-production-operation': { createTreatmentReasoningProductionService: () => ({ acquireIngest: unavailable, acquirePreview: unavailable }) },
    };
    const allowed = new Set([STORE, PORTABLE, TREATMENT, 'lib/schema.ts', 'lib/patient-lifecycle.ts',
        'lib/ai-treatment-reasoning-kill-switch.ts', 'lib/ai-lane-kill-switch.ts']);
    const cache = new Map();
    function load(relative) {
        assert.ok(allowed.has(relative), `unexpected production import: ${relative}`);
        if (cache.has(relative)) return cache.get(relative).exports;
        const filename = path.join(ROOT, relative), loadedModule = { exports: {} }; cache.set(relative, loadedModule);
        const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        });
        const require = name => {
            if (Object.hasOwn(doubles, name)) return doubles[name];
            if (name.startsWith('node:') || name === 'drizzle-orm' || name === 'drizzle-orm/sqlite-core') return nativeRequire(name);
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
            return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
        };
        new Function('require', 'module', 'exports', result.outputText)(require, loadedModule, loadedModule.exports);
        return loadedModule.exports;
    }
    const { createDurableReviewPatientLinkStore, DurableReviewPatientLinkStoreError } = load(STORE);
    const { createPortableSupervisorPatientVersionProductionV1, PortableSupervisorPatientVersionProductionV1Error } = load(PORTABLE);
    load(TREATMENT); assert.equal(typeof readTreatment, 'function');
    return { sqlite, store: createDurableReviewPatientLinkStore(), readTreatment,
        readPortable: createPortableSupervisorPatientVersionProductionV1(),
        denied(run, code) { assert.throws(run, error => error instanceof DurableReviewPatientLinkStoreError && error.code === code); },
        unavailable(run) { assert.throws(run, error => error instanceof PortableSupervisorPatientVersionProductionV1Error && error.code === 'patient_unavailable'); },
        links() { return sqlite.prepare('SELECT * FROM durable_review_patient_links ORDER BY review_id').all(); },
        unchanged(run) { const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
            const result = run(); assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, before); return result; },
    };
}

for (const patientId of ['synthetic-active', 'synthetic-archived']) {
    test(`durable association remains immutable/idempotent: ${patientId}`, t => {
        const h = fixture(t), link = { ...pair, patientId };
        assert.deepEqual(h.store.create(link), link);
        const rows = h.links();
        h.unchanged(() => {
            assert.deepEqual(h.store.create(link), link);
            assert.deepEqual(h.store.readByReviewId(link.reviewId), link);
            h.denied(() => h.store.create({ ...link, patientId: 'synthetic-no-membership' }), 'link_conflict');
        });
        assert.deepEqual(h.links(), rows);
    });
}
for (const patientId of ['synthetic-deleted', 'synthetic-absent']) {
    test(`durable new association denies unavailable parent without writing: ${patientId}`, t => {
        const h = fixture(t);
        h.unchanged(() => h.denied(() => h.store.create({ ...pair, patientId }), 'patient_missing'));
        assert.deepEqual(h.links(), []);
    });
}
test('durable tombstone denies read/retry while retaining history; explicit restore recovers the same link', t => {
    const h = fixture(t); h.store.create(pair); const history = h.links();
    h.sqlite.prepare('UPDATE patients SET deleted_at = ?, version = version + 1 WHERE id = ?').run(1893456001, pair.patientId);
    h.unchanged(() => {
        h.denied(() => h.store.readByReviewId(pair.reviewId), 'patient_missing');
        h.denied(() => h.store.create(pair), 'patient_missing');
    });
    assert.deepEqual(h.links(), history, 'history is retained, not purged or rewritten');
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM durable_review_records').get().n, 1);
    h.sqlite.prepare('UPDATE patients SET deleted_at = NULL, version = version + 1 WHERE id = ?').run(pair.patientId);
    h.unchanged(() => {
        assert.deepEqual(h.store.readByReviewId(pair.reviewId), pair);
        assert.deepEqual(h.store.create(pair), pair);
    });
    assert.deepEqual(h.links(), history);
});
test('durable review-reference integrity remains distinct from patient availability', t => {
    const h = fixture(t);
    h.unchanged(() => h.denied(() => h.store.create({ ...pair, reviewId: `review_${'2'.repeat(32)}` }), 'review_missing'));
    h.store.create(pair); const history = h.links();
    h.sqlite.prepare('DELETE FROM durable_review_records WHERE review_id = ?').run(pair.reviewId);
    h.unchanged(() => h.denied(() => h.store.readByReviewId(pair.reviewId), 'stored_state_invalid'));
    assert.deepEqual(h.links(), history);
});
test('durable missing parent denies an existing association without deleting its historical bytes', t => {
    const h = fixture(t); h.store.create(pair); const history = h.links();
    h.sqlite.prepare('DELETE FROM patients WHERE id = ?').run(pair.patientId);
    h.unchanged(() => h.denied(() => h.store.readByReviewId(pair.reviewId), 'patient_missing'));
    assert.deepEqual(h.links(), history);
});
for (const [patientId, expected] of [['synthetic-active', 7], ['synthetic-archived', 8],
    ['synthetic-deleted', null], ['synthetic-absent', null], ['synthetic-no-membership', null]]) {
    test(`Treatment Reasoning exact membership/archive/tombstone semantics: ${patientId}`, t => {
        const h = fixture(t);
        h.unchanged(() => {
            assert.equal(h.readTreatment(patientId, 'synthetic-ambulatory'), expected);
            assert.equal(h.readTreatment(patientId, 'other-ambulatory'), null);
        });
    });
}
test('Portable Supervisor preserves archive exclusion, membership and explicit restore semantics', t => {
    const h = fixture(t), read = patientId => h.readPortable(patientId, 'synthetic-ambulatory');
    h.unchanged(() => {
        assert.equal(read(pair.patientId), 7);
        for (const id of ['synthetic-archived', 'synthetic-deleted', 'synthetic-absent', 'synthetic-no-membership']) h.unavailable(() => read(id));
        h.unavailable(() => h.readPortable(pair.patientId, 'other-ambulatory'));
    });
    h.sqlite.prepare('UPDATE patients SET deleted_at = ?, version = version + 1 WHERE id = ?').run(1893456001, pair.patientId);
    h.unchanged(() => h.unavailable(() => read(pair.patientId)));
    h.sqlite.prepare('UPDATE patients SET deleted_at = NULL, version = version + 1 WHERE id = ?').run(pair.patientId);
    h.unchanged(() => assert.equal(read(pair.patientId), 9));
});
