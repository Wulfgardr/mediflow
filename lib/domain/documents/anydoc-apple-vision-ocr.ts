/* @Codex */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

export const ANYDOC_APPLE_VISION_OCR_SCHEMA_VERSION = 'mediflow.anydoc_apple_vision_ocr.v1' as const;
export const ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256 = 'fb87dd9c0ca98a9ac68840c7c4c7517fec8199dbbd3dc1b3c93ad617d80dc314' as const;
export const ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS = 30_000;
export const ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS = 30_000;
const PROCESS_SCHEMA = 'mediflow.apple_vision_ocr.v1';
const SCRIPT_FILE = 'apple-vision-ocr.swift';
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_DOCUMENT_PAGES = 16;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = MAX_OUTPUT_BYTES + 4096;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_PROFILE = '(version 1) (allow default) (deny network*)';

export type AnyDocAppleVisionOcrFailureReason =
    | 'invalid_input' | 'engine_unavailable' | 'resource_limit' | 'timeout'
    | 'empty_output' | 'recognition_failed' | 'temporary_storage_unavailable' | 'cleanup_failed';
export type AnyDocAppleVisionOcrResult = Readonly<{
    schemaVersion: typeof ANYDOC_APPLE_VISION_OCR_SCHEMA_VERSION;
    status: 'recognized'; text: string;
    receipt: Readonly<{ engine: 'apple_vision'; scriptSha256: typeof ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256;
        inputSha256: string; inputByteLength: number; outputSha256: string; outputByteLength: number;
        averageConfidence: number; network: 'denied'; temporaryInput: 'none'; timeoutMs: number;
        durationMs: number; review: 'required'; writes: 0; apply: 'none' }>;
    review: 'required'; writes: 0; apply: 'none';
}> | Readonly<{
    schemaVersion: typeof ANYDOC_APPLE_VISION_OCR_SCHEMA_VERSION;
    status: 'review_required'; reason: AnyDocAppleVisionOcrFailureReason;
    review: 'required'; writes: 0; apply: 'none';
}>;
type AnyDocAppleVisionOcrSuccess = Extract<AnyDocAppleVisionOcrResult, { status: 'recognized' }>;
export type AnyDocAppleVisionOcrDocumentResult = Readonly<{
    schemaVersion: 'mediflow.anydoc_apple_vision_ocr_document.v1';
    status: 'recognized'; pages: readonly AnyDocAppleVisionOcrSuccess[];
    review: 'required'; writes: 0; apply: 'none';
}> | Readonly<{
    schemaVersion: 'mediflow.anydoc_apple_vision_ocr_document.v1';
    status: 'review_required'; reason: AnyDocAppleVisionOcrFailureReason;
    review: 'required'; writes: 0; apply: 'none';
}>;

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const TEST_HARNESS = process.execArgv.some((argument) => argument === '--test'
    || argument.startsWith('--test=') || argument.startsWith('--test-'));
