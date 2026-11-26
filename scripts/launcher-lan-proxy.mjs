import { execFileSync, spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPairingAddress } from '../lib/network-pairing-address.mjs';

export const LAN_PROXY_DEFAULT_PORT = 3443;
const LISTENING = /^TLS proxy listening on https:\/\/[^\s]+:(\d+)$/mu;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

/** @param {string} certPath */
export function certificatePin(certPath) {
  return new X509Certificate(fs.readFileSync(certPath)).fingerprint256.replaceAll(':', '').toLowerCase();
}

/**
 * Self-signed certificate of this computer for the LAN proxy. Devices pin its SHA-256 at pairing, so it is
 * created once and kept; the private key never leaves the data directory.
 * @param {string} dataDir @param {{ run?: typeof execFileSync }} [options]
 */
export function lanCertificate(dataDir, { run = execFileSync } = {}) {
  const directory = path.join(dataDir, 'certs');
  const certPath = path.join(directory, 'local-api.crt'), keyPath = path.join(directory, 'local-api.key');
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    try {
      run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=MediFlow',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    } catch {
      fs.rmSync(certPath, { force: true }); fs.rmSync(keyPath, { force: true });
      throw Object.assign(new Error('openssl non disponibile'), { code: 'LAN_PROXY_CERTIFICATE' });
    }
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700);
    fs.chmodSync(keyPath, 0o600);
  }
  return { certPath, keyPath, pin: certificatePin(certPath) };
}

/**
 * Starts `scripts/local-api-tls-proxy.mjs` on the LAN in front of the local Web and publishes where it listens
 * in `runtime-status.json`, the file the Web reads to offer pairing.
 * @param {{ root: string, dataDir: string, target: string, port?: number, bindHost?: string, timeoutMs?: number }} options
 */
