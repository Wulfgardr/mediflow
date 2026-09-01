/* @Codex */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';
import { ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT, ANYDOC_PAGE_ROUTING_SCHEMA_VERSION } from './anydoc-local-extraction-runner';
import { ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION, type AnyDocPageManifestSourceBinding } from './anydoc-page-manifest';
import { ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES, ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION,
    ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';
export const ANYDOC_PDF_PAGE_RENDERER_SCHEMA_VERSION = 'mediflow.anydoc_pdf_page_renderer.v1' as const;
export const ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID = 'mediflow.pdfjs_png.node24.darwin_arm64.v1' as const;
export const ANYDOC_PDF_PAGE_RENDERER_DPI = 144; export const ANYDOC_PDF_PAGE_RENDERER_MAX_PAGES = 16;
export const ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS = 4096;
export const ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS = 12_000_000;
export const ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES = 16 * 1024 * 1024;
export const ANYDOC_PDF_PAGE_RENDERER_MAX_TOTAL_RASTER_BYTES = 32 * 1024 * 1024;
export const ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS = 10_000;
export const ANYDOC_PDF_PAGE_RENDERER_CLEANUP_TIMEOUT_MS = 250;
const PDFJS_VERSION = '4.10.38';
const PDFJS_TARBALL_SHA256 = '1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0';
const CANVAS_VERSION = '0.1.100';
const CANVAS_TARBALL_SHA256 = 'ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa';
const BACKEND_ID = '@napi-rs/canvas';
const BACKEND_PROFILE_ID = '@napi-rs/canvas-darwin-arm64';
const BACKEND_PROFILE_TARBALL_SHA256 = 'c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91';
export const ANYDOC_PDF_PAGE_RENDERER_ENGINE_DESCRIPTOR = [
    'engine=pdfjs-dist@4.10.38;integrity=sha512-/Y3fcFrXEAsMjJXeL9J8+ZG9U01LbuWaYypvDW2ycW1jL269L3js3DVBjDJ0Up9Np1uqDXsDrRihHANhZOlwdQ==;tarballSha256=1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0',
    'backend=@napi-rs/canvas@0.1.100;integrity=sha512-xglYA6q3XO5P3BNJYxVZ1IV7DLVjp1Py6nwag88YntrS+3vKHyYcMqXVS4ZztJmwz2uGvz1FWhI/4LgbR5uQDA==;tarballSha256=ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa',
    'backendProfile=@napi-rs/canvas-darwin-arm64@0.1.100;integrity=sha512-2PcswRaC7Ly645DGt88///zuFDhJxJYdKAs1uU3mfk1atYkXufgcgLfBpk6Tm12nCQBaNt1wpybuPZ4qOhTo8A==;tarballSha256=c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91',
    `profile=${ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID};platform=darwin;arch=arm64;node=24`,
    'options=disableWorker:true,isEvalSupported:false,useSystemFonts:false,useWorkerFetch:false,stopAtErrors:true,disableRange:true,disableStream:true,disableAutoFetch:true',
    `limits=dpi:${ANYDOC_PDF_PAGE_RENDERER_DPI},pages:${ANYDOC_PDF_PAGE_RENDERER_MAX_PAGES},dimension:${ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS},pixels:${ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS},raster:${ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES},totalRaster:${ANYDOC_PDF_PAGE_RENDERER_MAX_TOTAL_RASTER_BYTES},pageTimeout:${ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS},cleanupTimeout:${ANYDOC_PDF_PAGE_RENDERER_CLEANUP_TIMEOUT_MS}`,
].join('\n');
export const ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256 = createHash('sha256')
    .update(ANYDOC_PDF_PAGE_RENDERER_ENGINE_DESCRIPTOR).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/u;
const runtimeRequire = createRequire(import.meta.url);
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export type AnyDocPdfPageRendererFailureReason = 'invalid_manifest' | 'routing_manifest_mismatch'
    | 'invalid_materialization' | 'source_binding_mismatch' | 'page_evidence_mismatch'
    | 'resource_limit' | 'engine_unavailable' | 'render_failed' | 'timeout';
export interface AnyDocPdfPageRenderReceipt {
    readonly documentSourceRef: string; readonly documentRevision: number; readonly documentFreshnessEpoch: number;
    readonly sourceSha256: string; readonly sourceByteLength: number; readonly page: number; readonly admission: 'needsOcr';
    readonly pageSha256: string; readonly pageByteLength: number; readonly routingSha256: string;
    readonly materializerSha256: typeof ANYDOC_PDF_PAGE_MATERIALIZER_SHA256;
    readonly rendererProfileId: typeof ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID;
    readonly rendererSha256: typeof ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256;
    readonly engine: 'pdfjs-dist'; readonly engineVersion: typeof PDFJS_VERSION; readonly engineSha256: typeof PDFJS_TARBALL_SHA256;
    readonly backend: typeof BACKEND_ID; readonly backendVersion: typeof CANVAS_VERSION; readonly backendSha256: typeof CANVAS_TARBALL_SHA256;
    readonly backendProfile: typeof BACKEND_PROFILE_ID; readonly backendProfileSha256: typeof BACKEND_PROFILE_TARBALL_SHA256;
    readonly format: 'png'; readonly dpi: typeof ANYDOC_PDF_PAGE_RENDERER_DPI; readonly widthPixels: number;
    readonly heightPixels: number; readonly pixelCount: number; readonly rasterSha256: string; readonly rasterByteLength: number;
    readonly durationMs: number; readonly timeoutMs: typeof ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS;
}
export type AnyDocPdfPageRendererResult = Readonly<{
    schemaVersion: typeof ANYDOC_PDF_PAGE_RENDERER_SCHEMA_VERSION; status: 'rendered';
    sourceBinding: AnyDocPageManifestSourceBinding; routingSha256: string; pageCount: number;
    pages: readonly Readonly<{ page: number; pngBytes: Buffer; receipt: AnyDocPdfPageRenderReceipt }>[];
    review: 'required'; writes: 0; apply: 'none';
}> | Readonly<{
    schemaVersion: typeof ANYDOC_PDF_PAGE_RENDERER_SCHEMA_VERSION; status: 'review_required';
    reason: AnyDocPdfPageRendererFailureReason; review: 'required'; writes: 0; apply: 'none';
}>;
type Exact = Record<string, unknown>;
type ManifestPage = Readonly<{ page: number; status: 'native' | 'needsOcr'; pageSha256: string; pageByteLength: number }>;
type SnapshotPage = Readonly<{ page: number; pdfBytes: Buffer; pageSha256: string; pageByteLength: number }>;
type Snapshot = Readonly<{ sourceBinding: AnyDocPageManifestSourceBinding; routingSha256: string;
    pageCount: number; pages: readonly SnapshotPage[] }>;
type SnapshotResult = Readonly<{ snapshot: Snapshot; failure: null }>
    | Readonly<{ snapshot: null; failure: AnyDocPdfPageRendererFailureReason }>;
const snapshotFailure = (failure: AnyDocPdfPageRendererFailureReason): SnapshotResult =>
    Object.freeze({ snapshot: null, failure });
function exact(value: unknown, keys: readonly string[]): Exact | null {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const result: Exact = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        result[key] = descriptor.value;
    }
    return result;
}
function arrayValues(value: unknown, maximum: number): readonly unknown[] | null {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) return null;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
        output.push(descriptor.value);
    }
    return output;
}
function denied(reason: AnyDocPdfPageRendererFailureReason): AnyDocPdfPageRendererResult {
    return Object.freeze({ schemaVersion: ANYDOC_PDF_PAGE_RENDERER_SCHEMA_VERSION, status: 'review_required', reason,
        review: 'required', writes: 0, apply: 'none' });
}
function sourceBinding(value: unknown): AnyDocPageManifestSourceBinding | null {
    const input = exact(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength']);
    if (!input || typeof input.documentSourceRef !== 'string' || !SHA256.test(input.documentSourceRef)
        || !Number.isSafeInteger(input.documentRevision) || (input.documentRevision as number) < 1
        || !Number.isSafeInteger(input.documentFreshnessEpoch) || (input.documentFreshnessEpoch as number) < 1
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || (input.sourceByteLength as number) < 1
        || (input.sourceByteLength as number) > ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES) return null;
    return Object.freeze({ documentSourceRef: input.documentSourceRef, documentRevision: input.documentRevision as number,
        documentFreshnessEpoch: input.documentFreshnessEpoch as number, sourceSha256: input.sourceSha256,
        sourceByteLength: input.sourceByteLength as number });
}
function manifestSnapshot(value: unknown): { source: AnyDocPageManifestSourceBinding; routingSha256: string;
    pageCount: number; pages: readonly ManifestPage[] } | AnyDocPdfPageRendererFailureReason {
    const input = exact(value, ['schemaVersion', 'status', 'reason', 'sourceBinding', 'routingSha256', 'pageCount', 'pages', 'review', 'writes', 'apply']);
    const source = sourceBinding(input?.sourceBinding);
    if (!input || input.schemaVersion !== ANYDOC_PAGE_MANIFEST_SCHEMA_VERSION || input.status !== 'classified'
        || input.reason !== null || !source || typeof input.routingSha256 !== 'string' || !SHA256.test(input.routingSha256)
        || !Number.isSafeInteger(input.pageCount) || (input.pageCount as number) < 1
        || (input.pageCount as number) > ANYDOC_PAGE_ROUTING_MAX_PAGE_COUNT
        || input.review !== 'required' || input.writes !== 0 || input.apply !== 'none') return 'invalid_manifest';
    const values = arrayValues(input.pages, input.pageCount as number);
    if (!values || values.length !== input.pageCount) return 'invalid_manifest';
    const pages: ManifestPage[] = []; const needsOcr: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
        const page = exact(values[index], ['page', 'status', 'pageSha256', 'pageByteLength', 'materializerSha256', 'nativeEvidence']);
        if (!page || page.page !== index + 1 || (page.status !== 'native' && page.status !== 'needsOcr')
            || typeof page.pageSha256 !== 'string' || !SHA256.test(page.pageSha256)
            || !Number.isSafeInteger(page.pageByteLength) || (page.pageByteLength as number) < 1
            || (page.pageByteLength as number) > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES
            || page.materializerSha256 !== ANYDOC_PDF_PAGE_MATERIALIZER_SHA256) return 'invalid_manifest';
        if (page.status === 'needsOcr') {
            if (page.nativeEvidence !== null) return 'invalid_manifest';
            needsOcr.push(index + 1);
        } else if (!exact(page.nativeEvidence, ['receiptId', 'markdownSha256', 'markdownByteLength'])) return 'invalid_manifest';
        pages.push(Object.freeze({ page: index + 1, status: page.status, pageSha256: page.pageSha256,
            pageByteLength: page.pageByteLength as number }));
    }
    if (needsOcr.length < 1 || needsOcr.length > ANYDOC_PDF_PAGE_RENDERER_MAX_PAGES) return 'resource_limit';
    const routingSha256 = sha256(`${ANYDOC_PAGE_ROUTING_SCHEMA_VERSION}|${input.pageCount}|${needsOcr.join(',')}`);
    if (routingSha256 !== input.routingSha256) return 'routing_manifest_mismatch';
    return { source, routingSha256, pageCount: input.pageCount as number, pages: Object.freeze(pages) };
}
function snapshotInputs(manifestInput: unknown, materializationInput: unknown): SnapshotResult {
    const manifest = manifestSnapshot(manifestInput);
    if (typeof manifest === 'string') return snapshotFailure(manifest);
    const input = exact(materializationInput,
        ['schemaVersion', 'status', 'sourceSha256', 'sourceByteLength', 'pageCount', 'pages', 'review', 'writes', 'apply']);
    if (!input || input.schemaVersion !== ANYDOC_PDF_PAGE_MATERIALIZER_SCHEMA_VERSION || input.status !== 'materialized'
        || input.review !== 'required' || input.writes !== 0 || input.apply !== 'none'
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || !Number.isSafeInteger(input.pageCount))
        return snapshotFailure('invalid_materialization');
    if (input.sourceSha256 !== manifest.source.sourceSha256 || input.sourceByteLength !== manifest.source.sourceByteLength)
        return snapshotFailure('source_binding_mismatch');
    if (input.pageCount !== manifest.pageCount) return snapshotFailure('page_evidence_mismatch');
    const values = arrayValues(input.pages, manifest.pageCount);
    if (!values || values.length !== manifest.pageCount) return snapshotFailure('page_evidence_mismatch');
    const pages: SnapshotPage[] = []; let totalBytes = 0;
    for (let index = 0; index < values.length; index += 1) {
        const page = exact(values[index], ['page', 'pdfBytes', 'receipt']);
        const receipt = exact(page?.receipt, ['sourceSha256', 'sourceByteLength', 'page', 'pageSha256', 'pageByteLength', 'materializerSha256']);
        const expected = manifest.pages[index];
        if (!page || page.page !== index + 1 || !receipt || receipt.page !== index + 1
            || receipt.sourceSha256 !== manifest.source.sourceSha256 || receipt.sourceByteLength !== manifest.source.sourceByteLength
            || receipt.pageSha256 !== expected?.pageSha256 || receipt.pageByteLength !== expected.pageByteLength
            || receipt.materializerSha256 !== ANYDOC_PDF_PAGE_MATERIALIZER_SHA256
            || types.isProxy(page.pdfBytes) || !(page.pdfBytes instanceof Uint8Array))
            return snapshotFailure('page_evidence_mismatch');
        let pdfBytes: Buffer; try { pdfBytes = Buffer.from(page.pdfBytes); }
        catch { return snapshotFailure('page_evidence_mismatch'); }
        totalBytes += pdfBytes.byteLength;
        if (pdfBytes.byteLength > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES
            || totalBytes > ANYDOC_PDF_PAGE_MATERIALIZER_MAX_OUTPUT_BYTES) return snapshotFailure('resource_limit');
        if (pdfBytes.byteLength !== expected.pageByteLength || sha256(pdfBytes) !== expected.pageSha256)
            return snapshotFailure('page_evidence_mismatch');
        if (expected.status === 'needsOcr') pages.push(Object.freeze({ page: index + 1, pdfBytes,
            pageSha256: expected.pageSha256, pageByteLength: expected.pageByteLength }));
    }
    return Object.freeze({ snapshot: Object.freeze({ sourceBinding: manifest.source, routingSha256: manifest.routingSha256,
        pageCount: manifest.pageCount, pages: Object.freeze(pages) }), failure: null });
}
type RenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPage = { getViewport: (input: { scale: number }) => { width: number; height: number };
    render: (input: { canvasContext: unknown; viewport: unknown; background: string }) => RenderTask; cleanup: () => void };
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage>; cleanup: () => Promise<void> };
type LoadingTask = { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
type RasterCanvas = { width: number; height: number; getContext: (kind: '2d') => unknown;
    toBuffer: (format: 'image/png') => Buffer };
type RendererEngine = { getDocument: (input: unknown) => LoadingTask;
    createCanvas: (width: number, height: number) => RasterCanvas };
class PageRenderTimeout extends Error { constructor() { super(); this.name = 'PageRenderTimeout'; } }
function installedVersion(packageId: string): string | null {
    try { const value = runtimeRequire(`${packageId}/package.json`) as { version?: unknown };
        return typeof value.version === 'string' ? value.version : null; } catch { return null; }
}
async function loadEngine(): Promise<RendererEngine | null> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node.split('.')[0] !== '24'
        || installedVersion('pdfjs-dist') !== PDFJS_VERSION || installedVersion('@napi-rs/canvas') !== CANVAS_VERSION
        || installedVersion(BACKEND_PROFILE_ID) !== CANVAS_VERSION) return null;
    try {
        const [pdfjs, canvas] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('@napi-rs/canvas')]);
        if (pdfjs.version !== PDFJS_VERSION || typeof pdfjs.getDocument !== 'function' || typeof canvas.createCanvas !== 'function') return null;
        return { getDocument: pdfjs.getDocument as unknown as RendererEngine['getDocument'],
            createCanvas: canvas.createCanvas as unknown as RendererEngine['createCanvas'] };
    } catch { return null; }
}
function observeCleanup(action: () => unknown): Promise<void> {
    try {
        const value = action();
        if (!types.isPromise(value) || types.isProxy(value)) return Promise.resolve();
        return new Promise((resolve) => { Reflect.apply(Promise.prototype.then, value,
            [() => resolve(), () => resolve()]); });
    } catch { return Promise.resolve(); }
}
async function cleanupBounded(page: PdfPage | null, document: PdfDocument | null, loading: LoadingTask | null,
    timeoutMs: number): Promise<void> {
    try { page?.cleanup(); } catch { /* cleanup is best-effort after denial */ }
    const pending = [document && observeCleanup(() => document.cleanup()), loading && observeCleanup(() => loading.destroy())]
        .filter((value): value is Promise<void> => value !== null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.all(pending), new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]); }
    finally { if (timer) clearTimeout(timer); }
}
async function renderPage(engine: RendererEngine, bytes: Buffer, timeoutMs = ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS,
    cleanupTimeoutMs = ANYDOC_PDF_PAGE_RENDERER_CLEANUP_TIMEOUT_MS): Promise<{ pngBytes: Buffer; width: number; height: number }> {
    let loading: LoadingTask | null = null; let document: PdfDocument | null = null; let page: PdfPage | null = null;
    let task: RenderTask | null = null; let canvas: RasterCanvas | null = null; let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
        try { task?.cancel(); } catch { /* cancellation is host-owned and best-effort */ }
        reject(new PageRenderTimeout());
    }, timeoutMs); });
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, timeout]);
    try {
        loading = engine.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false,
            useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true, disableRange: true,
            disableStream: true, disableAutoFetch: true, maxImageSize: ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS,
            canvasMaxAreaInBytes: ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS * 4, verbosity: 0 });
        document = await bounded(loading.promise);
        if (document.numPages !== 1) throw new Error('not_single_page');
        page = await bounded(document.getPage(1)); const viewport = page.getViewport({ scale: ANYDOC_PDF_PAGE_RENDERER_DPI / 72 });
        const width = Math.ceil(viewport.width); const height = Math.ceil(viewport.height); const pixels = width * height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
            || width > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS || height > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS
            || !Number.isSafeInteger(pixels) || pixels > ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS) throw new RangeError('resource_limit');
        canvas = engine.createCanvas(width, height); task = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });
        await bounded(task.promise);
        const pngBytes = Buffer.from(canvas.toBuffer('image/png'));
        if (pngBytes.byteLength < 8 || pngBytes.byteLength > ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES) throw new RangeError('resource_limit');
        return { pngBytes, width, height };
    } finally {
        clearTimeout(timer!); await cleanupBounded(page, document, loading, cleanupTimeoutMs);
        if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
}
/** @internal Test-only engine seam; the public renderer remains host-owned and accepts no engine or limits. */
export const ANYDOC_PDF_PAGE_RENDERER_INTERNAL_TEST_SEAM = Object.freeze({ renderPage: (engine: RendererEngine, bytes: Buffer) =>
    renderPage(engine, Buffer.from(bytes), 20, 20) });
