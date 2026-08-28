/* @Codex */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const WORKER_PATH = fileURLToPath(new URL('../../../scripts/anydoc-local-extraction-worker.mjs', import.meta.url));
const WORKER_TIMEOUT_MS = 15_000;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const EXIT_SIGNAL = new Map<number, AnyDocLocalFailureSignal>([
    [20, 'unsupported'], [21, 'needsOcr'], [22, 'malformed'], [23, 'encrypted'],
    [24, 'resourceLimit'], [25, 'missingPart'], [26, 'io'],
]);

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

async function runWorker(bytes: Buffer): Promise<{ signal?: AnyDocLocalFailureSignal; markdown?: string }> {
    return await new Promise((resolve) => {
        const child = spawn(process.execPath, [WORKER_PATH], {
            env: { NODE_ENV: 'production', NAPI_RS_ENFORCE_VERSION_CHECK: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const output: Buffer[] = [];
        let outputBytes = 0;
        let diagnosticBytes = 0;
        let forcedSignal: AnyDocLocalFailureSignal | undefined;
        let settled = false;
        const finish = (value: { signal?: AnyDocLocalFailureSignal; markdown?: string }) => {
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
            if (code !== 0) return finish({ signal: EXIT_SIGNAL.get(code ?? -1) ?? 'io' });
            return finish({ markdown: Buffer.concat(output, outputBytes).toString('utf8') });
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(bytes);
    });
}

/** Converts one host-resolved byte snapshot without accepting caller-supplied digest, path, version, or parser options. */
export async function extractAnyDocLocalBytes(attachmentId: unknown, input: unknown): Promise<LocalExtractionResult> {
    if (!validAttachmentId(attachmentId) || !(input instanceof Uint8Array) || types.isProxy(input)) return deniedSource();
    let bytes: Buffer;
    try { bytes = Buffer.from(input); } catch { return deniedSource(); }
    if (bytes.byteLength < 1 || bytes.byteLength > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return deniedSource();
    const source = sourceEvidence(attachmentId, bytes);
    let result: Awaited<ReturnType<typeof runWorker>>;
    try { result = await runWorker(bytes); } catch { return mapAnyDocLocalFailure(source, 'io'); }
    return result.signal ? mapAnyDocLocalFailure(source, result.signal) : buildAnyDocLocalExtraction(source, result.markdown);
}
