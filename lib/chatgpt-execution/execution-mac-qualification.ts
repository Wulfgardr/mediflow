/* @Codex — concrete Mac issuer. No issuer registration API, receipt import,
 * injected OS observer, helper binary, success callback or environment switch. */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { ExecutionError, type ExecutionTransport, type ExecutionMethod, type ExecutionCode } from './execution-contract';
import type { QualifiedExecutionHost } from './execution-host';
import { createOpenAIConnectProxy } from './execution-egress-proxy';
import { createStdioExecutionTransport } from './execution-transport';
import { assertExecutionConfig, assertInitialized, executionInitializationParams, expectedExecutionConfig } from './execution-login';
import { EXECUTION_CONFIG, EXECUTION_SUBSTRATE, executionPublicCaBundle, executionSandboxProfile, verifyExecutionSubstrate } from './execution-sandbox';
import { MAC_CONFIG_SOURCE, MAC_CONTEXT_SHA256, MAC_POLICY_REVISION, macDigest, verifyMacSourceSet } from './execution-mac-config';
import { buildMacCustodian, launchMacCustodian, MacNativeBuildError, type MacNativeOwner } from './execution-mac-native';
import type { MacProductQualificationAuthority } from './execution-platform';

type Phase = 'preparing' | 'ready' | 'borrowed' | 'draining' | 'sealed' | 'revoked';
export type MacQualificationStage = 'platform' | 'sources' | 'build' | 'probe' | 'version' | 'protocol' | 'initialize' | 'readback' | 'custody';
export type MacPreparationOptions = Readonly<{ binaryPath: string; nativeSourcePath: string; schemaDirectory: string;
    c1ReceiptPath: string; lifetimeMs?: number; signal?: AbortSignal }>;
export type MacQualificationAudit = Readonly<{ schema: 'mediflow.mac-custody-audit.v1'; run: string; phase: Phase;
    stage: MacQualificationStage; claim: 'candidate_boundary_only_not_live_or_clinical'; revision: string | null;
    baseContextSha256: string; sourceAvailable: true; fullSourceBuildBinding: 'unqualified';
    consumedProjectionBinding: 'not_observed' | 'strict_startup_and_exact_readback'; protocolRegeneration: 'not_observed' | '24_digests_matched';
    initializeSha256: string | null; readbackSha256: string | null; nativeHelperSha256: string | null;
    compilerSha256: string | null; binarySha256: string; osBuild: string; cleanupComplete: boolean;
    ownedTreeCeased: boolean; administrativePolicy: 'absent_only_no_overrides'; resourcesRetained: boolean }>;
export class MacQualificationFailure extends ExecutionError {
    constructor(readonly stage: MacQualificationStage, readonly audit: MacQualificationAudit,
        /** Host-only diagnosis of our own retained directory, never a UI field. */
        readonly retainedRoot: string | null) { super('unqualified_boundary'); }
}
type Evidence = Readonly<{ revision: string; isCurrent(): boolean }>;
type Entry = Readonly<{ binaryPath: string; current(): Evidence | null; take(signal: AbortSignal): Promise<QualifiedExecutionHost> }>;
const authorities = new WeakMap<object, Entry>();
/** Even a structurally perfect caller object is rejected without invoking it. */
export function readMacQualification(authority: MacProductQualificationAuthority, binaryPath: string): Evidence | null {
    if (process.platform !== 'darwin' || !authority || typeof authority !== 'object') return null;
    const entry = authorities.get(authority);
    if (!entry || entry.binaryPath !== binaryPath) return null;
    try { return entry.current(); } catch { return null; }
}
export async function takeMacQualifiedHost(authority: MacProductQualificationAuthority, binaryPath: string, signal: AbortSignal): Promise<QualifiedExecutionHost> {
    const entry = authority && typeof authority === 'object' ? authorities.get(authority) : undefined;
    if (process.platform !== 'darwin' || !entry || entry.binaryPath !== binaryPath || !entry.current() || signal.aborted)
        throw new ExecutionError('unqualified_boundary');
    return entry.take(signal);
}
async function within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutionError('timeout')), milliseconds);
    })]); } finally { clearTimeout(timer); }
}
function administrativeFilesAbsent(): boolean {
    for (const path of ['/etc/codex/requirements.toml', '/etc/codex/config.toml', '/etc/codex/managed_config.toml']) {
        try { lstatSync(path); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
    }
    return true;
}
function identity(path: string): string {
    const s = lstatSync(path);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o222) !== 0) throw new ExecutionError('unqualified_boundary');
    return JSON.stringify([s.dev, s.ino, s.size, s.mode, s.uid, s.gid, s.mtimeMs, s.ctimeMs, s.nlink]);
}
/** Explicit host operation: compiles/probes locally and starts account-free with
 * CLOSED provider egress. It does not log in, acquire credentials or grant a turn. */
