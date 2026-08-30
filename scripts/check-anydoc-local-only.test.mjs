/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    ANYDOC_NATIVE_SUBPATH,
    runAnyDocLocalOnlyGuard,
    validateAnyDocNonWorkerSource,
    validateAnyDocSupplyChain,
    validateAnyDocWorkerSource,
} from './check-anydoc-local-only.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const validWorker = `import { toMarkdownBytes } from '${ANYDOC_NATIVE_SUBPATH}';\nvoid toMarkdownBytes;`;

test('accepted supply chain and native-only worker source pass', () => {
    assert.deepEqual(validateAnyDocSupplyChain(packageJson, packageLock), []);
    assert.deepEqual(validateAnyDocWorkerSource(validWorker), []);
});

test('package root and CLI imports fail', () => {
    for (const specifier of ['@firecrawl/anydoc', '@firecrawl/anydoc/cli.js']) {
        assert.match(validateAnyDocWorkerSource(`import '${specifier}';`).join('\n'), /package root or CLI import/u);
    }
});

test('comments and strings do not satisfy the exact static import requirement', () => {
    assert.match(validateAnyDocWorkerSource(`// import '${ANYDOC_NATIVE_SUBPATH}';`).join('\n'), /exactly one static import/u);
    assert.match(validateAnyDocWorkerSource(`const note = '${ANYDOC_NATIVE_SUBPATH}';`).join('\n'), /exactly one static import/u);
    assert.deepEqual(validateAnyDocWorkerSource(`${validWorker}\n// import '@firecrawl/anydoc';`), []);
    assert.notDeepEqual(validateAnyDocWorkerSource(`${validWorker}\nimport 'node:fs';`), []);
    assert.notDeepEqual(validateAnyDocWorkerSource(`import type { Result } from '${ANYDOC_NATIVE_SUBPATH}';`), []);
    assert.notDeepEqual(validateAnyDocWorkerSource(`import '${ANYDOC_NATIVE_SUBPATH}';`), []);
    assert.notDeepEqual(validateAnyDocWorkerSource(`import {} from '${ANYDOC_NATIVE_SUBPATH}';`), []);
    assert.notDeepEqual(validateAnyDocWorkerSource(`import { toMarkdownBytes } from '${ANYDOC_NATIVE_SUBPATH}' with { type: 'json' };`), []);
});

test('dynamic, require, computed and template package loading fail', () => {
    const sources = [
        `${validWorker}\nimport('@firecrawl/' + 'anydoc');`,
        `${validWorker}\nconst scope = '@firecrawl/'; const name = 'anydoc'; import(scope + name);`,
        `${validWorker}\nrequire(\`@firecrawl/${'${'}'anydoc'}\`);`,
        `${validWorker}\nconst load = require; load('@firecrawl/' + 'anydoc');`,
        `${validWorker}\nglobalThis['require']('@firecrawl/anydoc/cli.js');`,
    ];
    for (const source of sources) assert.notDeepEqual(validateAnyDocWorkerSource(source), []);
});

