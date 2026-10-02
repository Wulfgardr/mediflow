/* @Codex: post-fix route harness. Real Drizzle/better-sqlite3, production column
 * mappings, route/normalizers/journal; synthetic DDL/data in memory or an owned
 * disposable WAL database for two-connection writer-order tests.
 * Next/auth/audit are doubles. No production DB bootstrap, HTTP server or provider.
 * Missing project dependencies are errors, never a simulated SQL fallback/skip.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeRequire = createRequire(import.meta.url);
const Database = nativeRequire('better-sqlite3');
const { drizzle } = nativeRequire('drizzle-orm/better-sqlite3');

export function createHarness({ sharedWal = false, sourceOverrides = {} } = {}) {
    const audit = [], statements = [];
    const directory = sharedWal ? fs.mkdtempSync(path.join(os.tmpdir(), 'checkup-parent-wal-')) : null;
    const sqlite = new Database(directory ? path.join(directory, 'synthetic.db') : ':memory:',
        { verbose: query => statements.push(query) });
    let contender;
    function close() {
        if (contender?.open) contender.close();
        if (sqlite.open) sqlite.close();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
    if (sharedWal) {
        sqlite.pragma('journal_mode = WAL');
        sqlite.pragma('busy_timeout = 5000');
        sqlite.pragma('foreign_keys = ON');
    }
    sqlite.exec(`CREATE TABLE patients(id TEXT PRIMARY KEY, deleted_at INTEGER, is_archived INTEGER);
        CREATE TABLE checkups(id TEXT PRIMARY KEY, patient_id TEXT, version INTEGER, date INTEGER,
        title TEXT, notes TEXT, status TEXT, source TEXT, created_at INTEGER, updated_at INTEGER,
        deleted_at INTEGER, deletion_reason TEXT);
        INSERT INTO patients VALUES ('synthetic-patient', NULL, 0);
        INSERT INTO patients VALUES ('unrelated-active-patient', NULL, 0);
        INSERT INTO checkups VALUES ('synthetic-checkup', 'synthetic-patient', 5, 1893542400,
        'Before', NULL, 'pending', 'manual', 1893456000, 1893456000, NULL, NULL);`);
    if (sharedWal) {
        contender = new Database(sqlite.name);
        // Fail-fast lock observation avoids blocking the shared JS thread. It
        // proves writer exclusion, not production busy-timeout latency.
        contender.pragma('busy_timeout = 0');
        contender.pragma('foreign_keys = ON');
    }
    let beforeUpdate, beforeTransaction;
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
    const transaction = dbServer.transaction.bind(dbServer);
    dbServer.transaction = (...args) => {
        const callback = beforeTransaction; beforeTransaction = undefined; callback?.();
        return transaction(...args);
    };
    const cache = new Map();
    const allowed = new Set([
        'app/api/checkups/[id]/route.ts', 'lib/patient-edit-session.ts', 'lib/schema.ts',
        'lib/patient-lifecycle.ts', 'lib/checkup-concurrency.ts', 'lib/version-concurrency.ts',
        'lib/api-v1-clinical-lifecycle.ts', 'lib/api-v1-clinical-write-normalization.ts', 'lib/status-normalization.ts',
        'lib/checkup-json-body.ts', 'lib/bounded-request-body.ts', 'lib/checkup-write-operation.ts',
    ]);
    const auditDouble = {
        listChangedFields: (body, excluded) => Object.keys(body).filter(k => !excluded.includes(k)),
        auditContextFromSession: () => ({ actorType: 'user', actorRef: 'synthetic-review', sourceSurface: 'web', authContext: 'synthetic' }),
        requestIdFromRequest: () => 'synthetic-request',
        writeAuditEventInTransaction: (tx, event) => {
            assert.equal(tx.session.client, sqlite);
            assert.equal(sqlite.inTransaction, true, 'required audit must use the fixture transaction');
            audit.push(event);
        },
    };
    const doubles = {
        'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
        '@/lib/db-server': { dbServer },
        '@/lib/security/server-auth': { requireSession: async () => ({ userId: 'synthetic-review' }), unauthorizedResponse: () => Response.json({}, {status: 401}) },
        '@/lib/security/audit': auditDouble,
    };
    function load(relative) {
        assert.ok(allowed.has(relative), `unexpected production import: ${relative}`);
        if (cache.has(relative)) return cache.get(relative).exports;
        const filename = path.join(ROOT, relative), loadedModule = { exports: {} }; cache.set(relative, loadedModule);
        // Explicit mutation-test input is evaluated only by this private loader;
        // no file or production import is rewritten.
        const source = Object.hasOwn(sourceOverrides, relative)
            ? sourceOverrides[relative] : fs.readFileSync(filename, 'utf8');
        const result = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
        const require = name => {
            if (Object.hasOwn(doubles, name)) return doubles[name];
            if (name.startsWith('node:') || name === 'drizzle-orm' || name === 'drizzle-orm/sqlite-core') return nativeRequire(name);
            const resolved = name.startsWith('@/') ? name.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
            const target = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
            // The mutation operation uses relative imports for these same fixture seams.
            if (target === 'lib/db-server.ts') return { dbServer };
            if (target === 'lib/security/audit.ts') return auditDouble;
            return load(target);
        };
        new Function('require', 'module', 'exports', result.outputText)(require, loadedModule, loadedModule.exports);
        return loadedModule.exports;
    }
    // lib/schema.ts is loaded unchanged: real column names and timestamp codecs.
    // The physical tables above intentionally cover only this synthetic fixture.
    let route, Session;
    try {
        route = load('app/api/checkups/[id]/route.ts');
        Session = load('lib/patient-edit-session.ts').PatientEditSession;
    } catch (error) {
        close();
        throw error;
    }
    return {
        sqlite, contender, audit, statements, Session,
        beforeUpdate(callback) { beforeUpdate = callback; },
        beforeTransaction(callback) { beforeTransaction = callback; },
        deleteParent(connection = sqlite) { return connection.prepare("UPDATE patients SET deleted_at = 1893456001 WHERE id = 'synthetic-patient'").run(); },
        parent(connection = sqlite) { return { ...connection.prepare("SELECT * FROM patients WHERE id = 'synthetic-patient'").get() }; },
        row() { return { ...sqlite.prepare("SELECT * FROM checkups WHERE id = 'synthetic-checkup'").get() }; },
        async request(method, payload) {
            return route[method](new Request('http://synthetic.invalid/checkup', { method, body: JSON.stringify(payload) }), { params: Promise.resolve({ id: 'synthetic-checkup' }) });
        },
        close,
    };
}
