#!/usr/bin/env node
/* @Codex */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANYDOC_VERSION = '0.2.4';
export const ANYDOC_WORKER_PATH = 'scripts/anydoc-local-extraction-worker.mjs';
export const ANYDOC_NATIVE_SUBPATH = '@firecrawl/anydoc/index.js';

const EXPECTED_INTEGRITY = Object.freeze({
    '@firecrawl/anydoc': 'sha512-rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==',
    '@firecrawl/anydoc-darwin-arm64': 'sha512-1Eg0rPGVMN052E7Y2+zswANS0KLaWhXvYb9CPgO8HEtclzu3hKAIJ00lIu5PF+DXafZ10ZS4fmrcP+9Ifct9qw==',
    '@firecrawl/anydoc-darwin-x64': 'sha512-fTM8y6COu+jBqWRJ0Je0OqaDDt7YxJ8LU4ISoypO5eOBNXI3+l6tK1ZRwUclYWXGBr/6JaUWEgdyJVFfd/fpJg==',
    '@firecrawl/anydoc-linux-arm64-gnu': 'sha512-gRrrjluTfQCjOO6wBefEP1QumYlUcGWKP7secVIO+ly8U/+DDQ70bOHW2lOGu19hA/23j7bc7bb3oLPAaBY82A==',
    '@firecrawl/anydoc-linux-arm64-musl': 'sha512-fpzby6xqD709GmYUpnrWh7/2Csa6lwGrZrYPNGyn4KMEuJ1ibsNv6I3kdZAotMUKZ8nlNdPp32v964eBpsijcw==',
    '@firecrawl/anydoc-linux-x64-gnu': 'sha512-yfvx+iGo2CvZH0TB9MeyNjkrd5/psNFEuxkl2Jah/VNFesPRASqjjCkDRY7tKw7fPij1u/UyFVxI6bsu6Iow9Q==',
    '@firecrawl/anydoc-linux-x64-musl': 'sha512-9OWpM84c5SA/2wjfFxgfhupxziapus+7DERWmcOvkVxNp2H5Qj/9Y74c9leP2i03SjmBDl9tYWMVd3k/S3rY6w==',
    '@firecrawl/anydoc-win32-x64-msvc': 'sha512-E7d14hy5kZNsMNnHiutU6r9yr53LrKXSsMSFtl0QhU/1KWuvRnjhQEuMiuW4YbsMcPlEaK10WtBVF86g9OMW6A==',
});
const NATIVE_PACKAGES = Object.freeze(Object.keys(EXPECTED_INTEGRITY).filter((name) => name !== '@firecrawl/anydoc'));
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SCAN_ROOTS = ['app', 'components', 'lib', 'scripts'];
const SELF_FILES = new Set(['scripts/check-anydoc-local-only.mjs', 'scripts/check-anydoc-local-only.test.mjs']);

function sameMembers(left, right) {
    return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function validateAnyDocSupplyChain(packageJson, packageLock) {
    const issues = [];
    if (packageJson?.dependencies?.['@firecrawl/anydoc'] !== ANYDOC_VERSION) issues.push('package dependency must pin @firecrawl/anydoc 0.2.4 exactly');
    const packages = packageLock?.packages;
    if (!packages || typeof packages !== 'object') return [...issues, 'package-lock packages map is missing'];
    if (packages['']?.dependencies?.['@firecrawl/anydoc'] !== ANYDOC_VERSION) issues.push('package-lock root dependency drift');
    const root = packages['node_modules/@firecrawl/anydoc'];
    if (root?.engines?.node !== '>= 20') issues.push('AnyDoc Node engine drift');
    if (root?.hasInstallScript !== undefined) issues.push('AnyDoc install script is forbidden');
    if (!sameMembers(Object.keys(root?.optionalDependencies ?? {}), NATIVE_PACKAGES)) issues.push('AnyDoc native package set drift');
    if (Object.values(root?.optionalDependencies ?? {}).some((version) => version !== ANYDOC_VERSION)) issues.push('AnyDoc native dependency version drift');
    const lockedNativePackages = Object.keys(packages)
        .filter((key) => key.startsWith('node_modules/@firecrawl/anydoc-'))
        .map((key) => key.slice('node_modules/'.length));
    if (!sameMembers(lockedNativePackages, NATIVE_PACKAGES)) issues.push('AnyDoc locked native package set drift');
    for (const [name, integrity] of Object.entries(EXPECTED_INTEGRITY)) {
        const entry = packages[`node_modules/${name}`];
        if (entry?.version !== ANYDOC_VERSION) issues.push(`${name} version drift`);
        if (entry?.integrity !== integrity) issues.push(`${name} integrity drift`);
        if (entry?.hasInstallScript !== undefined) issues.push(`${name} install script is forbidden`);
        if (name !== '@firecrawl/anydoc' && entry?.optional !== true) issues.push(`${name} must remain optional`);
    }
    return issues;
}

function packageReferences(source) {
    return [...source.matchAll(/['"](@firecrawl\/anydoc(?:\/[^'"]*)?)['"]/gu)].map((match) => match[1]);
}

export function validateAnyDocWorkerSource(source) {
    const issues = [];
    const references = packageReferences(source);
    if (references.length !== 1 || references[0] !== ANYDOC_NATIVE_SUBPATH) issues.push(`worker must import exactly ${ANYDOC_NATIVE_SUBPATH}`);
    const forbidden = [
        [/\bocr\s*:\s*['"]hosted['"]/u, 'hosted OCR option'],
        [/FIRECRAWL_API_KEY/u, 'FIRECRAWL_API_KEY'],
        [/FIRECRAWL_API_URL/u, 'FIRECRAWL_API_URL'],
        [/NAPI_RS_NATIVE_LIBRARY_PATH/u, 'NAPI_RS_NATIVE_LIBRARY_PATH'],
        [/\bfetch\s*\(/u, 'fetch'],
        [/(?:['"](?:node:)?https?['"]|https?:\/\/)/u, 'HTTP module or URL'],
        [/(?:node:)?(?:net|tls)['"]/u, 'network socket module'],
        [/\b(?:WebSocket|XMLHttpRequest)\b/u, 'browser network API'],
    ];
    for (const [pattern, label] of forbidden) if (pattern.test(source)) issues.push(`${label} is forbidden`);
    return issues;
}

async function sourceFiles(root) {
    const files = [];
    async function walk(directory) {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
        }
    }
    for (const directory of SCAN_ROOTS) await walk(path.join(root, directory));
    return files;
}

export async function runAnyDocLocalOnlyGuard(root) {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    const issues = validateAnyDocSupplyChain(packageJson, packageLock);
    let workerSeen = false;
    for (const absolute of await sourceFiles(root)) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (SELF_FILES.has(relative)) continue;
        const source = await readFile(absolute, 'utf8');
        const references = packageReferences(source);
        if (relative === ANYDOC_WORKER_PATH) {
            workerSeen = true;
            issues.push(...validateAnyDocWorkerSource(source).map((issue) => `${relative}: ${issue}`));
        } else if (references.length > 0) {
            issues.push(`${relative}: AnyDoc package use is allowed only in ${ANYDOC_WORKER_PATH}`);
        }
    }
    if (issues.length > 0) throw new Error(`AnyDoc local-only guard failed:\n- ${issues.join('\n- ')}`);
    return { workerSeen, checkedPackages: Object.keys(EXPECTED_INTEGRITY).length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const result = await runAnyDocLocalOnlyGuard(process.cwd());
    console.log(`AnyDoc local-only guard: PASS (${result.checkedPackages} packages; worker ${result.workerSeen ? 'checked' : 'not present'})`);
}