test('hosted OCR, Firecrawl variables, native override and network use fail', () => {
    const forbiddenSources = [
        `${validWorker}\nconst options = { ocr: 'hosted' };`,
        `${validWorker}\nconst ocr = 'hosted'; const options = { ocr };`,
        `${validWorker}\nconst ocr = ['host', 'ed'].join(''); const options = { ocr };`,
        `${validWorker}\nconst options = { get ocr() { return 'hosted'; } };`,
        `${validWorker}\nconst options = { ocr() { return 'hosted'; } };`,
        `${validWorker}\nconst options = JSON.parse('{"ocr":"hosted"}');`,
        `${validWorker}\nconst options = {}; options.ocr = 'hosted';`,
        `${validWorker}\nconst options = {}; const mode = ['host', 'ed'].join(''); options.ocr = mode;`,
        `${validWorker}\nconst options = {}; options['o' + 'cr'] = 'hosted';`,
        `${validWorker}\nconst options = new class { ocr = 'hosted'; }();`,
        `${validWorker}\nconst [ocr] = ['hosted']; const options = { ocr };`,
        `${validWorker}\nconst { value: ocr = 'hosted' } = {}; const options = { ocr };`,
        `${validWorker}\nlet ocr; ({ ocr } = { ocr: 'hosted' }); const options = { ocr };`,
        `${validWorker}\nconst options = ((ocr) => ({ ocr }))('hosted');`,
        `${validWorker}\nconst [ocr] = ['hosted']; const base = { ocr }; const options = { ...base };`,
        `${validWorker}\nlet mode = 'hosted'; const options = { ocr: mode };`,
        `${validWorker}\nlet mode; mode = 'hosted'; const options = { ocr: mode };`,
        `${validWorker}\nconst options = ((mode) => ({ ocr: mode }))('hosted');`,
        `${validWorker}\nconst options = ((mode = 'hosted') => ({ ocr: mode }))();`,
        `${validWorker}\nconst options = ((...modes) => ({ ocr: modes[0] }))('hosted');`,
        `${validWorker}\nconst flag = true; const options = { ocr: flag ? 'hosted' : 'local' };`,
        `${validWorker}\nconst options = { ocr: (void 0, 'hosted') };`,
        `${validWorker}\nprocess.env.FIRECRAWL_API_KEY;`,
        `${validWorker}\nprocess.env.FIRECRAWL_API_URL;`,
        `${validWorker}\nprocess.env.NAPI_RS_NATIVE_LIBRARY_PATH;`,
        `${validWorker}\nfetch('/extract');`,
        `${validWorker}\nconst request = fetch; request('/extract');`,
        `${validWorker}\nglobalThis['fe' + 'tch']('/extract');`,
        `${validWorker}\nReflect.get(globalThis, 'fe' + 'tch')('/extract');`,
        `${validWorker}\nimport 'node:http';`,
        `${validWorker}\nimport 'node:https';`,
        `${validWorker}\nimport 'node:net';`,
        `${validWorker}\nconst prefix = 'node:'; import(prefix + 'http');`,
        `${validWorker}\nprocess.env['FIRECRAWL_' + 'API_KEY'];`,
        `${validWorker}\nReflect.get(process, 'e' + 'nv');`,
        `${validWorker}\nprocess.getBuiltinModule(['ht', 'tp'].join(''));`,
        `${validWorker}\nconst load = createRequire(import.meta.url); load(['@firecrawl/', 'anydoc/cli.js'].join(''));`,
        `${validWorker}\nObject.getOwnPropertyDescriptor(globalThis, ['fe', 'tch'].join('')).value;`,
        `${validWorker}\nconst env = Object.getOwnPropertyDescriptor(process, 'env').value; Object.getOwnPropertyDescriptor(env, ['FIRECRAWL_', 'API_KEY'].join('')).value;`,
        `${validWorker}\nnew WebSocket('ws://local');`,
    ];
    for (const source of forbiddenSources) assert.notDeepEqual(validateAnyDocWorkerSource(source), []);
});

test('AnyDoc direct and composed references fail outside the worker', () => {
    const sources = [
        `import '${ANYDOC_NATIVE_SUBPATH}';`,
        `import('@firecrawl/' + 'anydoc');`,
        `const scope = '@firecrawl/'; const name = 'anydoc'; require(scope + name + '/cli.js');`,
        `const spec = ['@firecrawl/', 'anydoc/index.js'].join(''); import(spec);`,
        `const spec = 'safe'; { const spec = ['@firecrawl/', 'anydoc/index.js'].join(''); import(spec); }`,
        `const spec = 'safe'; const spec = ['@firecrawl/', 'anydoc/index.js'].join(''); import(spec);`,
    ];
    for (const source of sources) assert.notDeepEqual(validateAnyDocNonWorkerSource(source), []);
    assert.deepEqual(validateAnyDocNonWorkerSource(`// import '@firecrawl/anydoc';\nconst parser = 'anydoc-local';`), []);
});

