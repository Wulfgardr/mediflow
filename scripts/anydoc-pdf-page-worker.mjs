#!/usr/bin/env node
/* @Codex */
import { createRequire, registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { writeSync } from 'node:fs';

const SCHEMA_VERSION = 'mediflow.anydoc_pdf_child_protocol.v1';
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_MATERIALIZED_BYTES = 25 * 1024 * 1024;
const MAX_RENDER_PAGES = 16;
const MAX_DIMENSION_PIXELS = 4096;
const MAX_PIXELS = 12_000_000;
const MAX_RASTER_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_RASTER_BYTES = 32 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 10_000;
const CLEANUP_OBSERVATION_MS = 250;
const DPI = 144;
const PDFJS_VERSION = '4.10.38';
const CANVAS_VERSION = '0.1.100';
const MAX_INPUT_BYTES = 4 + MAX_HEADER_BYTES + MAX_SOURCE_BYTES;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const require = createRequire(import.meta.url);
const NETWORK_MODULES = new Set([
    'dgram', 'dns', 'dns/promises', 'http', 'http2', 'https', 'net', 'quic', 'tls', 'undici',
    'node:dgram', 'node:dns', 'node:dns/promises', 'node:http', 'node:http2', 'node:https',
    'node:net', 'node:quic', 'node:tls',
]);

/* @Codex: Node's permission model denies filesystem writes, child processes and
   workers, but does not currently mediate sockets. Keep the child import graph
   network-closed as a second, process-local guard. The native renderer remains
   outside this JavaScript guard and is therefore still bounded by the parent. */
function denyNetwork() {
    const error = new Error('network_disabled');
    error.code = 'MEDIFLOW_NETWORK_DISABLED';
    throw error;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (NETWORK_MODULES.has(specifier)) denyNetwork();
        return nextResolve(specifier, context);
    },
});

const getBuiltinModule = process.getBuiltinModule.bind(process);
Object.defineProperty(process, 'getBuiltinModule', {
    configurable: false,
    enumerable: true,
    writable: false,
    value(specifier) {
        if (NETWORK_MODULES.has(specifier) || NETWORK_MODULES.has(`node:${specifier}`)) denyNetwork();
        return getBuiltinModule(specifier);
    },
});
Object.defineProperty(globalThis, 'fetch', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: async () => denyNetwork(),
});
if ('WebSocket' in globalThis) Object.defineProperty(globalThis, 'WebSocket', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: class NetworkDisabledWebSocket { constructor() { denyNetwork(); } },
});

class ResourceLimit extends Error {}
class PageTimeout extends Error {}
class EngineUnavailable extends Error {}

function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const actual = Object.keys(value);
    if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) return null;
    return value;
}

function exactArray(value, maximum) {
    return Array.isArray(value) && value.length <= maximum ? value : null;
}

function encodeFrame(header, bodies = []) {
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.byteLength < 1 || headerBytes.byteLength > MAX_HEADER_BYTES) throw new ResourceLimit();
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeUInt32BE(headerBytes.byteLength, 0);
    return Buffer.concat([prefix, headerBytes, ...bodies], 4 + headerBytes.byteLength
        + bodies.reduce((total, body) => total + body.byteLength, 0));
}

function emitFailure(reason) {
    process.stdout.write(encodeFrame({ schemaVersion: SCHEMA_VERSION, status: 'error', reason, bodyByteLength: 0 }));
}

