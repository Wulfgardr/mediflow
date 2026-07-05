#!/usr/bin/env node
/* @Codex */
// Cross-platform boot smoke for CI: starts `npm run start`, waits for the local
// server to answer on 127.0.0.1:3000, then exits. Any HTTP response means the
// Next.js standalone server booted on this OS (we are testing portability of the
// boot, not app correctness). Connection refused / timeout is a failure.
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const TARGET = `http://127.0.0.1:${PORT}/`;
const BOOT_GRACE_MS = 4000;
const DEADLINE_MS = 90_000;

const child = spawn('npm', ['run', 'start'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

let settled = false;
function finish(code, message) {
    if (settled) return;
    settled = true;
    console.log(message);
    try { child.kill(); } catch { /* ignore */ }
    process.exit(code);
}

child.on('exit', (code) => {
    if (!settled) finish(1, `[smoke] server process exited early (code ${code}).`);
});

const deadline = Date.now() + DEADLINE_MS;
function poll() {
    if (settled) return;
    if (Date.now() > deadline) {
        finish(1, '[smoke] timeout: server did not respond within 90s.');
        return;
    }
    const req = http.get(TARGET, (res) => {
        res.resume();
        finish(0, `[smoke] OK: server responded with HTTP ${res.statusCode}.`);
    });
    req.on('error', () => setTimeout(poll, 2000));
    req.setTimeout(3000, () => req.destroy());
}

setTimeout(poll, BOOT_GRACE_MS);
