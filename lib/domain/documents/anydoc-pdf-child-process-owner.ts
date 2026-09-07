/* @Codex */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import rendererProfiles from '../../../scripts/anydoc-pdf-renderer-profiles.json' with { type: 'json' };
import tesseractArtifacts from '../../../scripts/anydoc-tesseract-artifacts.json' with { type: 'json' };

export const ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION = 'mediflow.anydoc_pdf_child_protocol.v1' as const;
export const ANYDOC_PDF_CHILD_WORKER_SHA256 = '31fce8c00c25edd20f7f4442edc9fe00d659599e436cc5166b4be4950f7f3a67' as const;
export const ANYDOC_PDF_CHILD_JOB_TIMEOUT_MS = 30_000;
export const ANYDOC_PDF_CHILD_MAX_HEADER_BYTES = 64 * 1024;
export const ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB = 256;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_STDOUT_BYTES = 4 + ANYDOC_PDF_CHILD_MAX_HEADER_BYTES + MAX_BODY_BYTES;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_MATERIALIZED_BYTES = 25 * 1024 * 1024;
const MAX_RENDER_PAGES = 16;
const MAX_RASTER_BYTES = 16 * 1024 * 1024;
const MAX_DIMENSION_PIXELS = 4096;
const MAX_PIXELS = 12_000_000;
const MAX_PNG_CHUNKS = 2_048;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR = Buffer.from('IHDR', 'ascii');
const PNG_IDAT = Buffer.from('IDAT', 'ascii');
const PNG_IEND = Buffer.from('IEND', 'ascii');
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_NAME = 'medical-record-app';
const WORKER_FILE = 'anydoc-pdf-page-worker.mjs';
const MAX_ROOT_STEPS = 8;

export type AnyDocPdfChildFailureReason =
    | 'busy' | 'timeout' | 'resource_limit' | 'worker_unavailable' | 'protocol_error'
    | 'invalid_request' | 'malformed_or_encrypted_pdf' | 'page_count_mismatch'
    | 'engine_unavailable' | 'render_failed' | 'recognition_failed' | 'empty_output';

export type AnyDocPdfChildFailure = Readonly<{
    status: 'failed';
    reason: AnyDocPdfChildFailureReason;
    terminationSignal: 'SIGKILL' | null;
}>;

export type AnyDocPdfChildMaterializationResult = AnyDocPdfChildFailure | Readonly<{
    status: 'materialized';
    pages: readonly Readonly<{ page: number; pdfBytes: Buffer }>[];
}>;

export type AnyDocPdfChildRenderingResult = AnyDocPdfChildFailure | Readonly<{
    status: 'rendered';
    pages: readonly Readonly<{
        page: number;
        pngBytes: Buffer;
        width: number;
        height: number;
        durationMs: number;
    }>[];
}>;

type Exact = Record<string, unknown>;
type RawRunResult = Readonly<{ status: 'completed'; output: Buffer; terminationSignal: null }> | AnyDocPdfChildFailure;
type DecodedFrame = Readonly<{ header: unknown; body: Buffer }>;
type RunOptions = Readonly<{
    args: readonly string[];
    timeoutMs: number;
    maxOutputBytes: number;
    allowAddons: boolean;
    wasmMemoryPages?: number;
}>;
const failure = (reason: AnyDocPdfChildFailureReason,
    terminationSignal: 'SIGKILL' | null = null): AnyDocPdfChildFailure =>
    Object.freeze({ status: 'failed', reason, terminationSignal });

function exact(value: unknown, keys: readonly string[]): Exact | null {
    if (!value || typeof value !== 'object' || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) return null;
    const output: Exact = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        output[key] = descriptor.value;
    }
    return output;
}

function arrayValues(value: unknown, maximum: number): readonly unknown[] | null {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum
        || Reflect.ownKeys(descriptors).length !== length + 1) return null;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        output.push(descriptor.value);
    }
    return output;
}

function inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveOwnedWorker(): { path: string; directory: string; root: string } | null {
    let directory: string;
    try { directory = realpathSync(MODULE_DIRECTORY); } catch { return null; }
    for (let step = 0; step < MAX_ROOT_STEPS; step += 1) {
        try {
            const packageValue = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as unknown;
            if (exact(packageValue, Object.keys(packageValue as object))
                && (packageValue as { name?: unknown }).name === PACKAGE_NAME) {
                const candidate = path.join(directory, 'scripts', WORKER_FILE);
                if (!lstatSync(candidate).isFile()) return null;
                const root = realpathSync(directory);
                const worker = realpathSync(candidate);
                if (!inside(root, worker) || !statSync(worker).isFile()) return null;
                const digest = createHash('sha256').update(readFileSync(worker)).digest('hex');
                const profileManifest = path.join(root, 'scripts', 'anydoc-pdf-renderer-profiles.json');
                if (!lstatSync(profileManifest).isFile() || !inside(root, realpathSync(profileManifest))
                    || createHash('sha256').update(readFileSync(profileManifest)).digest('hex')
                    !== '41355c1e4360acdc293aa383a07ba2c8216a8a018b0a38ac2a9ec5cc0fe37e41') return null;
                const artifactManifest = path.join(root, 'scripts', 'anydoc-tesseract-artifacts.json');
                if (!lstatSync(artifactManifest).isFile() || !inside(root, realpathSync(artifactManifest))
                    || createHash('sha256').update(readFileSync(artifactManifest)).digest('hex')
                    !== '0fb4ed952127bafe84e97f3f3cb43f6f53d5d60984117eed6a550d73508c6978') return null;
                return digest === ANYDOC_PDF_CHILD_WORKER_SHA256
                    ? { path: worker, directory: path.dirname(worker), root }
                    : null;
            }
        } catch { /* continue toward the owned package root */ }
        const parent = path.dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
    return null;
}

function encodeFrame(header: object, bodies: readonly Buffer[]): Buffer {
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeUInt32BE(headerBytes.byteLength, 0);
    return Buffer.concat([prefix, headerBytes, ...bodies], 4 + headerBytes.byteLength
        + bodies.reduce((total, body) => total + body.byteLength, 0));
}

function decodeFrame(input: Buffer): DecodedFrame | null {
    if (input.byteLength < 5) return null;
    const headerLength = input.readUInt32BE(0);
    if (headerLength < 1 || headerLength > ANYDOC_PDF_CHILD_MAX_HEADER_BYTES
        || input.byteLength < 4 + headerLength) return null;
    const headerText = input.subarray(4, 4 + headerLength).toString('utf8');
    let header: unknown;
    try { header = JSON.parse(headerText); } catch { return null; }
    if (JSON.stringify(header) !== headerText) return null;
    return Object.freeze({ header, body: Buffer.from(input.subarray(4 + headerLength)) });
}

let activeJob = false;

async function runOwnedWorker(input: Buffer, options: RunOptions): Promise<RawRunResult> {
    if (activeJob) return failure('busy');
    activeJob = true;
    try {
        const worker = resolveOwnedWorker();
        if (!worker) return failure('worker_unavailable');
        return await new Promise<RawRunResult>((resolve) => {
            let child;
            try {
                const runtimeArguments = [
                    `--max-old-space-size=${ANYDOC_PDF_CHILD_MAX_OLD_SPACE_MB}`,
                    ...(options.wasmMemoryPages ? [`--wasm-max-mem-pages=${options.wasmMemoryPages}`] : []),
                    '--permission',
                    '--disable-warning=SecurityWarning',
                    `--allow-fs-read=${worker.root}`,
                    ...(options.allowAddons ? ['--allow-addons'] : []),
                    worker.path,
                    ...options.args,
                ];
                child = spawn(process.execPath, runtimeArguments, {
                    cwd: worker.directory,
                    env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                });
            } catch { resolve(failure('worker_unavailable')); return; }
            const output: Buffer[] = [];
            let outputBytes = 0;
            let diagnosticBytes = 0;
            let forcedReason: AnyDocPdfChildFailureReason | null = null;
            let settled = false;
            const finish = (result: RawRunResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const stop = (reason: AnyDocPdfChildFailureReason) => {
                if (forcedReason) return;
                forcedReason = reason;
                child.kill('SIGKILL');
            };
            const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
            child.stdout.on('data', (chunk: Buffer) => {
                outputBytes += chunk.byteLength;
                if (outputBytes > options.maxOutputBytes) stop('resource_limit');
                else output.push(Buffer.from(chunk));
            });
            child.stderr.on('data', (chunk: Buffer) => {
                diagnosticBytes += chunk.byteLength;
                if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) stop('resource_limit');
            });
            child.once('error', () => {
                if (!forcedReason) forcedReason = 'worker_unavailable';
                if (child.pid !== undefined) child.kill('SIGKILL');
            });
            child.once('close', (code, signal) => {
                if (forcedReason) return finish(failure(forcedReason, signal === 'SIGKILL' ? 'SIGKILL' : null));
                if (code !== 0 || signal !== null) return finish(failure('worker_unavailable'));
                return finish(Object.freeze({ status: 'completed', output: Buffer.concat(output, outputBytes), terminationSignal: null }));
            });
            child.stdin.on('error', () => undefined);
            child.stdin.end(input);
        });
    } finally { activeJob = false; }
}

type PngDimensions = Readonly<{ width: number; height: number }>;

function asciiChunkType(input: Buffer, offset: number): boolean {
    for (let index = offset; index < offset + 4; index += 1) {
        const value = input[index];
        if (value === undefined || !((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))) return false;
    }
    return true;
}

/* The isolated child is still an untrusted parser boundary. Accept only one
   structurally complete PNG whose first IHDR matches the bounded receipt. */
function pngDimensions(input: Buffer): PngDimensions | null {
    if (input.byteLength < 57 || input.byteLength > MAX_RASTER_BYTES
        || !input.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) return null;
    let offset = PNG_SIGNATURE.byteLength;
    let width = 0;
    let height = 0;
    let sawIdat = false;
    for (let count = 0; count < MAX_PNG_CHUNKS; count += 1) {
        if (offset + 12 > input.byteLength || !asciiChunkType(input, offset + 4)) return null;
        const byteLength = input.readUInt32BE(offset);
        const dataOffset = offset + 8;
        const next = dataOffset + byteLength + 4;
        if (byteLength > MAX_RASTER_BYTES || !Number.isSafeInteger(next) || next > input.byteLength) return null;
        const type = input.subarray(offset + 4, offset + 8);
        if (count === 0) {
            if (!type.equals(PNG_IHDR) || byteLength !== 13) return null;
            width = input.readUInt32BE(dataOffset);
            height = input.readUInt32BE(dataOffset + 4);
            const pixels = width * height;
            if (width < 1 || height < 1 || width > MAX_DIMENSION_PIXELS || height > MAX_DIMENSION_PIXELS
                || !Number.isSafeInteger(pixels) || pixels > MAX_PIXELS
                || input[dataOffset + 8] < 1 || input[dataOffset + 8] > 16
                || input[dataOffset + 10] !== 0 || input[dataOffset + 11] !== 0
                || (input[dataOffset + 12] !== 0 && input[dataOffset + 12] !== 1)) return null;
        } else if (type.equals(PNG_IHDR)) return null;
        if (type.equals(PNG_IDAT)) sawIdat = true;
        if (type.equals(PNG_IEND)) {
            return byteLength === 0 && sawIdat && next === input.byteLength
                ? Object.freeze({ width, height })
                : null;
        }
        offset = next;
    }
    return null;
}

function parseWorkerFailure(frame: DecodedFrame): AnyDocPdfChildFailure | null {
    const header = exact(frame.header, ['schemaVersion', 'status', 'reason', 'bodyByteLength']);
    const reasons: readonly AnyDocPdfChildFailureReason[] = [
        'invalid_request', 'malformed_or_encrypted_pdf', 'page_count_mismatch',
        'resource_limit', 'engine_unavailable', 'render_failed', 'timeout', 'recognition_failed', 'empty_output',
    ];
    return header && header.schemaVersion === ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION && header.status === 'error'
        && typeof header.reason === 'string' && reasons.includes(header.reason as AnyDocPdfChildFailureReason)
        && header.bodyByteLength === 0 && frame.body.byteLength === 0
        ? failure(header.reason as AnyDocPdfChildFailureReason)
        : null;
}

function completedFrame(result: RawRunResult): DecodedFrame | AnyDocPdfChildFailure {
    if (result.status === 'failed') return result;
    return decodeFrame(result.output) ?? failure('protocol_error');
}

/** Runs the fixed materializer in one digest-pinned child. Source hashes remain parent-owned. */
export async function runAnyDocPdfMaterializationChild(
    sourceBytes: Buffer,
    pageCount: number,
): Promise<AnyDocPdfChildMaterializationResult> {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 500
        || types.isProxy(sourceBytes) || !(sourceBytes instanceof Uint8Array)
        || sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_MATERIALIZED_BYTES)
        return failure('protocol_error');
    let source: Buffer;
    try { source = Buffer.from(sourceBytes); } catch { return failure('protocol_error'); }
    const input = encodeFrame({ schemaVersion: ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION,
        operation: 'materialize', pageCount, sourceByteLength: source.byteLength }, [source]);
    const value = completedFrame(await runOwnedWorker(input, {
        args: [], timeoutMs: ANYDOC_PDF_CHILD_JOB_TIMEOUT_MS, maxOutputBytes: MAX_STDOUT_BYTES,
        allowAddons: false,
    }));
    if ('reason' in value) return value;
    const workerFailure = parseWorkerFailure(value); if (workerFailure) return workerFailure;
    const header = exact(value.header, ['schemaVersion', 'status', 'pages', 'bodyByteLength']);
    const pages = arrayValues(header?.pages, 500);
    if (!header || header.schemaVersion !== ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION
        || header.status !== 'materialized' || !pages || pages.length !== pageCount
        || !Number.isSafeInteger(header.bodyByteLength) || (header.bodyByteLength as number) < 1
        || (header.bodyByteLength as number) > MAX_MATERIALIZED_BYTES
        || value.body.byteLength !== header.bodyByteLength) return failure('protocol_error');
    const output: Array<Readonly<{ page: number; pdfBytes: Buffer }>> = [];
    let offset = 0;
    for (let index = 0; index < pages.length; index += 1) {
        const page = exact(pages[index], ['page', 'byteLength']);
        if (!page || page.page !== index + 1 || !Number.isSafeInteger(page.byteLength)
            || (page.byteLength as number) < 1 || (page.byteLength as number) > MAX_MATERIALIZED_BYTES
            || offset + (page.byteLength as number) > value.body.byteLength) return failure('protocol_error');
        const next = offset + (page.byteLength as number);
        output.push(Object.freeze({ page: index + 1, pdfBytes: Buffer.from(value.body.subarray(offset, next)) }));
        offset = next;
    }
    return offset === value.body.byteLength
        ? Object.freeze({ status: 'materialized', pages: Object.freeze(output) })
        : failure('protocol_error');
}