type TemporaryRootOwner = Readonly<{ create(): string; remove(temporaryRoot: string): void }>;
type ProcessControl = Readonly<{ signal: AbortSignal; timeoutMs: number }>;
type DocumentRuntime = Readonly<{
    now(): number;
    scheduleDeadline(callback: () => void, delayMs: number): unknown;
    cancelDeadline(handle: unknown): void;
    extractImage(input: unknown, control: ProcessControl): Promise<AnyDocAppleVisionOcrResult>;
}>;
type OwnedProcessResult = Readonly<{
    raw: string; code: number | null; durationMs: number; timeoutMs: number;
}>;
const PRODUCTION_TEMPORARY_ROOT_OWNER: TemporaryRootOwner = Object.freeze({
    create: () => mkdtempSync(path.join(os.tmpdir(), 'mediflow-vision-ocr-')),
    remove: (temporaryRoot: string) => rmSync(temporaryRoot, { recursive: true, force: true }),
});
const denied = (reason: AnyDocAppleVisionOcrFailureReason): AnyDocAppleVisionOcrResult => Object.freeze({
    schemaVersion: ANYDOC_APPLE_VISION_OCR_SCHEMA_VERSION, status: 'review_required', reason,
    review: 'required', writes: 0, apply: 'none',
});
const documentDenied = (reason: AnyDocAppleVisionOcrFailureReason): AnyDocAppleVisionOcrDocumentResult => Object.freeze({
    schemaVersion: 'mediflow.anydoc_apple_vision_ocr_document.v1', status: 'review_required', reason,
    review: 'required', writes: 0, apply: 'none',
});
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) { const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        result[key] = descriptor.value; }
    return result;
}
function resolveOwnedScript(): string | null {
    let directory: string; try { directory = realpathSync(MODULE_DIRECTORY); } catch { return null; }
    for (let step = 0; step < 8; step += 1) {
        try {
            const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown };
            if (manifest.name === 'medical-record-app') {
                const root = realpathSync(directory); const candidate = path.join(root, 'scripts', SCRIPT_FILE);
                if (!lstatSync(candidate).isFile()) return null;
                const script = realpathSync(candidate); const relative = path.relative(root, script);
                if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !statSync(script).isFile()) return null;
                return sha256(readFileSync(script)) === ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256 ? script : null;
            }
        } catch { /* Continue toward the package root. */ }
        const parent = path.dirname(directory); if (parent === directory) return null; directory = parent;
    }
    return null;
}
function processEnvelope(raw: string, exitCode: number | null): { text: string; confidence: number } | AnyDocAppleVisionOcrFailureReason {
    let value: unknown; try { value = JSON.parse(raw.trim()); } catch { return 'recognition_failed'; }
    const success = exact(value, ['avgConfidence', 'engine', 'ok', 'schemaVersion', 'text']);
    if (exitCode === 0 && success?.schemaVersion === PROCESS_SCHEMA && success.engine === 'apple_vision' && success.ok === true
        && typeof success.text === 'string' && Buffer.byteLength(success.text, 'utf8') > 0
        && Buffer.byteLength(success.text, 'utf8') <= MAX_OUTPUT_BYTES && typeof success.avgConfidence === 'number'
        && Number.isFinite(success.avgConfidence) && success.avgConfidence >= 0 && success.avgConfidence <= 1)
        return { text: success.text, confidence: success.avgConfidence };
    const failure = exact(value, ['engine', 'error', 'ok', 'schemaVersion']);
    return failure?.schemaVersion === PROCESS_SCHEMA && failure.engine === 'apple_vision' && failure.ok === false
        && failure.error === 'empty_output' ? 'empty_output' : 'recognition_failed';
}
async function runOwnedScript(script: string, bytes: Buffer, temporaryRootOwner: TemporaryRootOwner,
    control: ProcessControl): Promise<OwnedProcessResult | AnyDocAppleVisionOcrFailureReason> {
    if (control.signal.aborted) { bytes.fill(0); return 'timeout'; }
    let temporaryRoot: string;
    try { temporaryRoot = temporaryRootOwner.create(); }
    catch { bytes.fill(0); return 'temporary_storage_unavailable'; }
    if (typeof temporaryRoot !== 'string' || !path.isAbsolute(temporaryRoot) || temporaryRoot.length < 2
        || temporaryRoot.includes('\0')) { bytes.fill(0); return 'temporary_storage_unavailable'; }
    const startedAt = performance.now();
    let result: OwnedProcessResult | AnyDocAppleVisionOcrFailureReason;
    try {
        result = await new Promise((resolve) => {
            const child = spawn('/usr/bin/sandbox-exec', ['-p', SANDBOX_PROFILE, '/usr/bin/xcrun', 'swift', script], {
                cwd: path.dirname(script), env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', LC_ALL: 'C',
                    TMPDIR: `${temporaryRoot}${path.sep}` },
                stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: true,
            });
            const output: Buffer[] = []; let outputBytes = 0; let diagnosticBytes = 0;
            let forced: AnyDocAppleVisionOcrFailureReason | null = null; let settled = false;
            const timeoutMs = Math.max(1, Math.min(ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS,
                Number.isFinite(control.timeoutMs) ? Math.ceil(control.timeoutMs) : 1));
            const finish = (value: OwnedProcessResult | AnyDocAppleVisionOcrFailureReason) => {
                if (settled) return; settled = true; clearTimeout(timer);
                control.signal.removeEventListener('abort', abortDocument); resolve(value);
            };
            const killOwnedProcessGroup = () => {
                let killed = false;
                if (child.pid !== undefined) {
                    try { process.kill(-child.pid, 'SIGKILL'); killed = true; } catch { /* direct-child fallback below */ }
                }
                if (!killed) { try { child.kill('SIGKILL'); } catch { /* retain admission until close */ } }
            };
            const stop = (reason: AnyDocAppleVisionOcrFailureReason) => {
                if (!forced) forced = reason;
                killOwnedProcessGroup();
            };
            const abortDocument = () => stop('timeout');
            const timer = setTimeout(() => stop('timeout'), timeoutMs); timer.unref();
            control.signal.addEventListener('abort', abortDocument, { once: true });
            if (control.signal.aborted) abortDocument();
            child.stdout.on('data', (chunk: Buffer) => { outputBytes += chunk.byteLength;
                if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) stop('resource_limit'); else output.push(Buffer.from(chunk)); });
            child.stderr.on('data', (chunk: Buffer) => { diagnosticBytes += chunk.byteLength;
                if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) stop('resource_limit'); });
            child.once('error', () => { if (!forced) forced = 'engine_unavailable'; killOwnedProcessGroup(); });
            child.once('close', (code) => finish(forced ?? { raw: Buffer.concat(output, outputBytes).toString('utf8'), code,
                durationMs: Math.max(0, Math.ceil(performance.now() - startedAt)), timeoutMs }));
            child.stdin.on('error', () => undefined); child.stdin.end(bytes);
        });
    } catch { result = 'engine_unavailable'; }
    bytes.fill(0);
    try { temporaryRootOwner.remove(temporaryRoot); }
    catch { return 'cleanup_failed'; }
    return result;
}

