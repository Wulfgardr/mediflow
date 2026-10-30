import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { processOwner, runtimeProcessIdentity, verifyChildOwner } from './runtime-leases.mjs';
import { WINDOWS_JOB_PHASE_TIMEOUT_MS } from './windows-runtime-job-deadlines.mjs';

export { WINDOWS_JOB_PHASE_TIMEOUT_MS, WINDOWS_JOB_STARTUP_TIMEOUT_MS } from './windows-runtime-job-deadlines.mjs';

export async function containWindowsWeb(child, owner) {
  verifyChildOwner(owner);
  const script = fileURLToPath(new URL('./windows-runtime-job-helper.mjs', import.meta.url));
  if (!fs.lstatSync(script).isFile() || fs.lstatSync(script).isSymbolicLink()) throw new Error('Windows Job helper unavailable.');
  const env = { ...process.env };
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']) delete env[name];
  const helper = spawn(process.execPath, [script, owner.file],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let readyResolve, drainedResolve, failReady, failDrained, buffer = '', stderr = '', drained = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; failReady = reject; });
  const closed = new Promise((resolve, reject) => { drainedResolve = resolve; failDrained = reject; });
  closed.catch(() => {});
  let failed = false;
  const fail = error => {
    if (failed) return;
    failed = true; clearTimeout(timer); helper.stdin.destroy();
    if (helper.exitCode === null && helper.signalCode === null) helper.kill();
    failReady(error); failDrained(error);
  };
  const started = performance.now();
  let phase = 'node', timer;
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
        if (frame.type === 'bootstrap' && phase === 'node') { phase = 'bootstrap'; armDeadline(); }
        else if (frame.type === 'assigning' && phase === 'bootstrap') { phase = 'assigning'; armDeadline(); }
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
