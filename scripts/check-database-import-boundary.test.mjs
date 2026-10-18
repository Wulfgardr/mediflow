import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeDatabaseImports, compareDatabaseInventory, runDatabaseImportGuard, DATABASE_SCOPE } from './check-database-import-boundary.mjs';

const scope = { roots: ['app', 'lib', 'components', 'hooks', 'packages'], entries: [] };
async function fixture(t, sources, manifest = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-db-import-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const files = { 'package.json': JSON.stringify(manifest), 'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }), ...sources };
    for (const [file, source] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), source);
    }
    return root;
}
const analyze = root => analyzeDatabaseImports(root, scope);

test('detects a new DB edge and a second edge inside an already admitted file', async t => {
    const root = await fixture(t, { 'lib/db-server.ts': 'export const dbServer = {};', 'app/a.ts': "import { dbServer } from '@/lib/db-server';" });
    const baseline = (await analyze(root)).edges;
    assert.equal(baseline.length, 1);
    assert.deepEqual(compareDatabaseInventory(baseline, baseline), []);
    await writeFile(path.join(root, 'app/a.ts'), "import { dbServer } from '@/lib/db-server'; import Database from 'better-sqlite3';");
    assert.match(compareDatabaseInventory((await analyze(root)).edges, baseline).join('\n'), /NEW_EDGE/);
});

test('distinguishes HTTP facade, crypto, operators and type imports from runtime SQL authority', async t => {
    const root = await fixture(t, {
        'lib/db.ts': 'export const db = { fetch() {} };',
        'lib/security.ts': 'export function encryptData() {}',
        'app/a.ts': "import { db } from '@/lib/db'; import { encryptData } from '@/lib/security'; import { eq } from 'drizzle-orm'; import type Database from 'better-sqlite3'; import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';",
    });
    assert.deepEqual((await analyze(root)).edges, []);
});

test('follows relative aliases and selective handle re-exports without tainting DTO services', async t => {
    const root = await fixture(t, {
        'lib/db-server.ts': 'export const dbServer = {};',
        'lib/barrel.ts': "export { dbServer as handle } from './db-server.js'; export function dto() { return { name: 'synthetic' }; }",
        'lib/second.ts': "import { handle } from './barrel'; export const connection = handle;",
        'app/a.ts': "import { connection } from '@/lib/second'; import { dto } from '@/lib/barrel';",
    });
    const edges = (await analyze(root)).edges;
    assert.ok(edges.some(e => e.file === 'app/a.ts' && e.capability === 'server:lib/db-server.ts' && e.symbols.includes('connection')));
    assert.ok(!edges.some(e => e.file === 'app/a.ts' && e.symbols.includes('dto')));
});

test('recognizes renamed npm drivers and CommonJS/static/dynamic loader aliases', async t => {
    const root = await fixture(t, { 'app/a.ts': `
        import DB from 'clinical-driver';
        import { createRequire as make } from 'node:module';
        const load = make(import.meta.url); const alias = load;
        const driver = 'better-' + 'sqlite3'; alias(driver);
        const direct = require; direct('node:sqlite');
        await import('sqlite3');
        export * from 'drizzle-orm/better-sqlite3';
    ` }, { dependencies: { 'clinical-driver': 'npm:better-sqlite3@11.0.0' } });
    const result = await analyze(root);
    for (const capability of ['driver:better-sqlite3', 'driver:node:sqlite', 'driver:sqlite3', 'driver:drizzle-orm/better-sqlite3']) {
        assert.ok(result.edges.some(e => e.capability === capability), capability);
    }
    assert.deepEqual(result.opaqueLoaders, []);
});

test('does not lose a handle through star chains, CommonJS or direct-return factories', async t => {
    const root = await fixture(t, {
        'lib/db-server.ts': 'export const dbServer = {};',
        'lib/star.ts': "export * from './db-server';",
        'lib/second.ts': "export { dbServer as renamed } from './star';",
        'lib/cjs.cjs': "const db = require('./db-server'); module.exports = db;",
        'lib/factory.ts': "import { dbServer } from './db-server'; export function connection() { return dbServer; } export const bag = { db: dbServer };",
        'app/a.ts': "import { renamed } from '../lib/second'; import * as raw from '../lib/cjs.cjs'; import { connection, bag } from '../lib/factory';",
    });
    const edges = (await analyze(root)).edges.filter(e => e.file === 'app/a.ts');
    assert.equal(edges.length, 3);
    assert.ok(edges.some(e => e.symbols.includes('connection') && e.symbols.includes('bag')));
});

