import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';
import type { Page, Request as BrowserRequest } from '@playwright/test';
import { installProductResponseDiagnostic, productDiagnosticHeaders } from './chatgpt-product-response-diagnostic.ts';

export const CONTRACT_DIAGNOSTIC_MAX_EVENTS = 64;
export const CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES = 32 * 1024;
type Event = { at: number; kind: string; detail: unknown };
type RendererCapture = { events: Event[]; dropped: number; byteCount: number; bytes: number[]; observerErrors: number };
type DiagnosticHost = typeof globalThis & { __mfContractDiagnostic?: {
    record(kind: string, detail?: unknown): void;
    read(part: ReadableStreamReadResult<Uint8Array>, aborted: boolean): void;
    snapshot(): RendererCapture;
} };

/** Bounded recorder for synthetic pages. No fetch/reader wrapper. */
export function installContractDiagnostic() {
    const events: Event[] = [], bytes: number[] = [];
    let dropped = 0, byteCount = 0, observerErrors = 0;
    function record(kind: string, detail: unknown = null) {
        try {
            const encoded = JSON.stringify(detail);
            const bounded = encoded.length <= 1024 ? JSON.parse(encoded) : { detailTruncated: true };
            if (events.length === 64) { events.shift(); dropped++; }
            events.push({ at: performance.timeOrigin + performance.now(), kind: kind.slice(0, 64), detail: bounded });
        } catch { observerErrors++; }
    }
    Object.defineProperty(globalThis, '__mfContractDiagnostic', { value: Object.freeze({
        record,
        read(part: ReadableStreamReadResult<Uint8Array>, aborted: boolean) {
            try {
                const offset = bytes.length, length = part.done ? 0 : part.value.byteLength;
                byteCount += length;
                if (!part.done) for (let index = 0; index < Math.min(length, 256 - offset); index++) bytes.push(part.value[index]);
                record('read', { done: part.done, length, capturedOffset: offset, capturedLength: bytes.length - offset, signalAborted: aborted });
            } catch { observerErrors++; }
        },
        snapshot() { return { events: events.slice(), dropped, byteCount, bytes: bytes.slice(), observerErrors }; },
    }) });
}

/** One init script guarantees recorder-before-observer order, even under Playwright. */
export function productDiagnosticInitScript() {
    return { content: `(${installContractDiagnostic.toString()})();(${installProductResponseDiagnostic.toString()})();` };
}

/** Original sole consumer, including its unconditional finally cancel. */
export async function consumeContractResponse({ mode, path }: { mode: string; path: string }) {
    const capture = (globalThis as DiagnosticHost).__mfContractDiagnostic;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => capture?.record('signal.abort'), { once: true });
    capture?.record('fetch', { method: 'POST', requestBytes: [123, 125], signalAborted: controller.signal.aborted });
    try {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
        capture?.record('response', { status: response.status, headers: ['content-type', 'content-length', 'cache-control'].map(name => [name, response.headers.get(name)?.slice(0, 128) ?? null]) });
        if (mode === 'duplicate') await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const reader = response.body!.getReader();
        if (mode === 'cancel-before-eof') { capture?.record('cancel', { phase: 'before-read' }); await reader.cancel(); capture?.record('cancel.resolved', { phase: 'before-read' }); }
        try {
            for (;;) {
                capture?.record('read.start', { signalAborted: controller.signal.aborted });
                let part: ReadableStreamReadResult<Uint8Array>;
                try { part = await reader.read(); }
                catch (error) { capture?.record('read.rejected', { message: String(error).slice(0, 256) }); throw error; }
                capture?.read(part, controller.signal.aborted); if (part.done) break;
                if (mode === 'abort') controller.abort();
            }
        } finally { capture?.record('cancel', { phase: 'finally' }); await reader.cancel(); capture?.record('cancel.resolved', { phase: 'finally' }); }
        capture?.record('consumer.return', { signalAborted: controller.signal.aborted });
        return 'consumed';
    } catch (error) { capture?.record('consumer.rejected', { message: String(error).slice(0, 256), signalAborted: controller.signal.aborted }); return 'consumer-rejected'; }
}

const clock = () => performance.timeOrigin + performance.now();
const failureText = (error: unknown) => error instanceof Error
    ? { name: error.name.slice(0, 64), message: error.message.slice(0, 512) } : { name: 'ThrownValue', message: String(error).slice(0, 512) };
async function deadline<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DIAGNOSTIC_CAPTURE_DEADLINE')), 1000); })]); }
    finally { clearTimeout(timer); }
}