async function readInput() {
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
        total += chunk.byteLength;
        if (total > MAX_INPUT_BYTES) {
            process.stdin.destroy();
            throw new ResourceLimit();
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
}

function decodeFrame(input) {
    if (input.byteLength < 5) return null;
    const headerLength = input.readUInt32BE(0);
    if (headerLength < 1 || headerLength > MAX_HEADER_BYTES || input.byteLength < 4 + headerLength) return null;
    const headerText = input.subarray(4, 4 + headerLength).toString('utf8');
    let header;
    try { header = JSON.parse(headerText); } catch { return null; }
    if (JSON.stringify(header) !== headerText) return null;
    return { header, body: input.subarray(4 + headerLength) };
}

function materializeRequest(frame) {
    const header = exact(frame?.header, ['schemaVersion', 'operation', 'pageCount', 'sourceByteLength']);
    if (!header || header.schemaVersion !== SCHEMA_VERSION || header.operation !== 'materialize'
        || !Number.isSafeInteger(header.pageCount) || header.pageCount < 1 || header.pageCount > 500
        || !Number.isSafeInteger(header.sourceByteLength) || header.sourceByteLength < 1
        || header.sourceByteLength > MAX_SOURCE_BYTES || frame.body.byteLength !== header.sourceByteLength) return null;
    return { pageCount: header.pageCount, sourceBytes: Buffer.from(frame.body) };
}

function renderRequest(frame) {
    const header = exact(frame?.header, ['schemaVersion', 'operation', 'pages', 'bodyByteLength']);
    const values = exactArray(header?.pages, MAX_RENDER_PAGES);
    if (!header || header.schemaVersion !== SCHEMA_VERSION || header.operation !== 'render'
        || !values || values.length < 1 || !Number.isSafeInteger(header.bodyByteLength)
        || header.bodyByteLength < 1 || header.bodyByteLength > MAX_MATERIALIZED_BYTES
        || frame.body.byteLength !== header.bodyByteLength) return null;
    const pages = [];
    let offset = 0;
    let previous = 0;
    for (const value of values) {
        const page = exact(value, ['page', 'byteLength']);
        if (!page || !Number.isSafeInteger(page.page) || page.page <= previous || page.page > 500
            || !Number.isSafeInteger(page.byteLength) || page.byteLength < 1
            || page.byteLength > MAX_MATERIALIZED_BYTES || offset + page.byteLength > frame.body.byteLength) return null;
        pages.push({ page: page.page, pdfBytes: Buffer.from(frame.body.subarray(offset, offset + page.byteLength)) });
        offset += page.byteLength;
        previous = page.page;
    }
    return offset === frame.body.byteLength ? pages : null;
}

async function materialize(request) {
    const { PDFDocument } = await import('pdf-lib');
    let source;
    let sourcePageCount;
    try {
        source = await PDFDocument.load(request.sourceBytes, {
            ignoreEncryption: false,
            throwOnInvalidObject: true,
            updateMetadata: false,
            capNumbers: true,
        });
        sourcePageCount = source.getPageCount();
    } catch { return { failure: 'malformed_or_encrypted_pdf' }; }
    if (sourcePageCount !== request.pageCount) return { failure: 'page_count_mismatch' };
    const pages = [];
    let total = 0;
    for (let index = 0; index < request.pageCount; index += 1) {
        try {
            const target = await PDFDocument.create({ updateMetadata: false });
            const [page] = await target.copyPages(source, [index]);
            if (!page) return { failure: 'page_count_mismatch' };
            target.addPage(page);
            const bytes = Buffer.from(await target.save({
                useObjectStreams: false,
                addDefaultPage: false,
                updateFieldAppearances: false,
            }));
            total += bytes.byteLength;
            if (bytes.byteLength < 1 || bytes.byteLength > MAX_MATERIALIZED_BYTES
                || total > MAX_MATERIALIZED_BYTES) throw new ResourceLimit();
            pages.push({ page: index + 1, bytes });
        } catch (error) {
            return { failure: error instanceof ResourceLimit ? 'resource_limit' : 'malformed_or_encrypted_pdf' };
        }
    }
    return { pages };
}

async function loadRenderer() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64'
        || process.versions.node.split('.')[0] !== '24') throw new EngineUnavailable();
    let installedPdfJs;
    let installedCanvas;
    let installedProfile;
    try {
        installedPdfJs = require('pdfjs-dist/package.json').version;
        installedCanvas = require('@napi-rs/canvas/package.json').version;
        installedProfile = require('@napi-rs/canvas-darwin-arm64/package.json').version;
    } catch { throw new EngineUnavailable(); }
    if (installedPdfJs !== PDFJS_VERSION || installedCanvas !== CANVAS_VERSION
        || installedProfile !== CANVAS_VERSION) throw new EngineUnavailable();
    try {
        const [pdfjs, canvas] = await Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
            import('@napi-rs/canvas'),
        ]);
        if (pdfjs.version !== PDFJS_VERSION || typeof pdfjs.getDocument !== 'function'
            || typeof canvas.createCanvas !== 'function') throw new EngineUnavailable();
        return { getDocument: pdfjs.getDocument, createCanvas: canvas.createCanvas };
    } catch (error) {
        if (error instanceof EngineUnavailable) throw error;
        throw new EngineUnavailable();
    }
}

