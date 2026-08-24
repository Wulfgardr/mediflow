/* @Codex */
import 'server-only';

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from '../../attachment-payload';

const SWIFT_EXECUTABLE = '/usr/bin/swift';
const APPLE_VISION_SCRIPT = fileURLToPath(new URL('../../../scripts/apple-vision-ocr.swift', import.meta.url));
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const FIXED_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' });

type ImageInput = Readonly<{ mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; payload: string }>;
export type AppleVisionOcrProcessResult = Readonly<{ status: 'succeeded'; output: string }> | Readonly<{ status: 'failed' }>;
type FileStats = Readonly<{ isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean; mode: number; uid?: number }>;
type PrivateFile = Readonly<{ writeFile: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
type Child = Readonly<{
    stdout: Readonly<{ on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown }>;
    stderr: Readonly<{ on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown }>;
    once: {
        (event: 'error', listener: () => void): unknown;
        (event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    };
    kill: (signal: NodeJS.Signals) => boolean;
}>;
export type AppleVisionOcrProcessRuntime = Readonly<{
    platform: () => NodeJS.Platform;
    uid: () => number | undefined;
    spawn: (command: string, args: readonly string[], options: Readonly<{ cwd: '/'; env: Readonly<Record<string, string>>; shell: false; stdio: ['ignore', 'pipe', 'pipe']; windowsHide: true }>) => Child;
    chmod: (path: string, mode: number) => Promise<void>;
    lstat: (path: string) => Promise<FileStats>;
    mkdtemp: (prefix: string) => Promise<string>;
    open: (path: string, flags: number, mode: number) => Promise<PrivateFile>;
    rm: (path: string, options: Readonly<{ recursive: true; force: true; maxRetries: number; retryDelay: number }>) => Promise<void>;
    setTimer: (callback: () => void, milliseconds: number) => unknown;
    clearTimer: (timer: unknown) => void;
}>;

function frozenResult(status: 'failed'): AppleVisionOcrProcessResult;
function frozenResult(status: 'succeeded', output: string): AppleVisionOcrProcessResult;
function frozenResult(status: 'failed' | 'succeeded', output?: string): AppleVisionOcrProcessResult {
    const result = Object.create(null) as { status: 'failed' | 'succeeded'; output?: string };
    result.status = status;
    if (status === 'succeeded') result.output = output;
    return Object.freeze(result) as AppleVisionOcrProcessResult;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            snapshot[key] = descriptor.value;
        }
        return snapshot;
    } catch { return null; }
}

function imageInput(value: unknown): ImageInput | null {
    const input = record(value, ['mimeType', 'payload']);
    if (!input || (input.mimeType !== 'image/png' && input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/webp')
        || typeof input.payload !== 'string' || !input.payload || input.payload.startsWith('ENC:') || input.payload.startsWith('data:')) return null;
    const size = getAttachmentPayloadByteSize(input.payload);
    const payload = Buffer.from(input.payload, 'base64');
    if (!size.ok || size.size <= 0 || size.size > resolveMaxAttachmentBytes() || payload.length === 0 || payload.length > resolveMaxAttachmentBytes()) return null;
    return Object.freeze({ mimeType: input.mimeType, payload: input.payload });
}

function runtimeSnapshot(value: unknown): AppleVisionOcrProcessRuntime | null {
    const keys = ['platform', 'uid', 'spawn', 'chmod', 'lstat', 'mkdtemp', 'open', 'rm', 'setTimer', 'clearTimer'] as const;
    const snapshot = record(value, keys);
    if (!snapshot || keys.some((key) => typeof snapshot[key] !== 'function')) return null;
    return Object.freeze(snapshot as unknown as AppleVisionOcrProcessRuntime);
}

function safeFacadeRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) return null;
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const snapshot: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            snapshot[key] = descriptor.value;
        }
        return snapshot;
    } catch { return null; }
}

function safeStats(value: unknown): FileStats | null {
    const stats = safeFacadeRecord(value, ['isDirectory', 'isFile', 'isSymbolicLink', 'mode', 'uid']);
    return stats && typeof stats.isDirectory === 'function' && typeof stats.isFile === 'function' && typeof stats.isSymbolicLink === 'function'
        && typeof stats.mode === 'number' && (typeof stats.uid === 'number' || stats.uid === undefined) ? stats as FileStats : null;
}

function safeFile(value: unknown): PrivateFile | null {
    const file = safeFacadeRecord(value, ['writeFile', 'close']);
    return file && typeof file.writeFile === 'function' && typeof file.close === 'function' ? file as PrivateFile : null;
}

function frozenFacade<T extends object>(value: T): T {
    return Object.freeze(Object.assign(Object.create(null), value)) as T;
}

function extensionFor(mimeType: ImageInput['mimeType']): 'png' | 'jpg' | 'webp' {
    return mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length) as 'png' | 'webp';
}

function isPrivateDirectory(info: FileStats, uid: number | undefined): boolean {
    return info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700
        && typeof uid === 'number' && info.uid === uid;
}