async function extractWithTemporaryRootOwner(input: unknown, temporaryRootOwner: TemporaryRootOwner,
    control: ProcessControl): Promise<AnyDocAppleVisionOcrResult> {
    if (control.signal.aborted) return denied('timeout');
    if (process.platform !== 'darwin') return denied('engine_unavailable');
    if (types.isProxy(input) || !(input instanceof Uint8Array)) return denied('invalid_input');
    let bytes: Buffer; try { bytes = Buffer.from(input); } catch { return denied('invalid_input'); }
    if (bytes.byteLength < 1) return denied('invalid_input');
    if (bytes.byteLength > MAX_INPUT_BYTES) { bytes.fill(0); return denied('resource_limit'); }
    const script = resolveOwnedScript(); if (!script) { bytes.fill(0); return denied('engine_unavailable'); }
    if (control.signal.aborted) { bytes.fill(0); return denied('timeout'); }
    const inputSha256 = sha256(bytes); const inputByteLength = bytes.byteLength;
    const processResult = await runOwnedScript(script, bytes, temporaryRootOwner, control);
    if (typeof processResult === 'string') return denied(processResult);
    const parsed = processEnvelope(processResult.raw, processResult.code);
    if (typeof parsed === 'string') return denied(parsed);
    const outputByteLength = Buffer.byteLength(parsed.text, 'utf8');
    return Object.freeze({ schemaVersion: ANYDOC_APPLE_VISION_OCR_SCHEMA_VERSION, status: 'recognized', text: parsed.text,
        receipt: Object.freeze({ engine: 'apple_vision', scriptSha256: ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256,
            inputSha256, inputByteLength, outputSha256: sha256(parsed.text), outputByteLength,
            averageConfidence: parsed.confidence, network: 'denied', temporaryInput: 'none',
            timeoutMs: processResult.timeoutMs, durationMs: processResult.durationMs,
            review: 'required', writes: 0, apply: 'none' }),
        review: 'required', writes: 0, apply: 'none' });
}