/** Runs the fixed renderer in one digest-pinned child. Raster digests and publication remain parent-owned. */
export async function runAnyDocPdfRenderingChild(
    pageInputs: readonly Readonly<{ page: number; pdfBytes: Buffer }>[],
): Promise<AnyDocPdfChildRenderingResult> {
    const inputValues = arrayValues(pageInputs, MAX_RENDER_PAGES);
    if (!inputValues || inputValues.length < 1) return failure('protocol_error');
    const snapshots: Array<Readonly<{ page: number; pdfBytes: Buffer }>> = [];
    let previous = 0;
    for (const value of inputValues) {
        const input = exact(value, ['page', 'pdfBytes']);
        if (!input || !Number.isSafeInteger(input.page) || (input.page as number) <= previous
            || (input.page as number) > 500 || types.isProxy(input.pdfBytes)
            || !(input.pdfBytes instanceof Uint8Array) || input.pdfBytes.byteLength < 1
            || input.pdfBytes.byteLength > MAX_MATERIALIZED_BYTES)
            return failure('protocol_error');
        try { snapshots.push(Object.freeze({ page: input.page as number, pdfBytes: Buffer.from(input.pdfBytes) })); }
        catch { return failure('protocol_error'); }
        previous = input.page as number;
    }
    const total = snapshots.reduce((sum, page) => sum + page.pdfBytes.byteLength, 0);
    if (total > MAX_MATERIALIZED_BYTES) return failure('resource_limit');
    const input = encodeFrame({ schemaVersion: ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION, operation: 'render',
        pages: snapshots.map((page) => ({ page: page.page, byteLength: page.pdfBytes.byteLength })),
        bodyByteLength: total }, snapshots.map((page) => page.pdfBytes));
    const value = completedFrame(await runOwnedWorker(input, {
        args: [], timeoutMs: ANYDOC_PDF_CHILD_JOB_TIMEOUT_MS, maxOutputBytes: MAX_STDOUT_BYTES,
        allowAddons: true,
    }));
    if ('reason' in value) return value;
    const workerFailure = parseWorkerFailure(value); if (workerFailure) return workerFailure;
    const header = exact(value.header, ['schemaVersion', 'status', 'pages', 'bodyByteLength']);
    const pages = arrayValues(header?.pages, MAX_RENDER_PAGES);
    if (!header || header.schemaVersion !== ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION
        || header.status !== 'rendered' || !pages || pages.length !== snapshots.length
        || !Number.isSafeInteger(header.bodyByteLength) || (header.bodyByteLength as number) < 1
        || (header.bodyByteLength as number) > MAX_BODY_BYTES
        || value.body.byteLength !== header.bodyByteLength) return failure('protocol_error');
    const output: Array<Readonly<{ page: number; pngBytes: Buffer; width: number; height: number; durationMs: number }>> = [];
    let offset = 0;
    for (let index = 0; index < pages.length; index += 1) {
        const page = exact(pages[index], ['page', 'byteLength', 'width', 'height', 'durationMs']);
        const expected = snapshots[index];
        if (!page || page.page !== expected?.page || !Number.isSafeInteger(page.byteLength)
            || (page.byteLength as number) < 57 || (page.byteLength as number) > MAX_RASTER_BYTES
            || !Number.isSafeInteger(page.width) || (page.width as number) < 1
            || !Number.isSafeInteger(page.height) || (page.height as number) < 1
            || !Number.isSafeInteger(page.durationMs) || (page.durationMs as number) < 0
            || offset + (page.byteLength as number) > value.body.byteLength) return failure('protocol_error');
        const next = offset + (page.byteLength as number);
        const pngBytes = Buffer.from(value.body.subarray(offset, next));
        const dimensions = pngDimensions(pngBytes);
        if (!dimensions || dimensions.width !== page.width || dimensions.height !== page.height) {
            return failure('protocol_error');
        }
        output.push(Object.freeze({ page: page.page as number,
            pngBytes, width: dimensions.width,
            height: dimensions.height, durationMs: page.durationMs as number }));
        offset = next;
    }
    return offset === value.body.byteLength
        ? Object.freeze({ status: 'rendered', pages: Object.freeze(output) })
        : failure('protocol_error');
}

