import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function isNetworkDenial(code, host, platform = process.platform) {
  return ['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT'].includes(code)
    || (platform === 'linux' && host === '::1' && code === 'EADDRNOTAVAIL');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function groupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
export async function runValidatorProcess(config, signal) {
  const child = spawn(config.javaExecutable, config.javaArgs, {
    env: config.environment, detached: true, stdio: ['ignore', 'inherit', 'inherit'],
  });
  let error;
  let status;
  let exitSignal;
  let closed = false;
  const exited = new Promise(resolve => {
    child.once('error', cause => { error = cause; });
    child.once('close', (code, cause) => { status = code; exitSignal = cause; closed = true; resolve(); });
  });
  let stop;
  const stopped = new Promise(resolve => { stop = resolve; });
  const cancel = () => stop();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, config.timeoutMs ?? 600_000);
  let terminated = false;
  let escalated = false;
  try {
    await Promise.race([exited, stopped]);
    if (child.pid && (!closed || groupExists(child.pid))) {
      terminated = true;
      signalGroup(child.pid, 'SIGTERM');
      const deadline = Date.now() + (config.graceMs ?? 2000);
      while (groupExists(child.pid) && Date.now() < deadline) await delay(10);
      if (groupExists(child.pid)) {
        escalated = true;
        signalGroup(child.pid, 'SIGKILL');
      }
      await exited;
      while (groupExists(child.pid)) await delay(10);
    }
    await exited;
    if (error) throw error;
    return { status, signal: exitSignal, terminated, escalated };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
export async function validateOffline(config) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  process.stdin.once('end', cancel);
  process.stdin.resume();
  const deadline = setTimeout(cancel, config.timeoutMs ?? 600_000);
  try {
    const evidence = { state: 'PROCESS_NETWORK_DENIED', validatorStarted: false, probes: [] };
    for (const host of ['1.1.1.1', '::1']) {
      if (controller.signal.aborted) throw new Error('VALIDATOR_CANCELLED');
      const code = await new Promise(resolve => {
        const socket = net.connect({ host, port: 443 });
        socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT'); });
        socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
        socket.once('error', error => resolve(error.code));
      });
      evidence.probes.push({ host, code });
      if (!isNetworkDenial(code, host)) {
        evidence.state = 'NETWORK_DENIAL_NOT_PROVEN';
        writeFileSync(config.networkEvidence, JSON.stringify(evidence, null, 2));
        throw new Error(`NETWORK_DENIAL_NOT_PROVEN:${host}:${code}`);
      }
    }
    if (controller.signal.aborted) throw new Error('VALIDATOR_CANCELLED');
    evidence.validatorStarted = true;
    writeFileSync(config.networkEvidence, JSON.stringify(evidence, null, 2));
    const result = await runValidatorProcess(config, controller.signal);
    if (result.terminated) throw new Error(`VALIDATOR_TERMINATED:${result.escalated ? 'SIGKILL' : 'SIGTERM'}`);
    return result.status ?? 2;
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
    process.stdin.removeListener('end', cancel);
    process.stdin.pause();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await validateOffline(JSON.parse(readFileSync(process.argv[2], 'utf8'))); }
  catch (error) { console.error(error); process.exitCode = 2; }
}
