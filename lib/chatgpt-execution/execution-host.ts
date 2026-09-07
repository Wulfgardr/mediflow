/* @Codex */
import 'server-only';
import { spawn } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionError, type ExecutionTransport } from './execution-contract';
import { createOpenAIConnectProxy } from './execution-egress-proxy';
import { EXECUTION_CONFIG, executionPublicCaBundle, executionSandboxProfile, verifyExecutionSubstrate } from './execution-sandbox';
import { createStdioExecutionTransport, type ExecutionDiagnostic } from './execution-transport';

const PRIVATE_MODE = 0o700;
function ownRoot(prefix: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    chmodSync(root, PRIVATE_MODE);
    return root;
}
function killGroup(pid: number | undefined, signal: NodeJS.Signals) {
    if (!pid) return false;
    try { process.kill(-pid, signal); return true; } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
}

/** Checks the same filesystem/network policy, with one extra trusted probe executable. */
async function qualifySandbox(root: string, binary: string, proxyPort: number, env: NodeJS.ProcessEnv): Promise<void> {
    const external = ownRoot('mediflow-chatgpt-sentinel-');
    const sentinel = join(external, 'synthetic.txt');
    writeFileSync(sentinel, 'synthetic boundary sentinel', { mode: 0o600 });
    const blocked = createServer(socket => { socket.on('error', () => {}); socket.destroy(); });
    let child: ReturnType<typeof spawn> | undefined;
    try {
        await new Promise<void>((resolve, reject) => {
            blocked.once('error', reject); blocked.listen(0, '127.0.0.1', resolve);
        });
        const deniedPort = (blocked.address() as { port: number }).port;
        const config = join(root, 'codex', 'config.toml');
        const owned = join(root, 'work', 'probe-owned.txt');
        const source = `import fs from 'node:fs';import net from 'node:net';import {spawnSync} from 'node:child_process';const r={};
for(const [key,operation] of [['read',()=>fs.readFileSync(${JSON.stringify(sentinel)})],['write',()=>fs.writeFileSync(${JSON.stringify(sentinel)},'changed')],['config',()=>fs.writeFileSync(${JSON.stringify(config)},'changed')],['ca',()=>fs.writeFileSync(${JSON.stringify(join(root, 'runtime', 'public-ca.pem'))},'changed')]]){try{operation();r[key]='allowed'}catch(e){r[key]=e.code}}
fs.writeFileSync(${JSON.stringify(owned)},'synthetic');r.owned='allowed';
for(const [key,port] of [['proxy',${proxyPort}],['local',${deniedPort}]])r[key]=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve('allowed')});s.once('error',e=>resolve(e.code));s.setTimeout(1500,()=>{s.destroy();resolve('timeout')})});
const p=spawnSync('/bin/sh',['-c','exit 0']);r.shell=p.error?.code??p.status;console.log(JSON.stringify(r));`;
        const probe = join(root, 'work', 'probe.mjs');
        writeFileSync(probe, source, { mode: 0o600 });
        const profile = join(root, 'profile.sb');
        writeFileSync(profile, executionSandboxProfile(root, binary, proxyPort, process.execPath), { mode: 0o600 });
        child = spawn('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, probe], {
            cwd: join(root, 'work'), env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout!.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            if (output.length > 4096 && !killGroup(child?.pid, 'SIGKILL')) child?.kill('SIGKILL');
        });
        child.stderr!.resume();
        const status = await new Promise<number | null>((resolve, reject) => {
            const timer = setTimeout(() => { if (!killGroup(child?.pid, 'SIGKILL')) child?.kill('SIGKILL'); reject(new ExecutionError('unqualified_boundary')); }, 5000);
            child!.once('error', () => { clearTimeout(timer); reject(new ExecutionError('unqualified_boundary')); });
            child!.once('exit', code => { clearTimeout(timer); resolve(code); });
        });
        const result = JSON.parse(output) as Record<string, unknown>;
        if (status !== 0 || result.read !== 'EPERM' || result.write !== 'EPERM' || result.config !== 'EPERM' || result.ca !== 'EPERM'
            || result.local !== 'EPERM' || result.shell !== 'EPERM' || result.owned !== 'allowed' || result.proxy !== 'allowed'
            || readFileSync(sentinel, 'utf8') !== 'synthetic boundary sentinel') throw new ExecutionError('unqualified_boundary');
        rmSync(probe); rmSync(owned);
    } catch { throw new ExecutionError('unqualified_boundary'); }
    finally {
        if (child && child.exitCode === null && child.signalCode === null && !killGroup(child.pid, 'SIGKILL')) child.kill('SIGKILL');
        await new Promise<void>(resolve => blocked.close(() => resolve()));
        rmSync(external, { recursive: true, force: true });
    }
}