async function runTestScenario(argument: string, timeoutMs: number, maxOutputBytes: number): Promise<AnyDocPdfChildFailure> {
    const result = completedFrame(await runOwnedWorker(Buffer.alloc(0), {
        args: [argument], timeoutMs, maxOutputBytes, allowAddons: false,
    }));
    if ('reason' in result) return result;
    return parseWorkerFailure(result) ?? failure('protocol_error');
}

/** @internal Cross-process failure fixtures; no caller path, bytes, limits, command, or environment is accepted. */
export const ANYDOC_PDF_CHILD_PROCESS_INTERNAL_TEST_SEAM = Object.freeze({
    runSynchronousHang: () => runTestScenario('--self-test=sync-hang', 100, 1024),
    runOversizedOutput: () => runTestScenario('--self-test=oversized-output', 1_000, 1024),
    runMalformedOutput: () => runTestScenario('--self-test=malformed-output', 1_000, 1024),
    runValidFailure: () => runTestScenario('--self-test=valid-failure', 1_000, 1024),
    runSharedDeadline: () => runTestScenario('--self-test=shared-deadline', 1_000, 1024),
    runNetworkDenied: () => runTestScenario('--self-test=network-denied', 1_000, 1024),
    validatePng: (input: Buffer, width: number, height: number) => {
        const dimensions = pngDimensions(Buffer.from(input));
        return dimensions?.width === width && dimensions.height === height;
    },
});

