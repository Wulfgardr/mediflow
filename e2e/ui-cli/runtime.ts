import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, openSync, writeSync } from 'node:fs';
import { cp, mkdir, readFile, realpath, stat, rm, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const buildIdentity = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[0-9a-f]{40}$/u),
  branch: z.string(),
  worktreeHash: z.string(),
  sourceFingerprint: z.string().min(1),
  buildId: z.string().min(1),
});
const runtimeContract = z.object({
  schemaVersion: z.literal(1),
  distDir: z.string().regex(/^\.[a-zA-Z0-9_-]+$/u),
  node: z.object({ major: z.literal(24), moduleVersion: z.literal(process.versions.modules) }),
  platform: z.literal(process.platform),
  arch: z.literal(process.arch),
});

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function identity(bundle: string, revision: string) {
  const metadata = buildIdentity.parse(await json(join(bundle, 'mediflow-build-identity.json')));
  const contract = runtimeContract.parse(await json(join(bundle, 'mediflow-runtime-contract.json')));
  const buildId = await readFile(join(bundle, contract.distDir, 'BUILD_ID'), 'utf8');
  if (metadata.revision !== revision || metadata.buildId !== buildId.trim()) {
    throw new Error('Revisione o BUILD_ID diverso da quello atteso.');
  }
  const serverSHA256 = createHash('sha256').update(await readFile(join(bundle, 'server.js'))).digest('hex');
  return { metadata, contract, serverSHA256 };
}

async function port() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Porta di prova non disponibile.');
  return address.port;
}

async function stop(child: ChildProcess, closed: Promise<unknown>) {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try { await closed; } finally { clearTimeout(force); }
}

async function start(bundle: string, output: string, revision: string, signal: AbortSignal) {
  const source = await realpath(bundle);
  const original = await identity(source, revision);
  const run = await mkdtemp(join(tmpdir(), 'mediflow-ui-cli-'));
  let child: ChildProcess | undefined;
  let closed: Promise<unknown> | undefined;
  const cleanup = async () => {
    try { if (child && closed) await stop(child, closed); }
    finally { await rm(run, { recursive: true, force: true, maxRetries: 3 }); }
  };
  try {
    const web = join(run, 'web');
    const data = join(run, 'data');
    const home = join(run, 'home');
    for (const dir of [data, home]) await mkdir(dir, { mode: 0o700 });
    if (await stat(join(source, 'medical.db')).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) throw new Error('Il bundle contiene un archivio medical.db.');
    await cp(source, web, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    const { metadata, contract, serverSHA256 } = await identity(web, revision);
    if (serverSHA256 !== original.serverSHA256 || JSON.stringify(metadata) !== JSON.stringify(original.metadata)) {
      throw new Error('Identità del bundle cambiata durante la copia.');
    }
    const localPort = await port();
    const origin = `http://127.0.0.1:${localPort}`;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: run, TEMP: run, SystemRoot: process.env.SystemRoot,
      XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'),
      NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(localPort),
      NEXT_TELEMETRY_DISABLED: '1', MEDIFLOW_PLUGIN_LOCAL_UI: '0',
      MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
      MEDIFLOW_NEXT_DIST_DIR: contract.distDir,
      MEDIFLOW_APP_REVISION: metadata.revision.slice(0, 12), MEDIFLOW_APP_BRANCH: metadata.branch,
      MEDIFLOW_APP_WORKTREE_HASH: metadata.worktreeHash,
      MEDIFLOW_APP_SOURCE_FINGERPRINT: metadata.sourceFingerprint, MEDIFLOW_APP_FINGERPRINT: metadata.sourceFingerprint,
      HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1', NODE_USE_ENV_PROXY: '1',
    };
    const log = openSync(join(output, 'server.log'), 'wx', 0o600);
    try {
      const processChild = spawn(process.execPath, ['server.js'], { cwd: web, env, stdio: ['ignore', 'pipe', log], windowsHide: true });
      child = processChild;
      closed = new Promise(resolve => processChild.once('close', resolve));
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Il server del banco non è pronto.')), 25_000);
        let stdout = '';
        processChild.stdout!.on('data', (chunk: Buffer) => {
          writeSync(log, chunk);
          stdout = (stdout + chunk.toString()).slice(-2048);
          if (/Ready in/u.test(stdout)) resolve();
        });
        processChild.once('error', reject);
        processChild.once('exit', (code, bySignal) => reject(new Error(`Server del banco terminato: ${code ?? bySignal}`)));
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        void closed!.then(() => clearTimeout(deadline));
        processChild.stdout!.on('close', () => clearTimeout(deadline));
        if (signal.aborted) reject(signal.reason);
      });
      const get = (url: string) => fetch(origin + url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      const response = await get('/api/system/revision');
      const observed = await response.json();
      const html = await get('/');
      const auth = await get('/api/auth/check');
      const state = await auth.json();
      if (!response.ok || observed.sourceFingerprint !== metadata.sourceFingerprint || !html.ok
        || !(await html.text()).includes(metadata.sourceFingerprint)
        || !auth.ok || state.isSetup !== false || state.hasSession !== false || state.db?.state !== 'ready') {
        throw new Error('Identità servita o archivio iniziale del banco non verificabili.');
      }
      return { origin, metadata, observed, serverSHA256, cleanup };
    } finally {
      if (closed) void closed.then(() => closeSync(log));
      else closeSync(log);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function launchRuntime(bundle: string, output: string, revision: string, signal: AbortSignal) {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('La CLI richiede Node.js 24.');
  return start(bundle, output, revision, signal);
}
