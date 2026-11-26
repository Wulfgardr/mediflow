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

/**
 * Keeps one service alive for the launcher. `publish` receives the current endpoint, or null as soon as the
 * service is gone, so the Web never keeps an address nobody answers on.
 * @param {{ binary: string, publish: (endpoint: { url: string, secret: string } | null) => void, log?: (message: string) => void,
 *   restarts?: number, start?: typeof startLocalVoiceService }} options
 */
export function superviseLocalVoiceService({ binary, publish, log = () => {}, restarts = 3, start = startLocalVoiceService }) {
  let service = null, starting = null, stopped = false, left = restarts;
  const launch = () => starting ||= (async () => {
    try {
      const started = await start({ binary });
      if (stopped) { await started.stop(); return null; }
      service = started;
      void started.exited.then(() => {
        if (service !== started) return;
        service = null;
        publish(null);
        if (stopped) return;
        if (left-- > 0) { log('Il servizio della voce si è arrestato: riavvio.'); void launch().then(endpoint => endpoint && publish(endpoint)); }
        else log('Il servizio della voce si è arrestato più volte: registrazione locale non disponibile fino al prossimo avvio.');
      });
      return { url: started.url, secret: started.secret };
    } catch (error) {
      log(`Voce locale non avviata: ${error.message}`);
      return null;
    } finally { starting = null; }
  })();
  return {
    ensure: async () => service ? { url: service.url, secret: service.secret } : launch(),
    current: () => service ? { url: service.url, secret: service.secret } : null,
    pid: () => service?.pid ?? null,
    stop: async () => { stopped = true; await starting; await service?.stop(); service = null; },
  };
}
