/* @Codex: host-only filesystem service; never import from a browser value graph. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';

export const PORTABLE_PROVIDER = 'athena_transformers' as const;
export const PORTABLE_PLATFORMS = ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'] as const;
export type PortablePlatform = typeof PORTABLE_PLATFORMS[number];
export type PortableCode = 'NEEDS_CONTEXT' | 'platform_unsupported' | 'manifest_invalid' | 'license_missing'
    | 'model_not_provisioned' | 'needs_activation' | 'admitted' | 'revoked' | 'artifact_tampered'
    | 'consent_required' | 'cancelled' | 'busy' | 'interrupted' | 'unavailable';
export class PortableProvisioningError extends Error {
    readonly code: PortableCode;
    constructor(code: PortableCode) { super(`Treatment portable: ${code}`); this.name = 'PortableProvisioningError'; this.code = code; }
}
export type PortableFile = Readonly<{ path: string; bytes: number; sha256: string }>;
export type PortableRelease = Readonly<{
    schemaVersion: 'mediflow.treatment-portable-release.v1'; provider: typeof PORTABLE_PROVIDER;
    model: typeof ATHENA_R1_QWEN3_8B_MODEL_ID; modelRevision: string; format: 'safetensors'; platform: PortablePlatform;
    sourceRef: string; approvalRef: string;
    runtime: Readonly<{ python: string; pythonVersion: string; transformersVersion: string; torchVersion: string; sourceRef: string }>;
    licenses: Readonly<{ model: string; runtime: readonly string[] }>;
    limits: Readonly<{ memoryBytes: number; threads: number }>;
    files: readonly PortableFile[];
}>;
export type PortableStatus = Readonly<{
    schemaVersion: 'mediflow.treatment-portable-status.v1'; provider: typeof PORTABLE_PROVIDER;
    model: typeof ATHENA_R1_QWEN3_8B_MODEL_ID; state: PortableCode; releaseDigest: string | null;
    revision: number; selected: boolean; prerequisites: readonly string[]; writesPerformed: 0; applyPolicy: 'none';
}>;
type State = Readonly<{ schemaVersion: 'mediflow.treatment-portable-state.v1'; releaseDigest: string;
    status: 'verified' | 'admitted' | 'revoked'; revision: number; receiptRef: string }>;
export type VerifiedPortableArtifact = Readonly<{
    release: PortableRelease; artifactDigest: string; runtimeDigest: string; workerDigest: string;
    revision: number; directory: string; python: string; worker: string;
}>;

/** Published METADATA supplied in follow-up 1; not evidence of acquired weights. */
export const PORTABLE_MODEL_EVIDENCE = Object.freeze({
    repository: 'mims-harvard/ATHENA-R1-Qwen3-8B',
    revision: 'acacc6b08e341aaf03c9639097255013ac65ebf2',
    transformersConfigVersion: '4.52.0', licenseDeclared: 'mit', licenseApproval: 'not_supplied',
    acquired: false, runtimeQualified: false,
    files: Object.freeze([
    {
        "path": "model/config.json",
        "bytes": 1567,
        "sha256": "5d381c40e78c67fcb4b7fcf511f875ca9feb8b3f1f63a4b6d289efe8cc94e170"
    },
    {
        "path": "model/model.safetensors.index.json",
        "bytes": 32878,
        "sha256": "62f13643ec9f476e5ef7e59251564f73eab0a2f554776e60a0b6d89342389220"
    },
    {
        "path": "model/tokenizer_config.json",
        "bytes": 5404,
        "sha256": "443bfa629eb16387a12edbf92a76f6a6f10b2af3b53d87ba1550adfcf45f7fa0"
    },
    {
        "path": "model/model-00001-of-00004.safetensors",
        "bytes": 4944232808,
        "sha256": "12cbc785c2c98f18b4c34da0d36265d14593adccfee65ae77f489a52f157563b"
    },
    {
        "path": "model/model-00002-of-00004.safetensors",
        "bytes": 4957903872,
        "sha256": "781ac00356ab57fc2b03bc2249ae1a8af5d306d211177901d86879c6f879374e"
    },
    {
        "path": "model/model-00003-of-00004.safetensors",
        "bytes": 4952631904,
        "sha256": "6f6922172ea6358ec7ac2e32a4e4c1bddf798a39cc4a875321923e3f0ad603cd"
    },
    {
        "path": "model/model-00004-of-00004.safetensors",
        "bytes": 1526748280,
        "sha256": "8d1ce751cdba0c58ac35e88d937bd2e81c48d7dbdfec67b0f1420e4f6a89ea53"
    }
].map(file => Object.freeze(file))),
});
export type PortableHardwareObservation = Readonly<{
    platform: string; nodeArchitecture: string; machineArchitecture: string;
    totalMemoryBytes: number; availableMemoryBytes: number; logicalCpus: number;
}>;
export type PortableHardwareReport = Readonly<{
    schemaVersion: 'mediflow.treatment-portable-hardware.v1';
    targetPlatform: PortablePlatform | null; nodeArchitecture: string; machineArchitecture: string;
    totalMemoryBytes: number; availableMemoryBytes: number; logicalCpus: number; threads: number;
    weightBytes: number; kvCacheBudgetBytes: number; minimumProcessMemoryBytes: number;
    processMemoryLimitBytes: number; minimumHostMemoryBytes: number;
    policy: 'bf16_cpu_conservative_v1'; qualification: 'not_observed'; blockers: readonly string[];
}>;
const GIB = 1024 ** 3;
const KV_CACHE_BYTES = 2 * 36 * 8 * 128 * (8192 + 1600) * 2;
export const PORTABLE_PUBLISHED_WEIGHT_BYTES = PORTABLE_MODEL_EVIDENCE.files
    .filter(file => file.path.endsWith('.safetensors')).reduce((total, file) => total + file.bytes, 0);