/* @Codex */
export const ANYDOC_TESSERACT_ARTIFACT_SET_SHA256 = '0fb4ed952127bafe84e97f3f3cb43f6f53d5d60984117eed6a550d73508c6978';
function inspectTesseractArtifacts() {
    const base = { engine: 'tesseract_wasm' as const, qualification: 'pending_target_benchmark' as const,
        artifactSetSha256: ANYDOC_TESSERACT_ARTIFACT_SET_SHA256,
        guidance: 'Provisionare localmente i cinque file di scripts/anydoc-tesseract-artifacts.json in node_modules/mediflow-ocr-tesseract; verificare digest e rieseguire il controllo. Nessun download automatico.' };
    if (process.versions.node.split('.')[0] !== '24')
        return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'node24_required', guidance: 'Usare Node 24 e ripetere il controllo locale.' });
    if (!['darwin', 'linux', 'win32'].includes(process.platform))
        return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'unsupported_platform' });
    const worker = resolveOwnedWorker();
    if (!worker) return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'worker_unavailable' });
    try {
        for (const artifact of tesseractArtifacts.files) {
            const file = path.join(worker.root, tesseractArtifacts.directory, artifact.name);
            if (!lstatSync(file).isFile() || !inside(worker.root, realpathSync(file)))
                return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'artifact_invalid' });
            const stat = statSync(file);
            if (stat.size !== artifact.byteLength || createHash('sha256').update(readFileSync(file)).digest('hex') !== artifact.sha256)
                return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'artifact_invalid' });
        }
    } catch { return Object.freeze({ ...base, status: 'unavailable' as const, reason: 'artifact_missing' }); }
    return Object.freeze({ ...base, status: 'artifacts_verified' as const, reason: null });
}

