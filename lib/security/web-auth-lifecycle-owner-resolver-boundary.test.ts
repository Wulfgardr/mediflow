/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER_STEM = ['web-auth-life', 'cycle-owner'].join('');
const PACKAGE = `@mediflow/${OWNER_STEM}`;
const D1A = `lib/security/${OWNER_STEM}-boundary.test.ts`;
const D1B = `lib/security/${OWNER_STEM}-resolver-boundary.test.ts`;
const GUARD_SCRIPT = `check:${OWNER_STEM}-boundary`;
const GUARD_COMMAND = `node scripts/run-strip-types.mjs --test ${D1A} ${D1B}`;
const NEXT_AST_SHA256 = '6ce42676490da267f3fa21dbc6bee69dafb81900cede602710a53db7db09154d';
const EXPECTED_TSCONFIG_RESOLVER = {
    extends: null, moduleResolution: 'bundler', baseUrl: null, paths: { '@/*': ['./*'] }, rootDirs: null,
    moduleSuffixes: null, customConditions: null,
};
const EXPECTED_SCRIPTS = {
    [`pre${GUARD_SCRIPT}`]: null,
    [GUARD_SCRIPT]: GUARD_COMMAND,
    [`post${GUARD_SCRIPT}`]: null,
    predev: 'node scripts/node-runtime-contract.mjs verify',
    dev: 'next dev --turbopack --hostname 127.0.0.1 --port 3000', postdev: null,
    prebuild: 'node scripts/node-runtime-contract.mjs verify', build: 'next build',
    postbuild: 'node scripts/node-runtime-contract.mjs write-standalone-manifest && node scripts/check-standalone-runtime-bundle.mjs',
    prestart: 'node scripts/node-runtime-contract.mjs verify',
    start: 'next start --hostname 127.0.0.1 --port 3000',
    poststart: null,
};
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type PackageJson = Record<string, unknown>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: Json): string => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, JSON.parse(canonical(item))]))
    : Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item))) : value);
const parsedTypeScript = (file: string, source: string) =>
    ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const nextConfigErrors = (source: string): string[] => {
    const tree = parsedTypeScript('next.config.ts', source) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    if (tree.parseDiagnostics.length > 0) return ['next:parse'];
    const printed = ts.createPrinter({ removeComments: true }).printFile(tree);
    return digest(printed) === NEXT_AST_SHA256 ? [] : ['next:ast'];
};
const tsconfigErrors = (source: string): string[] => {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
    if (parsed.error || !parsed.config || typeof parsed.config !== 'object') return ['tsconfig:parse'];
    const config = parsed.config as Record<string, unknown>;
    const compiler = (config.compilerOptions ?? {}) as Record<string, Json>;
    const projection = {
        extends: (config.extends as Json | undefined) ?? null,
        moduleResolution: compiler.moduleResolution ?? null, baseUrl: compiler.baseUrl ?? null,
        paths: compiler.paths ?? null, rootDirs: compiler.rootDirs ?? null,
        moduleSuffixes: compiler.moduleSuffixes ?? null, customConditions: compiler.customConditions ?? null,
    };
    return canonical(projection) === canonical(EXPECTED_TSCONFIG_RESOLVER) ? [] : ['tsconfig:resolver'];
};
const packageErrors = (value: PackageJson): string[] => {
    const scripts = (value.scripts ?? {}) as Record<string, unknown>;
    const scriptProjection = Object.fromEntries(Object.keys(EXPECTED_SCRIPTS).map((key) => [key, scripts[key] ?? null]));
    const resolverProjection = Object.fromEntries(['imports', 'exports', 'browser'].map((key) => [key, value[key] ?? null]));
    const errors: string[] = [];
    if (canonical(scriptProjection as Json) !== canonical(EXPECTED_SCRIPTS)) errors.push('package:scripts');
    if (canonical(resolverProjection as Json) !== canonical({ imports: null, exports: null, browser: null })) errors.push('package:resolver');
    return errors;
};
const ignoredDirectory = (name: string) => name === '.git' || name === 'node_modules' || name === 'coverage'
    || name === '.turbo' || name.startsWith('.next');
const repositoryFiles = (root: string): string[] => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        return entry.isDirectory() && !ignoredDirectory(entry.name) ? walk(absolute) : entry.isDirectory() ? [] : [absolute];
    });
    return walk(root).map((file) => path.relative(root, file));
};
const inventoryErrors = (files: readonly string[]): string[] => {
    const normalized = files.map((file) => file.replaceAll(path.sep, '/')).filter((file) =>
        !file.split('/').slice(0, -1).some(ignoredDirectory));
    const nextConfigs = normalized.filter((file) => /^next\.config\.[^/]+$/u.test(path.basename(file))).sort();
    const packages = normalized.filter((file) => path.basename(file) === 'package.json').sort();
    const alternates = normalized.filter((file) => /^jsconfig(?:\..+)?\.json$/u.test(path.basename(file))
        || /^babel\.config\./u.test(path.basename(file)) || /^\.babelrc(?:\.|$)/u.test(path.basename(file)));
    const errors: string[] = [];
    if (canonical(nextConfigs) !== canonical(['next.config.ts'])) errors.push('inventory:next-config');
    if (canonical(packages) !== canonical(['package.json'])) errors.push('inventory:package');
    if (alternates.length > 0) errors.push('inventory:alternate-resolver');
    return errors;
};