function boundedUntil(promise, deadline, onTimeout) {
    let timer;
    const remaining = Math.max(0, Math.ceil(deadline - performance.now()));
    if (remaining === 0) {
        try { onTimeout?.(); } catch { /* best-effort cancellation inside the already isolated child */ }
        return Promise.reject(new PageTimeout());
    }
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try { onTimeout?.(); } catch { /* best-effort cancellation inside the already isolated child */ }
            reject(new PageTimeout());
        }, remaining);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function cleanup(page, document, loading) {
    try { page?.cleanup(); } catch { /* parent hard-kills a synchronous cleanup stall */ }
    const pending = [];
    try { if (document) pending.push(Promise.resolve(document.cleanup()).catch(() => undefined)); } catch { /* best effort */ }
    try { if (loading) pending.push(Promise.resolve(loading.destroy()).catch(() => undefined)); } catch { /* best effort */ }
    let timer;
    try {
        await Promise.race([
            Promise.all(pending),
            new Promise((resolve) => { timer = setTimeout(resolve, CLEANUP_OBSERVATION_MS); }),
        ]);
    } finally { clearTimeout(timer); }
}

async function renderPage(engine, bytes) {
    const started = performance.now();
    const deadline = started + PAGE_TIMEOUT_MS;
    let loading = null;
    let document = null;
    let page = null;
    let task = null;
    let canvas = null;
    try {
        loading = engine.getDocument({
            data: new Uint8Array(bytes),
            disableWorker: true,
            isEvalSupported: false,
            useSystemFonts: false,
            useWorkerFetch: false,
            stopAtErrors: true,
            disableRange: true,
            disableStream: true,
            disableAutoFetch: true,
            maxImageSize: MAX_PIXELS,
            canvasMaxAreaInBytes: MAX_PIXELS * 4,
            verbosity: 0,
        });
        document = await boundedUntil(loading.promise, deadline, () => loading?.destroy());
        if (document.numPages !== 1) throw new Error('not_single_page');
        page = await boundedUntil(document.getPage(1), deadline, () => loading?.destroy());
        const viewport = page.getViewport({ scale: DPI / 72 });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        const pixels = width * height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
            || width > MAX_DIMENSION_PIXELS || height > MAX_DIMENSION_PIXELS
            || !Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) throw new ResourceLimit();
        canvas = engine.createCanvas(width, height);
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });
        await boundedUntil(task.promise, deadline, () => task?.cancel());
        const pngBytes = Buffer.from(canvas.toBuffer('image/png'));
        const durationMs = Math.max(0, Math.ceil(performance.now() - started));
        if (durationMs > PAGE_TIMEOUT_MS) throw new PageTimeout();
        if (pngBytes.byteLength < PNG_SIGNATURE.byteLength
            || !pngBytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
            || pngBytes.byteLength > MAX_RASTER_BYTES) throw new ResourceLimit();
        return { pngBytes, width, height, durationMs };
    } finally {
        await cleanup(page, document, loading);
        if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
}

