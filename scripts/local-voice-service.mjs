import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const LOCAL_VOICE_READY = 'MEDIFLOW_LOCAL_VOICE_READY';
export const LOCAL_VOICE_SANDBOX_PROFILE = '(version 1) (allow default) (deny network*)'
  + ' (allow network-bind (local ip "localhost:*")) (allow network-inbound (local ip "localhost:*"))'
  + ' (deny file-write*) (deny process-fork)';

/** @param {string} root @param {NodeJS.ProcessEnv} [env] */
export function localVoiceBinary(root, env = process.env) {
  return env.MEDIFLOW_LOCAL_VOICE_BINARY || path.join(root, 'native/local-voice/target/release/mediflow-voice');
}

/** @param {string} binary @param {NodeJS.Platform} [platform] */
export function localVoiceLaunch(binary, platform = process.platform) {
  if (platform === 'darwin') return { command: '/usr/bin/sandbox-exec', args: ['-p', LOCAL_VOICE_SANDBOX_PROFILE, binary] };
  return { command: binary, args: [] };
}

/**
 * @param {{ binary: string, models?: string, secret?: string, platform?: NodeJS.Platform, timeoutMs?: number }} options
 * @returns {Promise<{ url: string, secret: string, pid: number, stop: () => Promise<void>, exited: Promise<number | null> }>}
 */
export async function startLocalVoiceService({ binary, models, secret = crypto.randomBytes(32).toString('hex'), platform = process.platform, timeoutMs = 10_000 }) {
  if (!path.isAbsolute(binary) || !existsSync(binary)) throw new Error('local-voice-binary-missing');
  if (models !== undefined && !path.isAbsolute(models)) throw new Error('local-voice-models-not-absolute');
  const { command, args } = localVoiceLaunch(binary, platform);
  const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', MEDIFLOW_LOCAL_VOICE_SECRET: secret,
    ...(models ? { MEDIFLOW_LOCAL_VOICE_MODELS: models } : {}) };
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const port = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('local-voice-start-timeout')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('local-voice-exited')); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(new RegExp(`^${LOCAL_VOICE_READY} (\\{[^\\r\\n]+\\})$`, 'mu'));
      if (match) { clearTimeout(timer); resolve(JSON.parse(match[1]).port); }
      else if (buffer.length > 4096) { clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('local-voice-start-output')); }
    });
  });
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/u.test(secret)) { child.kill('SIGKILL'); throw new Error('local-voice-port'); }
  const endpoint = { url: `http://127.0.0.1:${port}`, secret };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await exited;
    clearTimeout(timer);
  };
  return { ...endpoint, pid: /** @type {number} */ (child.pid), stop, exited };
}