export async function prepareMacProductQualification(options: MacPreparationOptions) {
    let stage: MacQualificationStage = 'platform', phase: Phase = 'preparing';
    let root: string | null = null, binaryPath = '', revision: string | null = null;
    let cleaned = false, treeCeased = false, revoked = false, borrowed = false, intentionalDrain = false, buildUnconfirmed = false;
    let initialization: unknown, initSha: string | null = null, configSha: string | null = null;
    let native: ReturnType<typeof buildMacCustodian> | undefined;
    let protocolMatched = false;
    let proxy: Awaited<ReturnType<typeof createOpenAIConnectProxy>> | undefined;
    let raw: ExecutionTransport | undefined, host: QualifiedExecutionHost | undefined, serverOwner: MacNativeOwner | undefined;
    const owners: MacNativeOwner[] = [], listeners: Server[] = [], immutable = new Map<string, string>();
    const nonce = randomBytes(16).toString('hex');
    const start = performance.now(), wallStart = Date.now(), lifetime = options.lifetimeMs ?? 300_000;
    let drainingAt = 0, cleanupPromise: Promise<boolean> | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
    let closeProxy: Promise<void> | undefined, rootIdentity: string | undefined;
    function audit(): MacQualificationAudit {
        return Object.freeze({ schema: 'mediflow.mac-custody-audit.v1', run: nonce, phase, stage,
            claim: 'candidate_boundary_only_not_live_or_clinical', revision, baseContextSha256: MAC_CONTEXT_SHA256,
            sourceAvailable: true, fullSourceBuildBinding: 'unqualified',
            consumedProjectionBinding: configSha ? 'strict_startup_and_exact_readback' : 'not_observed',
            protocolRegeneration: protocolMatched ? '24_digests_matched' : 'not_observed',
            initializeSha256: initSha, readbackSha256: configSha, nativeHelperSha256: native?.helperSha256 ?? null,
            compilerSha256: native?.compilerSha256 ?? null, binarySha256: EXECUTION_SUBSTRATE.codexSha256,
            osBuild: EXECUTION_SUBSTRATE.osBuild, cleanupComplete: cleaned, ownedTreeCeased: treeCeased,
            administrativePolicy: 'absent_only_no_overrides', resourcesRetained: root !== null && !cleaned });
    }
    function withdraw() {
        if (revoked) return;
        revoked = true; phase = 'revoked';
        // Withdrawal is synchronous; no late IO can restore this state.
        if (proxy) closeProxy ??= proxy.close();
        for (const owner of owners) owner.close();
        if (raw) void raw.close().catch(() => undefined);
    }
    function expired(): boolean {
        return !Number.isFinite(lifetime) || lifetime < 1000 || lifetime > 300_000
            || performance.now() - start >= lifetime || Date.now() - wallStart >= lifetime || Date.now() < wallStart;
    }
    function check() {
        if (revoked || options.signal?.aborted || expired()) { withdraw(); throw new ExecutionError('unqualified_boundary'); }
    }
    async function cleanup(): Promise<boolean> {
        if (cleanupPromise) return cleanupPromise;
        cleanupPromise = (async () => {
            if (proxy) closeProxy ??= proxy.close();
            for (const owner of owners) owner.close();
            try {
                await within(Promise.all(owners.map(owner => owner.finished)), 1000);
                treeCeased = owners.every(owner => owner.drained());
                const network = listeners.map(listener => new Promise<void>(resolve => listener.close(() => resolve())));
                if (closeProxy) network.push(closeProxy);
                await within(Promise.all(network), 200);
                if (!treeCeased || buildUnconfirmed) return false;
                if (root) {
                    const s = lstatSync(root);
                    if (JSON.stringify([s.dev, s.ino, s.uid]) !== rootIdentity || !s.isDirectory() || s.isSymbolicLink()) return false;
                    rmSync(root, { recursive: true, force: false });
                    for (const suffix of ['.sentinel', '.sock']) {
                        try { rmSync(root + suffix); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                    }
                }
                cleaned = true; return true;
            } catch { return false; }
        })();
        return cleanupPromise;
    }
    async function close(): Promise<boolean> {
        withdraw(); clearTimeout(expiry); options.signal?.removeEventListener('abort', withdraw);
        if (raw) { try { await within(raw.close(), 1000); } catch { /* Remain revoked. */ } }
        return cleanup();
    }
    function current(): boolean {
        try {
            check();
            if (phase === 'sealed') return cleaned && treeCeased;
            if (phase === 'draining') return intentionalDrain && performance.now() - drainingAt < 500;
            if (phase !== 'ready' && phase !== 'borrowed' || !serverOwner?.live() || !administrativeFilesAbsent()) { withdraw(); return false; }
            for (const [path, expected] of immutable) if (identity(path) !== expected) { withdraw(); return false; }
            return true;
        } catch { withdraw(); return false; }
    }
    try {
        if (process.platform !== 'darwin' || process.getuid?.() === 0 || process.getuid?.() !== process.geteuid?.()) throw new ExecutionError('unqualified_boundary');
        check(); options.signal?.addEventListener('abort', withdraw, { once: true });
        expiry = setTimeout(() => { withdraw(); void close(); }, lifetime);
        stage = 'sources';
        const pins = verifyMacSourceSet(options.schemaDirectory, options.c1ReceiptPath, expectedExecutionConfig());
        binaryPath = verifyExecutionSubstrate(options.binaryPath);
        const ca = executionPublicCaBundle();
        check();
        root = realpathSync(mkdtempSync('/private/tmp/mfmac-')); chmodSync(root, 0o700);
        const rootStat = lstatSync(root); rootIdentity = JSON.stringify([rootStat.dev, rootStat.ino, rootStat.uid]);
        for (const name of ['runtime', 'codex', 'work', 'tmp', 'config', 'cache', 'data']) mkdirSync(join(root, name), { mode: 0o700 });
        const binary = join(root, 'runtime', 'codex');
        copyFileSync(binaryPath, binary, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE); chmodSync(binary, 0o500);
        verifyExecutionSubstrate(binary);
        const binaryIdentity = identity(binary);
        writeFileSync(join(root, 'runtime', 'public-ca.pem'), ca, { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'codex', 'config.toml'), EXECUTION_CONFIG, { mode: 0o400, flag: 'wx' });
        stage = 'build'; native = buildMacCustodian(root, options.nativeSourcePath); check();
        proxy = await createOpenAIConnectProxy({ initiallyClosed: true }); check();
        const proxyUrl = `http://127.0.0.1:${proxy.port}`;
        const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', HOME: root, CODEX_HOME: join(root, 'codex'), TMPDIR: join(root, 'tmp'),
            XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'),
            PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
            HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: '', no_proxy: '',
            CODEX_CA_CERTIFICATE: join(root, 'runtime', 'public-ca.pem') };
        writeFileSync(join(root, 'runtime', 'profile.sb'), executionSandboxProfile(root, binary, proxy.port), { mode: 0o400, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'profile-probe.sb'), executionSandboxProfile(root, binary, proxy.port, native.helper), { mode: 0o400, flag: 'wx' });
        const tcp = createServer(socket => { socket.on('error', () => undefined); socket.destroy(); }); listeners.push(tcp);
        await new Promise<void>((resolve, reject) => { tcp.once('error', reject); tcp.listen(0, '127.0.0.1', resolve); });
        const address = tcp.address(); if (!address || typeof address === 'string') throw new ExecutionError('unqualified_boundary');
        const unix = createServer(socket => { socket.on('error', () => undefined); socket.destroy(); }); listeners.push(unix);
        await new Promise<void>((resolve, reject) => { unix.once('error', reject); unix.listen(root + '.sock', resolve); });
        writeFileSync(root + '.sentinel', 'MediFlow synthetic boundary sentinel', { mode: 0o600, flag: 'wx' });
        writeFileSync(join(root, 'runtime', 'probe-ports'), `${proxy.port} ${address.port}\n`, { mode: 0o400, flag: 'wx' });
        async function run(mode: 'probe' | 'version' | 'schemas'): Promise<string> {
            check(); const owner = launchMacCustodian(root!, nonce, mode, env, withdraw); owners.push(owner);
            const output = owner.collect(); // Attach before the first await, including fast --version.
            void output.catch(() => undefined);
            await within(owner.started, 6000);
            const text = await output; check();
            if (!owner.drained()) throw new ExecutionError('unqualified_boundary');
            return text;
        }
        stage = 'probe'; await run('probe');
        if (readFileSync(root + '.sentinel', 'utf8') !== 'MediFlow synthetic boundary sentinel') throw new ExecutionError('unqualified_boundary');
        stage = 'version'; if ((await run('version')).trim() !== `codex-cli ${EXECUTION_SUBSTRATE.codexVersion}`) throw new ExecutionError('unqualified_boundary');
        stage = 'protocol'; await run('schemas');
        for (const pin of pins) {
            const path = join(root, 'work', 'schemas', pin.path), st = lstatSync(path);
            if (!st.isFile() || st.isSymbolicLink() || st.size > 2_097_152 || macDigest(readFileSync(path)) !== pin.sha256) throw new ExecutionError('unqualified_boundary');
        }
        protocolMatched = true; check();
        stage = 'initialize';
        serverOwner = launchMacCustodian(root, nonce, 'server', env, withdraw); owners.push(serverOwner);
        const server = serverOwner;
        raw = createStdioExecutionTransport(server.child, { killGraceMs: 150, groupDrainMs: 150,
            // Compatibility hook: actual native whole-tree reaping is stronger
            // than a process-group observation. Public group field stays null.
            terminate: () => server.close(), waitForOwnedGroupExit: async () => {
                await within(server.finished, 140); return server.drained();
            }, onClosing: () => { if (!intentionalDrain) withdraw(); closeProxy ??= proxy!.close(); server.close(); },
            onClosed: async () => { if (!await cleanup()) throw new ExecutionError('unqualified_boundary'); } });
        raw.subscribe(() => undefined, () => withdraw());
        void server.finished.then(() => { if (!intentionalDrain) withdraw(); });
        await within(server.started, 6000); check();
        initialization = await raw.request('initialize', executionInitializationParams()); assertInitialized(initialization, join(root, 'work'));
        initSha = macDigest(JSON.stringify(initialization)); raw.initialized(); check();
        stage = 'readback';
        const actualConfig = await raw.request('config/read', { includeLayers: false });
        assertExecutionConfig(actualConfig); configSha = macDigest(JSON.stringify(actualConfig)); check();
        stage = 'custody';
        for (const path of [binary, native.helper, join(root, 'runtime', 'mac-owner.c'), join(root, 'runtime', 'profile.sb'),
            join(root, 'runtime', 'profile-probe.sb'), join(root, 'runtime', 'public-ca.pem'), join(root, 'runtime', 'probe-ports'), join(root, 'codex', 'config.toml')]) immutable.set(path, identity(path));
        // Keep the authenticated large binary identity without blocking the native
        // heartbeat by synchronously re-hashing 220 MB during a live session.
        if (identity(binary) !== binaryIdentity) throw new ExecutionError('unqualified_boundary');
        if (macDigest(readFileSync(native.helper)) !== native.helperSha256 || readFileSync(join(root, 'codex', 'config.toml'), 'utf8') !== EXECUTION_CONFIG
            || readFileSync(join(root, 'runtime', 'public-ca.pem'), 'utf8') !== ca) throw new ExecutionError('unqualified_boundary');
        revision = macDigest(JSON.stringify({ base: MAC_CONTEXT_SHA256, policy: MAC_POLICY_REVISION, nonce, binary: EXECUTION_SUBSTRATE,
            native, source: MAC_CONFIG_SOURCE, protocol: pins, initSha, configSha,
            profile: macDigest(readFileSync(join(root, 'runtime', 'profile.sb'))), config: macDigest(EXECUTION_CONFIG) }));
        phase = 'ready';
        const evidence = Object.freeze({ revision, isCurrent: current });
        let observationTaken = false;
        const transport: ExecutionTransport = Object.freeze({
            async request(method: ExecutionMethod, params?: unknown) {
                if (!borrowed || intentionalDrain || !current() || method === 'initialize') throw new ExecutionError('unqualified_boundary');
                const value = await raw!.request(method, params);
                if (!current() || intentionalDrain) throw new ExecutionError('unqualified_boundary');
                return value;
            },
            initialized() { throw new ExecutionError('invalid_request'); },
            takeInitializationObservation() {
                if (!borrowed || observationTaken || !current() || intentionalDrain) throw new ExecutionError('unqualified_boundary');
                observationTaken = true; const value = initialization; initialization = undefined; return value;
            },
            subscribe: (notification: (method: string, params: unknown) => void, failure: (code: ExecutionCode) => void) => raw!.subscribe(notification, failure),
            async close() {
                if (!intentionalDrain) { intentionalDrain = true; drainingAt = performance.now(); if (!revoked) phase = 'draining'; }
                const success = await raw!.close();
                if (!success || !cleaned || !treeCeased || expired()) { withdraw(); return false; }
                if (!revoked) phase = 'sealed';
                return !revoked;
            },
            drainObservation() {
                const observation = raw!.drainObservation!();
                return Object.freeze({ closing: observation.closing, leaderExited: observation.leaderExited,
                    ownedGroupCeased: null, ownedTreeCeased: treeCeased ? true : observation.closing ? server.drained() : null });
            },
        });
        // The product may keep its watcher during bounded drain; execution publication
        // must NOT accept that transitional witness before the native STOP+close proof.
        host = Object.freeze({ transport, cwd: join(root, 'work'), boundaryQualified: () => phase !== 'draining' && current(), close, cleanupComplete: () => cleaned });
        const authority: MacProductQualificationAuthority = Object.freeze({ currentEvidence: () => current() ? evidence : null });
        authorities.set(authority, Object.freeze({ binaryPath, current: () => current() ? evidence : null,
            async take(signal: AbortSignal) {
                if (borrowed || signal.aborted || !current()) throw new ExecutionError('unqualified_boundary');
                borrowed = true; phase = 'borrowed';
                signal.addEventListener('abort', withdraw, { once: true });
                if (!proxy!.activate() || signal.aborted || !current()) { await close(); throw new ExecutionError('unqualified_boundary'); }
                return host!;
            } }));
        if (!current()) throw new ExecutionError('unqualified_boundary');
        return Object.freeze({ authority, binaryPath, audit, close });
    } catch (error) {
        if (error instanceof MacNativeBuildError && error.drainUnconfirmed) buildUnconfirmed = true;
        await close();
        throw new MacQualificationFailure(stage, audit(), root && !cleaned ? root : null);
    }
}
