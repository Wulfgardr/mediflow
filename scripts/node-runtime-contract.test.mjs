/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { physicalFiles, physicalRecord, sha256 } from './launch-bundled-headless-supervisor.mjs';
import { assertNodeRuntime, readNodeContract, standaloneDirectory } from './node-runtime-contract.mjs';

test('accepts only the Node major pinned by .nvmrc and package engines', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-node-contract-'));
    try {
        fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
        const contract = readNodeContract(root);
        assert.deepEqual(contract, { major: 24, engines: '>=24 <25' });
        assert.deepEqual(assertNodeRuntime(contract, { node: '24.18.0', modules: '137' }), {
            version: '24.18.0', moduleVersion: '137',
        });
        assert.throws(() => assertNodeRuntime(contract, { node: '20.20.2', modules: '115' }), /24\.x richiesto/);
        assert.throws(() => assertNodeRuntime(contract, { node: '26.4.0', modules: '147' }), /24\.x richiesto/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('uses the configured Next.js dist directory for standalone artifacts', () => {
    assert.equal(
        standaloneDirectory('/repo', { MEDIFLOW_NEXT_DIST_DIR: '.next-custom' }),
        path.join('/repo', '.next-custom', 'standalone')
    );
});

test('fails closed when .nvmrc and engines drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-node-contract-'));
    try {
        fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
        assert.throws(() => readNodeContract(root), /Contratto Node incoerente/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const nativeContract = new URL('./node-runtime-contract.mjs', import.meta.url).href;

function nativeFixture(t) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-resolution-')));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'project');
    const marker = path.join(directory, 'executed');
    writeFixture(path.join(root, 'package.json'), '{}');
    return { directory, root, marker };
}

function writeFixture(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, { mode: 0o644 });
}

function syntheticSqlite(root, marker, value = 1) {
    const packageRoot = path.join(root, 'node_modules/better-sqlite3');
    writeFixture(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'better-sqlite3', main: 'lib/database.js' }));
    writeFixture(path.join(packageRoot, 'lib/database.js'), `
        const fs = require('node:fs');
        fs.appendFileSync(${JSON.stringify(marker)}, 'load\\n');
        module.exports = class {
            constructor(name) { if (name !== ':memory:') throw new Error('Unexpected database'); }
            prepare(sql) { if (sql !== 'select 1 as value') throw new Error('Unexpected probe'); return { get: () => ({ value: ${value} }) }; }
            close() { fs.appendFileSync(${JSON.stringify(marker)}, 'close\\n'); }
        };
    `);
    return packageRoot;
}

