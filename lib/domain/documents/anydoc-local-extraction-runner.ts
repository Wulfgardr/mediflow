/* @Codex */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

import {
    ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES,
    ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES,
    buildAnyDocLocalExtraction,
    mapAnyDocLocalFailure,
    type AnyDocLocalFailureSignal,
    type LocalExtractionResult,
} from './anydoc-local-extraction-contract';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const MEDIFLOW_PACKAGE_NAME = 'medical-record-app';
const WORKER_FILE = 'anydoc-local-extraction-worker.mjs';
const WORKER_SHA256 = '5d6e2e60f1d71f3fd45065961258a7debe8a96e017abdcee92823986c8f08c67';
const MAX_ROOT_STEPS = 8;
const WORKER_TIMEOUT_MS = 15_000;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_PAGE_ROUTING_ENVELOPE_BYTES = 4 * 1024;
const EXIT_SIGNAL = new Map<number, AnyDocLocalFailureSignal>([
    [20, 'unsupported'], [21, 'needsOcr'], [22, 'malformed'], [23, 'encrypted'],
    [24, 'resourceLimit'], [25, 'missingPart'], [26, 'io'],
]);

/* @Codex */
export const ANYDOC_PAGE_ROUTING_SCHEMA_VERSION = 'mediflow.anydoc_page_routing.v1' as const;
export const ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT = 500;

export interface AnyDocPageRoutingEvidence {
    readonly schemaVersion: typeof ANYDOC_PAGE_ROUTING_SCHEMA_VERSION;
    readonly pages: readonly number[];
    readonly pageCount: number;
}

type WorkerResult = {
    signal?: AnyDocLocalFailureSignal;
    markdown?: string;
    pageRouting?: AnyDocPageRoutingEvidence;
};

/** Accepts only the bounded, exact-key worker envelope; all malformed evidence is discarded. */
export function parseAnyDocPageRoutingEnvelope(input: unknown): AnyDocPageRoutingEvidence | null {
    if (typeof input !== 'string' || input.length < 1
        || Buffer.byteLength(input, 'utf8') > MAX_PAGE_ROUTING_ENVELOPE_BYTES) return null;
    let value: unknown;
    try { value = JSON.parse(input); } catch { return null; }
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 3 || !['schemaVersion', 'pages', 'pageCount'].every((key) => keys.includes(key))) return null;
    const candidate = value as { schemaVersion?: unknown; pages?: unknown; pageCount?: unknown };
    if (candidate.schemaVersion !== ANYDOC_PAGE_ROUTING_SCHEMA_VERSION || !Array.isArray(candidate.pages)
        || typeof candidate.pageCount !== 'number') return null;
    const pages = candidate.pages;
    const pageCount = candidate.pageCount;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT
        || pages.length < 1 || pages.length > pageCount
        || pages.some((page, index) => !Number.isSafeInteger(page) || page < 1
            || page > pageCount || (index > 0 && page <= pages[index - 1]))) return null;
    return Object.freeze({
        schemaVersion: ANYDOC_PAGE_ROUTING_SCHEMA_VERSION,
        pages: Object.freeze([...pages]) as readonly number[],
        pageCount,
    });
}

function deniedSource(): LocalExtractionResult {
    return buildAnyDocLocalExtraction(null, '');
}

function validAttachmentId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function sourceEvidence(attachmentId: string, bytes: Buffer) {
    return {
        attachmentId,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.byteLength,
    };
}

function inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveOwnedWorker(): { path: string; directory: string } | null {
    let directory: string;
    try { directory = realpathSync(MODULE_DIRECTORY); } catch { return null; }

    for (let step = 0; step < MAX_ROOT_STEPS; step += 1) {
        let packageValue: unknown;
        try {
            const packagePath = path.join(directory, 'package.json');
            packageValue = JSON.parse(readFileSync(packagePath, 'utf8'));
        } catch { packageValue = null; }
        if (typeof packageValue === 'object' && packageValue !== null
            && Object.getPrototypeOf(packageValue) === Object.prototype
            && Reflect.ownKeys(packageValue).length > 0
            && (packageValue as { name?: unknown }).name === MEDIFLOW_PACKAGE_NAME) {
            try {
                const workerPath = path.join(directory, 'scripts', WORKER_FILE);
                if (!lstatSync(workerPath).isFile()) return null;
                const root = realpathSync(directory);
                const worker = realpathSync(workerPath);
                if (!inside(root, worker) || !statSync(worker).isFile()) return null;
                const digest = createHash('sha256').update(readFileSync(worker)).digest('hex');
                return digest === WORKER_SHA256 ? { path: worker, directory: path.dirname(worker) } : null;
            } catch { return null; }
        }
        const parent = path.dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }

    return null;
}

async function runWorker(bytes: Buffer): Promise<WorkerResult> {
    return await new Promise((resolve) => {
        const worker = resolveOwnedWorker();
        if (!worker) return resolve({ signal: 'io' });
        const child = spawn(process.execPath, [worker.path], {
            cwd: worker.directory,
            env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const output: Buffer[] = [];
        let outputBytes = 0;
        let diagnosticBytes = 0;
        let forcedSignal: AnyDocLocalFailureSignal | undefined;
        let settled = false;
        const finish = (value: WorkerResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const stop = (signal: AnyDocLocalFailureSignal) => {
            forcedSignal = signal;
            child.kill('SIGKILL');
        };
        const timer = setTimeout(() => stop('resourceLimit'), WORKER_TIMEOUT_MS);
        timer.unref();

        child.stdout.on('data', (chunk: Buffer) => {
            outputBytes += chunk.byteLength;
            if (outputBytes > ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES) stop('resourceLimit');
            else output.push(Buffer.from(chunk));
        });
        child.stderr.on('data', (chunk: Buffer) => {
            diagnosticBytes += chunk.byteLength;
            if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) stop('resourceLimit');
        });
        child.once('error', () => finish({ signal: 'io' }));
        child.once('close', (code) => {
            if (forcedSignal) return finish({ signal: forcedSignal });
            if (code === 21) {
                const pageRouting = parseAnyDocPageRoutingEnvelope(Buffer.concat(output, outputBytes).toString('utf8'));
                return finish(pageRouting ? { signal: 'needsOcr', pageRouting } : { signal: 'io' });
            }
            if (code !== 0) return finish({ signal: EXIT_SIGNAL.get(code ?? -1) ?? 'io' });
            return finish({ markdown: Buffer.concat(output, outputBytes).toString('utf8') });
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(bytes);
    });
}

/** Returns only validated page-routing evidence and never exposes native or partial document text. */
export async function extractAnyDocPageRoutingBytes(input: unknown): Promise<AnyDocPageRoutingEvidence | null> {
    if (types.isProxy(input) || !(input instanceof Uint8Array)) return null;
    let bytes: Buffer;
    try { bytes = Buffer.from(input); } catch { return null; }
    if (bytes.byteLength < 1 || bytes.byteLength > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return null;
    try {
        const result = await runWorker(bytes);
        return result.signal === 'needsOcr' ? result.pageRouting ?? null : null;
    } catch { return null; }
}

/** Converts one host-resolved byte snapshot without accepting caller-supplied digest, path, version, or parser options. */
export async function extractAnyDocLocalBytes(attachmentId: unknown, input: unknown): Promise<LocalExtractionResult> {
    if (!validAttachmentId(attachmentId) || types.isProxy(input) || !(input instanceof Uint8Array)) return deniedSource();
    let bytes: Buffer;
    try { bytes = Buffer.from(input); } catch { return deniedSource(); }
    if (bytes.byteLength < 1 || bytes.byteLength > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return deniedSource();
    const source = sourceEvidence(attachmentId, bytes);
    let result: Awaited<ReturnType<typeof runWorker>>;
    try { result = await runWorker(bytes); } catch { return mapAnyDocLocalFailure(source, 'io'); }
    return result.signal ? mapAnyDocLocalFailure(source, result.signal) : buildAnyDocLocalExtraction(source, result.markdown);
}
