/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';
import { ANYDOC_PDF_PAGE_RENDERER_DPI, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
    ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS, ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID } from './anydoc-pdf-page-renderer';
import { DEEPSEEK_OCR2_ARTIFACT_MANIFEST, DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
    evaluateDeepSeekOcr2RuntimePreflight } from './deepseek-ocr2-runtime-preflight';
import { DEEPSEEK_OCR2_OFFICIAL_ADAPTER_INTERNAL_TEST_SEAM, DEEPSEEK_OCR2_OFFICIAL_ADAPTER_TIMEOUT_MS,
    createDeepSeekOcr2OfficialRuntimeAdapter } from './deepseek-ocr2-runtime-adapter';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const SOURCE_REF = 'a'.repeat(64); const SOURCE_SHA = 'b'.repeat(64); const ROUTING_SHA = 'c'.repeat(64);
const PAGE_SHA = 'd'.repeat(64); const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]);
const text = 'Referto sintetico di test.';
function compatibleEvidence() {
    const profile = DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile;
    return { mode: 'synthetic_test', operatingSystem: profile.operatingSystem, architecture: profile.architecture,
        hostMemoryBytes: profile.minimumHostMemoryBytes, temporaryStorageBytes: profile.minimumTemporaryStorageBytes,
        acceleratorVendor: profile.acceleratorVendor, acceleratorMemoryBytes: profile.minimumAcceleratorMemoryBytes,
        computeBackend: profile.computeBackend, pythonVersion: profile.pythonVersion, cudaVersion: profile.cudaVersion,
        pytorchVersion: profile.pytorchVersion, transformersVersion: profile.transformersVersion,
        tokenizersVersion: profile.tokenizersVersion, flashAttentionVersion: profile.flashAttentionVersion,
        modelDigestSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.digestSha256 } as const;
}
function rendererPage(admission: 'needsOcr' | 'native' = 'needsOcr') {
    const receipt = Object.freeze({ documentSourceRef: SOURCE_REF, documentRevision: 7, documentFreshnessEpoch: 11,
        sourceSha256: SOURCE_SHA, sourceByteLength: 100, page: 1, admission, pageSha256: PAGE_SHA, pageByteLength: 50,
        routingSha256: ROUTING_SHA, materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
        rendererProfileId: ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID, rendererSha256: ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
        engine: 'pdfjs-dist', engineVersion: '4.10.38', engineSha256: '1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0',
        backend: '@napi-rs/canvas', backendVersion: '0.1.100', backendSha256: 'ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa',
        backendProfile: '@napi-rs/canvas-darwin-arm64', backendProfileSha256: 'c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91',
        format: 'png', dpi: ANYDOC_PDF_PAGE_RENDERER_DPI, widthPixels: 1, heightPixels: 1, pixelCount: 1,
        rasterSha256: sha256(PNG), rasterByteLength: PNG.byteLength, durationMs: 1,
        timeoutMs: ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS });
    return Object.freeze({ page: 1, pngBytes: Buffer.from(PNG), receipt });
}
const currentness = (): Readonly<{ documentSourceRef: string; documentRevision: number; documentFreshnessEpoch: number;
    sourceSha256: string; sourceByteLength: number }> => Object.freeze({ documentSourceRef: SOURCE_REF, documentRevision: 7,
    documentFreshnessEpoch: 11, sourceSha256: SOURCE_SHA, sourceByteLength: 100 });
const eligible = () => evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, compatibleEvidence());
const request = (page = rendererPage(), current = currentness(), preflight = eligible(),
    manifest: unknown = DEEPSEEK_OCR2_ARTIFACT_MANIFEST) => Object.freeze({ manifest, rendererPage: page,
        currentness: current, preflight });
const output = (overrides: Record<string, unknown> = {}) => Object.freeze({
    schemaVersion: 'mediflow.deepseek_ocr2.official_process_output.v1', status: 'complete', text,
    outputTokenCount: 8, peakResidentMemoryBytes: 1024, ...overrides,
});
function engine(run: (value: unknown) => unknown, terminate: (reason: unknown) => unknown = async () => undefined,
    kill: (reason: unknown) => unknown = async () => undefined) {
    return Object.freeze({ kind: 'official_local_process', run, terminate, kill });
}

