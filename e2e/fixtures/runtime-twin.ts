import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { stopServer, trackClose } from '../../visual-qualification/owned-server.mjs';
import { isolatedChromeLaunch } from './secure-browser';

export const twinPin = '086086';
const root = resolve(__dirname, '../..');
const distName = '.next-e2e';

async function loopbackPort(): Promise<number> {
    const reservation = createServer();
    await new Promise<void>((done, reject) => {
        reservation.once('error', reject);
        reservation.listen(0, '127.0.0.1', done);
    });
    const address = reservation.address();
    await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
    if (!address || typeof address === 'string' || address.port === 3000) throw new Error('No isolated loopback port');
    return address.port;
}

export async function withTwinRuntime(
    mode: 'comparison' | 'official' | 'first-run',
    exercise: (page: Page) => Promise<void>,
): Promise<void> {
    if (process.env.MEDIFLOW_TEST_RUNTIME_TWIN !== '1') throw new Error('Runtime twin requires explicit opt-in');
    const port = await loopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const directory = await mkdtemp(join(tmpdir(), 'mediflow-twin-'));
    const data = join(directory, 'data');
    const home = join(directory, 'home');
    const dist = join(root, distName);
    const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: process.env.LANG,
        HOME: home, USERPROFILE: home, TMPDIR: directory, TEMP: directory,
        MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
        MEDIFLOW_RUNTIME_TWIN: mode === 'comparison' ? '1' : undefined,
        MEDIFLOW_NEXT_DIST_DIR: distName, E2E_PIN: twinPin,
        NEXT_TELEMETRY_DISABLED: '1',
        HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1',
        NO_PROXY: '127.0.0.1', NODE_USE_ENV_PROXY: '1',
    };
    let browser: Browser | undefined;
    let ownsDist = false;
    try {
        await mkdir(dist, { mode: 0o700 });
        ownsDist = true;
        await mkdir(data, { mode: 0o700 });
        await mkdir(home, { mode: 0o700 });
        const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, env, timeout: 30_000 });
        node(['scripts/node-runtime-contract.mjs', 'verify']);
        if (mode === 'first-run') {
            node(['scripts/run-strip-types.mjs', '--input-type=module', '-e',
                "const { openDbServer } = await import('./lib/db-server.ts'); openDbServer().close()"]);
        } else {
            node(['scripts/prepare-e2e-db.mjs']);
        }
        const child = spawn(process.execPath, [
            'node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port),
        ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const closed = trackClose(child);
        try {
            const ready = AbortSignal.timeout(30_000);
            let output = '';
            await new Promise<void>((done, reject) => {
                const append = (chunk: Buffer) => {
                    output = (output + chunk.toString()).slice(-4096);
                    if (output.includes('Ready in')) done();
                };
                child.stdout.on('data', append);
                child.stderr.on('data', append);
                closed.then(() => reject(new Error(`Synthetic server exited before readiness\n${output}`)));
                child.once('error', reject);
                ready.addEventListener('abort', () => reject(new Error(`Synthetic server readiness timed out\n${output}`)), { once: true });
            });
            const response = await fetch(`${origin}/api/auth/check`, { signal: AbortSignal.timeout(30_000) });
            const auth = await response.json();
            if (!response.ok || auth.status !== 'ok' || auth.isSetup !== (mode !== 'first-run') || auth.hasSession) {
                throw new Error(`Unexpected synthetic archive at startup\n${output}`);
            }
            browser = await chromium.launch(isolatedChromeLaunch(origin));
            const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block', viewport: { width: 1440, height: 960 } });
            await context.route('**/*', route => new URL(route.request().url()).origin === origin
                ? route.continue() : route.abort('blockedbyclient'));
            await exercise(await context.newPage());
        } finally {
            try { await browser?.close(); } finally { await stopServer(child, closed); }
        }
    } finally {
        try {
            if (ownsDist) await rm(dist, { recursive: true, force: true });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}