function snapshotDocumentImages(input: unknown): readonly Buffer[] | AnyDocAppleVisionOcrFailureReason {
    if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return 'invalid_input';
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 1
        || Reflect.ownKeys(descriptors).length !== length + 1) return 'invalid_input';
    if (length > MAX_DOCUMENT_PAGES) return 'resource_limit';
    const images: Buffer[] = []; let totalBytes = 0;
    const reject = (reason: AnyDocAppleVisionOcrFailureReason) => {
        for (const image of images) image.fill(0);
        return reason;
    };
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true
            || types.isProxy(descriptor.value) || !(descriptor.value instanceof Uint8Array)) return reject('invalid_input');
        totalBytes += descriptor.value.byteLength;
        if (descriptor.value.byteLength < 1) return reject('invalid_input');
        if (descriptor.value.byteLength > MAX_INPUT_BYTES || !Number.isSafeInteger(totalBytes)
            || totalBytes > MAX_DOCUMENT_INPUT_BYTES) return reject('resource_limit');
        try { images.push(Buffer.from(descriptor.value)); } catch { return reject('invalid_input'); }
    }
    return Object.freeze(images);
}

function createDocumentExtractor(runtime: DocumentRuntime) {
    let activeDocument = false;
    return async (input: unknown): Promise<AnyDocAppleVisionOcrDocumentResult> => {
        if (activeDocument) return documentDenied('resource_limit');
        activeDocument = true;
        const controller = new AbortController();
        let deadlineHandle: unknown;
        let images: readonly Buffer[] = Object.freeze([]);
        try {
            const startedAt = runtime.now();
            if (!Number.isFinite(startedAt)) return documentDenied('engine_unavailable');
            const deadlineAt = startedAt + ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS;
            const snapshot = snapshotDocumentImages(input);
            if (typeof snapshot === 'string') return documentDenied(snapshot);
            images = snapshot;
            const initialRemaining = Math.ceil(deadlineAt - runtime.now());
            if (initialRemaining < 1) return documentDenied('timeout');
            deadlineHandle = runtime.scheduleDeadline(() => controller.abort(),
                Math.min(ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS, initialRemaining));
            const pages: AnyDocAppleVisionOcrSuccess[] = [];
            for (let index = 0; index < images.length; index += 1) {
                const remainingMs = Math.ceil(deadlineAt - runtime.now());
                if (controller.signal.aborted || remainingMs < 1) {
                    controller.abort(); return documentDenied('timeout');
                }
                const result = await runtime.extractImage(images[index], Object.freeze({
                    signal: controller.signal,
                    timeoutMs: Math.min(ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS, remainingMs),
                }));
                if (controller.signal.aborted) return documentDenied('timeout');
                if (result.status !== 'recognized') return documentDenied(result.reason);
                pages.push(result);
            }
            return Object.freeze({ schemaVersion: 'mediflow.anydoc_apple_vision_ocr_document.v1',
                status: 'recognized', pages: Object.freeze(pages), review: 'required', writes: 0, apply: 'none' });
        } catch { return documentDenied('engine_unavailable'); }
        finally {
            if (deadlineHandle !== undefined) { try { runtime.cancelDeadline(deadlineHandle); } catch { /* fail closed above */ } }
            controller.abort();
            for (const image of images) image.fill(0);
            activeDocument = false;
        }
    };
}

function runtimeWithTemporaryRootOwner(temporaryRootOwner: TemporaryRootOwner): DocumentRuntime {
    return Object.freeze({
        now: () => performance.now(),
        scheduleDeadline(callback: () => void, delayMs: number) {
            const timer = setTimeout(callback, delayMs); timer.unref(); return timer;
        },
        cancelDeadline: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        extractImage: (input: unknown, control: ProcessControl) =>
            extractWithTemporaryRootOwner(input, temporaryRootOwner, control),
    });
}