test('version, integrity and native package drift fail', () => {
    const cases = [];
    const dependencyDrift = structuredClone(packageJson);
    dependencyDrift.dependencies['@firecrawl/anydoc'] = '^0.2.4';
    cases.push([dependencyDrift, packageLock]);
    const versionDrift = structuredClone(packageLock);
    versionDrift.packages['node_modules/@firecrawl/anydoc'].version = '0.2.5';
    cases.push([packageJson, versionDrift]);
    const integrityDrift = structuredClone(packageLock);
    integrityDrift.packages['node_modules/@firecrawl/anydoc-darwin-arm64'].integrity = 'sha512-drift';
    cases.push([packageJson, integrityDrift]);
    const nativeSetDrift = structuredClone(packageLock);
    nativeSetDrift.packages['node_modules/@firecrawl/anydoc'].optionalDependencies['@firecrawl/anydoc-extra'] = '0.2.4';
    cases.push([packageJson, nativeSetDrift]);
    const nativeVersionDrift = structuredClone(packageLock);
    nativeVersionDrift.packages['node_modules/@firecrawl/anydoc'].optionalDependencies['@firecrawl/anydoc-darwin-arm64'] = '0.2.5';
    cases.push([packageJson, nativeVersionDrift]);
    const lockRootDrift = structuredClone(packageLock);
    lockRootDrift.packages[''].dependencies['@firecrawl/anydoc'] = '^0.2.4';
    cases.push([packageJson, lockRootDrift]);
    const optionalDrift = structuredClone(packageLock);
    optionalDrift.packages['node_modules/@firecrawl/anydoc-linux-x64-gnu'].optional = false;
    cases.push([packageJson, optionalDrift]);
    for (const [candidatePackage, candidateLock] of cases) assert.notDeepEqual(validateAnyDocSupplyChain(candidatePackage, candidateLock), []);
});

test('retired PDF inspector cannot be reintroduced through project inputs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mediflow-pdf-retirement-source-'));

    async function reset() {
        await rm(root, { recursive: true, force: true });
        await mkdir(path.join(root, 'scripts'), { recursive: true });
        await writeFile(path.join(root, 'package.json'), JSON.stringify(packageJson));
        await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(packageLock));
        await writeFile(path.join(root, 'next.config.ts'), 'export default {};\n');
        await writeFile(path.join(root, 'scripts', 'anydoc-local-extraction-worker.mjs'), validWorker);
    }

    async function expectFailure(mutate) {
        await reset();
        await mutate();
        await assert.rejects(runAnyDocLocalOnlyGuard(root), /retired PDF inspector/u);
    }

    try {
        await reset();
        assert.deepEqual(await runAnyDocLocalOnlyGuard(root), { workerSeen: true, checkedPackages: 8 });
        await reset();
        const aliasPackage = structuredClone(packageJson);
        aliasPackage.dependencies['retired-parser'] = 'npm:@firecrawl/pdf-inspector@1.12.0';
        await writeFile(path.join(root, 'package.json'), JSON.stringify(aliasPackage));
        await writeFile(path.join(root, 'scripts', 'legacy.ts'), "import 'retired-parser/internal.js';\n");
        await assert.rejects(runAnyDocLocalOnlyGuard(root), (error) => error instanceof Error
            && /dependency is forbidden/u.test(error.message)
            && /legacy\.ts: retired PDF inspector alias import is forbidden/u.test(error.message));
        await expectFailure(async () => {
            const value = structuredClone(packageJson);
            value.dependencies['@firecrawl/pdf-inspector'] = '1.12.0';
            await writeFile(path.join(root, 'package.json'), JSON.stringify(value));
        });
        await expectFailure(async () => {
            const value = structuredClone(packageLock);
            value.packages['node_modules/@firecrawl/pdf-inspector-linux-x64-gnu'] = { version: '1.12.0' };
            await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(value));
        });
        await expectFailure(async () => {
            const value = structuredClone(packageLock);
            value.packages[''].dependencies['retired-parser'] = 'file:vendor/retired-parser';
            value.packages['node_modules/retired-parser'] = {
                name: '@firecrawl/pdf-inspector',
                resolved: 'file:vendor/retired-parser',
            };
            await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(value));
        });
        await expectFailure(async () => {
            const value = structuredClone(packageLock);
            value.packages['node_modules/renamed-parser'] = {
                name: 'renamed-parser',
                resolved: 'https://registry.npmjs.org/@firecrawl/pdf-inspector/-/pdf-inspector-1.12.0.tgz',
            };
            await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(value));
        });
        await expectFailure(async () => {
            const value = structuredClone(packageLock);
            value.packages['node_modules/renamed-parser'] = {
                name: 'renamed-parser',
                version: 'npm:@firecrawl/pdf-inspector@1.12.0',
            };
            await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(value));
        });
        await expectFailure(() => writeFile(path.join(root, 'next.config.ts'), "const traced = '@firecrawl/' + 'pdf-inspector';\n"));
        await expectFailure(() => writeFile(path.join(root, 'scripts', 'legacy.ts'), "import '@firecrawl/pdf-inspector';\n"));
        await expectFailure(async () => {
            const target = path.join(root, 'retired-worker-target.mjs');
            await writeFile(target, 'export {};\n');
            await symlink(target, path.join(root, 'scripts', 'pdf-inspector-worker.mjs'));
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