test('binds one rendered needsOcr page to the pinned offline official request and PHI-safe receipt', async () => {
    let seen: Record<string, unknown> = Object.create(null); let seenRasterSha256: string | null = null;
    const page = rendererPage(); const adapter = createDeepSeekOcr2OfficialRuntimeAdapter(engine(async (value) => {
        seen = value as Record<string, unknown>; seenRasterSha256 = sha256(seen.rasterBytes as Buffer); return output();
    }));
    const result = await adapter.execute(request(page));
    assert.equal(result.status, 'contract_completed'); assert.equal(result.output, text); assert.equal(result.reason, null);
    assert.deepEqual(Reflect.ownKeys(seen), ['schemaVersion', 'artifactId', 'sourceRevision',
        'sourceArchiveSha256', 'modelRevision', 'modelDigestSha256', 'runtimeProfileId', 'page', 'rasterBytes',
        'localFilesOnly', 'network', 'fallback', 'trustRemoteCode', 'maximumOutputBytes', 'maximumOutputTokens',
        'maximumResidentMemoryBytes', 'timeoutMs']);
    assert.deepEqual([seen.network, seen.fallback, seen.localFilesOnly, seen.trustRemoteCode],
        ['denied', 'none', true, false]);
    assert.equal(seen.modelRevision, DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.revision);
    assert.equal(seen.modelDigestSha256, DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.digestSha256);
    assert.notEqual(seen.rasterBytes, page.pngBytes); assert.equal(seenRasterSha256, sha256(PNG));
    assert.equal((seen.rasterBytes as Buffer).every((value) => value === 0), true);
    assert.equal(result.receipt?.manifestSha256, DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256);
    assert.equal(result.receipt?.outputSha256, sha256(text)); assert.equal(result.receipt?.qualityPermille, 1000);
    assert.equal(result.receipt?.runtimeQualification, 'synthetic_contract_only');
    assert.doesNotMatch(JSON.stringify(result.receipt), /Referto|"text":|"pngBytes":|"rasterBytes":|"path":|"endpoint":/iu);
    assert.deepEqual([result.review, result.writes, result.apply], ['required', 0, 'none']);
});

test('fails closed on caller-shaped, unpinned, non-admitted, stale or denied evidence', async () => {
    const run = async () => output(); const denied = async (value: unknown) =>
        createDeepSeekOcr2OfficialRuntimeAdapter(engine(run)).execute(value);
    assert.equal((await denied({ ...request() })).reason, 'invalid_request');
    assert.equal((await denied(Object.freeze({ ...request(), extra: true }))).reason, 'invalid_request');
    assert.equal((await denied(Object.freeze({ ...request(), manifest: Object.freeze({ ...DEEPSEEK_OCR2_ARTIFACT_MANIFEST }) }))).reason,
        'invalid_manifest');
    assert.equal((await denied(request({ ...rendererPage() }))).reason, 'invalid_renderer_receipt');
    assert.equal((await denied(request(rendererPage(), { ...currentness() }))).reason, 'binding_mismatch');
    assert.equal((await denied(request(rendererPage(), currentness(), { ...eligible() }))).reason, 'invalid_preflight');
    assert.equal((await denied(request(rendererPage('native')))).reason, 'invalid_renderer_receipt');
    assert.equal((await denied(request(rendererPage(), Object.freeze({ ...currentness(), documentRevision: 8 })))).reason,
        'binding_mismatch');
    const hold = evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST,
        { ...compatibleEvidence(), mode: 'local_probe' });
    assert.equal((await denied(request(rendererPage(), currentness(), hold))).reason, 'preflight_denied');
});