const liveNext = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
const liveTsconfig = readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
const livePackage = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const liveFiles = repositoryFiles(ROOT);

test('freezes the sole comment-insensitive Next resolver surface', () => {
    assert.deepEqual(nextConfigErrors(liveNext), []);
    assert.deepEqual(nextConfigErrors(`// synthetic comment\n${liveNext.replace('config.resolve.alias.canvas = false;',
        'config.resolve.alias.canvas = false; /* neutral existing alias */')}`), []);
    const webpackMarker = 'config.resolve.alias.canvas = false;';
    const hostile = [
        `config.resolve.alias['${PACKAGE}'] = './owner-shim'; ${webpackMarker}`,
        `const key='@mediflow/'+'web-auth-life'+'cycle-owner';config.resolve.alias[key]='./owner-shim';${webpackMarker}`,
        `config.resolve.alias={...config.resolve.alias,'${PACKAGE}':'./owner-shim',canvas:false};`,
        `const ownerAliases={'${PACKAGE}':'./owner-shim'};config.resolve.alias={...config.resolve.alias,...ownerAliases};`,
        `new ResolverAliasPlugin({'${PACKAGE}':'./owner-shim'}).apply(config);${webpackMarker}`,
        `applyOwnerAlias(config);${webpackMarker}`,
    ];
    for (const replacement of hostile) assert.notDeepEqual(nextConfigErrors(liveNext.replace(webpackMarker, replacement)), []);
    assert.notDeepEqual(nextConfigErrors(`import {applyOwnerAlias} from './alias-helper';\n${liveNext.replace(
        webpackMarker, hostile.at(-1)!)}`), []);
    assert.notDeepEqual(nextConfigErrors(liveNext.replace('turbopack: {},',
        `turbopack:{resolveAlias:{'${PACKAGE}':'./owner-shim'}},`)), []);
});

test('freezes canonical TypeScript and package resolver projections', () => {
    assert.deepEqual(tsconfigErrors(liveTsconfig), []);
    assert.deepEqual(tsconfigErrors(`// order and whitespace are neutral\n${JSON.stringify({ compilerOptions: {
        paths: { '@/*': ['./*'] }, moduleResolution: 'bundler' }, include: [] }, null, 4)}`), []);
    for (const mutation of [
        { paths: { '@/*': ['./*'], [PACKAGE]: ['./owner-shim'] } }, { baseUrl: '.' }, { rootDirs: ['.', './owner-shim'] },
        { moduleSuffixes: ['.owner', ''] }, { customConditions: ['owner'] },
    ]) {
        const parsed = JSON.parse(liveTsconfig) as { compilerOptions: Record<string, unknown> };
        Object.assign(parsed.compilerOptions, mutation);
        assert.notDeepEqual(tsconfigErrors(JSON.stringify(parsed)), []);
    }
    assert.notDeepEqual(tsconfigErrors(JSON.stringify({ ...JSON.parse(liveTsconfig), extends: './owner-tsconfig.json' })), []);
    assert.deepEqual(packageErrors(livePackage), []);
    for (const [key, expected] of Object.entries(EXPECTED_SCRIPTS)) assert.notDeepEqual(packageErrors({ ...livePackage,
        scripts: { ...(livePackage.scripts as object), [key]: expected === null ? 'node synthetic-hook.mjs' : `${expected} && node synthetic-hook.mjs` } }), []);
    const reorderedScripts = Object.fromEntries(Object.entries(EXPECTED_SCRIPTS).reverse());
    assert.deepEqual(packageErrors(JSON.parse(JSON.stringify({ scripts: reorderedScripts, name: 'synthetic' }, null, 4))), []);
    for (const key of ['imports', 'exports', 'browser']) assert.notDeepEqual(packageErrors({ scripts: EXPECTED_SCRIPTS,
        [key]: { [PACKAGE]: './owner-shim' } }), []);
});

test('denies alternate resolver files, nested packages, and loss of the combined guard', () => {
    assert.deepEqual(inventoryErrors(liveFiles), []);
    const baseline = ['next.config.ts', 'package.json'];
    for (const file of ['next.config.js', 'next.config.mjs', 'jsconfig.json', '.babelrc', 'babel.config.cjs',
        'lib/security/package.json']) assert.notDeepEqual(inventoryErrors([...baseline, file]), [], file);
    assert.deepEqual(inventoryErrors([...baseline, 'node_modules/dep/package.json', '.next/cache/package.json']), []);
    assert.notDeepEqual(packageErrors({ ...livePackage, scripts: { ...(livePackage.scripts as object),
        [`pre${GUARD_SCRIPT}`]: `node synthetic-replace.mjs ${D1B} noop`,
        [`post${GUARD_SCRIPT}`]: `node synthetic-restore.mjs ${D1B}` } }), []);
    assert.notDeepEqual(packageErrors({ ...livePackage, scripts: { ...(livePackage.scripts as object),
        [GUARD_SCRIPT]: `node scripts/run-strip-types.mjs --test ${D1A}` } }), []);
});
