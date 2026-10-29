import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { windowsTaskkillCommand } from './windows-system-command.mjs';
import { processOwner, runtimeProcessIdentity, verifyChildOwner } from './runtime-leases.mjs';

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
  const fail = error => { failReady(error); failDrained(error); };
  const timer = setTimeout(() => { helper.stdin.destroy(); fail(new Error('Windows Job startup timeout.')); }, 30000);
  helper.once('error', fail);
  helper.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  helper.stdin.on('error', () => {});
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 8192) { helper.stdin.destroy(); fail(new Error('Invalid Windows Job receipt.')); return; }
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const frame = JSON.parse(line);
        if (frame.nonce !== owner.token.nonce) throw new Error('Windows Job nonce mismatch.');
        if (frame.type === 'ready') { clearTimeout(timer); readyResolve(); }
        else if (frame.type === 'drained' && frame.active === 0) drained = true;
      } catch (error) { fail(error); }
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