function runNative(root) {
    return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { verifyNativeBinding } from ${JSON.stringify(nativeContract)};
        try { verifyNativeBinding(${JSON.stringify(root)}); }
        catch (error) { process.stderr.write(String(error.message)); process.exitCode = 1; }
    `], { env: {}, encoding: 'utf8', timeout: 10_000 });
}

test('native preflight probes the selected physical local SQLite and closes it', t => {
    const f = nativeFixture(t);
    syntheticSqlite(f.root, f.marker);
    const result = runNative(f.root);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(f.marker, 'utf8'), 'load\nclose\n');
});

test('native preflight retains failed-probe rejection and database closing', t => {
    const f = nativeFixture(t);
    syntheticSqlite(f.root, f.marker, 0);
    const result = runNative(f.root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SQLite probe failed/);
    assert.equal(fs.readFileSync(f.marker, 'utf8'), 'load\nclose\n');
});

for (const kind of ['missing local package', 'symlinked package', 'symlinked node_modules', 'entry escaping package']) {
    test(`native preflight denies ${kind} before ancestor code executes`, t => {
        const f = nativeFixture(t);
        const ancestor = syntheticSqlite(f.directory, f.marker);
        if (kind === 'symlinked package') {
            fs.mkdirSync(path.join(f.root, 'node_modules'));
            fs.symlinkSync(ancestor, path.join(f.root, 'node_modules/better-sqlite3'));
        } else if (kind === 'symlinked node_modules') {
            fs.symlinkSync(path.join(f.directory, 'node_modules'), path.join(f.root, 'node_modules'));
        } else if (kind === 'entry escaping package') {
            const local = path.join(f.root, 'node_modules/better-sqlite3');
            writeFixture(path.join(local, 'package.json'), JSON.stringify({ name: 'better-sqlite3', main: 'lib/database.js' }));
            fs.mkdirSync(path.join(local, 'lib'));
            fs.symlinkSync(path.join(ancestor, 'lib/database.js'), path.join(local, 'lib/database.js'));
        }
        const result = runNative(f.root);
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1, `${result.stderr}; dependencyExecuted=${fs.existsSync(f.marker)}`);
        assert.equal(fs.existsSync(f.marker), false, 'Unapproved dependency executed');
    });
}

function approvedSharedFixture(t) {
    const f = nativeFixture(t);
    const app = path.join(f.directory, 'MediFlow.app');
    const contents = path.join(app, 'Contents');
    const resources = path.join(contents, 'Resources');
    const web = path.join(resources, 'WebRuntime');
    const runtime = path.join(web, 'HeadlessRuntime');
    const launcher = path.join(resources, 'mediflow-headless-supervisor.mjs');
    const node = { major: 24, version: process.versions.node, moduleVersion: process.versions.modules,
        platform: process.platform, arch: process.arch, ...physicalRecord(process.execPath) };
    const identity = { schemaVersion: 1, revision: 'a'.repeat(40), branch: 'synthetic', worktreeHash: 'fixture',
        sourceFingerprint: `synthetic@${'a'.repeat(40)}:fixture`, buildId: 'synthetic-resolution-only' };
    writeFixture(path.join(web, 'package.json'), '{}');
    writeFixture(path.join(web, 'server.js'), 'throw new Error("Synthetic server must not run");');
    writeFixture(path.join(web, '.next/BUILD_ID'), identity.buildId);
    writeFixture(path.join(web, 'mediflow-build-identity.json'), JSON.stringify(identity));
    writeFixture(path.join(web, 'mediflow-runtime-contract.json'), JSON.stringify({ schemaVersion: 1,
        node: { major: node.major, version: node.version, moduleVersion: node.moduleVersion },
        platform: node.platform, arch: node.arch, betterSqlite3Version: 'synthetic-no-native-binding' }));
    writeFixture(path.join(runtime, '.nvmrc'), '24\n');
    writeFixture(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module', engines: { node: '>=24 <25' } }));
    for (const name of ['scripts/mediflow-headless-supervisor.mjs', 'scripts/node-runtime-contract.mjs']) {
        writeFixture(path.join(runtime, name), fs.readFileSync(path.join(sourceRoot, name)));
    }
    writeFixture(path.join(runtime, 'scripts/intelligent-host-mcp-stdio.mjs'), 'throw new Error("No agent execution");');
    writeFixture(path.join(runtime, 'scripts/register-strip-types-loader.mjs'), '// Inert fixture: no agent child.');
    // Only the synthetic .node format is substituted. The real launcher/roster
    // hooks and Supervisor entrypoint execute; application lifetime is inert.
    writeFixture(path.join(runtime, 'scripts/headless-source-loader.mjs'), `
        import { createRequire } from 'node:module';
        import fs from 'node:fs';
        const require = createRequire(import.meta.url);
        require.extensions['.node'] = (module, file) => {
            if (file !== ${JSON.stringify(path.join(contents, 'Frameworks/mediflow-web-better-sqlite3.node'))}) throw new Error('Wrong fixture binding');
            fs.appendFileSync(${JSON.stringify(f.marker)}, 'relocated\\n');
            module.exports = class {
                constructor(name) { if (name !== ':memory:') throw new Error('Wrong database'); }
                prepare(sql) { if (sql !== 'select 1 as value') throw new Error('Wrong probe'); return { get: () => ({ value: 1 }) }; }
                close() { fs.appendFileSync(${JSON.stringify(f.marker)}, 'close\\n'); }
            };
        };
    `);
    writeFixture(path.join(runtime, 'lib/security/portable-supervisor-production.ts'), `
        import fs from 'node:fs';
        export function createPortableSupervisorProductionV1(kind, options) {
            if (kind !== 'mcp' || options.webDirectory !== ${JSON.stringify(web)}) throw new Error('Wrong composition');
            fs.appendFileSync(${JSON.stringify(f.marker)}, 'inert-factory\\n');
            return { closed: Promise.resolve(), terminate() {} };
        }
    `);
    writeFixture(path.join(web, 'node_modules/better-sqlite3/package.json'), JSON.stringify({ main: 'lib/database.js' }));
    writeFixture(path.join(web, 'node_modules/better-sqlite3/lib/database.js'),
        "module.exports = require('../../../../../Frameworks/mediflow-web-better-sqlite3.node');\n");
    writeFixture(path.join(contents, 'Frameworks/mediflow-web-better-sqlite3.node'), 'INERT SYNTHETIC BINDING, NOT NATIVE CODE');
    const roster = { schemaVersion: 1, mode: 'mcp', node, identity,
        files: physicalFiles(contents).map(name => ({ path: name, ...physicalRecord(path.join(contents, name)) })) };
    const bytes = JSON.stringify(roster) + '\n';
    writeFixture(path.join(runtime, 'headless-roster.json'), bytes);
    const template = fs.readFileSync(path.join(sourceRoot, 'scripts/launch-bundled-headless-supervisor.mjs'), 'utf8');
    writeFixture(launcher, template.replace('__MEDIFLOW_HEADLESS_ROSTER_SHA256__', sha256(bytes)));
    const data = path.join(f.directory, 'data'); fs.mkdirSync(data);
    const run = () => spawnSync(process.execPath, [launcher], {
        env: { MEDIFLOW_DATA_DIR: data }, encoding: 'utf8', timeout: 10_000,
    });
    return { ...f, web, runtime, run };
}

test('approved bundled composition selects shared WebRuntime SQLite with a relocated fixture binding', t => {
    const f = approvedSharedFixture(t);
    assert.equal(fs.existsSync(path.join(f.runtime, 'node_modules/better-sqlite3')), false);
    assert.equal(fs.existsSync(path.join(f.web, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')), false);
    const result = f.run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(fs.readFileSync(f.marker, 'utf8'), 'relocated\nclose\ninert-factory\n');
});

test('bundled roster rejects altered shared SQLite before fixture code executes', t => {
    const f = approvedSharedFixture(t);
    fs.appendFileSync(path.join(f.web, 'node_modules/better-sqlite3/lib/database.js'), '// altered');
    const result = f.run();
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(f.marker), false);
});
