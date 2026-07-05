#!/usr/bin/env node
/* @Codex */
// Cross-platform launcher helpers shared by Start_MediFlow.command (macOS),
// Start-MediFlow.ps1 (Windows) and scripts/start-mediflow.sh (Linux).
// Centralizes the fragile platform logic (port detection, browser open,
// Node version check, worktree hash) so each launcher stays thin.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

/** Return the PID listening on a TCP port, or '' if none. */
function portListenerPid(port) {
    if (!Number.isInteger(port) || port <= 0) return '';

    if (process.platform === 'win32') {
        const res = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
        for (const line of (res.stdout || '').split(/\r?\n/)) {
            const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
            if (m && Number(m[1]) === port) return m[2];
        }
        return '';
    }

    // macOS + Linux: prefer lsof, fall back to ss (Linux), then netstat.
    let res = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
        const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith('p'));
        if (line) return line.slice(1);
    }
    res = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
        const m = res.stdout.match(/pid=(\d+)/);
        if (m) return m[1];
    }
    return '';
}

/** Open a localhost http(s) URL in the default browser. Non-fatal on failure. */
function openUrl(url) {
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
    return res?.status ?? 0;
}

/** Check the running Node satisfies the pinned >=20 <21 range. */
function checkNode() {
    const major = Number(process.versions.node.split('.')[0]);
    return { ok: major >= 20 && major < 21, version: process.versions.node, required: '>=20 <21' };
}

/** Short hash of the git worktree status (replaces macOS-only `shasum`). */
function worktreeHash() {
    const res = spawnSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });
    const status = res.stdout || '';
    if (!status.trim()) return 'clean';
    return crypto.createHash('sha1').update(status).digest('hex').slice(0, 12);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
    case 'port-listener':
        process.stdout.write(portListenerPid(Number(arg)));
        break;
    case 'open':
        process.exit(openUrl(arg));
        break;
    case 'check-node': {
        const status = checkNode();
        console.log(JSON.stringify(status));
        process.exit(status.ok ? 0 : 1);
        break;
    }
    case 'worktree-hash':
        process.stdout.write(worktreeHash());
        break;
    default:
        console.error('usage: launcher-helpers.mjs <port-listener <port>|open <url>|check-node|worktree-hash>');
        process.exit(2);
}