/* @Codex: checks pinned OCR artifacts and renderer prerequisites without loading native code. */
export function inspectAnyDocDesktopOcrCapability() {
    const artifacts = inspectTesseractArtifacts();
    if (artifacts.status !== 'artifacts_verified') return artifacts;
    const profile = rendererProfiles.find((entry) => entry.platform === process.platform && entry.arch === process.arch);
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    const glibc = String(report?.header?.glibcVersionRuntime).split('.').map(Number);
    if (!profile || (profile.libc === 'glibc' && !(glibc[0] > 2 || (glibc[0] === 2 && glibc[1] >= 18))))
        return Object.freeze({ ...artifacts, status: 'unavailable' as const, reason: 'renderer_profile_unsupported' });
    const worker = resolveOwnedWorker();
    try {
        if (!worker) throw new Error();
        for (const [dependency, version] of [['pdfjs-dist', '4.10.38'], ['@napi-rs/canvas', '0.1.100'], [profile.package, profile.version]]) {
            const packagePath = path.join(worker.root, 'node_modules', dependency, 'package.json');
            if (!inside(worker.root, realpathSync(packagePath))
                || JSON.parse(readFileSync(packagePath, 'utf8')).version !== version) throw new Error();
        }
        const binaryPath = path.join(worker.root, 'node_modules', profile.package, profile.binary);
        if (!lstatSync(binaryPath).isFile() || !inside(worker.root, realpathSync(binaryPath))
            || statSync(binaryPath).size !== profile.binaryByteLength
            || createHash('sha256').update(readFileSync(binaryPath)).digest('hex') !== profile.binarySha256) throw new Error();
        return Object.freeze({ ...artifacts, rendererProfile: profile.package });
    } catch {
        return Object.freeze({ ...artifacts, status: 'unavailable' as const, reason: 'renderer_unavailable',
            guidance: `Ripristinare il pacchetto ${profile.package}@${profile.version} fissato dal lock e rieseguire il controllo; nessun download automatico.` });
    }
}