export function portableMachineArchitecture(machine: string): 'arm64' | 'x64' | null {
    if (/^(?:aarch64|arm64)$/iu.test(machine)) return 'arm64';
    if (/^(?:x86_64|amd64|x64)$/iu.test(machine)) return 'x64';
    return null;
}
export function readPortableHardware(): PortableHardwareObservation {
    return Object.freeze({ platform: process.platform, nodeArchitecture: process.arch,
        machineArchitecture: os.machine(), totalMemoryBytes: os.totalmem(), availableMemoryBytes: os.freemem(),
        logicalCpus: os.availableParallelism() });
}
/** Admission policy, NOT an observed minimum, benchmark or clinical qualification. */
export function assessPortableHardware(observed: PortableHardwareObservation,
    release?: Pick<PortableRelease, 'platform' | 'limits' | 'files'>, checkAvailable = false): PortableHardwareReport {
    const machine = portableMachineArchitecture(observed.machineArchitecture);
    const target = `${observed.platform}-${machine ?? 'unknown'}`;
    const targetPlatform = PORTABLE_PLATFORMS.find(value => value === target) ?? null;
    const weightBytes = release ? release.files.filter(file => file.path.endsWith('.safetensors')).reduce((total, file) => total + file.bytes, 0) : PORTABLE_PUBLISHED_WEIGHT_BYTES;
    const minimumProcessMemoryBytes = Math.ceil((2 * weightBytes + KV_CACHE_BYTES + 4 * GIB) / GIB) * GIB;
    const processMemoryLimitBytes = release?.limits.memoryBytes ?? minimumProcessMemoryBytes;
    const minimumHostMemoryBytes = processMemoryLimitBytes + 4 * GIB;
    const threads = release?.limits.threads ?? Math.min(4, observed.logicalCpus);
    const blockers: string[] = [];
    if (!targetPlatform || (release && release.platform !== targetPlatform)) blockers.push('native_platform_or_runtime_architecture_unverified');
    if (![observed.totalMemoryBytes, observed.availableMemoryBytes, observed.logicalCpus].every(value => Number.isSafeInteger(value) && value >= 0)
        || observed.logicalCpus < 1 || observed.availableMemoryBytes > observed.totalMemoryBytes) blockers.push('hardware_observation_invalid');
    if (processMemoryLimitBytes < minimumProcessMemoryBytes) blockers.push('process_memory_budget_below_bf16_policy');
    if (observed.totalMemoryBytes < minimumHostMemoryBytes) blockers.push('physical_memory_below_bf16_policy');
    if (threads > observed.logicalCpus) blockers.push('configured_threads_exceed_available_cpus');
    if (checkAvailable && observed.availableMemoryBytes < processMemoryLimitBytes) blockers.push('available_memory_below_process_budget');
    return Object.freeze({ schemaVersion: 'mediflow.treatment-portable-hardware.v1', targetPlatform,
        nodeArchitecture: observed.nodeArchitecture, machineArchitecture: observed.machineArchitecture,
        totalMemoryBytes: observed.totalMemoryBytes, availableMemoryBytes: observed.availableMemoryBytes,
        logicalCpus: observed.logicalCpus, threads, weightBytes, kvCacheBudgetBytes: KV_CACHE_BYTES,
        minimumProcessMemoryBytes, processMemoryLimitBytes, minimumHostMemoryBytes,
        policy: 'bf16_cpu_conservative_v1', qualification: 'not_observed', blockers: Object.freeze(blockers) });
}
/** Metadata comparison only. Callers must still hash actual local bytes. */
export function verifyPortablePublishedMetadata(release: PortableRelease): void {
    if (release.modelRevision !== PORTABLE_MODEL_EVIDENCE.revision) return fail('manifest_invalid');
    for (const expected of PORTABLE_MODEL_EVIDENCE.files) {
        const actual = release.files.find(file => file.path === expected.path);
        if (!actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) return fail('artifact_tampered');
    }
    if (release.files.filter(file => file.path.endsWith('.safetensors')).length !== 4) return fail('manifest_invalid');
}