for (const [name, declaration, consumer] of [
    ['named default function', 'export default function connection() { return dbServer; }', 'import connection from'],
    ['anonymous default function', 'export default function() { return dbServer; }', 'import connection from'],
    ['separately exported function', 'function connection() { return dbServer; } export { connection };', 'import { connection } from'],
    ['exported destructuring', 'export const { connection } = { connection: dbServer };', 'import { connection } from'],
]) {
    test(`new consumer of ${name} creates an edge even when its owner is already admitted`, async t => {
        const root = await fixture(t, {
            'lib/db-server.ts': 'export const dbServer = {};',
            'lib/owner.ts': `import { dbServer } from './db-server'; ${declaration}`,
            'app/consumer.ts': '',
        });
        const baseline = (await analyze(root)).edges;
        assert.equal(baseline.length, 1);
        assert.equal(baseline[0].file, 'lib/owner.ts');
        await writeFile(path.join(root, 'app/consumer.ts'), `${consumer} '../lib/owner';`);
        const observed = (await analyze(root)).edges;
        const added = observed.filter(edge => edge.file === 'app/consumer.ts');
        assert.equal(added.length, 1);
        assert.equal(added[0].capability, 'server:lib/db-server.ts');
        const findings = compareDatabaseInventory(observed, baseline);
        assert.equal(findings.length, 1);
        assert.match(findings[0], /NEW_EDGE.*app\/consumer\.ts/);
    });
}

test('these function and destructuring forms do not propagate unrelated DTO values', async t => {
    const root = await fixture(t, {
        'lib/db-server.ts': 'export const dbServer = {};',
        'lib/owner.ts': `import { dbServer } from './db-server';
            export default function dto() { return { name: 'synthetic' }; }
            function other() { return { name: 'synthetic' }; } export { other };
            export const { view } = { connection: dbServer, view: { name: 'synthetic' } };`,
        'app/consumer.ts': "import dto, { other, view } from '../lib/owner';",
    });
    assert.deepEqual((await analyze(root)).edges.map(edge => edge.file), ['lib/owner.ts']);
});

test('tracks destructured dynamic handle exports and named CommonJS exports', async t => {
    const root = await fixture(t, {
        'lib/db-server.ts': 'export const dbServer = {};',
        'lib/barrel.ts': "const { dbServer: local } = await import('./db-server'); export { local as db };",
        'lib/cjs.cjs': "const raw=require('./db-server'); module.exports.handle=raw.dbServer;",
        'app/a.ts': "import { db } from '../lib/barrel'; import { handle } from '../lib/cjs.cjs';",
    });
    assert.equal((await analyze(root)).edges.filter(e => e.file === 'app/a.ts').length, 2);
});

test('does not silently ignore loader apply, destructuring, builtin module and native binding forms', async t => {
    const samples = [
        "require.apply(null, ['better-sqlite3']);",
        "import * as Module from 'node:module'; const {createRequire: make}=Module; make(import.meta.url)('better-sqlite3');",
        "const Module=process.getBuiltinModule('module'); Module.createRequire(import.meta.url)('better-sqlite3');",
        "process.dlopen(module, './binding.node');",
    ];
    for (const source of samples) {
        const root = await fixture(t, { 'app/a.ts': source }); const result = await analyze(root);
        assert.ok(result.edges.length + result.opaqueLoaders.length > 0, source);
    }
});

test('detects package aliases in package-lock and namespace createRequire immediate calls', async t => {
    const root = await fixture(t, {
        'package-lock.json': JSON.stringify({ packages: { 'node_modules/hidden-driver': { name: 'better-sqlite3' } } }),
        'app/a.ts': "import * as Module from 'node:module'; const factory=Module.createRequire; factory(import.meta.url)('hidden-driver'); import DB = require('node:sqlite'); export { DB };",
        'app/b.ts': "import { DB } from './a';",
    });
    const edges = (await analyze(root)).edges;
    assert.ok(edges.some(e => e.capability === 'driver:better-sqlite3'));
    assert.ok(edges.some(e => e.file === 'app/b.ts' && e.capability === 'driver:node:sqlite'));
});

test('protects opaque loaders by exact file digest and occurrence, not an unrestricted exemption', async t => {
    const root = await fixture(t, { 'app/a.ts': 'export const load = (target) => import(target);' });
    const before = await analyze(root);
    assert.equal(before.opaqueLoaders.length, 1);
    assert.equal(before.opaqueLoaders[0].kind, 'dynamic');
    await writeFile(path.join(root, 'app/a.ts'), "export const load = (target) => import(target); load('better-sqlite3');");
    const after = await analyze(root);
    assert.match(compareDatabaseInventory(after.opaqueLoaders, before.opaqueLoaders).join('\n'), /NEW_EDGE|STALE_EDGE/);
});

test('mutable objects are not treated as proven constant module identities', async t => {
    const root = await fixture(t, { 'app/a.ts': "const config={driver:'node:fs'}; config.driver='better-sqlite3'; import(config.driver);" });
    assert.equal((await analyze(root)).opaqueLoaders.length, 1);
});