async function renderSnapshot(snapshot: Snapshot): Promise<AnyDocPdfPageRendererResult> {
    const engine = await loadEngine(); if (!engine) return denied('engine_unavailable');
    const pages: Array<Readonly<{ page: number; pngBytes: Buffer; receipt: AnyDocPdfPageRenderReceipt }>> = [];
    let totalRasterBytes = 0;
    for (const input of snapshot.pages) {
        const started = performance.now();
        try {
            const raster = await renderPage(engine, input.pdfBytes); totalRasterBytes += raster.pngBytes.byteLength;
            if (totalRasterBytes > ANYDOC_PDF_PAGE_RENDERER_MAX_TOTAL_RASTER_BYTES) return denied('resource_limit');
            const durationMs = Math.min(ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS, Math.max(0, Math.ceil(performance.now() - started)));
            const receipt: AnyDocPdfPageRenderReceipt = Object.freeze({ ...snapshot.sourceBinding, page: input.page,
                admission: 'needsOcr', pageSha256: input.pageSha256, pageByteLength: input.pageByteLength,
                routingSha256: snapshot.routingSha256, materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
                rendererProfileId: ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID, rendererSha256: ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
                engine: 'pdfjs-dist', engineVersion: PDFJS_VERSION, engineSha256: PDFJS_TARBALL_SHA256,
                backend: BACKEND_ID, backendVersion: CANVAS_VERSION, backendSha256: CANVAS_TARBALL_SHA256,
                backendProfile: BACKEND_PROFILE_ID, backendProfileSha256: BACKEND_PROFILE_TARBALL_SHA256,
                format: 'png', dpi: ANYDOC_PDF_PAGE_RENDERER_DPI, widthPixels: raster.width, heightPixels: raster.height,
                pixelCount: raster.width * raster.height, rasterSha256: sha256(raster.pngBytes),
                rasterByteLength: raster.pngBytes.byteLength, durationMs, timeoutMs: ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS });
            pages.push(Object.freeze({ page: input.page, pngBytes: raster.pngBytes, receipt }));
        } catch (error) {
            if (error instanceof PageRenderTimeout) return denied('timeout');
            if (error instanceof RangeError && error.message === 'resource_limit') return denied('resource_limit');
            return denied('render_failed');
        }
    }
    return Object.freeze({ schemaVersion: ANYDOC_PDF_PAGE_RENDERER_SCHEMA_VERSION, status: 'rendered',
        sourceBinding: snapshot.sourceBinding, routingSha256: snapshot.routingSha256, pageCount: snapshot.pageCount,
        pages: Object.freeze(pages), review: 'required', writes: 0, apply: 'none' });
}
/** Snapshots the classified manifest and materialized bytes; caller cannot choose page, format, DPI, path, or engine. */
export function renderAnyDocNeedsOcrPages(
    manifestInput: unknown, materializationInput: unknown,
): Promise<AnyDocPdfPageRendererResult> {
    const result = snapshotInputs(manifestInput, materializationInput);
    return result.snapshot ? renderSnapshot(result.snapshot) : Promise.resolve(denied(result.failure));
}