export type AnyDocTesseractDocumentResult = AnyDocPdfChildFailure | Readonly<{
    status: 'recognized'; pages: readonly Readonly<{ text: string; receipt: Readonly<{
        engine: 'tesseract_wasm'; scriptSha256: string; artifactSetSha256: string;
        inputSha256: string; inputByteLength: number; outputSha256: string;
        outputByteLength: number; averageConfidence: number;
    }> }>[];
}>;

/** Internal raster boundary: routing and currentness remain in the composition owner. */
export async function runAnyDocTesseractDocument(input: unknown): Promise<AnyDocTesseractDocumentResult> {
    const values = arrayValues(input, MAX_RENDER_PAGES);
    if (!values || values.length < 1) return failure('invalid_request');
    const images: Buffer[] = [];
    let total = 0;
    for (const value of values) {
        if (types.isProxy(value) || !(value instanceof Uint8Array) || value.byteLength > MAX_RASTER_BYTES)
            return failure('invalid_request');
        const bytes = Buffer.from(value);
        if (!pngDimensions(bytes)) return failure('invalid_request');
        total += bytes.byteLength;
        if (total > MAX_BODY_BYTES) return failure('resource_limit');
        images.push(bytes);
    }
    if (inspectTesseractArtifacts().status !== 'artifacts_verified') return failure('engine_unavailable');
    const payload = encodeFrame({ schemaVersion: ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION,
        operation: 'recognize_tesseract', pages: images.map((page) => ({ byteLength: page.byteLength })), bodyByteLength: total }, images);
    const value = completedFrame(await runOwnedWorker(payload, { args: [],
        timeoutMs: ANYDOC_PDF_CHILD_JOB_TIMEOUT_MS, maxOutputBytes: 20 * 1024 * 1024, allowAddons: false, wasmMemoryPages: 8192 }));
    if ('reason' in value) return value;
    const failed = parseWorkerFailure(value); if (failed) return failed;
    const header = exact(value.header, ['schemaVersion', 'status', 'bodyByteLength']);
    if (!header || header.schemaVersion !== ANYDOC_PDF_CHILD_PROTOCOL_SCHEMA_VERSION || header.status !== 'recognized'
        || header.bodyByteLength !== value.body.byteLength) return failure('protocol_error');
    let parsed: unknown; try { parsed = JSON.parse(value.body.toString('utf8')); } catch { return failure('protocol_error'); }
    const pages = arrayValues(parsed, MAX_RENDER_PAGES);
    if (!pages || pages.length !== images.length) return failure('protocol_error');
    const recognized = [];
    for (let index = 0; index < pages.length; index += 1) {
        const page = exact(pages[index], ['text', 'confidence']);
        if (!page || typeof page.text !== 'string' || !page.text.trim()
            || Buffer.byteLength(page.text) > 1024 * 1024 || typeof page.confidence !== 'number'
            || !Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 1) return failure('protocol_error');
        recognized.push(Object.freeze({ text: page.text, receipt: Object.freeze({
            engine: 'tesseract_wasm' as const, scriptSha256: ANYDOC_PDF_CHILD_WORKER_SHA256,
            artifactSetSha256: ANYDOC_TESSERACT_ARTIFACT_SET_SHA256,
            inputSha256: createHash('sha256').update(images[index]).digest('hex'), inputByteLength: images[index].byteLength,
            outputSha256: createHash('sha256').update(page.text).digest('hex'), outputByteLength: Buffer.byteLength(page.text),
            averageConfidence: page.confidence,
        }) }));
    }
    return Object.freeze({ status: 'recognized', pages: Object.freeze(recognized) });
}