const extractProductionDocument = createDocumentExtractor(runtimeWithTemporaryRootOwner(PRODUCTION_TEMPORARY_ROOT_OWNER));

/** Runs one bounded OCR document with immediate process-wide admission and one shared deadline. */
export function extractAnyDocAppleVisionDocument(input: unknown): Promise<AnyDocAppleVisionOcrDocumentResult> {
    return extractProductionDocument(input);
}

/** Runs the fixed Apple Vision engine offline; callers cannot supply paths, limits, runtime, or fallback. */
export async function extractAnyDocAppleVisionImage(input: unknown): Promise<AnyDocAppleVisionOcrResult> {
    const result = await extractProductionDocument([input]);
    return result.status === 'recognized' ? result.pages[0] ?? denied('recognition_failed') : denied(result.reason);
}

/** Test-only seam for exercising owned temporary-root failures without observing or mutating global tmp state. */
export function createAnyDocAppleVisionImageExtractorForTest(dependencies: unknown) {
    const value = TEST_HARNESS ? exact(dependencies, ['createTemporaryRoot', 'removeTemporaryRoot']) : null;
    const createTemporaryRoot = value?.createTemporaryRoot; const removeTemporaryRoot = value?.removeTemporaryRoot;
    if (typeof createTemporaryRoot !== 'function' || types.isProxy(createTemporaryRoot)
        || typeof removeTemporaryRoot !== 'function' || types.isProxy(removeTemporaryRoot))
        return async (_input: unknown): Promise<AnyDocAppleVisionOcrResult> => denied('engine_unavailable');
    const owner: TemporaryRootOwner = Object.freeze({ create: () => Reflect.apply(createTemporaryRoot, undefined, []) as string,
        remove: (temporaryRoot: string) => { Reflect.apply(removeTemporaryRoot, undefined, [temporaryRoot]); } });
    const extractDocument = createDocumentExtractor(runtimeWithTemporaryRootOwner(owner));
    return async (input: unknown): Promise<AnyDocAppleVisionOcrResult> => {
        const result = await extractDocument([input]);
        return result.status === 'recognized' ? result.pages[0] ?? denied('recognition_failed') : denied(result.reason);
    };
}

/** Test-only deterministic owner seam; production never accepts clocks, schedulers, limits, or runners. */
export function createAnyDocAppleVisionDocumentExtractorForTest(dependencies: unknown) {
    const value = TEST_HARNESS ? exact(dependencies, ['cancelDeadline', 'extractImage', 'now', 'scheduleDeadline']) : null;
    const cancelDeadline = value?.cancelDeadline; const extractImage = value?.extractImage;
    const now = value?.now; const scheduleDeadline = value?.scheduleDeadline;
    if ([cancelDeadline, extractImage, now, scheduleDeadline]
        .some((candidate) => typeof candidate !== 'function' || types.isProxy(candidate)))
        return async (_input: unknown): Promise<AnyDocAppleVisionOcrDocumentResult> => documentDenied('engine_unavailable');
    return createDocumentExtractor(Object.freeze({
        now: () => Reflect.apply(now as (...args: never[]) => unknown, undefined, []) as number,
        scheduleDeadline: (callback: () => void, delayMs: number) =>
            Reflect.apply(scheduleDeadline as (...args: unknown[]) => unknown, undefined, [callback, delayMs]),
        cancelDeadline: (handle: unknown) => { Reflect.apply(cancelDeadline as (...args: unknown[]) => unknown, undefined, [handle]); },
        extractImage: (input: unknown, control: ProcessControl) =>
            Reflect.apply(extractImage as (...args: unknown[]) => unknown, undefined, [input, control]) as Promise<AnyDocAppleVisionOcrResult>,
    }));
}
