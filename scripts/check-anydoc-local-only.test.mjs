/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    ANYDOC_NATIVE_SUBPATH,
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
        `${validWorker}\nnew WebSocket('ws://local');`,
    ];
    for (const source of forbiddenSources) assert.notDeepEqual(validateAnyDocWorkerSource(source), []);
});

test('AnyDoc direct and composed references fail outside the worker', () => {
    const sources = [
        `import '${ANYDOC_NATIVE_SUBPATH}';`,
        `import('@firecrawl/' + 'anydoc');`,
        `const scope = '@firecrawl/'; const name = 'anydoc'; require(scope + name + '/cli.js');`,
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