export async function startLanProxy({ root, dataDir, target, port = LAN_PROXY_DEFAULT_PORT, bindHost, timeoutMs = 10_000 }) {
  const targetUrl = new URL(target);
  if (targetUrl.protocol !== 'http:' || targetUrl.hostname !== '127.0.0.1') throw new Error('Il proxy inoltra solo verso MediFlow su questo computer.');
  const resolvedBindHost = bindHost === undefined ? await readPairingAddress('0.0.0.0') : bindHost;
  if (!resolvedBindHost) {
    throw Object.assign(new Error('nessuna rete disponibile'), { code: 'LAN_PROXY_NO_NETWORK' });
  }
  if (WILDCARD_HOSTS.has(resolvedBindHost)) {
    throw Object.assign(new Error('Il proxy non può ascoltare su tutte le reti.'), { code: 'LAN_PROXY_WILDCARD_FORBIDDEN' });
  }
  const loopbackProbe = !LOOPBACK_HOSTS.has(resolvedBindHost);
  const { certPath, keyPath, pin } = lanCertificate(dataDir);
  const statusFile = path.join(dataDir, 'runtime-status.json'), pidFile = path.join(dataDir, 'local-api-tls-proxy.pid');
  const child = spawn(process.execPath, [path.join(root, 'scripts/local-api-tls-proxy.mjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_TLS_CERT_PATH: certPath, MEDIFLOW_TLS_KEY_PATH: keyPath, MEDIFLOW_TLS_PORT: String(port),
      MEDIFLOW_TLS_BIND_HOST: resolvedBindHost, MEDIFLOW_TLS_LOOPBACK_PROBE: loopbackProbe ? '1' : '0',
      MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: targetUrl.origin } });
  child.channel?.unref();
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  const listening = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Il proxy non ha risposto in tempo.')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error(/EADDRINUSE/u.test(stderr) ? `porta ${port} occupata` : 'proxy arrestato all’avvio'),
        { code: /EADDRINUSE/u.test(stderr) ? 'LAN_PROXY_PORT_BUSY' : 'LAN_PROXY_EXITED' }));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer = (buffer + chunk).slice(-4096);
      const match = buffer.match(LISTENING);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  fs.writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
  fs.writeFileSync(statusFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseURL: `https://localhost:${listening}/api/v1`,
    tlsPin: pin, networkMode: 'network-home-base', port: listening, bindHost: resolvedBindHost, loopbackProbe, httpTarget: targetUrl.origin, certPath,
    proxyPidPath: pidFile, owner: 'launcher' }, null, 2)}\n`, { mode: 0o600 });
  const publishedPid = () => { try { return fs.readFileSync(pidFile, 'utf8').trim(); } catch { return null; } };
  const unpublish = () => {
    if (publishedPid() !== String(child.pid)) return;
    fs.rmSync(statusFile, { force: true }); fs.rmSync(pidFile, { force: true });
  };
  void exited.then(unpublish);
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    unpublish();
  };
  return { port: listening, bindHost: resolvedBindHost, pin, pid: /** @type {number} */ (child.pid), exited, stop };
}

function isOrphanLanProxyProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid) return false;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; }
  if (process.platform === 'win32') return false;
  try {
    const args = execFileSync('/bin/ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 });
    return /scripts\/local-api-tls-proxy\.mjs/u.test(args);
  } catch {
    return false;
  }
}

export async function stopOrphanLanProxy(dataDir, activePid = null) {
  const pidFile = path.join(dataDir, 'local-api-tls-proxy.pid');
  const statusFile = path.join(dataDir, 'runtime-status.json');
  let rawPid = null;
  try { rawPid = fs.readFileSync(pidFile, 'utf8').trim(); } catch { rawPid = null; }
  const pid = rawPid && /^\d+$/u.test(rawPid) ? Number(rawPid) : null;
  if (pid && pid === activePid) return false;
  let stopped = false;
  if (pid && isOrphanLanProxyProcess(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { stopped = true; break; } }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!stopped) {
      try { process.kill(pid, 'SIGKILL'); stopped = true; } catch {}
    }
  }
  if (pid && pid !== activePid) {
    fs.rmSync(pidFile, { force: true });
    fs.rmSync(statusFile, { force: true });
  } else if (!activePid && fs.existsSync(statusFile)) {
    try {
      const descriptor = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (descriptor?.owner === 'launcher') fs.rmSync(statusFile, { force: true });
    } catch {}
  }
  return stopped;
}

/**
 * The launcher keeps the LAN proxy on exactly while the Web is in home-base mode: the Web setting stays the
 * single switch, and the proxy never listens on the network while the archive is local-only.
 * @param {{ root: string, dataDir: string, port?: number, readOverview: (target: string) => Promise<{ operatingMode: string, hasPairedClients: boolean } | null>,
 *   log?: (message: string) => void, start?: typeof startLanProxy, attempts?: number }} options
 */
export function createLanProxyController({
  root,
  dataDir,
  port = LAN_PROXY_DEFAULT_PORT,
  readOverview,
  log = () => {},
  start = startLanProxy,
  resolveBindHost = () => readPairingAddress('0.0.0.0'),
  attempts = 3,
}) {
  let proxy = null, target = null, busy = null, pending = false, failures = 0;
  /** @type {{ state: 'off' | 'on' | 'error' | 'unknown', paired: boolean, port: number | null, reason: string | null }} */
  let status = { state: 'unknown', paired: false, port: null, reason: null };
  const halt = async () => { const current = proxy; proxy = null; await current?.stop(); };
  const sync = async () => {
    let overview = null;
    try { overview = target ? await readOverview(target) : null; } catch { overview = null; }
    const wanted = !!target && overview?.operatingMode === 'network-home-base';
    if (!wanted) {
      await halt();
      await stopOrphanLanProxy(dataDir, null);
      status = { state: overview ? 'off' : 'unknown', paired: false, port: null, reason: null };
      return;
    }
    let nextBindHost = null;
    try { nextBindHost = await resolveBindHost(); } catch { nextBindHost = null; }
    if (!nextBindHost || WILDCARD_HOSTS.has(nextBindHost)) {
      const hadProxy = !!proxy;
      await halt();
      await stopOrphanLanProxy(dataDir, null);
      failures = 0;
      if (hadProxy) log('Rete non disponibile: collegamento per iPhone e iPad spento.');
      status = { state: 'off', paired: overview.hasPairedClients, port: null, reason: 'no-network' };
      return;
    }
    if (proxy && proxy.bindHost !== nextBindHost) {
      log(`Indirizzo di rete cambiato (${proxy.bindHost} -> ${nextBindHost}): sposto il collegamento per iPhone e iPad.`);
      await halt();
      failures = 0;
    }
    if (!proxy && failures < attempts) {
      await stopOrphanLanProxy(dataDir, null);
      try {
        const started = await start({ root, dataDir, target, port, bindHost: nextBindHost });
        const active = { ...started, bindHost: started.bindHost ?? nextBindHost };
        proxy = active;
        failures = 0;
        log(`Collegamento per iPhone e iPad acceso su ${active.bindHost}:${active.port}.`);
        void active.exited.then(() => {
          if (proxy !== active) return;
          proxy = null; failures++;
          status = { ...status, state: 'error', port: null, reason: 'stopped' };
          log('Il collegamento per iPhone e iPad si è arrestato.');
        });
      } catch (error) {
        failures++;
        status = { state: 'error', paired: overview.hasPairedClients, port: null, reason: error.code === 'LAN_PROXY_PORT_BUSY' ? 'port' : error.code === 'LAN_PROXY_CERTIFICATE' ? 'certificate' : 'stopped' };
        log(`Collegamento per iPhone e iPad non acceso: ${error.message}`);
        return;
      }
    }
    status = proxy ? { state: 'on', paired: overview.hasPairedClients, port: proxy.port, reason: null } : { ...status, paired: overview.hasPairedClients };
  };
  const run = () => {
    if (busy) { pending = true; return busy; }
    busy = (async () => {
      do {
        pending = false;
        await sync();
      } while (pending);
    })().finally(() => { busy = null; });
    return busy;
  };
  return {
    follow: async url => { target = url; failures = 0; await run(); },
    refresh: run,
    detach: async () => { target = null; pending = false; await busy; await halt(); await stopOrphanLanProxy(dataDir, null); status = { state: 'unknown', paired: false, port: null, reason: null }; },
    status: () => status,
    pid: () => proxy?.pid ?? null,
  };
}

/**
 * Reads the Web's network mode with the local administrative token (ADR 0200, «Stato»). Without the token the
 * Web creates it on the first unauthenticated request; the launcher asks only for an archive already set up,
 * so restoring into an empty data directory stays possible.
 * @param {string} url @param {string} dataDir @param {NodeJS.ProcessEnv} [env]
 */
export async function readNetworkOverview(url, dataDir, env = process.env) {
  const file = path.join(dataDir, 'local-api-token');
  const token = env.MEDIFLOW_LOCAL_API_TOKEN || (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
  if (!token) {
    const check = await fetch(new URL('/api/auth/check', url), { signal: AbortSignal.timeout(2000) }).then(response => response.json()).catch(() => null);
    if (check?.isSetup === true) await fetch(new URL('/api/system/network-overview', url), { signal: AbortSignal.timeout(2000) }).then(response => response.body?.cancel()).catch(() => {});
    return null;
  }
  const response = await fetch(new URL('/api/system/network-overview', url), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
  if (!response.ok) { await response.body?.cancel(); return null; }
  const { session } = await response.json();
  return typeof session?.operatingMode === 'string' ? { operatingMode: session.operatingMode, hasPairedClients: session.pairingState === 'paired' } : null;
}
