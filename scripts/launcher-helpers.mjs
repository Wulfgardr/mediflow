#!/usr/bin/env node
/* @Codex */
// Cross-platform launcher helpers shared by Start_MediFlow.command (macOS),
// Start-MediFlow.ps1 (Windows) and scripts/start-mediflow.sh (Linux).
// Centralizes the fragile platform logic (port detection, browser open,
// Node version check, worktree hash) so each launcher stays thin.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNodeRuntime, readNodeContract, verifyNativeBinding } from './node-runtime-contract.mjs';

/* @Codex */
function cleanDiagnostic(value) {
    return String(value || '').trim().replace(/[|\t\r\n]+/g, ' ').slice(0, 240);
}

/* @Codex */
function occupiedFromLines(lines, port, pattern) {
    for (const line of lines.split(/\r?\n/)) {
        const match = line.trim().match(pattern);
        if (match && Number(match[1]) === port) {
            return { state: 'occupied', pid: match[2] || '', reason: '' };
        }
    }
    return null;
}

/** Inspect a TCP port without conflating an inspection failure with a free port. */
/* @Codex */
export function inspectPort(port, options = {}) {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        return { state: 'unknown', pid: '', reason: 'invalid-port' };
    }

    const platform = options.platform || process.platform;
    const run = options.spawnSyncImpl || spawnSync;
    if (platform === 'win32') {
        const result = run('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
        if (result.error || result.status !== 0) {
            return {
                state: 'unknown',
                pid: '',
                reason: cleanDiagnostic(result.error?.message || result.stderr || `netstat-exit-${result.status}`),
            };
        }
        return occupiedFromLines(
            result.stdout || '',
            port,
            /^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i,
        ) || { state: 'free', pid: '', reason: '' };
    }

    const lsof = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    if (!lsof.error && lsof.status === 0) {
        const pid = (lsof.stdout || '').split(/\r?\n/).find((line) => /^p\d+$/.test(line))?.slice(1);
        return pid
            ? { state: 'occupied', pid, reason: '' }
            : { state: 'unknown', pid: '', reason: 'lsof-returned-no-listener-pid' };
    }
    if (!lsof.error && lsof.status === 1 && !(lsof.stdout || '').trim() && !(lsof.stderr || '').trim()) {
        return { state: 'free', pid: '', reason: '' };
    }

    if (platform === 'linux') {
        const ss = run('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
        if (!ss.error && ss.status === 0) {
            if (!(ss.stdout || '').trim()) return { state: 'free', pid: '', reason: '' };
            const pid = (ss.stdout || '').match(/pid=(\d+)/)?.[1] || '';
            return { state: 'occupied', pid, reason: '' };
        }
        return {
            state: 'unknown',
            pid: '',
            reason: cleanDiagnostic(ss.error?.message || ss.stderr || `ss-exit-${ss.status}`),
        };
    }

    return {
        state: 'unknown',
        pid: '',
        reason: cleanDiagnostic(lsof.error?.message || lsof.stderr || `lsof-exit-${lsof.status}`),
    };
}

/** Return the listener PID when known. Kept for backwards-compatible CLI use. */
/* @Codex */
export function portListenerPid(port) {
    const result = inspectPort(port);
    return result.state === 'occupied' ? result.pid : '';
}

/** Open a localhost http(s) URL in the default browser. Non-fatal on failure. */
export function openUrl(url) {
    if (typeof url !== 'string' || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(url)) {
        console.error(`[launcher] URL non consentito: ${url}`);
        return 1;
    }
    let res;
    if (process.platform === 'darwin') {
        res = spawnSync('open', [url], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
        res = spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
        res = spawnSync('xdg-open', [url], { stdio: 'ignore' });
    }
    return res?.status ?? 1;
}

/** Verify the exact project Node contract, optionally including the native SQLite binding. */
export function checkNode(checkNative = false) {
    try {
        const contract = readNodeContract();
        const runtime = assertNodeRuntime(contract);
        if (checkNative) verifyNativeBinding();
        return { ok: true, ...runtime, required: contract.engines, nativeBinding: checkNative ? 'ready' : 'not-checked' };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/** Short hash of the git worktree status (replaces macOS-only `shasum`). */
export function hashWorktreeStatus(status) {
    const normalized = typeof status === 'string' ? status.trim() : '';
    if (!normalized) return 'clean';
    return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/* @Codex */
function readGitValue(args, cwd, fallback = 'unknown') {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) return fallback;
    return result.stdout.trim() || fallback;
}

/* @Codex: keep this algorithm identical to lib/app-revision.ts. */
export function readProductIdentity(cwd = process.cwd()) {
    const resolvedCwd = path.resolve(cwd);
    const checkoutPath = path.resolve(
        readGitValue(['rev-parse', '--show-toplevel'], resolvedCwd, resolvedCwd)
    );
    const manifest = JSON.parse(readFileSync(path.join(checkoutPath, 'package.json'), 'utf8'));
    if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
        throw new Error('package.json non contiene una versione valida');
    }

    const revision = readGitValue(['rev-parse', '--short=12', 'HEAD'], checkoutPath);
    const branch = readGitValue(['branch', '--show-current'], checkoutPath);
    const status = readGitValue(['status', '--porcelain=v1'], checkoutPath, '');
    const worktreeHash = hashWorktreeStatus(status);
    const sourceFingerprint = `${branch}@${revision}:${worktreeHash}`;
    return { version: manifest.version.trim(), checkoutPath, revision, branch, worktreeHash, sourceFingerprint };
}

/* @Codex */
export function classifyRevisionPayload(payload, expectedSourceFingerprint) {
    if (!payload || typeof payload !== 'object'
        || typeof payload.revision !== 'string' || !payload.revision
        || typeof payload.sourceFingerprint !== 'string' || !payload.sourceFingerprint
        || typeof payload.fingerprint !== 'string' || !payload.fingerprint) {
        return { ok: false, reason: 'not-mediflow' };
    }
    if (payload.sourceFingerprint !== expectedSourceFingerprint) {
        return { ok: false, reason: 'source-mismatch', revision: payload.revision, sourceFingerprint: payload.sourceFingerprint };
    }
    return { ok: true, revision: payload.revision, sourceFingerprint: payload.sourceFingerprint };
}

/* @Codex */
export async function probeRunningInstance(baseUrl, expectedSourceFingerprint, fetchImpl = globalThis.fetch) {
    try {
        const parsed = new URL(baseUrl);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol)) {
            return { ok: false, reason: 'url-not-allowed' };
        }
        const response = await fetchImpl(new URL('/api/system/revision', parsed), {
            cache: 'no-store',
            headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
            signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) return { ok: false, reason: `http-${response.status}` };
        return classifyRevisionPayload(await response.json(), expectedSourceFingerprint);
    } catch {
        return { ok: false, reason: 'unreachable-or-invalid' };
    }
}

/* @Codex */
function normalizeWaitNumber(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

/** Poll until the exact expected MediFlow source is serving requests. */
/* @Codex */
export async function waitForRunningInstance(baseUrl, expectedSourceFingerprint, options = {}) {
    const timeoutMs = normalizeWaitNumber(options.timeoutMs, 30_000, 0, 120_000);
    const intervalMs = normalizeWaitNumber(options.intervalMs, 250, 1, 5_000);
    const probe = options.probe || probeRunningInstance;
    const now = options.now || Date.now;
    const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const startedAt = now();
    let attempts = 0;
    let lastResult = { ok: false, reason: 'not-probed' };

    while (true) {
        attempts += 1;
        lastResult = await probe(baseUrl, expectedSourceFingerprint);
        if (lastResult.ok) return { ...lastResult, attempts };

        const elapsedMs = Math.max(0, now() - startedAt);
        if (elapsedMs >= timeoutMs) {
            return {
                ok: false,
                reason: 'timeout',
                lastReason: lastResult.reason || 'unknown',
                attempts,
            };
        }
        await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
    }
}

/** Open the browser only after the exact expected instance has become ready. */
/* @Codex */
export async function waitForInstanceAndOpen(baseUrl, expectedSourceFingerprint, options = {}) {
    const result = await waitForRunningInstance(baseUrl, expectedSourceFingerprint, options);
    if (!result.ok) return { ...result, browserOpened: false };

    const open = options.open || openUrl;
    const openStatus = open(baseUrl);
    if (openStatus !== 0) {
        return { ...result, reason: 'browser-open-failed', browserOpened: false };
    }
    return { ...result, browserOpened: true };
}

/* @Codex */
function printIdentitySummary(identity) {
    console.log(`  Versione prodotto: ${identity.version}`);
    console.log(`  Checkout: ${identity.checkoutPath}`);
    console.log(`  Sorgente: ${identity.sourceFingerprint}`);
}

/* @Codex */
export async function runCli(argv = process.argv.slice(2)) {
    const [cmd, ...args] = argv;
    switch (cmd) {
        case 'port-listener':
            process.stdout.write(portListenerPid(Number(args[0])));
            return 0;
        case 'inspect-port': {
            const result = inspectPort(Number(args[0]));
            process.stdout.write(`${result.state}|${result.pid}|${result.reason}`);
            return result.state === 'unknown' ? 1 : 0;
        }
        case 'open':
            return openUrl(args[0]);
        case 'check-node':
        case 'check-runtime': {
            const status = checkNode(cmd === 'check-runtime');
            console.log(JSON.stringify(status));
            return status.ok ? 0 : 1;
        }
        case 'worktree-hash': {
            process.stdout.write(readProductIdentity().worktreeHash);
            return 0;
        }
        case 'identity-summary':
            printIdentitySummary(readProductIdentity());
            return 0;
        case 'identity-field': {
            const identity = readProductIdentity();
            const field = args[0];
            if (!Object.hasOwn(identity, field)) return 2;
            process.stdout.write(String(identity[field]));
            return 0;
        }
        case 'verify-instance': {
            const result = await probeRunningInstance(args[0], args[1]);
            console.log(JSON.stringify(result));
            return result.ok ? 0 : 1;
        }
        case 'wait-and-open': {
            const result = await waitForInstanceAndOpen(args[0], args[1], {
                timeoutMs: args[2],
                intervalMs: args[3],
            });
            console.log(JSON.stringify(result));
            return result.ok ? 0 : 1;
        }
        default:
            console.error('usage: launcher-helpers.mjs <inspect-port <port>|port-listener <port>|open <url>|check-node|check-runtime|worktree-hash|identity-summary|identity-field <field>|verify-instance <url> <source-fingerprint>|wait-and-open <url> <source-fingerprint> [timeout-ms] [interval-ms]>');
            return 2;
    }
}

/* @Codex */
const invokedAsScript = process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
    process.exitCode = await runCli();
}