test('module.require is an actual loader and nonlocal createRequire bases cannot bypass the inventory', async t => {
    const root = await fixture(t, { 'app/a.cjs': "module.require('better-sqlite3');" });
    assert.equal((await analyze(root)).edges.length, 1);
    await writeFile(path.join(root, 'app/a.cjs'), "const {createRequire}=require('node:module'); const load=createRequire('/elsewhere/package.json'); load('node:fs');");
    assert.ok((await analyze(root)).opaqueLoaders.some(record => record.kind === 'require-base'));
});

test('stale, duplicate and extra occurrences cannot be hidden by equal totals', async t => {
    const root = await fixture(t, { 'app/a.ts': "import 'better-sqlite3';" });
    const edges = (await analyze(root)).edges;
    assert.match(compareDatabaseInventory([], edges).join('\n'), /STALE_EDGE/);
    assert.match(compareDatabaseInventory(edges, [...edges, ...edges]).join('\n'), /DUPLICATE/);
    await writeFile(path.join(root, 'app/a.ts'), "import 'better-sqlite3'; import 'better-sqlite3';");
    assert.match(compareDatabaseInventory((await analyze(root)).edges, edges).join('\n'), /COUNT/);
});

test('rejects syntax errors and symlink escapes; follows a test-named file reached by runtime', async t => {
    const root = await fixture(t, { 'lib/helper.test.ts': "export { default } from 'better-sqlite3';", 'app/a.ts': "import DB from '../lib/helper.test';" });
    assert.ok((await analyze(root)).edges.some(e => e.file === 'app/a.ts'));
    await writeFile(path.join(root, 'app/a.ts'), 'import {');
    await assert.rejects(analyze(root), /SYNTAX/);
    await writeFile(path.join(root, 'app/a.ts'), '');
    await symlink(path.join(root, 'lib/helper.test.ts'), path.join(root, 'app/escape.ts'));
    await assert.rejects(analyze(root), /SYMLINK/);
});

test('real guard fails closed on a missing or malformed inventory and explains drift', async t => {
    const root = await fixture(t, { 'app/a.ts': "import 'better-sqlite3';" });
    await assert.rejects(runDatabaseImportGuard(root), /inventory|ENOENT/);
    await mkdir(path.join(root, 'docs'));
    const observed = await analyze(root);
    for (const file of DATABASE_SCOPE.entries) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), ''); }
    const inventory = { schemaVersion: 1, scope: DATABASE_SCOPE, edges: observed.edges.map(edge => ({ ...edge, classification: 'legacy' })), opaqueLoaders: [], classifications: { legacy: 'Existing synthetic fixture' }, nativeBoundary: {} };
    await writeFile(path.join(root, 'docs/database-import-boundary.json'), JSON.stringify(inventory));
    assert.equal((await runDatabaseImportGuard(root)).edges, 1);
    inventory.edges[0].symbols.push('*');
    await writeFile(path.join(root, 'docs/database-import-boundary.json'), JSON.stringify(inventory));
    await assert.rejects(runDatabaseImportGuard(root), /INVALID_EDGE/);
    inventory.edges[0].symbols.pop();
    await writeFile(path.join(root, 'docs/database-import-boundary.json'), JSON.stringify(inventory));
    await writeFile(path.join(root, 'app/a.ts'), "import 'better-sqlite3'; import 'node:sqlite';");
    await assert.rejects(runDatabaseImportGuard(root), /NEW_EDGE/);
    inventory.scope = { roots: ['lib'], entries: [] };
    await writeFile(path.join(root, 'docs/database-import-boundary.json'), JSON.stringify(inventory));
    await assert.rejects(runDatabaseImportGuard(root), /SCOPE_DRIFT/);
});

test('resolves first-party package barrels, package imports and package-specific driver aliases', async t => {
    const root = await fixture(t, {
        'package.json': JSON.stringify({ imports: { '#db': './lib/db-server.ts' } }),
        'lib/db-server.ts': 'export const dbServer = {};',
        'packages/bridge/package.json': JSON.stringify({ name: '@mediflow/bridge', exports: './index.js', dependencies: { privateSql: 'npm:better-sqlite3@11.0.0' } }),
        'packages/bridge/index.js': "export { dbServer } from '../../lib/db-server'; import DB from 'privateSql';",
        'app/a.ts': "import { dbServer } from '@mediflow/bridge'; import { dbServer as other } from '#db';",
    });
    const result = await analyze(root);
    assert.equal(result.edges.filter(e => e.file === 'app/a.ts').length, 2);
    assert.ok(result.edges.some(e => e.file === 'packages/bridge/index.js' && e.capability === 'driver:better-sqlite3'));
});
