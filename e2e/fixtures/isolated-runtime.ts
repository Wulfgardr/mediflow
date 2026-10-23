/* destructive auth tests own their process and initially empty data directory. */
import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trustedWebRequestHeaders } from './trusted-web-request';

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

// Source payloads must use their admitted launcher; CI's traced standalone copy
// has no source ledger and retains its existing build-time environment contract.
export function isolatedRuntimeArguments(bundle: string): string[] {
  if (!existsSync(path.join(path.dirname(bundle), 'runtime-payload-ledger.json'))) {
    return [path.join(bundle, 'server.js')];
  }
  const launcher = path.resolve(bundle, '../..', 'scripts/source-runtime.mjs');
  if (!existsSync(launcher)) throw new Error('Source payload requires its verified source runtime launcher.');
  return [launcher, 'web'];
}

type IsolatedRuntime = Readonly<{ url: string;
  offerPairing(options?: { nonce?: string; expiresIn?: number; instance?: string }): { nonce: string; host: string };
  usePairing(nonce: string, host: string): Promise<string>;
}>;

export const test = base.extend<{ isolatedRuntime: IsolatedRuntime; initialRuntimeServices: boolean; pluginLocalUiRuntime: boolean }>({
  pluginLocalUiRuntime: [false, { option: true }],
  initialRuntimeServices: [false, { option: true }],
  isolatedRuntime: async ({ initialRuntimeServices, pluginLocalUiRuntime }, provide, testInfo) => {
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
    if (initialRuntimeServices) {
      mkdirSync(path.join(dataDirectory, 'pm2'), { mode: 0o700 });
      writeFileSync(path.join(dataDirectory, 'pm2/pm2.log'), 'synthetic runtime log', { mode: 0o600 });
    }
    const log = openSync(path.join(directory, 'server.log'), 'wx', 0o600);
    const environment: NodeJS.ProcessEnv = { ...process.env,
      NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      MEDIFLOW_NEXT_DIST_DIR: contract.distDir,
      MEDIFLOW_DATA_DIR: dataDirectory, MEDIFLOW_E2E_DATA_DIR: dataDirectory,
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
    };
    environment.MEDIFLOW_LOCAL_UI_INSTANCE = randomUUID();
    environment.MEDIFLOW_LOCAL_UI_WEB_SECRET = randomBytes(32).toString('hex');
    environment.MEDIFLOW_PLUGIN_LOCAL_UI = pluginLocalUiRuntime ? '1' : '0';
    delete environment.MEDIFLOW_RUNTIME_TWIN;
    delete environment.NEXT_PUBLIC_MEDIFLOW_RUNTIME_TWIN;
    let args = isolatedRuntimeArguments(bundle);
    if (pluginLocalUiRuntime && args.length === 1) {
      const metadata = JSON.parse(readFileSync(path.join(bundle, 'mediflow-build-identity.json'), 'utf8'));
      environment.MEDIFLOW_APP_SOURCE_FINGERPRINT = metadata.sourceFingerprint;
      const bootstrap = path.join(directory, 'plugin-web.mjs');
      writeFileSync(bootstrap, `import { createRequire } from 'node:module';
        import { installLocalUiWebNavigation } from ${JSON.stringify(path.join(repositoryRoot, 'scripts/local-ui-web-navigation.mjs'))};
        installLocalUiWebNavigation(process, ${JSON.stringify(url)}, () => {});
        createRequire(${JSON.stringify(serverPath)})(${JSON.stringify(serverPath)});`);
      args = [bootstrap];
    }
    const child = spawn(process.execPath, args, {
      cwd: bundle, env: environment, stdio: pluginLocalUiRuntime ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
        child.stdout!.on('data', (chunk: Buffer) => {
          writeSync(log, chunk);
          output = (output + chunk.toString()).slice(-2_048);
          if (!readySeen && /Ready in/u.test(output)) { readySeen = true; settle(); }
        });
        child.stderr!.on('data', (chunk: Buffer) => writeSync(log, chunk));
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
      expect(await initial.json()).toMatchObject({ status: 'ok', isSetup: false, hasSession: false, db: { state: 'ready' } });
      initialEmptyAccount = true;
      await provide({ url,
        offerPairing(options = {}) {
          const request = { nonce: options.nonce ?? randomUUID(), host: randomUUID(), expiresAt: Date.now() + (options.expiresIn ?? 60000),
            instance: options.instance ?? environment.MEDIFLOW_LOCAL_UI_INSTANCE,
            dataDir: dataDirectory, sourceFingerprint: revision.sourceFingerprint };
          child.send({ type: 'mediflow-local-ui-pair-offer', request });
          return { nonce: request.nonce, host: request.host };
        },
        usePairing(nonce, host) {
          const requestId = randomUUID();
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { child.off('message', receive); reject(new Error('pairing IPC timeout')); }, 3000);
            const receive = (frame: any) => { if (frame?.type === 'mediflow-local-ui-pair-result' && frame.requestId === requestId) {
              clearTimeout(timer); child.off('message', receive); resolve(frame.status);
            } };
            child.on('message', receive);
            child.send({ type: 'mediflow-local-ui-pair-use', nonce, host, requestId,
              navigation: JSON.stringify({ schemaVersion: 'mediflow.local-ui.navigation.v1', intent: 'search', requestId, expiresAt: Date.now() + 5000 }) });
          });
        },
      });
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
          emptyDataBeforeStart: !initialRuntimeServices, initialRuntimeServices, pluginLocalUiRuntime, initialEmptyAccount, sourceFingerprint, childStopped: true,
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
  extraHTTPHeaders: async ({ baseURL }, provide) => provide(trustedWebRequestHeaders(baseURL)),
});

export { expect };