test('denies Proxy, revoked Proxy and accessors without invoking hostile traps', async () => {
    let reads = 0; const page = rendererPage(); const hostileReceipt = { ...page.receipt };
    Object.defineProperty(hostileReceipt, 'rasterSha256', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    const hostilePage = Object.freeze({ ...page, receipt: Object.freeze(hostileReceipt) });
    let result = await createDeepSeekOcr2OfficialRuntimeAdapter(engine(async () => output()))
        .execute(request(hostilePage));
    assert.equal(result.reason, 'invalid_renderer_receipt'); assert.equal(reads, 0);
    const proxiedEngine = new Proxy(engine(async () => output()), {});
    result = await createDeepSeekOcr2OfficialRuntimeAdapter(proxiedEngine).execute(request());
    assert.equal(result.reason, 'invalid_engine');
    const revoked = Proxy.revocable(request(), {}); revoked.revoke();
    result = await createDeepSeekOcr2OfficialRuntimeAdapter(engine(async () => output())).execute(revoked.proxy);
    assert.equal(result.reason, 'invalid_request');
});

test('rejects hostile, blank, oversized, low-quality and over-budget process output', async () => {
    const invalid: Array<[unknown, string]> = [
        [new Proxy(output(), {}), 'invalid_output'], [output({ text: '' }), 'invalid_output'],
        [output({ text: 'x'.repeat(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputBytes + 1) }), 'resource_limit'],
        [output({ text: ';;;;;;;;;;;;' }), 'low_quality'],
        [output({ outputTokenCount: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputTokens + 1 }), 'resource_limit'],
        [output({ peakResidentMemoryBytes: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumResidentMemoryBytes + 1 }), 'resource_limit'],
    ];
    for (const [value, reason] of invalid) {
        const result = await createDeepSeekOcr2OfficialRuntimeAdapter(engine(async () => value)).execute(request());
        assert.equal(result.reason, reason);
    }
    let reads = 0; const hostile = { ...output() };
    Object.defineProperty(hostile, 'text', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    const result = await createDeepSeekOcr2OfficialRuntimeAdapter(engine(async () => Object.freeze(hostile))).execute(request());
    assert.equal(result.reason, 'invalid_output'); assert.equal(reads, 0);
});

test('rejects thenables and engine reentrancy, then remains terminal', async () => {
    let thenReads = 0; const thenable = {};
    Object.defineProperty(thenable, 'then', { get() { thenReads += 1; throw new Error('raw'); } });
    let result = await createDeepSeekOcr2OfficialRuntimeAdapter(engine(() => thenable)).execute(request());
    assert.equal(result.reason, 'invalid_engine_promise'); assert.equal(thenReads, 0);
    const holder: { adapter?: ReturnType<typeof createDeepSeekOcr2OfficialRuntimeAdapter> } = {};
    let reentrant: ReturnType<ReturnType<typeof createDeepSeekOcr2OfficialRuntimeAdapter>['execute']> | undefined;
    const adapter = createDeepSeekOcr2OfficialRuntimeAdapter(engine(() => {
        reentrant = holder.adapter?.execute(request()); return Promise.resolve(output());
    }));
    holder.adapter = adapter;
    result = await adapter.execute(request()); assert.equal(result.status, 'contract_completed');
    assert.ok(reentrant); assert.equal((await reentrant).reason, 'restart_forbidden');
    assert.equal((await adapter.execute(request())).reason, 'restart_forbidden');
});

test('observes a process promise returned after reentrant cancellation', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<unknown>((_resolve, rejectValue) => { reject = rejectValue; });
    const holder: { adapter?: ReturnType<typeof createDeepSeekOcr2OfficialRuntimeAdapter> } = {};
    const adapter = createDeepSeekOcr2OfficialRuntimeAdapter(engine(() => { holder.adapter?.cancel(); return pending; }));
    holder.adapter = adapter;
    assert.equal((await adapter.execute(request())).reason, 'cancelled');
    reject(new Error('late synthetic failure'));
    await new Promise((resolve) => setImmediate(resolve));
});

test('cancels one-shot, zeroes raster retention, terminates then kills, and discards late completion', async () => {
    let release!: (value: unknown) => void; const pending = new Promise<unknown>((resolve) => { release = resolve; });
    let raster: Buffer = Buffer.alloc(0); const events: string[] = [];
    const adapter = DEEPSEEK_OCR2_OFFICIAL_ADAPTER_INTERNAL_TEST_SEAM.create(engine((value) => {
        raster = (value as { rasterBytes: Buffer }).rasterBytes; return pending;
    }, () => { events.push('terminate'); return new Promise(() => undefined); }, async () => { events.push('kill'); }));
    const execution = adapter.execute(request()); assert.equal(adapter.cancel(), true);
    const result = await execution; assert.equal(result.reason, 'cancelled'); assert.equal(result.receipt, null);
    assert.ok(raster.byteLength > 0); assert.equal(raster.every((value: number) => value === 0), true);
    release(output()); await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(events, ['terminate', 'kill']); assert.equal((await adapter.execute(request())).reason, 'restart_forbidden');
    assert.equal(adapter.cancel(), false);
});

test('times out before cleanup observation and fences ignored cancel plus late completion', async () => {
    let release!: (value: unknown) => void; const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const events: string[] = [];
    const adapter = DEEPSEEK_OCR2_OFFICIAL_ADAPTER_INTERNAL_TEST_SEAM.create(engine(() => pending,
        async () => { events.push('terminate'); }, async () => { events.push('kill'); }));
    const started = performance.now(); const result = await adapter.execute(request());
    assert.equal(result.reason, 'timeout'); assert.ok(performance.now() - started < 200); assert.equal(result.receipt, null);
    release(output()); await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(events, ['terminate']);
    assert.equal((await adapter.execute(request())).reason, 'restart_forbidden');
});

test('keeps production timeout and runtime surface host-owned with no transport, route or fallback seam', () => {
    assert.ok(DEEPSEEK_OCR2_OFFICIAL_ADAPTER_TIMEOUT_MS >= 60_000);
    assert.equal(createDeepSeekOcr2OfficialRuntimeAdapter.length, 1);
    const source = readFileSync(new URL('./deepseek-ocr2-runtime-adapter.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|https?:|node:child_process|spawn\(|exec\(|process\.env|modelPath|endpoint|Ollama|Apple Vision|app\/api|dbServer|lib\/schema/iu);
    assert.doesNotMatch(source, /console\.|readFile|writeFile|AbortSignal/iu);
});
