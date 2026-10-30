import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { windowsTaskkillCommand } from './windows-system-command.mjs';
import { processOwner, runtimeProcessIdentity, verifyChildOwner } from './runtime-leases.mjs';

export const WINDOWS_JOB_PHASE_TIMEOUT_MS = 30000;
export const WINDOWS_JOB_STARTUP_TIMEOUT_MS = 3 * WINDOWS_JOB_PHASE_TIMEOUT_MS;

export async function containWindowsWeb(child, owner) {
  verifyChildOwner(owner);
  const script = fileURLToPath(new URL('./windows-runtime-job.ps1', import.meta.url));
  const executable = path.join(path.dirname(windowsTaskkillCommand()), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.lstatSync(executable).isFile() || fs.lstatSync(executable).isSymbolicLink()) throw new Error('Windows Job helper unavailable.');
  const helper = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-OwnerFile', owner.file],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let readyResolve, drainedResolve, failReady, failDrained, buffer = '', stderr = '', drained = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; failReady = reject; });
  const closed = new Promise((resolve, reject) => { drainedResolve = resolve; failDrained = reject; });
  closed.catch(() => {});
  let failed = false;
  const fail = error => { failed = true; clearTimeout(timer); helper.stdin.destroy(); failReady(error); failDrained(error); };
  const started = performance.now();
  let phase = 'powershell', timer;
  const armDeadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      helper.stdin.destroy();
      fail(new Error(`Windows Job startup timeout: phase=${phase}, elapsedMs=${Math.round(performance.now() - started)}, helperPid=${helper.pid}, stderr=${stderr}`));
    }, WINDOWS_JOB_PHASE_TIMEOUT_MS);
  };
  armDeadline();
  helper.once('error', fail);
  helper.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  helper.stdin.on('error', () => {});
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', chunk => {
    if (failed) return;
    buffer += chunk;
    if (buffer.length > 8192) { helper.stdin.destroy(); fail(new Error('Invalid Windows Job receipt.')); return; }
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const frame = JSON.parse(line);
        if (frame.nonce !== owner.token.nonce) throw new Error('Windows Job nonce mismatch.');
        if (frame.type === 'compiling' && phase === 'powershell') { phase = 'compiling'; armDeadline(); }
        else if (frame.type === 'assigning' && phase === 'compiling') { phase = 'assigning'; armDeadline(); }
        else if (frame.type === 'ready' && phase === 'assigning') { phase = 'ready'; clearTimeout(timer); readyResolve(); }
        else if (frame.type === 'drained' && frame.active === 0 && phase === 'ready') { phase = 'drained'; drained = true; }
        else throw new Error(`Invalid Windows Job transition: ${phase} -> ${frame.type}.`);
      } catch (error) { fail(error); return; }
    }
  });
  helper.once('close', code => {
    clearTimeout(timer);
    if (code === 0 && drained) drainedResolve();
    else fail(new Error(`Windows Job cleanup unconfirmed (${code}): ${stderr}`));
  });
  await ready;
  return {
    closed,
    owner: processOwner(runtimeProcessIdentity, helper.pid),
    async stop() {
      verifyChildOwner(owner, false);
      if (!drained) helper.stdin.end(owner.token.nonce + '\n');
      await closed;
    },
  };
}