const DIGEST = /^[0-9a-f]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[a-zA-Z0-9.+-]{0,32})$/u;
const MAX_MANIFEST = 8 * 1024 * 1024;
const WORKER = 'worker/treatment-reasoning-portable-worker.py';
const verifiedHandles = new WeakSet<object>();
const fail = (code: PortableCode): never => { throw new PortableProvisioningError(code); };
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) fail('cancelled'); };
export const isVerifiedPortableArtifact = (value: unknown): value is VerifiedPortableArtifact =>
    typeof value === 'object' && value !== null && verifiedHandles.has(value);

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Reflect.ownKeys(value).length !== keys.length) return fail('manifest_invalid');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const entry = Object.getOwnPropertyDescriptor(value, key);
        if (!entry?.enumerable || !('value' in entry)) return fail('manifest_invalid');
        result[key] = entry.value;
    }
    return result;
}
function boundedText(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 3 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function safeRelative(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 240 && /^(model|runtime|worker)\/[A-Za-z0-9_./+-]+$/u.test(value)
        && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.endsWith('.')
            && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}
/** Parses data, never resolves a URL or evaluates a manifest field. */
export function parsePortableRelease(bytes: Buffer): PortableRelease {
    try {
        if (bytes.length > MAX_MANIFEST) return fail('manifest_invalid');
        const root = exact(JSON.parse(bytes.toString('utf8')), ['schemaVersion', 'provider', 'model', 'modelRevision', 'format', 'platform',
            'sourceRef', 'approvalRef', 'runtime', 'licenses', 'limits', 'files']);
        const runtime = exact(root.runtime, ['python', 'pythonVersion', 'transformersVersion', 'torchVersion', 'sourceRef']);
        const licenses = exact(root.licenses, ['model', 'runtime']);
        const limits = exact(root.limits, ['memoryBytes', 'threads']);
        if (root.schemaVersion !== 'mediflow.treatment-portable-release.v1' || root.provider !== PORTABLE_PROVIDER
            || root.model !== ATHENA_R1_QWEN3_8B_MODEL_ID || root.format !== 'safetensors'
            || typeof root.modelRevision !== 'string' || !/^[0-9a-f]{40,64}$/u.test(root.modelRevision)
            || !PORTABLE_PLATFORMS.includes(root.platform as PortablePlatform) || !boundedText(root.sourceRef) || !boundedText(root.approvalRef)
            || !boundedText(runtime.sourceRef) || !safeRelative(runtime.python) || !runtime.python.startsWith('runtime/')
            || !['pythonVersion', 'transformersVersion', 'torchVersion'].every(k => typeof runtime[k] === 'string' && VERSION.test(runtime[k] as string))
            || !Number.isSafeInteger(limits.memoryBytes) || (limits.memoryBytes as number) < 1024 ** 3 || (limits.memoryBytes as number) > 64 * 1024 ** 3
            || !Number.isSafeInteger(limits.threads) || (limits.threads as number) < 1 || (limits.threads as number) > 4
            || !Array.isArray(root.files) || root.files.length < 7 || root.files.length > 50_000) return fail('manifest_invalid');
        const names = new Set<string>(); let total = 0;
        const files = root.files.map((item: unknown): PortableFile => {
            const row = exact(item, ['path', 'bytes', 'sha256']);
            if (!safeRelative(row.path) || names.has(row.path.toLowerCase()) || !Number.isSafeInteger(row.bytes)
                || (row.bytes as number) < 1 || (row.bytes as number) > 20 * 1024 ** 3 || typeof row.sha256 !== 'string' || !DIGEST.test(row.sha256)
                || (row.path.startsWith('model/') && !/\.(?:json|safetensors|txt|md|model)$|\/(?:LICENSE|NOTICE)$/u.test(row.path))) return fail('manifest_invalid');
            names.add(row.path.toLowerCase()); total += row.bytes as number;
            return Object.freeze({ path: row.path, bytes: row.bytes as number, sha256: row.sha256 });
        });
        if (total > 96 * 1024 ** 3 || !files.some(f => f.path === runtime.python) || !files.some(f => f.path === WORKER)
            || !['model/config.json', 'model/tokenizer.json', 'model/tokenizer_config.json'].every(n => files.some(f => f.path === n))
            || !files.some(f => /^model\/[^/]+\.safetensors$/u.test(f.path))) return fail('manifest_invalid');
        const licenseFile = (p: unknown) => safeRelative(p) && files.some(f => f.path === p && f.bytes <= 1024 * 1024);
        if (!licenseFile(licenses.model) || !(licenses.model as string).startsWith('model/') || !Array.isArray(licenses.runtime)
            || licenses.runtime.length < 1 || licenses.runtime.length > 200 || !licenses.runtime.every(p => licenseFile(p) && p.startsWith('runtime/'))) return fail('license_missing');
        return Object.freeze({ ...root, runtime: Object.freeze(runtime), limits: Object.freeze(limits),
            licenses: Object.freeze({ model: licenses.model, runtime: Object.freeze([...licenses.runtime]) }), files: Object.freeze(files) }) as PortableRelease;
    } catch (error) { if (error instanceof PortableProvisioningError) throw error; return fail('manifest_invalid'); }
}

/** Rejects symlinks/junctions along the whole path; no implicit user directory fallback. */
function localDirectory(value: string, create = false): string {
    if (!path.isAbsolute(value) || value.includes('\0') || /^(?:\\\\|\/\/)/u.test(value)
        || value.split(/[\\/]/u).includes('..') || value.startsWith('\\\\?')) return fail('unavailable');
    const resolved = path.resolve(value); let current = path.parse(resolved).root;
    for (const piece of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, piece);
        if (!fs.existsSync(current)) { if (!create) return fail('model_not_provisioned'); fs.mkdirSync(current, { mode: 0o700 }); }
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('artifact_tampered');
    }
    if (path.relative(resolved, fs.realpathSync(resolved)) !== '') return fail('artifact_tampered');
    return resolved;
}
function plainFile(filename: string): fs.Stats {
    localDirectory(path.dirname(filename));
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return fail('artifact_tampered');
    return stat;
}
function boundedRead(filename: string, limit: number): Buffer {
    const stat = plainFile(filename); if (stat.size > limit) return fail('manifest_invalid');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const opened = fs.fstatSync(fd);
        if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return fail('artifact_tampered');
        const result = Buffer.alloc(opened.size); let offset = 0;
        while (offset < result.length) { const n = fs.readSync(fd, result, offset, result.length - offset, offset); if (!n) return fail('artifact_tampered'); offset += n; }
        if (fs.fstatSync(fd).size !== result.length) return fail('artifact_tampered');
        return result;
    } finally { fs.closeSync(fd); }
}
async function digestFile(filename: string, expected: PortableFile, signal?: AbortSignal, destination?: string): Promise<void> {
    cancelled(signal); const stat = plainFile(filename);
    if (stat.size !== expected.bytes) return fail('artifact_tampered');
    const input = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let output: fs.promises.FileHandle | undefined;
    try {
        const opened = await input.stat();
        if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== expected.bytes) return fail('artifact_tampered');
        if (destination) { localDirectory(path.dirname(destination), true); output = await fs.promises.open(destination, 'wx', 0o600); }
        const digest = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let count = 0;
        while (true) {
            cancelled(signal); const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            count += bytesRead; if (count > expected.bytes) return fail('artifact_tampered');
            digest.update(buffer.subarray(0, bytesRead));
            if (output) { let n = 0; while (n < bytesRead) { const written = await output.write(buffer, n, bytesRead - n, null); if (!written.bytesWritten) return fail('unavailable'); n += written.bytesWritten; } }
        }
        const after = await input.stat();
        if (count !== expected.bytes || digest.digest('hex') !== expected.sha256 || after.size !== opened.size
            || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return fail('artifact_tampered');
        if (output) await output.sync();
    } finally { await input.close(); await output?.close(); }
}
async function inventoryFile(filename: string, relative: string, signal?: AbortSignal): Promise<PortableFile> {
    cancelled(signal); const stat = plainFile(filename);
    if (stat.size < 1 || stat.size > 20 * GIB) return fail('manifest_invalid');
    const fd = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await fd.stat();
        if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return fail('artifact_tampered');
        const digest = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
        while (true) {
            cancelled(signal); const read = await fd.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead) break;
            bytes += read.bytesRead; if (bytes > stat.size) return fail('artifact_tampered');
            digest.update(buffer.subarray(0, read.bytesRead));
        }
        const after = await fd.stat();
        if (bytes !== stat.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return fail('artifact_tampered');
        return Object.freeze({ path: relative, bytes, sha256: digest.digest('hex') });
    } finally { await fd.close(); }
}
function inventory(directory: string): string[] {
    const root = localDirectory(directory); const output: string[] = [];
    const visit = (dir: string, depth: number) => {
        if (depth > 32 || output.length > 50_000) return fail('artifact_tampered');
        for (const name of fs.readdirSync(dir)) {
            const item = path.join(dir, name); const stat = fs.lstatSync(item);
            if (stat.isSymbolicLink()) return fail('artifact_tampered');
            if (stat.isDirectory()) visit(item, depth + 1);
            else { plainFile(item); output.push(path.relative(root, item).split(path.sep).join('/')); }
        }
    };
    visit(root, 0); return output.sort();
}
function writeAtomic(filename: string, value: unknown): void {
    localDirectory(path.dirname(filename), true);
    const temp = `${filename}.${randomBytes(12).toString('hex')}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, filename); } finally { fs.rmSync(temp, { force: true }); }
    // Directory fsync is not portable to Windows; atomic visibility is distinct from power-loss durability.
    if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(filename), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
const prerequisite = (code: PortableCode): readonly string[] => Object.freeze(code === 'NEEDS_CONTEXT'
    ? ['host_release_manifest', 'immutable_model_revision_and_checksums', 'approved_model_and_runtime_licenses', 'pinned_self_contained_python_transformers_torch_runtime']
    : code === 'model_not_provisioned' ? ['explicit_offline_import'] : code === 'needs_activation' ? ['explicit_host_admission']
        : code === 'admitted' ? [] : [code]);

/** Host composition only: never populate applicationRoot/workerPath from a request.
 * Capture the launcher's root once; imports/status must not inspect the worker.
 * Its physical path and digest are checked only by explicit artifact operations.
 */
export function createPortableProvisioning(options: Readonly<{ applicationRoot?: string; dataDir?: string; platform?: string; arch?: string; workerPath?: string; hardware?(): PortableHardwareObservation }> = {}) {
    const observe = options.hardware ?? readPortableHardware;
    const initialHardware = observe();
    const platform = `${options.platform ?? initialHardware.platform}-${options.arch ?? portableMachineArchitecture(initialHardware.machineArchitecture) ?? 'unknown'}`;
    const hardware = (release?: PortableRelease, checkAvailable = false) => assessPortableHardware(observe(), release, checkAvailable);
    const dataDir = options.dataDir ?? process.env.MEDIFLOW_DATA_DIR;
    const root = dataDir ? path.join(dataDir, 'treatment-reasoning-portable') : null;
    const applicationRoot = options.applicationRoot ?? process.cwd();
    // A bundled module URL is a public asset/chunk location, not an OS file identity.
    // localDirectory remains lazy and strict (no symlink/alias/traversal rewriting).
    const workerPath = () => options.workerPath ?? path.join(localDirectory(applicationRoot), 'scripts', 'treatment-reasoning-portable-worker.py');
    const paths = () => {
        if (!PORTABLE_PLATFORMS.includes(platform as PortablePlatform)) return fail('platform_unsupported');
        if (!dataDir || !root || !path.isAbsolute(dataDir)) return fail('NEEDS_CONTEXT');
        return root;
    };
    const objectDir = (digest: string) => { if (!DIGEST.test(digest)) return fail('manifest_invalid'); return path.join(paths(), 'objects', digest); };
    const manifestAt = (directory: string) => {
        const bytes = boundedRead(path.join(directory, 'release.json'), MAX_MANIFEST); const release = parsePortableRelease(bytes);
        if (release.platform !== platform) return fail('platform_unsupported');
        return { bytes, release, digest: hash(bytes) };
    };
    const stateAt = (digest: string): State | null => {
        const filename = path.join(paths(), 'records', `${digest}.json`);
        if (!fs.existsSync(filename)) return null;
        const value = exact(JSON.parse(boundedRead(filename, 2048).toString('utf8')), ['schemaVersion', 'releaseDigest', 'status', 'revision', 'receiptRef']);
        if (value.schemaVersion !== 'mediflow.treatment-portable-state.v1' || value.releaseDigest !== digest
            || !['verified', 'admitted', 'revoked'].includes(value.status as string) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
            || typeof value.receiptRef !== 'string' || !/^receipt_[0-9a-f]{32}$/u.test(value.receiptRef)) return fail('artifact_tampered');
        return Object.freeze(value) as State;
    };
    const selectedDigest = (): string | null => {
        const file = path.join(paths(), 'selected.json'); if (!fs.existsSync(file)) return null;
        const value = exact(JSON.parse(boundedRead(file, 256).toString('utf8')), ['releaseDigest']);
        return typeof value.releaseDigest === 'string' && DIGEST.test(value.releaseDigest) ? value.releaseDigest : fail('artifact_tampered');
    };
    const saveState = (digest: string, status: State['status'], previous: State | null): State => {
        if (previous?.status === 'revoked') return fail('revoked');
        const value: State = Object.freeze({ schemaVersion: 'mediflow.treatment-portable-state.v1', releaseDigest: digest, status,
            revision: (previous?.revision ?? 0) + 1, receiptRef: `receipt_${randomBytes(16).toString('hex')}` });
        writeAtomic(path.join(paths(), 'records', `${digest}.json`), value); return value;
    };
    const consent = (digest: string, supplied: string | undefined) => { if (!DIGEST.test(digest) || supplied !== digest) fail('consent_required'); };
    const lock = () => {
        const directory = localDirectory(paths(), true); const filename = path.join(directory, 'operation.lock');
        try { const fd = fs.openSync(filename, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd); }
        catch { return fail('busy'); }
        return () => { fs.rmSync(filename, { force: true }); };
    };
    const verify = async (directory: string, expectedDigest: string, signal?: AbortSignal) => {
        const entry = manifestAt(directory); if (entry.digest !== expectedDigest) return fail('artifact_tampered');
        const actual = inventory(path.join(directory, 'artifacts'));
        if (JSON.stringify(actual) !== JSON.stringify(entry.release.files.map(f => f.path).sort())) return fail('artifact_tampered');
        for (const file of entry.release.files) await digestFile(path.join(directory, 'artifacts', file.path), file, signal);
        const worker = entry.release.files.find(f => f.path === WORKER)!;
        await digestFile(workerPath(), worker, signal);
        const config = JSON.parse(boundedRead(path.join(directory, 'artifacts/model/config.json'), 1024 * 1024).toString('utf8'));
        if (!config || config.model_type !== 'qwen3' || config.auto_map || config.quantization_config) return fail('manifest_invalid');
        const indexPath = path.join(directory, 'artifacts/model/model.safetensors.index.json');
        if (fs.existsSync(indexPath)) {
            const index = JSON.parse(boundedRead(indexPath, 16 * 1024 * 1024).toString('utf8'));
            if (!index?.weight_map || typeof index.weight_map !== 'object' || Array.isArray(index.weight_map)
                || Object.values(index.weight_map).length === 0 || !Object.values(index.weight_map).every(p => typeof p === 'string'
                    && /^[A-Za-z0-9_.-]+\.safetensors$/u.test(p) && entry.release.files.some(f => f.path === `model/${p}`))) return fail('manifest_invalid');
        } else if (!entry.release.files.some(f => f.path === 'model/model.safetensors')) return fail('manifest_invalid');
        cancelled(signal); return entry;
    };
    const status = (requestedDigest?: string): PortableStatus => {
        let digest: string | null = null; let revision = 0; let selected = false; let state: PortableCode;
        let release: PortableRelease | undefined;
        try {
            const dir = paths(); if (!fs.existsSync(dir)) return Object.freeze({ schemaVersion: 'mediflow.treatment-portable-status.v1', provider: PORTABLE_PROVIDER, model: ATHENA_R1_QWEN3_8B_MODEL_ID, state: 'NEEDS_CONTEXT', releaseDigest: null, revision: 0, selected: false, prerequisites: Object.freeze([...prerequisite('NEEDS_CONTEXT'), ...hardware().blockers]), writesPerformed: 0, applyPolicy: 'none' }); localDirectory(dir);
            const current = selectedDigest(); digest = requestedDigest ?? current;
            if (!digest) {
                const incoming = path.join(dir, 'incoming/release.json');
                if (!fs.existsSync(incoming)) state = 'NEEDS_CONTEXT';
                else { const incomingEntry = manifestAt(path.dirname(incoming)); digest = incomingEntry.digest; release = incomingEntry.release; const record = stateAt(digest); revision = record?.revision ?? 0; state = record?.status === 'revoked' ? 'revoked' : record ? 'needs_activation' : 'model_not_provisioned'; }
            } else {
                const entry = manifestAt(objectDir(digest)); release = entry.release; if (entry.digest !== digest) return fail('artifact_tampered');
                const record = stateAt(digest); revision = record?.revision ?? 0; selected = current === digest;
                state = record?.status === 'revoked' ? 'revoked' : record?.status === 'admitted' && selected ? 'admitted' : 'needs_activation';
            }
        } catch (error) { state = error instanceof PortableProvisioningError ? error.code : 'unavailable'; }
        const hardwareBlockers = hardware(release).blockers;
        if (state === 'admitted' && hardwareBlockers.length) state = 'unavailable';
        return Object.freeze({ schemaVersion: 'mediflow.treatment-portable-status.v1', provider: PORTABLE_PROVIDER,
            model: ATHENA_R1_QWEN3_8B_MODEL_ID, state, releaseDigest: digest, revision, selected,
            prerequisites: Object.freeze([...new Set([...prerequisite(state), ...hardwareBlockers])]), writesPerformed: 0, applyPolicy: 'none' });
    };
    return Object.freeze({ status, hardware: () => {
        try {
            const selected = selectedDigest();
            if (selected) return hardware(manifestAt(objectDir(selected)).release);
            const incoming = path.join(paths(), 'incoming');
            if (fs.existsSync(path.join(incoming, 'release.json'))) return hardware(manifestAt(incoming).release);
        } catch { /* Status owns artifact errors; hardware is configuration-only. */ }
        return hardware();
    },
        async inventoryOffline(input: Readonly<{ confirmed: boolean; signal?: AbortSignal }>) {
            if (input.confirmed !== true) return fail('consent_required');
            cancelled(input.signal);
            const incoming = path.join(paths(), 'incoming');
            if (!fs.existsSync(path.join(incoming, 'release-input.json'))) return fail('NEEDS_CONTEXT');
            const config = exact(JSON.parse(boundedRead(path.join(incoming, 'release-input.json'), MAX_MANIFEST).toString('utf8')),
                ['schemaVersion', 'provider', 'model', 'modelRevision', 'format', 'platform', 'sourceRef', 'approvalRef', 'runtime', 'licenses', 'limits']);
            const unlock = lock();
            try {
                const artifacts = path.join(incoming, 'artifacts');
                const files: PortableFile[] = []; let total = 0;
                for (const name of inventory(artifacts)) {
                    const file = await inventoryFile(path.join(artifacts, name), name, input.signal);
                    total += file.bytes; if (total > 96 * GIB) return fail('manifest_invalid');
                    files.push(file);
                }
                const release = parsePortableRelease(Buffer.from(JSON.stringify({ ...config, files }), 'utf8'));
                verifyPortablePublishedMetadata(release);
                if (release.platform !== platform) return fail('platform_unsupported');
                const worker = files.find(file => file.path === WORKER)!;
                await digestFile(workerPath(), worker, input.signal); cancelled(input.signal);
                writeAtomic(path.join(incoming, 'release.json'), release);
                const entry = manifestAt(incoming);
                return Object.freeze({ schemaVersion: 'mediflow.treatment-portable-inventory.v1', state: 'model_not_provisioned' as const,
                    releaseDigest: entry.digest, files: files.length, bytes: total, imported: false, selected: false,
                    modelEvidence: 'published_metadata_matched', runtimeQualification: 'not_observed',
                    licenseApproval: 'operator_reference_not_independently_qualified', writesPerformed: 0, applyPolicy: 'none' });
            } finally { unlock(); }
        },
        async importOffline(input: Readonly<{ consentDigest?: string; signal?: AbortSignal }>): Promise<PortableStatus> {
            cancelled(input.signal); const incoming = path.join(paths(), 'incoming');
            if (!fs.existsSync(path.join(incoming, 'release.json'))) return fail('NEEDS_CONTEXT');
            const entry = manifestAt(incoming); consent(entry.digest, input.consentDigest);
            const unlock = lock(); const stage = path.join(paths(), '.stage'); let createdStage = false;
            try {
                const previous = stateAt(entry.digest); if (previous?.status === 'revoked') return fail('revoked');
                if (fs.existsSync(stage)) return fail('interrupted');
                if (fs.existsSync(objectDir(entry.digest))) { await verify(objectDir(entry.digest), entry.digest, input.signal);
                    if (!previous) saveState(entry.digest, 'verified', null); return status(entry.digest); }
                localDirectory(stage, true); createdStage = true;
                const names = inventory(path.join(incoming, 'artifacts'));
                if (JSON.stringify(names) !== JSON.stringify(entry.release.files.map(f => f.path).sort())) return fail('artifact_tampered');
                for (const file of entry.release.files) await digestFile(path.join(incoming, 'artifacts', file.path), file, input.signal, path.join(stage, 'artifacts', file.path));
                fs.writeFileSync(path.join(stage, 'release.json'), entry.bytes, { flag: 'wx', mode: 0o600 });
                await verify(stage, entry.digest, input.signal); cancelled(input.signal);
                localDirectory(path.join(paths(), 'objects'), true);
                if (process.platform !== 'win32') fs.chmodSync(path.join(stage, 'artifacts', entry.release.runtime.python), 0o700);
                fs.renameSync(stage, objectDir(entry.digest)); saveState(entry.digest, 'verified', previous);
                return status(entry.digest);
            } catch (error) {
                if (createdStage && fs.existsSync(stage)) { localDirectory(stage); fs.rmSync(stage, { recursive: true }); }
                if (error instanceof PortableProvisioningError) throw error;
                return fail('unavailable');
            } finally { unlock(); }
        },
        async activate(input: Readonly<{ consentDigest?: string; signal?: AbortSignal }>): Promise<PortableStatus> {
            const digest = input.consentDigest ?? ''; consent(digest, input.consentDigest); cancelled(input.signal);
            const unlock = lock();
            try {
                const previous = stateAt(digest); if (previous?.status === 'revoked') return fail('revoked');
                if (!previous) return fail('model_not_provisioned');
                const entry = await verify(objectDir(digest), digest, input.signal); cancelled(input.signal);
                if (hardware(entry.release).blockers.length) return fail('unavailable');
                if (previous.status !== 'admitted') saveState(digest, 'admitted', previous);
                writeAtomic(path.join(paths(), 'selected.json'), { releaseDigest: digest }); return status();
            } finally { unlock(); }
        },
        revoke(input: Readonly<{ consentDigest?: string }>): PortableStatus {
            const digest = input.consentDigest ?? ''; consent(digest, input.consentDigest); const unlock = lock();
            try { const previous = stateAt(digest); if (!previous) return fail('model_not_provisioned');
                if (previous.status !== 'revoked') saveState(digest, 'revoked', previous); return status(digest);
            } finally { unlock(); }
        },
        recover(input: Readonly<{ confirmed: boolean }>): PortableStatus {
            if (input.confirmed !== true) return fail('consent_required');
            const dir = localDirectory(paths(), true); const filename = path.join(dir, 'operation.lock');
            if (fs.existsSync(filename)) {
                const owner = exact(JSON.parse(boundedRead(filename, 128).toString('utf8')), ['pid']);
                if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1) return fail('busy');
                try { process.kill(owner.pid as number, 0); return fail('busy'); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return fail('busy'); }
                fs.unlinkSync(filename);
            }
            const unlock = lock();
            try { const stage = path.join(dir, '.stage'); if (fs.existsSync(stage)) { localDirectory(stage); fs.rmSync(stage, { recursive: true }); } return status(); }
            finally { unlock(); }
        },
        async verifySelected(signal?: AbortSignal): Promise<VerifiedPortableArtifact> {
            const before = status(); if (before.state !== 'admitted' || !before.releaseDigest) return fail(before.state);
            const directory = objectDir(before.releaseDigest); const entry = await verify(directory, before.releaseDigest, signal);
            if (hardware(entry.release, true).blockers.length) return fail('unavailable');
            const after = status(); if (after.state !== 'admitted' || after.releaseDigest !== before.releaseDigest || after.revision !== before.revision) return fail('revoked');
            const artifact = Object.freeze({ release: entry.release, artifactDigest: entry.digest,
                runtimeDigest: hash(JSON.stringify({ runtime: entry.release.runtime, files: entry.release.files.filter(f => f.path.startsWith('runtime/')).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) })),
                workerDigest: entry.release.files.find(f => f.path === WORKER)!.sha256, revision: before.revision,
                directory: path.join(directory, 'artifacts'), python: path.join(directory, 'artifacts', entry.release.runtime.python),
                worker: path.join(directory, 'artifacts', WORKER) });
            verifiedHandles.add(artifact); return artifact;
        },
    });
}
export type PortableProvisioning = ReturnType<typeof createPortableProvisioning>;