async function render(pages) {
    let engine;
    try { engine = await loadRenderer(); } catch { return { failure: 'engine_unavailable' }; }
    const output = [];
    let total = 0;
    for (const input of pages) {
        try {
            const result = await renderPage(engine, input.pdfBytes);
            total += result.pngBytes.byteLength;
            if (total > MAX_TOTAL_RASTER_BYTES) throw new ResourceLimit();
            output.push({ page: input.page, ...result });
        } catch (error) {
            if (error instanceof PageTimeout) return { failure: 'timeout' };
            if (error instanceof ResourceLimit) return { failure: 'resource_limit' };
            return { failure: 'render_failed' };
        }
    }
    return { pages: output };
}

function emitMaterialized(pages) {
    const bodyByteLength = pages.reduce((total, page) => total + page.bytes.byteLength, 0);
    const header = {
        schemaVersion: SCHEMA_VERSION,
        status: 'materialized',
        pages: pages.map((page) => ({ page: page.page, byteLength: page.bytes.byteLength })),
        bodyByteLength,
    };
    process.stdout.write(encodeFrame(header, pages.map((page) => page.bytes)));
}

function emitRendered(pages) {
    const bodyByteLength = pages.reduce((total, page) => total + page.pngBytes.byteLength, 0);
    const header = {
        schemaVersion: SCHEMA_VERSION,
        status: 'rendered',
        pages: pages.map((page) => ({ page: page.page, byteLength: page.pngBytes.byteLength,
            width: page.width, height: page.height, durationMs: page.durationMs })),
        bodyByteLength,
    };
    process.stdout.write(encodeFrame(header, pages.map((page) => page.pngBytes)));
}

const selfTest = process.argv[2];
if (selfTest === '--self-test=sync-hang') {
    while (true) { /* hard-kill fixture: deliberately blocks the child event loop */ }
} else if (selfTest === '--self-test=oversized-output') {
    writeSync(1, Buffer.alloc(4 * 1024, 0x78));
    while (true) { /* leave the process alive so the owner observes SIGKILL */ }
} else if (selfTest === '--self-test=malformed-output') {
    writeSync(1, Buffer.from([0, 0, 0, 3, 0x7b]));
} else if (selfTest === '--self-test=valid-failure') {
    emitFailure('malformed_or_encrypted_pdf');
} else if (selfTest === '--self-test=shared-deadline') {
    const deadline = performance.now() + 100;
    const delayed = () => new Promise((resolve) => setTimeout(resolve, 45));
    try {
        await boundedUntil(delayed(), deadline);
        await boundedUntil(delayed(), deadline);
        await boundedUntil(delayed(), deadline);
        emitFailure('render_failed');
    } catch (error) {
        emitFailure(error instanceof PageTimeout ? 'timeout' : 'render_failed');
    }
} else if (selfTest === '--self-test=network-denied') {
    let denials = 0;
    try { await import('node:net'); } catch (error) {
        if (error?.code === 'MEDIFLOW_NETWORK_DISABLED') denials += 1;
    }
    try { process.getBuiltinModule('node:http'); } catch (error) {
        if (error?.code === 'MEDIFLOW_NETWORK_DISABLED') denials += 1;
    }
    try { await globalThis.fetch('http://127.0.0.1:9'); } catch (error) {
        if (error?.code === 'MEDIFLOW_NETWORK_DISABLED') denials += 1;
    }
    emitFailure(denials === 3 ? 'invalid_request' : 'render_failed');
} else if (selfTest !== undefined) {
    emitFailure('invalid_request');
} else {
    try {
        const frame = decodeFrame(await readInput());
        const materialization = materializeRequest(frame);
        if (materialization) {
            const result = await materialize(materialization);
            if (result.failure) emitFailure(result.failure);
            else emitMaterialized(result.pages);
        } else {
            const pages = renderRequest(frame);
            if (!pages) emitFailure('invalid_request');
            else {
                const result = await render(pages);
                if (result.failure) emitFailure(result.failure);
                else emitRendered(result.pages);
            }
        }
    } catch (error) {
        emitFailure(error instanceof ResourceLimit ? 'resource_limit' : 'invalid_request');
    }
}
