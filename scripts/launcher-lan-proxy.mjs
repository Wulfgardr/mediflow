import { execFileSync, spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LAN_PROXY_DEFAULT_PORT = 3443;
const LISTENING = /^TLS proxy listening on https:\/\/[^\s]+:(\d+)$/mu;

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
    try {
      run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=MediFlow',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    } catch {
      fs.rmSync(certPath, { force: true }); fs.rmSync(keyPath, { force: true });
      throw Object.assign(new Error('openssl non disponibile'), { code: 'LAN_PROXY_CERTIFICATE' });
    }
  }
  if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600);
  return { certPath, keyPath, pin: certificatePin(certPath) };
}

/**
 * Starts `scripts/local-api-tls-proxy.mjs` on the LAN in front of the local Web and publishes where it listens
 * in `runtime-status.json`, the file the Web reads to offer pairing.
 * @param {{ root: string, dataDir: string, target: string, port?: number, bindHost?: string, timeoutMs?: number }} options
 */
export async function startLanProxy({ root, dataDir, target, port = LAN_PROXY_DEFAULT_PORT, bindHost = '0.0.0.0', timeoutMs = 10_000 }) {
  const targetUrl = new URL(target);
  if (targetUrl.protocol !== 'http:' || targetUrl.hostname !== '127.0.0.1') throw new Error('Il proxy inoltra solo verso MediFlow su questo computer.');
  const { certPath, keyPath, pin } = lanCertificate(dataDir);
  const statusFile = path.join(dataDir, 'runtime-status.json'), pidFile = path.join(dataDir, 'local-api-tls-proxy.pid');
  const child = spawn(process.execPath, [path.join(root, 'scripts/local-api-tls-proxy.mjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_TLS_CERT_PATH: certPath, MEDIFLOW_TLS_KEY_PATH: keyPath, MEDIFLOW_TLS_PORT: String(port),
      MEDIFLOW_TLS_BIND_HOST: bindHost, MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: targetUrl.origin } });
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
    tlsPin: pin, networkMode: 'network-home-base', port: listening, bindHost, httpTarget: targetUrl.origin, certPath,
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
  return { port: listening, pin, pid: /** @type {number} */ (child.pid), exited, stop };
}

/**
 * The launcher keeps the LAN proxy on exactly while the Web is in home-base mode: the Web setting stays the
 * single switch, and the proxy never listens on the network while the archive is local-only.
 * @param {{ root: string, dataDir: string, port?: number, readOverview: (target: string) => Promise<{ operatingMode: string, hasPairedClients: boolean } | null>,
 *   log?: (message: string) => void, start?: typeof startLanProxy, attempts?: number }} options
 */
export function createLanProxyController({ root, dataDir, port = LAN_PROXY_DEFAULT_PORT, readOverview, log = () => {}, start = startLanProxy, attempts = 3 }) {
  let proxy = null, target = null, busy = null, failures = 0;
  /** @type {{ state: 'off' | 'on' | 'error' | 'unknown', paired: boolean, port: number | null, reason: string | null }} */
  let status = { state: 'unknown', paired: false, port: null, reason: null };
  const halt = async () => { const current = proxy; proxy = null; await current?.stop(); };
  const sync = async () => {
    let overview = null;
    try { overview = target ? await readOverview(target) : null; } catch { overview = null; }
    const wanted = !!target && overview?.operatingMode === 'network-home-base';
    if (!wanted) {
      await halt();
      status = { state: overview ? 'off' : 'unknown', paired: false, port: null, reason: null };
      return;
    }
    if (!proxy && failures < attempts) {
      try {
        const started = await start({ root, dataDir, target, port });
        proxy = started;
        failures = 0;
        log(`Collegamento per iPhone e iPad acceso sulla porta ${started.port}.`);
        void started.exited.then(() => {
          if (proxy !== started) return;
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
  const run = () => busy ||= sync().finally(() => { busy = null; });
  return {
    follow: async url => { target = url; failures = 0; await run(); },
    refresh: run,
    detach: async () => { target = null; await busy; await halt(); status = { state: 'unknown', paired: false, port: null, reason: null }; },
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
