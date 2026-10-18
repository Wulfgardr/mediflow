#!/usr/bin/env node
// Owns one disposable synthetic Next runtime, following the canonical
// network-home-base-write-smoke.sh copy/configuration/bootstrap recipe.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomBytes, randomInt } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from './crypto.mjs';
import { compareReports, compareResourceWritesReports, comparePatientProfileWritesReports } from './compare.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
    if (!['--rust-probe', '--output-dir', '--samples'].includes(args[index]) || !args[index + 1] || options.has(args[index])) {
        throw new Error('Usage: node run.mjs --rust-probe /path/to/release/mediflow-runtime-probe [--output-dir /path/to/reports] [--samples 5]');
    }
    options.set(args[index], args[index + 1]);
}
if (!options.has('--rust-probe')) throw new Error('--rust-probe is required; the runner never builds or downloads a binary implicitly');
if (process.platform !== 'linux') throw new Error('This owned HTTP runtime qualification currently follows the Linux smoke recipe; native compile/test jobs cover other OSes separately');
const probe = path.resolve(options.get('--rust-probe'));
fs.accessSync(probe, fs.constants.X_OK);
const samples = Number(options.get('--samples') ?? 5);
if (!Number.isInteger(samples) || samples < 5 || samples > 30) throw new Error('--samples must be an integer from 5 to 30');
const outputDirectory = options.has('--output-dir') ? path.resolve(options.get('--output-dir')) : fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-comparison-report-'));
fs.mkdirSync(outputDirectory, { recursive: true });
if (fs.readdirSync(outputDirectory).length > 0) throw new Error('The report directory must be empty to prevent mixing runs');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-transition-'));
fs.chmodSync(owned, 0o700);
const workspace = path.join(owned, 'candidate-current');
const dataDirectory = path.join(owned, 'data-candidate');
const logDirectory = path.join(owned, 'logs');
const privatePath = path.join(owned, 'candidate-private.json');
const clientPath = path.join(owned, 'candidate-client-private.json');
const sourceEntries = ['app', 'components', 'lib', 'public', 'drizzle', 'packages', 'package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.mjs'];
let server;
let phase = 'prepare';
let result;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const save = (name, value) => fs.writeFileSync(path.join(outputDirectory, name), JSON.stringify(value, null, 2) + '\n');
const savePrivate = (name, value) => fs.writeFileSync(path.join(owned, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

async function availablePort() {
    const listener = net.createServer();
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    return port;
}

function copyWorkspace() {
    fs.mkdirSync(workspace);
    for (const entry of sourceEntries) fs.cpSync(path.join(repository, entry), path.join(workspace, entry), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'scripts'));
    for (const script of ['prepare-e2e-db.mjs', 'web-auth-control-test-client.mjs']) {
        fs.copyFileSync(path.join(repository, 'scripts', script), path.join(workspace, 'scripts', script));
    }
    // Installed dependencies must match npm ci. The auth owner is a physical
    // copy so another local checkout operation cannot change the running host.
    const installed = path.join(repository, 'node_modules');
    for (const required of ['next', 'typescript', '@types/react', '@types/node', '@mediflow/web-auth-lifecycle-owner']) fs.accessSync(path.join(installed, required));
    const modules = path.join(workspace, 'node_modules');
    fs.mkdirSync(modules);
    for (const entry of fs.readdirSync(installed)) {
        if (entry !== '@mediflow') {
            fs.symlinkSync(path.join(installed, entry), path.join(modules, entry));
            continue;
        }
        fs.mkdirSync(path.join(modules, entry));
        for (const name of fs.readdirSync(path.join(installed, entry))) {
            const source = path.join(installed, entry, name);
            const destination = path.join(modules, entry, name);
            if (name === 'web-auth-lifecycle-owner') fs.cpSync(source, destination, { recursive: true, dereference: true });
            else fs.symlinkSync(source, destination);
        }
    }
    fs.writeFileSync(path.join(workspace, 'next.config.ts'), `import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone", distDir: ".next-transition-candidate", turbopack: {},
  serverExternalPackages: ["@mediflow/web-auth-lifecycle-owner", "pdfjs-dist", "pm2"],
  webpack: (config) => { config.resolve.alias.canvas = false; return config; },
};
export default nextConfig;
`);
}

function sourceReceipt() {
    const manifest = [];
    const visit = (relative) => {
        const absolute = path.join(workspace, relative);
        if (fs.statSync(absolute).isDirectory()) {
            for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
        } else manifest.push({ path: relative.split(path.sep).join('/'), sha256: sha256(fs.readFileSync(absolute)) });
    };
    for (const entry of [...sourceEntries, 'scripts']) visit(entry);
    manifest.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const owner = JSON.parse(fs.readFileSync(path.join(workspace, 'node_modules/@mediflow/web-auth-lifecycle-owner/package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json'), 'utf8'));
    if (owner.version !== lock.packages['node_modules/@mediflow/web-auth-lifecycle-owner'].version) throw new Error('Installed auth owner differs from the copied lockfile');
    save('source-manifest.json', manifest);
    return {
        baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
        hostDiffSha256: sha256(execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', ...sourceEntries], { cwd: repository })),
        sourceManifestSha256: sha256(canonicalJson(manifest)), copiedFileCount: manifest.length,
        ownerVersion: owner.version, ownerPhysicalCopy: true, nodeVersion: process.version,
        rustProbeSha256: sha256(fs.readFileSync(probe)), runtimeMode: 'Next dev --webpack; optimized Rust probe supplied by caller',
    };
}

async function execute(command, commandArgs, environment, cwd = repository) {
    const name = `${phase}-${randomBytes(4).toString('hex')}`;
    const stderr = fs.openSync(path.join(logDirectory, `${name}.stderr.log`), 'w', 0o600);
    const child = spawn(command, commandArgs, { cwd, env: environment, stdio: ['ignore', 'pipe', stderr] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > 2_097_152) child.kill('SIGTERM');
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    try {
        const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
        if (status !== 0) {
            // Probe failures contain only closed diagnostic codes. Keep those
            // codes in the public synthetic artifact instead of losing the
            // reason when the disposable runtime is cleaned up.
            try {
                const failed = JSON.parse(stdout);
                const code = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,95}$/u.test(value);
                if (failed.result === 'fail' && code(failed.phase) && code(failed.reason)) {
                    save(`${phase}-failure.json`, { result: 'fail', phase: failed.phase, reason: failed.reason,
                        status: Number.isInteger(failed.status) && failed.status >= 400 && failed.status <= 599 ? failed.status : null });
                }
            } catch { /* Never retain arbitrary child output or credentials. */ }
            throw new Error(`${phase}: child exited ${status}; no successful receipt was issued`);
        }
        return stdout.trim();
    } finally {
        clearTimeout(timer);
        fs.closeSync(stderr);
    }
}

function distribution(values) {
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Adapter timing observation is missing or invalid');
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return { samples: values.length, medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, minMs: sorted[0], maxMs: sorted.at(-1) };
}

try {
    fs.mkdirSync(dataDirectory, { mode: 0o700 });
    fs.mkdirSync(logDirectory, { mode: 0o700 });
    copyWorkspace();
    const provenance = sourceReceipt();
    save('provenance.json', provenance);
    const port = await availablePort();
    const runtime = {
        MEDIFLOW_DATA_DIR: dataDirectory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
        MEDIFLOW_LOCAL_API_TOKEN: randomBytes(32).toString('base64url'),
        E2E_USERNAME: `synthetic-${randomBytes(8).toString('hex')}`, E2E_PIN: String(randomInt(0, 100_000_000)).padStart(8, '0'),
        E2E_PASSPHRASE: `confronto sintetico ${randomBytes(32).toString('base64url')}`,
        E2E_DISPLAY_NAME: 'Dr. Confronto Sintetico', E2E_AMBULATORY_NAME: 'Casa di Comunità — Prova sintetica',
        E2E_BASE_URL: `http://127.0.0.1:${port}`, MEDIFLOW_LOCAL_AUTHORITY: '0',
        MEDIFLOW_PROVIDER_V2_ENABLED: '0', MEDIFLOW_PROVIDER_V2_NETWORK: '0', MEDIFLOW_ICD_WHO_ENABLED: '0',
        NEXT_TELEMETRY_DISABLED: '1', TMPDIR: owned,
    };
    savePrivate('candidate-private.json', runtime);
    // No ambient provider credentials or developer API tokens enter the host.
    const environment = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC', ...runtime };
    phase = 'golden-vectors';
    save('golden-vectors.json', JSON.parse(await execute(process.execPath, [path.join(directory, 'verify-vectors.mjs')], environment)));
    phase = 'bootstrap';
    await execute(process.execPath, ['scripts/prepare-e2e-db.mjs'], environment, workspace);
    phase = 'start';
    const serverLog = fs.openSync(path.join(logDirectory, 'next.log'), 'w', 0o600);
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', workspace, '--webpack', '--hostname', '127.0.0.1', '--port', String(port)],
        { cwd: workspace, env: environment, detached: true, stdio: ['ignore', serverLog, serverLog] });
    fs.closeSync(serverLog);
    server.on('error', () => {});
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
        try {
            const response = await fetch(`${runtime.E2E_BASE_URL}/api/v1/ambulatories`, {
                headers: { Authorization: `Bearer ${runtime.MEDIFLOW_LOCAL_API_TOKEN}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
            });
            if (response.ok && Array.isArray(await response.json())) { ready = true; break; }
        } catch { /* Startup readiness is bounded; no clinical mutation is retried. */ }
        await sleep(500);
    }
    if (!ready) throw new Error('The owned runtime did not pass authenticated readiness before its deadline');
    phase = 'seed';
    await execute(process.execPath, [path.join(directory, 'prepare-runtime.mjs'), 'candidate', privatePath, workspace], environment);
    const client = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
    save('seed-receipt.json', JSON.parse(fs.readFileSync(path.join(owned, 'candidate-seed-receipt.json'), 'utf8')));
    const runClient = async (name, configPath, label) => {
        phase = `${label}-${name}`;
        const report = JSON.parse(await execute(name === 'javascript' ? process.execPath : probe,
            name === 'javascript' ? [path.join(directory, 'js-client.mjs'), '--config', configPath] : ['--config', configPath], environment));
        save(`${label}-${name}.json`, report);
        return report;
    };
    const warmJavascript = await runClient('javascript', clientPath, 'warmup');
    const warmRust = await runClient('rust', clientPath, 'warmup');
    save('warmup-comparison.json', compareReports(warmJavascript, warmRust));
    const measurements = { javascript: [], rust: [] };
    for (let index = 0; index < samples; index += 1) {
        const observed = {};
        const label = `sample-${String(index + 1).padStart(2, '0')}`;
        for (const name of index % 2 === 0 ? ['javascript', 'rust'] : ['rust', 'javascript']) {
            observed[name] = await runClient(name, clientPath, label);
            measurements[name].push(observed[name].timingsMs);
        }
        save(`${label}-comparison.json`, compareReports(observed.javascript, observed.rust));
    }
    const mutationReports = {};
    for (const name of ['javascript', 'rust']) {
        const configName = `${name}-writes-private.json`;
        savePrivate(configName, { ...client, exerciseWrites: true, writePatientId: client.writePatientIds[name] });
        mutationReports[name] = await runClient(name, path.join(owned, configName), 'writes');
    }
    const comparison = compareReports(mutationReports.javascript, mutationReports.rust);
    save('writes-comparison.json', comparison);
    const resourceFixture = JSON.parse(fs.readFileSync(path.join(directory, 'resource-writes.json'), 'utf8'));
    const resourceReports = {};
    for (const name of ['javascript', 'rust']) {
        const configName = `${name}-resources-private.json`;
        savePrivate(configName, { ...client, exerciseWrites: false, exerciseResourceWrites: true,
            resourceWritesSha256: sha256(canonicalJson(resourceFixture)), writePatientId: client.writePatientIds[name] });
        resourceReports[name] = await runClient(name, path.join(owned, configName), 'resources');
    }
    const resourceComparison = compareResourceWritesReports(resourceReports.javascript, resourceReports.rust);
    save('resources-comparison.json', resourceComparison);
    const profileFixture = JSON.parse(fs.readFileSync(path.join(directory, 'patient-profile-writes.json'), 'utf8'));
    const profileReports = {};
    for (const name of ['javascript', 'rust']) {
        const configName = `${name}-patient-profiles-private.json`;
        savePrivate(configName, { ...client, exerciseWrites: false, exerciseResourceWrites: false,
            exercisePatientProfileWrites: true, patientProfileWritesSha256: sha256(canonicalJson(profileFixture)) });
        profileReports[name] = await runClient(name, path.join(owned, configName), 'patient-profiles');
    }
    const profileComparison = comparePatientProfileWritesReports(profileReports.javascript, profileReports.rust);
    save('patient-profiles-comparison.json', profileComparison);
    result = { schemaVersion: 1, result: 'pass', synthetic: true, protocolId: comparison.protocolId,
        provenance, corpusSha256: client.corpusSha256, snapshotCanonicalSha256: comparison.snapshotCanonicalSha256,
        sampleOrder: 'Alternating JS/Rust after one discarded warm-up per client; each sample authenticates a fresh session.',
        observations: Object.fromEntries(Object.entries(measurements).map(([name, rows]) => [name, {
            login: distribution(rows.map((row) => row.login)), snapshot: distribution(rows.map((row) => row.snapshot)),
        }])),
        qualification: 'Diagnostic end-to-end timings on a Next development host. Login includes v3 KDF and HTTP; snapshot includes each client\'s own protocol preflights. These are not production startup, RSS, rendering or intrinsic language speed measurements.',
        checkedWrites: comparison.checkedWrites, resourceWriteProtocolId: resourceComparison.protocolId,
        resourceWritesSha256: resourceComparison.fixtureSha256, checkedResourceWrites: true,
        patientProfileWriteProtocolId: profileComparison.protocolId,
        patientProfileWritesSha256: profileComparison.fixtureSha256, checkedPatientProfileWrites: true,
        completedAt: new Date().toISOString() };
} catch (error) {
    result = { schemaVersion: 1, result: 'fail', phase, reason: error instanceof Error ? error.message : 'Comparison failed',
        qualification: 'No equivalence or performance result is issued for an incomplete run.' };
    process.exitCode = 1;
} finally {
    if (server?.pid) {
        const closed = new Promise((resolve) => server.once('close', resolve));
        try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await Promise.race([closed, sleep(5_000)]);
        // All descendants are in the process group this runner created.
        try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    fs.rmSync(owned, { recursive: true, force: true });
    result ??= { schemaVersion: 1, result: 'fail', phase, reason: 'Interrupted before a complete receipt' };
    result.ownedRuntimeRemoved = !fs.existsSync(owned);
    save('receipt.json', result);
}
console.log(JSON.stringify({ result: result.result, receiptPath: path.join(outputDirectory, 'receipt.json'), ownedRuntimeRemoved: result.ownedRuntimeRemoved }));
