import 'server-only';
/* @Codex: bounded, one-shot, CPU-only local process. No package resolution. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createPortableProvisioning, isVerifiedPortableArtifact, PortableProvisioningError,
    type PortableProvisioning, type VerifiedPortableArtifact } from './treatment-reasoning-portable-provisioning.ts';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';

export type PortableRuntimeCode = 'input_invalid' | 'runtime_unavailable' | 'runtime_busy' | 'execution_timeout'
    | 'execution_cancelled' | 'binding_stale' | 'provider_failed' | 'provider_invalid' | 'termination_unconfirmed';
export class PortableRuntimeError extends Error {
    readonly code: PortableRuntimeCode;
    constructor(code: PortableRuntimeCode) { super(`Treatment portable runtime: ${code}`); this.name = 'PortableRuntimeError'; this.code = code; }
}
export type PortableEngineMetadata = Readonly<{
    provider: 'athena_transformers'; model: typeof ATHENA_R1_QWEN3_8B_MODEL_ID;
    platform: VerifiedPortableArtifact['release']['platform']; artifactDigest: string;
    runtimeDigest: string; workerDigest: string; admissionRevision: number;
}>;
type Control = Readonly<{ signal?: AbortSignal; isAborted?(): boolean; verifyChoice?(): Promise<void> }>;
type Invoke = Readonly<{ instruction: string; signal: Readonly<{ isAborted(): boolean }> }>;
type Spawn = (command: string, args: readonly string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;
const MAX_INPUT = 96 * 1024;
const MAX_OUTPUT = 64 * 1024;
const MAX_STDERR = 16 * 1024;
const MAX_WALL = 420_000;
const error = (code: PortableRuntimeCode) => new PortableRuntimeError(code);

function environment(artifact: VerifiedPortableArtifact): NodeJS.ProcessEnv {
    // No PATH, proxy, token, account, PYTHONPATH, inherited model cache or credentials.
    const result: NodeJS.ProcessEnv = { NODE_ENV: 'production', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', UV_OFFLINE: '1', PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1', TOKENIZERS_PARALLELISM: 'false', CUDA_VISIBLE_DEVICES: '',
        OMP_NUM_THREADS: String(artifact.release.limits.threads), MKL_NUM_THREADS: String(artifact.release.limits.threads),
        OPENBLAS_NUM_THREADS: String(artifact.release.limits.threads), LANG: 'C.UTF-8' };
    if (process.platform === 'win32' && process.env.SystemRoot) result.SystemRoot = process.env.SystemRoot;
    return result;
}
function decode(bytes: Buffer): string {
    try {
        const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!frame || Object.getPrototypeOf(frame) !== Object.prototype || Object.keys(frame).sort().join(',') !== 'content,model,schemaVersion'
            || frame.schemaVersion !== 'mediflow.treatment-portable-worker-result.v1' || frame.model !== ATHENA_R1_QWEN3_8B_MODEL_ID
            || typeof frame.content !== 'string' || !frame.content.trim() || Buffer.byteLength(frame.content, 'utf8') > 60_000) throw error('provider_invalid');
        return frame.content;
    } catch { throw error('provider_invalid'); }
}
export type PreparedPortableRuntime = Readonly<{
    metadata: PortableEngineMetadata;
    current(): boolean;
    invoke(input: Invoke): Promise<string>;
    close(): void;
}>;

/** Factory inputs are host-only test/composition seams, never request payload fields. */
export function createTreatmentReasoningPortableRuntime(options: Readonly<{
    provisioning?: PortableProvisioning; spawn?: Spawn; timeoutMs?: number; terminationGraceMs?: number;
}> = {}) {
    const provisioning = options.provisioning ?? createPortableProvisioning({ applicationRoot: process.cwd() });
    const start = options.spawn ?? ((command, args, config) => spawn(command, [...args], config) as ChildProcessWithoutNullStreams);
    const timeoutMs = options.timeoutMs ?? MAX_WALL;
    const graceMs = options.terminationGraceMs ?? 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WALL
        || !Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 2000) throw error('input_invalid');
    let busy = false;
    return Object.freeze({
        status: provisioning.status,
        async prepare(control: Control = {}): Promise<PreparedPortableRuntime> {
            if (busy) throw error('runtime_busy');
            busy = true;
            const controller = new AbortController(); let closed = false; let used = false;
            let processOwned = false; let timedOut = false; let activeChild: ChildProcessWithoutNullStreams | null = null;
            const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            const abort = () => controller.abort();
            control.signal?.addEventListener('abort', abort, { once: true });
            const invalid = () => closed || controller.signal.aborted || control.signal?.aborted === true || control.isAborted?.() === true;
            const terminalCode = () => timedOut ? 'execution_timeout' as const : 'execution_cancelled' as const;
            const close = () => {
                closed = true; clearTimeout(deadline); controller.abort();
                control.signal?.removeEventListener('abort', abort);
                if (!processOwned) busy = false;
            };
            const verifyChoice = async (): Promise<void> => {
                if (invalid()) throw error(terminalCode());
                if (!control.verifyChoice) return;
                // A stalled authority read must not extend the acquisition/execution deadline.
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const finish = (failure?: PortableRuntimeError) => {
                        if (settled) return; settled = true;
                        controller.signal.removeEventListener('abort', onAbort);
                        if (failure) reject(failure); else resolve();
                    };
                    const onAbort = () => finish(error(terminalCode()));
                    controller.signal.addEventListener('abort', onAbort, { once: true });
                    if (controller.signal.aborted) { onAbort(); return; }
                    void Promise.resolve().then(() => control.verifyChoice!()).then(
                        () => finish(), () => finish(error('binding_stale')));
                });
            };
            let artifact: VerifiedPortableArtifact;
            try {
                if (invalid()) throw error(terminalCode());
                artifact = await provisioning.verifySelected(controller.signal);
                if (!isVerifiedPortableArtifact(artifact)) throw error('runtime_unavailable');
                await verifyChoice();
                if (invalid()) throw error(terminalCode());
            } catch (failure) {
                close();
                if (failure instanceof PortableRuntimeError) throw failure;
                if (timedOut) throw error('execution_timeout');
                if (failure instanceof PortableProvisioningError && failure.code === 'cancelled') throw error('execution_cancelled');
                throw error('runtime_unavailable');
            }
            const current = () => {
                const state = provisioning.status();
                return !invalid() && state.state === 'admitted' && state.selected
                    && state.releaseDigest === artifact.artifactDigest && state.revision === artifact.revision;
            };
            const metadata: PortableEngineMetadata = Object.freeze({ provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID,
                platform: artifact.release.platform, artifactDigest: artifact.artifactDigest, runtimeDigest: artifact.runtimeDigest,
                workerDigest: artifact.workerDigest, admissionRevision: artifact.revision });
            return Object.freeze({ metadata, current, close,
                async invoke(input: Invoke): Promise<string> {
                    if (used || closed) throw error('binding_stale'); used = true;
                    if (typeof input.instruction !== 'string' || !input.instruction.startsWith('task=treatment_reasoning\n')
                        || Buffer.byteLength(input.instruction, 'utf8') > 64_000 || !input.signal || typeof input.signal.isAborted !== 'function') {
                        close(); throw error('input_invalid');
                    }
                    const frame = Buffer.from(JSON.stringify({ schemaVersion: 'mediflow.treatment-portable-worker-request.v2', model: metadata.model, targetPlatform: artifact.release.platform,
                        directory: artifact.directory, versions: { python: artifact.release.runtime.pythonVersion,
                            transformers: artifact.release.runtime.transformersVersion, torch: artifact.release.runtime.torchVersion },
                        limits: artifact.release.limits, instruction: input.instruction }), 'utf8');
                    if (frame.length > MAX_INPUT) { close(); throw error('input_invalid'); }
                    try {
                        if (input.signal.isAborted() || invalid()) throw error(terminalCode());
                        if (!current()) throw error('binding_stale');
                        await verifyChoice();
                        if (!current() || input.signal.isAborted()) throw error('binding_stale');
                        const content = await new Promise<string>((resolve, reject) => {
                            let child: ChildProcessWithoutNullStreams;
                            let settled = false; let stopped: PortableRuntimeError | null = null; let pollBusy = false;
                            let outputBytes = 0; let errorBytes = 0; const chunks: Buffer[] = [];
                            let termination: ReturnType<typeof setTimeout> | undefined;
                            const finish = (failure: PortableRuntimeError | null, value?: string) => {
                                if (settled) return; settled = true;
                                if (poll) clearInterval(poll); if (termination) clearTimeout(termination);
                                controller.signal.removeEventListener('abort', onAbort);
                                chunks.length = 0;
                                if (failure) reject(failure); else resolve(value!);
                            };
                            const stop = (failure: PortableRuntimeError) => {
                                if (stopped || settled) return; stopped = failure;
                                try {
                                    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
                                    else child.kill('SIGKILL');
                                } catch { try { child.kill('SIGKILL'); } catch { /* Close event or bounded unconfirmed denial below. */ } }
                                termination = setTimeout(() => finish(error('termination_unconfirmed')), graceMs);
                            };
                            const onAbort = () => stop(error(terminalCode()));
                            const poll = setInterval(() => {
                                if (pollBusy || settled || stopped) return;
                                if (invalid() || input.signal.isAborted()) { stop(error(terminalCode())); return; }
                                if (!current()) { stop(error('binding_stale')); return; }
                                if (control.verifyChoice) {
                                    pollBusy = true;
                                    void control.verifyChoice().then(() => { if (!current() || input.signal.isAborted()) stop(error('binding_stale')); },
                                        () => stop(error('binding_stale'))).finally(() => { pollBusy = false; });
                                }
                            }, 50);
                            try {
                                child = start(artifact.python, ['-I', '-B', artifact.worker], {
                                    cwd: artifact.directory, env: environment(artifact), shell: false, windowsHide: true,
                                    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
                                });
                                activeChild = child; processOwned = true;
                            } catch { finish(error('provider_failed')); return; }
                            child.once('close', (code, signal) => {
                                processOwned = false; activeChild = null; if (closed) busy = false;
                                if (stopped) { finish(stopped); return; }
                                if (code !== 0 || signal !== null) { finish(error('provider_failed')); return; }
                                try { finish(null, decode(Buffer.concat(chunks, outputBytes))); }
                                catch { finish(error('provider_invalid')); }
                            });
                            child.once('error', () => stop(error('provider_failed')));
                            child.stdout.on('data', (chunk: Buffer) => {
                                if (stopped || settled) return;
                                outputBytes += chunk.length; if (outputBytes > MAX_OUTPUT) stop(error('provider_invalid'));
                                else chunks.push(Buffer.from(chunk));
                            });
                            child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > MAX_STDERR) stop(error('provider_failed')); });
                            child.stdin.on('error', () => stop(error('provider_failed')));
                            controller.signal.addEventListener('abort', onAbort, { once: true });
                            if (invalid() || input.signal.isAborted()) stop(error(terminalCode()));
                            else child.stdin.end(frame);
                        });
                        if (!current() || input.signal.isAborted()) throw error('binding_stale');
                        // Rehash after inference: no publication after artifact/admission mutation.
                        const after = await provisioning.verifySelected(controller.signal);
                        if (after.artifactDigest !== artifact.artifactDigest || after.runtimeDigest !== artifact.runtimeDigest
                            || after.workerDigest !== artifact.workerDigest || after.revision !== artifact.revision) throw error('binding_stale');
                        await verifyChoice();
                        if (!current() || input.signal.isAborted()) throw error('binding_stale');
                        return content;
                    } catch (failure) {
                        if (failure instanceof PortableRuntimeError) throw failure;
                        throw error(timedOut ? 'execution_timeout' : 'provider_failed');
                    } finally {
                        // Keep the verified lease valid for the caller's synchronous publication
                        // check, but never allow a second invoke. Caller must close after CAS.
                        if (processOwned && activeChild) { try { activeChild.kill('SIGKILL'); } catch { /* busy remains poisoned until close */ } }
                    }
                },
            });
        },
    });
}