async function writePrivateImage(runtime: AppleVisionOcrProcessRuntime, image: ImageInput): Promise<Readonly<{ directory: string; path: string }>> {
    const uid = runtime.uid();
    if (typeof uid !== 'number') throw new Error('private owner unavailable');
    const directory = await runtime.mkdtemp(join(tmpdir(), 'mediflow-local-ocr-'));
    try {
        await runtime.chmod(directory, 0o700);
        const directoryInfo = safeStats(await runtime.lstat(directory));
        if (!directoryInfo || !isPrivateDirectory(directoryInfo, uid)) throw new Error('private directory unavailable');
        const path = join(directory, `input.${extensionFor(image.mimeType)}`);
        const file = safeFile(await runtime.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
        if (!file) throw new Error('private file unavailable');
        try { await file.writeFile(Buffer.from(image.payload, 'base64')); } finally { await file.close(); }
        await runtime.chmod(path, 0o600);
        const fileInfo = safeStats(await runtime.lstat(path));
        if (!fileInfo || !fileInfo.isFile() || fileInfo.isSymbolicLink() || (fileInfo.mode & 0o777) !== 0o600 || fileInfo.uid !== uid) throw new Error('private file unavailable');
        return frozenFacade({ directory, path });
    } catch (error) {
        await runtime.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }).catch(() => undefined);
        throw error;
    }
}

async function hasFixedBoundary(runtime: AppleVisionOcrProcessRuntime): Promise<boolean> {
    try {
        const executable = safeStats(await runtime.lstat(SWIFT_EXECUTABLE));
        const script = safeStats(await runtime.lstat(APPLE_VISION_SCRIPT));
        return Boolean(executable?.isFile() && !executable.isSymbolicLink() && script?.isFile() && !script.isSymbolicLink());
    } catch { return false; }
}

function invoke(runtime: AppleVisionOcrProcessRuntime, imagePath: string): Promise<string | null> {
    return new Promise((resolve) => {
        let output = Buffer.alloc(0); let errors = Buffer.alloc(0); let settled = false; let terminating = false;
        const timer = { value: undefined as unknown };
        const finish = (value: string | null) => {
            if (settled) return;
            settled = true;
            try { runtime.clearTimer(timer.value); } catch { /* @Codex: a timer cleanup error must not expose a child result. */ }
            resolve(value);
        };
        let child: Child;
        try {
            child = runtime.spawn(SWIFT_EXECUTABLE, [APPLE_VISION_SCRIPT, imagePath], {
                cwd: '/', env: FIXED_ENV, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
            });
        } catch { finish(null); return; }
        const terminate = () => {
            if (settled || terminating) return;
            terminating = true;
            try { child.kill('SIGKILL'); } catch { /* @Codex: a terminal event remains required before cleanup. */ }
        };
        const collect = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
            if (settled || terminating) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const current = stream === 'stdout' ? output : errors;
            if (current.length + bytes.length > MAX_OUTPUT_BYTES) { terminate(); return; }
            if (stream === 'stdout') output = Buffer.concat([output, bytes]); else errors = Buffer.concat([errors, bytes]);
        };
        child.stdout.on('data', (chunk: Buffer | string) => collect('stdout', chunk));
        child.stderr.on('data', (chunk: Buffer | string) => collect('stderr', chunk));
        child.once('error', () => finish(null));
        child.once('close', (code, signal) => finish(!terminating && code === 0 && signal === null ? output.toString('utf8') : null));
        try { timer.value = runtime.setTimer(terminate, TIMEOUT_MS); } catch { terminate(); }
    });
}

/** Internal server-only runner. Runtime injection is construction-only for deterministic lifecycle tests. */
export function createAppleVisionOcrProcessRunner(runtime: AppleVisionOcrProcessRuntime) {
    const safeRuntime = runtimeSnapshot(runtime);
    return Object.freeze({
        async run(value: unknown): Promise<AppleVisionOcrProcessResult> {
            const image = imageInput(value);
            try {
                if (!safeRuntime || !image || safeRuntime.platform() !== 'darwin' || !await hasFixedBoundary(safeRuntime)) return frozenResult('failed');
            } catch { return frozenResult('failed'); }
            let temporary: Readonly<{ directory: string; path: string }> | null = null;
            let output: string | null = null;
            try { temporary = await writePrivateImage(safeRuntime, image); output = await invoke(safeRuntime, temporary.path); } catch { output = null; }
            try {
                if (temporary) await safeRuntime.rm(temporary.directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
            } catch { return frozenResult('failed'); }
            return output === null ? frozenResult('failed') : frozenResult('succeeded', output);
        },
    });
}

const systemRuntime: AppleVisionOcrProcessRuntime = Object.freeze({
    platform: () => process.platform,
    uid: () => typeof process.getuid === 'function' ? process.getuid() : undefined,
    spawn: (command: string, args: readonly string[], options) => spawn(command, [...args], options as never) as unknown as Child,
    chmod,
    lstat: async (path: string) => {
        const stats = await lstat(path);
        return frozenFacade({ isDirectory: () => stats.isDirectory(), isFile: () => stats.isFile(), isSymbolicLink: () => stats.isSymbolicLink(), mode: stats.mode, uid: stats.uid });
    },
    mkdtemp,
    open: async (path: string, flags: number, mode: number) => {
        const file = await open(path, flags, mode);
        return frozenFacade({ writeFile: (data: Uint8Array) => file.writeFile(data), close: () => file.close() });
    },
    rm,
    setTimer: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
    clearTimer: (timer: unknown) => clearTimeout(timer as NodeJS.Timeout),
});

export const systemAppleVisionOcrRunner = createAppleVisionOcrProcessRunner(systemRuntime);
