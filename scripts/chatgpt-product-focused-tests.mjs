#!/usr/bin/env node
/* @Codex — no installer, network dependency resolution, personal home or DB smoke. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, mkdirSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fail(message) { console.error(message); process.exit(2); }
if (Number(process.versions.node.split('.')[0]) !== 24) fail(`NODE24_REQUIRED: observed ${process.versions.node}; no alternative-runtime PASS is accepted.`);
const args = process.argv.slice(2);
if (args.some(arg => !['--browser', '--loopback-proxy'].includes(arg))) fail('Usage: MEDIFLOW_DATA_DIR=<absolute fresh run-owned synthetic directory> node scripts/chatgpt-product-focused-tests.mjs [--browser] [--loopback-proxy]');
const raw = process.env.MEDIFLOW_DATA_DIR;
if (!raw || !isAbsolute(raw) || resolve(raw) === root) fail('EXPLICIT_SYNTHETIC_DATA_DIR_REQUIRED');
const directory = resolve(raw);
if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) fail('DATA_DIR_MUST_BE_AN_OWNED_DIRECTORY');
const resolvedDirectory = realpathSync(directory);
// Reject aliases through a symlink/junction, including parent paths, instead of
// discovering or falling back to the application's configured data directory.
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
if (normalize(resolvedDirectory) !== normalize(directory)) fail('DATA_DIR_ALIAS_DENIED_USE_CANONICAL_RUN_OWNED_PATH');
const marker = join(directory, '.chatgpt-product-synthetic-only.json');
const signature = { schema: 'mediflow.chatgpt-product-test-dir.v1', clinicalData: false };
if (existsSync(marker)) {
    if (lstatSync(marker).isSymbolicLink() || JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) !== JSON.stringify(signature)) fail('DATA_DIR_MARKER_INVALID');
} else {
    if (readdirSync(directory).length) fail('REFUSE_NONEMPTY_UNMARKED_DATA_DIR');
    writeFileSync(marker, JSON.stringify(signature), { mode: 0o600, flag: 'wx' });
}
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const pinned = lock.packages?.['node_modules/@mediflow/web-auth-lifecycle-owner'];
const sourceOwner = JSON.parse(readFileSync(join(root, 'packages/web-auth-lifecycle-owner/package.json'), 'utf8'));
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declaredArchive = rootPackage.dependencies?.['@mediflow/web-auth-lifecycle-owner'];
if (pinned?.version !== sourceOwner.version || !pinned.resolved?.startsWith('file:')
    || declaredArchive !== pinned.resolved || lock.packages?.['']?.dependencies?.['@mediflow/web-auth-lifecycle-owner'] !== declaredArchive
    || !pinned.integrity?.startsWith('sha512-')) fail('OWNER_LOCK_CONTRACT_MISSING');
const archive = resolve(root, pinned.resolved.slice(5));
if (relative(root, archive).startsWith('..' + sep) || relative(root, archive) === '..') fail('OWNER_ARCHIVE_OUTSIDE_SOURCE');
const digest = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
if (digest !== pinned.integrity) fail('OWNER_ARCHIVE_INTEGRITY_MISMATCH');
const provenance = JSON.parse(readFileSync(archive.replace(/\.tgz$/u, '.provenance.json'), 'utf8'));
if (provenance.package?.version !== sourceOwner.version || provenance.package?.name !== sourceOwner.name
    || provenance.artifact?.integrity !== digest || provenance.artifact?.bytes !== lstatSync(archive).size
    || provenance.artifact?.sha256 !== createHash('sha256').update(readFileSync(archive)).digest('hex')
    || resolve(root, provenance.artifact?.path ?? '') !== archive) fail('OWNER_PROVENANCE_MISMATCH');
const require = createRequire(join(root, 'package.json'));
// Compare installed owner implementation with the attached frozen package. This
// runner never writes node_modules or installs a replacement owner.
for (const packageName of ['typescript', '@mediflow/web-auth-lifecycle-owner']) {
    try { require.resolve(packageName); } catch { fail(`LOCKED_DEPENDENCY_MISSING: ${packageName}`); }
}
const ownerRoot = dirname(require.resolve('@mediflow/web-auth-lifecycle-owner'));
function verifyOwnerTree(path = join(root, 'packages/web-auth-lifecycle-owner'), child = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (!child && entry.name === 'artifacts') continue;
        const suffix = join(child, entry.name), source = join(path, entry.name), installed = join(ownerRoot, suffix);
        if (entry.isDirectory()) {
            if (!existsSync(installed) || lstatSync(installed).isSymbolicLink() || !lstatSync(installed).isDirectory()) fail(`OWNER_INSTALLED_DIRECTORY_MISMATCH: ${suffix}`);
            verifyOwnerTree(source, suffix); continue;
        }
        if (!entry.isFile() || !existsSync(installed) || lstatSync(installed).isSymbolicLink() || !readFileSync(source).equals(readFileSync(installed))) fail(`OWNER_INSTALLED_PREIMAGE_MISMATCH: ${suffix}`);
    }
}
if (lstatSync(ownerRoot).isSymbolicLink() || realpathSync(ownerRoot) !== ownerRoot) fail('OWNER_INSTALLED_ALIAS_DENIED');
verifyOwnerTree();
function rejectInstalledExtras(path = ownerRoot, child = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        const suffix = join(child, entry.name), installed = join(path, entry.name), source = join(root, 'packages/web-auth-lifecycle-owner', suffix);
        if (entry.isSymbolicLink() || !existsSync(source) || (!child && entry.name === 'artifacts')) fail(`OWNER_INSTALLED_EXTRA: ${suffix}`);
        if (entry.isDirectory()) rejectInstalledExtras(installed, suffix);
        else if (!entry.isFile()) fail(`OWNER_INSTALLED_TYPE_MISMATCH: ${suffix}`);
    }
}
rejectInstalledExtras();
const tests = [];
for (const folder of ['lib/chatgpt-product', 'lib/chatgpt-account', 'lib/chatgpt-execution']) {
    for (const entry of readdirSync(join(root, folder)).sort()) {
        if (!entry.endsWith('.test.ts') && !entry.endsWith('.test.cjs')) continue;
        if (entry === 'execution-egress-proxy.test.ts' && !args.includes('--loopback-proxy')) continue;
        tests.push(`${folder}/${entry}`);
    }
}
tests.push('lib/security/native-inference.test.cjs', 'lib/security/native-ordinary-content.test.cjs', 'lib/security/native-ordinary-host-sources.test.cjs');
tests.push('lib/ai-providers/fabric/chatgpt-synthetic-synthesis-binding.test.ts', 'components/settings/chatgpt-synthesis-panel.test.ts');
if (args.includes('--browser')) tests.push('e2e/chatgpt-synthesis-product.spec.ts', 'lib/chatgpt-account/account-product.browser.test.mjs');
const command = [join(root, 'scripts/run-strip-types.mjs'), '--test', '--test-concurrency=1', ...tests];
console.log(JSON.stringify({ node: process.version, ownerVersion: pinned.version, ownerArchiveIntegrity: digest,
    testData: 'explicit-run-owned-synthetic', selectedTests: tests, loopbackProxy: args.includes('--loopback-proxy'),
    browser: args.includes('--browser'), liveProvider: 'NOT_RUN', osQualification: 'NOT_RUN' }, null, 2));
const result = spawnSync(process.execPath, command, { cwd: root, stdio: 'inherit', shell: false,
    env: { ...process.env, MEDIFLOW_DATA_DIR: directory, NEXT_TELEMETRY_DISABLED: '1' } });
if (result.error) fail(`TEST_PROCESS_FAILED: ${result.error.code ?? 'unknown'}`);
process.exit(result.status ?? 1);