export type QualifiedExecutionHost = Readonly<{
    transport: ExecutionTransport; cwd: string; boundaryQualified(): boolean;
    close(): Promise<boolean>; cleanupComplete(): boolean;
}>;

/** Explicit host call only. There is no startup, egress or login at module import. */
export async function createQualifiedExecutionHost(binaryPath: string, lifetimeMs = 300_000, diagnostic?: (event: ExecutionDiagnostic) => void): Promise<QualifiedExecutionHost> {
    if (!Number.isFinite(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 600_000) throw new ExecutionError('invalid_request');
    const sourceBinary = verifyExecutionSubstrate(binaryPath);
    const root = ownRoot('mediflow-chatgpt-execution-');
    let proxy: Awaited<ReturnType<typeof createOpenAIConnectProxy>> | undefined;
    let transport: ExecutionTransport | undefined;
    let qualified = false;
    let cleanup = false;
    try {
        for (const name of ['codex', 'runtime', 'work', 'tmp', 'config', 'cache', 'data']) mkdirSync(join(root, name), { mode: PRIVATE_MODE });
        const binary = join(root, 'runtime', 'codex');
        copyFileSync(sourceBinary, binary, constants.COPYFILE_FICLONE);
        chmodSync(binary, 0o500);
        // Run immutable, re-hashed bytes owned by this session, so an app update
        // cannot change the executable between preflight and invocation.
        verifyExecutionSubstrate(binary);
        const publicCa = join(root, 'runtime', 'public-ca.pem');
        writeFileSync(publicCa, executionPublicCaBundle(), { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'codex', 'config.toml'), EXECUTION_CONFIG, { mode: 0o600, flag: 'wx' });
        proxy = await createOpenAIConnectProxy();
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const env: NodeJS.ProcessEnv = {
            HOME: root, CODEX_HOME: join(root, 'codex'), TMPDIR: join(root, 'tmp'),
            XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'),
            PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', NODE_ENV: 'production',
            HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: '', no_proxy: '',
            CODEX_CA_CERTIFICATE: publicCa,
        };
        await qualifySandbox(root, binary, proxy.port, env);
        writeFileSync(join(root, 'profile.sb'), executionSandboxProfile(root, binary, proxy.port), { mode: 0o600 });
        const child = spawn('/usr/bin/sandbox-exec', ['-f', join(root, 'profile.sb'), binary, 'app-server', '--strict-config', '--listen', 'stdio://'], {
            cwd: join(root, 'work'), env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
        const exit = () => { if (!killGroup(child.pid, 'SIGKILL')) child.kill('SIGKILL'); };
        process.once('exit', exit);
        const expiry = setTimeout(() => { qualified = false; void transport?.close(); }, lifetimeMs);
        expiry.unref();
        transport = createStdioExecutionTransport(child, {
            diagnostic,
            // Revoke the only network path even when process exit cannot be attested.
            onClosing() { void proxy!.close(); },
            terminate(signal) { if (!killGroup(child.pid, signal)) child.kill(signal); },
            async onClosed() {
                clearTimeout(expiry); process.removeListener('exit', exit);
                // Close the only reachable network destination even if a descendant
                // survives process-group termination; no transport is reused.
                await proxy!.close();
                rmSync(root, { recursive: true, force: true }); cleanup = !existsSync(root);
            },
        });
        // Qualification remains evidence after an intentional transport close.
        // Failures, expiry and owner-initiated host close invalidate it immediately.
        transport.subscribe(() => {}, () => { qualified = false; });
        const original = transport;
        transport = Object.freeze({ ...original, async request(method, params) {
            const result = await original.request(method, params);
            if (method === 'initialize' && (!result || typeof result !== 'object'
                || (result as { codexHome?: unknown }).codexHome !== join(root, 'codex'))) {
                await original.close(); throw new ExecutionError('unqualified_boundary');
            }
            return result;
        } } satisfies ExecutionTransport);
        qualified = true;
        return Object.freeze({ transport, cwd: join(root, 'work'), boundaryQualified: () => qualified,
            close() { qualified = false; return transport!.close(); }, cleanupComplete: () => cleanup });
    } catch {
        if (transport) await transport.close();
        await proxy?.close(); rmSync(root, { recursive: true, force: true });
        throw new ExecutionError('unqualified_boundary');
    }
}
