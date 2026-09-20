/* @Codex: destructive auth tests own their process and initially empty data directory. */
import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../..');

async function availableLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Loopback port unavailable.');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return address.port;
}

type IsolatedRuntime = Readonly<{ url: string }>;

export const test = base.extend<{ isolatedRuntime: IsolatedRuntime }>({
  isolatedRuntime: async ({}, provide, testInfo) => {
    const bundle = path.resolve(process.env.E2E_ISOLATED_STANDALONE_DIR
      || path.join(repositoryRoot, process.env.MEDIFLOW_NEXT_DIST_DIR || '.next', 'standalone'));
    const serverPath = path.join(bundle, 'server.js');
    const contractPath = path.join(bundle, 'mediflow-runtime-contract.json');
    if (!existsSync(serverPath) || !existsSync(contractPath)) {
      throw new Error('This test requires its own standalone server. Set E2E_ISOLATED_STANDALONE_DIR to a built bundle with public/static assets; it never resets E2E_BASE_URL.');
    }
    // Production bootstrap can copy a legacy DB from cwd. Reject it before launch.
    if (existsSync(path.join(bundle, 'medical.db'))) {
      throw new Error('The isolated standalone bundle must not contain a legacy medical.db.');
    }
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
    if (process.versions.node.split('.')[0] !== '24' || contract.node?.major !== 24
      || contract.node?.moduleVersion !== process.versions.modules
      || contract.platform !== process.platform || contract.arch !== process.arch) {
      throw new Error('The isolated bundle must match this Node24 runtime, native ABI and platform.');
    }

    const port = await availableLoopbackPort();
    const url = `http://127.0.0.1:${port}`;
    const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-e2e-isolated-'));
    const dataDirectory = path.join(directory, 'data');
    mkdirSync(dataDirectory, { mode: 0o700 });
    expect(readdirSync(dataDirectory)).toEqual([]);
    const log = openSync(path.join(directory, 'server.log'), 'wx', 0o600);
    const environment: NodeJS.ProcessEnv = { ...process.env,
      NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      MEDIFLOW_DATA_DIR: dataDirectory, MEDIFLOW_E2E_DATA_DIR: dataDirectory,
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
    };
    delete environment.MEDIFLOW_RUNTIME_TWIN;
    delete environment.NEXT_PUBLIC_MEDIFLOW_RUNTIME_TWIN;
    const child = spawn(process.execPath, [serverPath], {
      cwd: bundle, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    let readySeen = false;
    let sourceFingerprint: string | null = null;
    let initialEmptyAccount = false;
    try {
      // Require readiness from this child before sending any request to the allocated port.
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('The isolated server did not become ready.')), 30_000);
        const settle = (error?: Error) => { clearTimeout(deadline); if (error) reject(error); else resolve(); };
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          writeSync(log, chunk);
          output = (output + chunk.toString()).slice(-2_048);
          if (!readySeen && /Ready in/u.test(output)) { readySeen = true; settle(); }
        });
        child.stderr.on('data', (chunk: Buffer) => writeSync(log, chunk));
        child.once('error', () => settle(new Error('The isolated server could not start.')));
        child.once('exit', () => { if (!readySeen) settle(new Error('The isolated server exited before readiness.')); });
      });
      const revisionResponse = await fetch(`${url}/api/system/revision`);
      expect(revisionResponse.status).toBe(200);
      const revision = await revisionResponse.json();
      const html = await (await fetch(url)).text();
      sourceFingerprint = revision.fingerprint;
      expect(typeof sourceFingerprint).toBe('string');
      expect(Boolean(sourceFingerprint && html.includes(sourceFingerprint)),
        'HTML and runtime must share the bundle metadata; pass its supported MEDIFLOW_APP_* environment.').toBe(true);
      const initial = await fetch(`${url}/api/auth/check`);
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({ status: 'ok', isSetup: false, hasSession: false });
      initialEmptyAccount = true;
      await provide({ url });
    } finally {
      // Only the child we created is terminated. No port-wide kill, account restore or DB edit.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const forceExit = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      await closed;
      clearTimeout(forceExit);
      closeSync(log);
      const keepEvidence = !initialEmptyAccount || testInfo.status !== 'passed';
      await testInfo.attach('isolated-runtime.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          isolated: true, url, node: process.versions.node, platform: process.platform, arch: process.arch,
          emptyDataBeforeStart: true, initialEmptyAccount, sourceFingerprint, childStopped: true,
          serverSHA256: createHash('sha256').update(readFileSync(serverPath)).digest('hex'),
          runtimeContractSHA256: createHash('sha256').update(readFileSync(contractPath)).digest('hex'),
          sharedDatabaseUsed: false, accountOrDatabaseRestore: false,
          ...(keepEvidence ? { retainedPrivateDirectory: directory } : {}),
        }),
      });
      if (!keepEvidence) rmSync(directory, { recursive: true });
    }
  },
  baseURL: async ({ isolatedRuntime }, provide) => provide(isolatedRuntime.url),
});

export { expect };