/** Bounded forensic side channel. Its data never participates in oracle success. */
export function createContractDiagnostic(mode: string, outputDirectory: string) {
    if (!/^[a-z][a-z0-9-]{0,40}$/u.test(mode)) throw new Error('DIAGNOSTIC_CASE_INVALID');
    const describeFailure = (error: unknown) => mode.startsWith('product-')
        ? { name: 'ProductDiagnosticFailure', message: error instanceof Error && /^ORACLE_[A-Z_]+(?:: net::ERR_ABORTED)?$/u.test(error.message) ? error.message : 'product-observation-failed' }
        : failureText(error);
    const events: Event[] = [];
    let dropped = 0, observerErrors = 0, oracleFailure: ReturnType<typeof failureText> | null = null;
    let testFailure: ReturnType<typeof failureText> | null = null, renderer: RendererCapture | null = null;
    let calibration: { nodeBefore: number; renderer: number; nodeAfter: number; offsetLower: number; offsetUpper: number } | null = null;
    let captureError: ReturnType<typeof failureText> | null = null;
    const disposers: Array<() => void> = [];
    function record(kind: string, detail: unknown = null) {
        try {
            const encoded = JSON.stringify(detail);
            if (events.length === CONTRACT_DIAGNOSTIC_MAX_EVENTS) { events.shift(); dropped++; }
            events.push({ at: clock(), kind: kind.slice(0, 64), detail: encoded.length <= 1024 ? JSON.parse(encoded) : { detailTruncated: true } });
        } catch { observerErrors++; }
    }
    return {
        record,
        attach(page: Page, url: string, operation?: 'consent' | 'login/complete') {
            let selected: BrowserRequest | undefined, requests = 0;
            const identity = operation ? { operation, request: `${operation}:1` } : {};
            const onRequest = (request: BrowserRequest) => {
                if (request.url() !== url || request.method() !== 'POST' || operation && selected) return;
                selected ??= request;
                record('request', { ...identity, number: ++requests, navigation: request.isNavigationRequest() });
            };
            const onResponse = (response: import('@playwright/test').Response) => { if (response.request() === selected) { const headers = response.headers(); record('response', { ...identity, status: response.status(), headers: operation ? productDiagnosticHeaders(name => headers[name]) : ['content-type', 'content-length', 'cache-control'].map(name => [name, headers[name]?.slice(0, 128) ?? null]) }); } };
            const onFinished = (request: BrowserRequest) => { if (request === selected) record('requestfinished', operation ? identity : null); };
            const onFailed = (request: BrowserRequest) => { if (request === selected) record('requestfailed', { ...identity, error: operation ? (request.failure()?.errorText === 'net::ERR_ABORTED' ? 'net::ERR_ABORTED' : 'other') : request.failure()?.errorText.slice(0, 256) ?? null }); };
            const onNavigation = (frame: import('@playwright/test').Frame) => { if (frame === page.mainFrame()) record('navigation', operation ? { operation } : { url: frame.url().slice(0, 256) }); };
            const onClose = () => record('page.close'), onCrash = () => record('page.crash');
            page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished); page.on('requestfailed', onFailed);
            page.on('framenavigated', onNavigation); page.on('close', onClose); page.on('crash', onCrash);
            disposers.push(() => { page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed); page.off('framenavigated', onNavigation); page.off('close', onClose); page.off('crash', onCrash); });
        },
        async calibrate(page: Page) {
            try {
                const nodeBefore = clock();
                const renderer = await deadline(page.evaluate(() => performance.timeOrigin + performance.now()));
                const nodeAfter = clock();
                calibration = { nodeBefore, renderer, nodeAfter, offsetLower: nodeBefore - renderer, offsetUpper: nodeAfter - renderer };
            } catch (error) { captureError = describeFailure(error); }
        },
        observe<T>(result: Promise<T>): Promise<T> {
            return result.catch(error => { oracleFailure = describeFailure(error); record('oracle.failure', oracleFailure); throw error; });
        },
        async run<T>(page: Page, consumer: () => Promise<unknown> | undefined, work: () => Promise<T>): Promise<T> {
            try { return await work(); }
            catch (error) { testFailure = describeFailure(error); record('test.failure', testFailure); throw error; }
            finally {
                if (oracleFailure || testFailure) {
                    try { const current = consumer(); if (current) await deadline(current.then(() => undefined, () => undefined)); }
                    catch (error) { captureError = describeFailure(error); }
                    try { renderer = await deadline(page.evaluate(() => (globalThis as DiagnosticHost).__mfContractDiagnostic?.snapshot() ?? null)); }
                    catch (error) { captureError = describeFailure(error); }
                }
            }
        },
        persist() {
            try {
                if (!oracleFailure && !testFailure) return null;
                const data = { schema: 'mediflow.synthetic-browser-response-diagnostic.v1', mode,
                    runtime: { node: process.version, platform: process.platform, arch: process.arch, githubSha: /^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : null },
                    oracleFailure, testFailure, captureError, calibration,
                    node: { events: events.slice(), dropped, observerErrors }, renderer };
                let encoded = JSON.stringify(data);
                while (Buffer.byteLength(encoded) > CONTRACT_DIAGNOSTIC_MAX_FILE_BYTES) {
                    if (data.node.events.length) { data.node.events.shift(); data.node.dropped++; }
                    else if (data.renderer?.events.length) { data.renderer.events.shift(); data.renderer.dropped++; }
                    else throw new Error('DIAGNOSTIC_ENVELOPE_TOO_LARGE');
                    encoded = JSON.stringify(data);
                }
                const directory = resolve(outputDirectory);
                let current = parse(directory).root;
                for (const part of directory.slice(current.length).split(sep)) {
                    current = join(current, part);
                    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
                    const status = lstatSync(current);
                    if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('DIAGNOSTIC_OUTPUT_ALIAS');
                }
                if (realpathSync(directory) !== directory) throw new Error('DIAGNOSTIC_OUTPUT_ALIAS');
                const file = join(directory, `${mode}-${randomUUID()}.json`);
                writeFileSync(file, encoded, { flag: 'wx', mode: 0o600 });
                console.error(`CHATGPT_ORACLE_DIAGNOSTIC ${file} (${Buffer.byteLength(encoded)} bytes)`);
                return file;
            } catch (error) { console.error(`CHATGPT_ORACLE_DIAGNOSTIC_UNAVAILABLE ${failureText(error).message}`); return null; }
            finally { for (const dispose of disposers.splice(0)) dispose(); }
        },
    };
}
