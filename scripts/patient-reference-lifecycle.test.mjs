/* post-fix ADR 0066 tests. Real Drizzle + better-sqlite3 and unchanged
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
const PORTABLE = 'lib/security/portable-supervisor-patient-version-production.ts';
const pair = Object.freeze({ patientId: 'synthetic-active' });

function fixture(t) {
    const sqlite = new Database(':memory:'); t.after(() => sqlite.close());
    sqlite.exec(`CREATE TABLE patients(id TEXT PRIMARY KEY, version INTEGER, deleted_at INTEGER, is_archived INTEGER);
        INSERT INTO patients VALUES ('synthetic-active', 7, NULL, 0), ('synthetic-archived', 8, NULL, 1),
        ('synthetic-deleted', 9, 1893456001, 0), ('synthetic-no-membership', 10, NULL, 0);
        CREATE TABLE ambulatories(id TEXT PRIMARY KEY);
        INSERT INTO ambulatories VALUES ('synthetic-ambulatory'), ('other-ambulatory');
        CREATE TABLE patients_to_ambulatories(patient_id TEXT, ambulatory_id TEXT);
        INSERT INTO patients_to_ambulatories VALUES ('synthetic-active', 'synthetic-ambulatory'),
        ('synthetic-archived', 'synthetic-ambulatory'), ('synthetic-deleted', 'synthetic-ambulatory');`);
    const dbServer = drizzle(sqlite);
    const databasePort = { dbServer,
        runDbServerImmediateTransaction: callback => sqlite.transaction(callback).immediate() };
    const unavailable = () => { throw new Error('fixture denies auth/provider/service execution'); };
    const doubles = {
        'server-only': {}, '../db-server': databasePort, '../../db-server': databasePort,
    };
    const allowed = new Set([PORTABLE, 'lib/schema.ts', 'lib/patient-lifecycle.ts', 'lib/version-concurrency.ts',
        'lib/ai-treatment-reasoning-kill-switch.ts', 'lib/ai-lane-kill-switch.ts', 'lib/ai-function-availability.ts']);
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
    const { createPortableSupervisorPatientVersionProductionV1, PortableSupervisorPatientVersionProductionV1Error } = load(PORTABLE);
    return { sqlite,
        readPortable: createPortableSupervisorPatientVersionProductionV1(),
        unavailable(run) { assert.throws(run, error => error instanceof PortableSupervisorPatientVersionProductionV1Error && error.code === 'patient_unavailable'); },
        unchanged(run) { const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
            const result = run(); assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, before); return result; },
    };
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
