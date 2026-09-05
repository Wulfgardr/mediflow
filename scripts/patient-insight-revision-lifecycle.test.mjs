/* @Codex: post-fix ADR 0066 reader tests, real Drizzle/better-sqlite3 only.
 * Captures the production root's readPatientRevision callback, not a rewritten
 * query. Column mappings + activePatients are real. Assembly/auth/provider
 * dependencies are explicit, non-executable doubles; no real DB bootstrap.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const Database = nativeRequire('better-sqlite3');
const { drizzle } = nativeRequire('drizzle-orm/better-sqlite3');
const PRODUCTION = 'lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts';

function fixture(t) {
    const sqlite = new Database(':memory:'); t.after(() => sqlite.close());
    // Minimal synthetic physical schema; real lib/schema.ts supplies ORM mappings.
    sqlite.exec(`CREATE TABLE patients(id TEXT PRIMARY KEY, version INTEGER NOT NULL,
        deleted_at INTEGER, is_archived INTEGER);
        INSERT INTO patients VALUES ('synthetic-active', 4, NULL, 0),
        ('synthetic-archived', 8, NULL, 1), ('synthetic-deleted', 5, 1893456001, 0),
        ('unrelated-active', 5, NULL, 0);`);
    const statements = [];
    const dbServer = drizzle(sqlite, { logger: { logQuery(query) { statements.push(query); } } });
    let captured;
    const unavailable = () => { throw new Error('fixture forbids live auth/provider/preview execution'); };
    const doubles = {
        'server-only': {},
        '../../db-server': { dbServer },
        '../../security/server-auth': { acquireAuthenticatedWebSessionProjectionOwnerContext: unavailable },
        '../host-local-provider-binding': { createHostLocalProviderBindingService: () => Object.freeze({}) },
        '../host-local-provider-readiness': { observeClinical: unavailable },
        './provider-lifecycle-service': { createHostProviderLifecycleService: () => ({ service: Object.freeze({}) }) },
        './candidate-router': { routeHostResolvedCandidateCapability: unavailable },
        './patient-insight-host-capability': { createPatientInsightHostCapability: unavailable },
        './patient-insight-authenticated-preview': {
            createAuthenticatedPatientInsightPreviewService(sources) {
                assert.equal(captured, undefined); captured = sources;
                return { acquire: unavailable };
            },
        },
    };
    const allowed = new Set([PRODUCTION, 'lib/patient-lifecycle.ts', 'lib/schema.ts', 'lib/ai-patient-insight-kill-switch.ts', 'lib/ai-lane-kill-switch.ts']);
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
    load(PRODUCTION);
    assert.equal(typeof captured?.readPatientRevision, 'function');
    const changes = () => sqlite.prepare('SELECT total_changes() AS n').get().n;
    return {
        sqlite,
        read(patientId) {
            const before = changes(), statementCount = statements.length;
            const revision = captured.readPatientRevision(patientId);
            assert.equal(changes(), before, 'the production reader performs no writes');
            assert.equal(statements.length, statementCount + 1, 'every read queries SQLite; no cached revision');
            assert.match(statements.at(-1), /^select\s/i);
            return revision;
        },
    };
}

for (const [state, patientId, expected] of [
    ['active', 'synthetic-active', 4],
    ['archived but not deleted', 'synthetic-archived', 8],
    ['tombstoned', 'synthetic-deleted', null],
    ['absent', 'synthetic-absent', null],
]) {
    test(`production revision reader: ${state}, no writes`, t => {
        const h = fixture(t); assert.equal(h.read(patientId), expected);
    });
}

test('production revision reread becomes unavailable after a synthetic tombstone', t => {
    const h = fixture(t); assert.equal(h.read('synthetic-active'), 4);
    h.sqlite.prepare('UPDATE patients SET deleted_at = ?, version = ? WHERE id = ?')
        .run(1893456001, 5, 'synthetic-active');
    assert.equal(h.read('synthetic-active'), null);
});

test('production revision reader observes an explicit synthetic restore with a new version', t => {
    const h = fixture(t); assert.equal(h.read('synthetic-deleted'), null);
    h.sqlite.prepare('UPDATE patients SET deleted_at = NULL, version = ? WHERE id = ?')
        .run(6, 'synthetic-deleted');
    assert.equal(h.read('synthetic-deleted'), 6);
});
