/* @Codex: post-fix route harness. Real Drizzle/better-sqlite3, production column
 * mappings, route/normalizers/journal; synthetic DDL/data in :memory: only.
 * Next/auth/audit are doubles. No production DB bootstrap, HTTP server or provider.
 * Missing project dependencies are errors, never a simulated SQL fallback/skip.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeRequire = createRequire(import.meta.url);
const Database = nativeRequire('better-sqlite3');
const { drizzle } = nativeRequire('drizzle-orm/better-sqlite3');

export function createHarness() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE patients(id TEXT PRIMARY KEY, deleted_at INTEGER, is_archived INTEGER);
        CREATE TABLE checkups(id TEXT PRIMARY KEY, patient_id TEXT, version INTEGER, date INTEGER,
        title TEXT, notes TEXT, status TEXT, source TEXT, created_at INTEGER, updated_at INTEGER,
        deleted_at INTEGER, deletion_reason TEXT);
        INSERT INTO patients VALUES ('synthetic-patient', NULL, 0);
        INSERT INTO patients VALUES ('unrelated-active-patient', NULL, 0);
        INSERT INTO checkups VALUES ('synthetic-checkup', 'synthetic-patient', 5, 1893542400,
        'Before', NULL, 'pending', 'manual', 1893456000, 1893456000, NULL, NULL);`);
    let beforeUpdate;
    const audit = [], statements = [];
    const dbServer = drizzle(sqlite, { logger: {
        logQuery(query) {
            statements.push(query);
            // The real driver logs immediately before executing its prepared SQL.
            // Only fixture state changes here; no query is built/replaced by the test.
            if (/^update\s+"checkups"\s/i.test(query.trimStart())) {
                const callback = beforeUpdate; beforeUpdate = undefined; callback?.();
            }
        },
    } });
    const cache = new Map();
    const allowed = new Set([
        'app/api/checkups/[id]/route.ts', 'lib/patient-edit-session.ts', 'lib/schema.ts',
        'lib/patient-lifecycle.ts', 'lib/checkup-concurrency.ts', 'lib/version-concurrency.ts',
        'lib/api-v1-clinical-lifecycle.ts', 'lib/api-v1-clinical-write-normalization.ts', 'lib/status-normalization.ts',
    ]);
    const doubles = {
        'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
        '@/lib/db-server': { dbServer },
        '@/lib/security/server-auth': { requireSession: async () => ({ userId: 'synthetic-review' }), unauthorizedResponse: () => Response.json({}, {status: 401}) },
        '@/lib/security/audit': { listChangedFields: (body, excluded) => Object.keys(body).filter(k => !excluded.includes(k)), safeWriteAuditEventFromRequest: async (_r, _s, event) => { audit.push(event); } },
    };
    function load(relative) {
        assert.ok(allowed.has(relative), `unexpected production import: ${relative}`);
        if (cache.has(relative)) return cache.get(relative).exports;
        const filename = path.join(ROOT, relative), loadedModule = { exports: {} }; cache.set(relative, loadedModule);
        const source = fs.readFileSync(filename, 'utf8');
        const result = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
        const require = name => {
            if (Object.hasOwn(doubles, name)) return doubles[name];
            if (name.startsWith('node:') || name === 'drizzle-orm' || name === 'drizzle-orm/sqlite-core') return nativeRequire(name);
            const resolved = name.startsWith('@/') ? name.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
            return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
        };
        new Function('require', 'module', 'exports', result.outputText)(require, loadedModule, loadedModule.exports);
        return loadedModule.exports;
    }
    // lib/schema.ts is loaded unchanged: real column names and timestamp codecs.
    // The physical tables above intentionally cover only this synthetic fixture.
    const route = load('app/api/checkups/[id]/route.ts');
    return {
        sqlite, audit, statements, Session: load('lib/patient-edit-session.ts').PatientEditSession,
        beforeUpdate(callback) { beforeUpdate = callback; },
        deleteParent() { sqlite.exec("UPDATE patients SET deleted_at = 1893456001 WHERE id = 'synthetic-patient'"); },
        row() { return { ...sqlite.prepare("SELECT * FROM checkups WHERE id = 'synthetic-checkup'").get() }; },
        async request(method, payload) {
            return route[method](new Request('http://synthetic.invalid/checkup', { method, body: JSON.stringify(payload) }), { params: Promise.resolve({ id: 'synthetic-checkup' }) });
        },
        close() { sqlite.close(); },
    };
}
