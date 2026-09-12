/* @Codex — real native build/launch only; no injected issuer transport or helper pin. */
import 'server-only';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { ExecutionError } from './execution-contract';
import { macDigest, readPinnedMacFile } from './execution-mac-config';
import { MacOwnerSequence, parseMacOwnerFrame } from './execution-mac-state';

// Updated only with the complete reviewed native source, never from caller JSON.
export const MAC_NATIVE_SOURCE = Object.freeze({ bytes: 20411, sha256: 'c26edcc883e311f279507fc5a80c792242a252d66e99ee97c5f67693bcb14fac' });
export class MacNativeBuildError extends ExecutionError {
    constructor(readonly drainUnconfirmed: boolean) { super('unqualified_boundary'); }
}
const fail = (): never => { throw new ExecutionError('unqualified_boundary'); };
function trustedCommand(binary: string, args: readonly string[], root: string): string {
    const result = spawnSync(binary, [...args], { cwd: root, shell: false,
        env: { NODE_ENV: 'production', HOME: root, TMPDIR: join(root, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
        timeout: 30_000, maxBuffer: 16_384, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Never expose compiler/OS prose in a product or qualification receipt.
    if (result.error || result.status !== 0 || result.signal) throw new MacNativeBuildError(Boolean(result.error || result.signal));
    return result.stdout.trim();
}
/** The compiler/SDK are installed, Apple-signed host TCB, not a caller helper.
 * No downloads, user CFLAGS, credential env or arbitrary build script executes. */
export function buildMacCustodian(root: string, sourcePath: string) {
    if (process.platform !== 'darwin' || process.getuid?.() === 0 || process.getuid?.() !== process.geteuid?.()) fail();
    const source = readPinnedMacFile(sourcePath, MAC_NATIVE_SOURCE);
    const copiedSource = join(root, 'runtime', 'mac-owner.c');
    writeFileSync(copiedSource, source, { mode: 0o400, flag: 'wx' });
    const compiler = realpathSync(trustedCommand('/usr/bin/xcrun', ['--find', 'clang'], root));
    const sdk = realpathSync(trustedCommand('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], root));
    if (!compiler.startsWith('/') || !lstatSync(compiler).isFile() || !lstatSync(sdk).isDirectory()) fail();
    trustedCommand('/usr/bin/codesign', ['--verify', '--strict', '-R', '=anchor apple', compiler], root);
    const helper = join(root, 'runtime', 'mac-owner');
    trustedCommand(compiler, ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
        '-isysroot', sdk, '-mmacosx-version-min=13.0', '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2',
        copiedSource, '-framework', 'CoreFoundation', '-lsandbox', '-o', helper], root);
    chmodSync(helper, 0o500);
    return Object.freeze({ helper, helperSha256: macDigest(readFileSync(helper)), compilerSha256: macDigest(readFileSync(compiler)),
        sdkPathSha256: macDigest(sdk), sourceSha256: MAC_NATIVE_SOURCE.sha256 });
}
export type MacNativeOwner = Readonly<{
    child: ChildProcessWithoutNullStreams;
    started: Promise<void>;
    finished: Promise<void>;
    live(): boolean;
    drained(): boolean;
    exitCode(): number | null;
    close(): void;
    collect(): Promise<string>;
}>;
/** Caller's hooks observe failure only; they cannot supply success or replace OS IO. */
export function launchMacCustodian(root: string, nonce: string, mode: 'probe' | 'version' | 'schemas' | 'server',
    env: NodeJS.ProcessEnv, onFailure: () => void): MacNativeOwner {
    if (process.platform !== 'darwin') fail();
    const helper = join(root, 'runtime', 'mac-owner');
    const child = spawn(helper, [mode, root, nonce], { cwd: join(root, 'work'), env, shell: false, detached: false,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    const inheritedChannel = child.stdio[3];
    if (!(inheritedChannel instanceof Duplex)) { child.stdin.destroy(); throw new ExecutionError('unqualified_boundary'); }
    const channel: Duplex = inheritedChannel;
    const sequence = new MacOwnerSequence();
    let buffer = '', closing = false, startedSettled = false;
    let resolveStart!: () => void, rejectStart!: (error: ExecutionError) => void, resolveFinish!: () => void;
    const started = new Promise<void>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    // Errors before an awaiting caller reaches this promise must not go unhandled.
    void started.catch(() => undefined);
    const finished = new Promise<void>(resolve => { resolveFinish = resolve; });
    function command(value: 'P\n' | 'C\n') {
        if (!channel.destroyed && channel.writable) channel.write(value, error => { if (error && !closing) failure(); });
    }
    function close() { if (closing) return; closing = true; clearInterval(heartbeat); command('C\n'); }
    function failure(protocolInvalid = false) {
        sequence.invalidate(protocolInvalid);
        if (!startedSettled) { startedSettled = true; rejectStart(new ExecutionError('unqualified_boundary')); }
        close(); try { onFailure(); } catch { /* Failure observers cannot restore custody. */ }
    }
    channel.on('data', (chunk: Buffer) => {
        try {
            if (!Buffer.isBuffer(chunk) || chunk.some(byte => byte > 127 || byte === 0)) fail();
            buffer += chunk.toString('ascii');
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const frame = parseMacOwnerFrame(buffer.slice(0, end), nonce); buffer = buffer.slice(end + 1);
                sequence.accept(frame, performance.now());
                if (frame.kind === 'ERROR' || frame.kind === 'STOP' && frame.detail >= 2) failure();
                if (!startedSettled && sequence.started) { startedSettled = true; resolveStart(); }
            }
            if (Buffer.byteLength(buffer) > 160) fail();
        } catch { failure(true); }
    });
    channel.on('error', () => { if (!closing) failure(true); });
    channel.on('end', () => { if (buffer || !closing && sequence.reason === null) failure(); });
    const heartbeat = setInterval(() => {
        if (!closing) { command('P\n'); if (sequence.started && !sequence.live(performance.now())) failure(); }
    }, 100);
    // Do not unref this lease: an outstanding child is a live owned resource.
    command('P\n');
    child.once('error', () => failure());
    // 'close', not 'exit': drain the status descriptor before judging STOP ordering.
    child.once('close', (code, signal) => {
        clearInterval(heartbeat); sequence.exited(code, signal);
        if (sequence.failed) failure();
        if (!startedSettled) { startedSettled = true; rejectStart(new ExecutionError('unqualified_boundary')); }
        resolveFinish();
    });
    child.stderr.resume(); // No retention/logging of potential auth prose.
    let collectPromise: Promise<string> | undefined;
    return Object.freeze({ child, started, finished, live: () => !closing && sequence.live(performance.now()),
        drained: () => sequence.drained, exitCode: () => sequence.exitCode, close,
        collect() {
            if (mode === 'server') return Promise.reject(new ExecutionError('invalid_request'));
            if (collectPromise) return collectPromise;
            collectPromise = new Promise<string>((resolve, reject) => {
                let text = ''; const timer = setTimeout(() => { failure(); reject(new ExecutionError('timeout')); }, 15_000);
                child.stdout.on('data', (chunk: Buffer) => {
                    text += chunk.toString('utf8');
                    if (Buffer.byteLength(text) > 4096) { failure(); clearTimeout(timer); reject(new ExecutionError('protocol_error')); }
                    if (mode === 'probe' && text === 'MAC_PROBE_OK_V1\n') close();
                });
                void finished.then(() => {
                    clearTimeout(timer);
                    if (!(!sequence.failed && sequence.drained && (mode === 'probe' ? text === 'MAC_PROBE_OK_V1\n' && sequence.reason === 1 : sequence.exitCode === 0))) reject(new ExecutionError('unqualified_boundary'));
                    else resolve(text);
                });
            });
            return collectPromise;
        } });
}
