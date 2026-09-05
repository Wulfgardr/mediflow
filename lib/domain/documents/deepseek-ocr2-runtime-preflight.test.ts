/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';
import { ANYDOC_PDF_PAGE_RENDERER_DPI, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
    ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS, ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID } from './anydoc-pdf-page-renderer';
import { DEEPSEEK_OCR2_ARTIFACT_MANIFEST, DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
    DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS, createDeepSeekOcr2FakeAdapter,
    evaluateDeepSeekOcr2RuntimePreflight, preflightCurrentDeepSeekOcr2Runtime } from './deepseek-ocr2-runtime-preflight';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const SOURCE_REF = 'a'.repeat(64); const SOURCE_SHA = 'b'.repeat(64); const ROUTING_SHA = 'c'.repeat(64);
const PAGE_SHA = 'd'.repeat(64); const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]);
const output = (text = 'Referto sintetico di test.') => ({
    schemaVersion: 'mediflow.deepseek_ocr2.fake_output.v1', status: 'complete', text,
});
function compatibleEvidence(mode: 'synthetic_test' | 'local_probe' = 'synthetic_test') {
    const profile = DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile;
    return { mode, operatingSystem: profile.operatingSystem, architecture: profile.architecture,
        hostMemoryBytes: profile.minimumHostMemoryBytes, temporaryStorageBytes: profile.minimumTemporaryStorageBytes,
        acceleratorVendor: profile.acceleratorVendor, acceleratorMemoryBytes: profile.minimumAcceleratorMemoryBytes,
        computeBackend: profile.computeBackend, pythonVersion: profile.pythonVersion, cudaVersion: profile.cudaVersion,
        pytorchVersion: profile.pytorchVersion, transformersVersion: profile.transformersVersion,
        tokenizersVersion: profile.tokenizersVersion, flashAttentionVersion: profile.flashAttentionVersion,
        modelDigestSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.digestSha256 };
}
function rendererPage() {
    return { page: 1, pngBytes: Buffer.from(PNG), receipt: { documentSourceRef: SOURCE_REF, documentRevision: 7,
        documentFreshnessEpoch: 11, sourceSha256: SOURCE_SHA, sourceByteLength: 100, page: 1, admission: 'needsOcr',
        pageSha256: PAGE_SHA, pageByteLength: 50, routingSha256: ROUTING_SHA,
        materializerSha256: ANYDOC_PDF_PAGE_MATERIALIZER_SHA256,
        rendererProfileId: ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID, rendererSha256: ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
        engine: 'pdfjs-dist', engineVersion: '4.10.38', engineSha256: '1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0',
        backend: '@napi-rs/canvas', backendVersion: '0.1.100', backendSha256: 'ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa',
        backendProfile: '@napi-rs/canvas-darwin-arm64', backendProfileSha256: 'c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91',
        format: 'png', dpi: ANYDOC_PDF_PAGE_RENDERER_DPI, widthPixels: 1, heightPixels: 1, pixelCount: 1,
        rasterSha256: sha256(PNG), rasterByteLength: PNG.byteLength, durationMs: 1,
        timeoutMs: ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS } };
}
const currentness = () => ({ documentSourceRef: SOURCE_REF, documentRevision: 7, documentFreshnessEpoch: 11,
    sourceSha256: SOURCE_SHA, sourceByteLength: 100 });
const eligible = () => evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, compatibleEvidence());
const request = (preflight = eligible(), page = rendererPage()) => ({
    manifest: DEEPSEEK_OCR2_ARTIFACT_MANIFEST, rendererPage: page, currentness: currentness(), preflight,
});

test('pins the official artifact and keeps the current M4 on the upstream hardware hold', () => {
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.source.revision, '2f3699ebbb96fa8af32212e8c170f2cc28730fad');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.source.archiveSha256, '9476e0418ed9f644353dd7a51f089d09df5e217365bc87c72a672eb0fb054b9b');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.id, 'deepseek-ai/DeepSeek-OCR-2');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.revision, 'aaa02f3811945a91062062994c5c4a3f4c0af2b0');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.digestSha256, 'd8ff67a424ba6f4dd077885eb9d6a05d2537e76fe5491f0e2a9b712f8c8870fa');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.license, 'Apache-2.0');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.policyOrigin, 'mediflow_unbenchmarked_v1');
    assert.equal(DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256, '6af7ca3acfb43c11770e564ec8f9b59973fac172bd1ecb6999be0659f7b286ee');
    const m4 = { ...compatibleEvidence('local_probe'), operatingSystem: 'darwin', architecture: 'arm64',
        acceleratorVendor: 'apple', computeBackend: 'metal', acceleratorMemoryBytes: null,
        pythonVersion: null, cudaVersion: null, pytorchVersion: null, transformersVersion: null,
        tokenizersVersion: null, flashAttentionVersion: null, modelDigestSha256: null };
    const decision = evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, m4);
    assert.equal(decision.status, 'HOLD_HARDWARE_UPSTREAM_RUNTIME');
    assert.equal(decision.reason, 'nvidia_cuda_upstream_required');
    const current = preflightCurrentDeepSeekOcr2Runtime();
    if (process.platform === 'darwin' && process.arch === 'arm64')
        assert.equal(current.status, 'HOLD_HARDWARE_UPSTREAM_RUNTIME');
});

test('fails closed on manifest, runtime, artifact and resource drift', () => {
    const drifted = { ...clone(DEEPSEEK_OCR2_ARTIFACT_MANIFEST),
        model: { ...clone(DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model), revision: '0'.repeat(40) } };
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(drifted, compatibleEvidence()).reason, 'invalid_manifest');
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST,
        { ...compatibleEvidence(), hostMemoryBytes: 1 }).reason, 'insufficient_resources');
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST,
        { ...compatibleEvidence(), pytorchVersion: '2.6.1' }).reason, 'runtime_or_artifact_drift');
    const local = evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, compatibleEvidence('local_probe'));
    assert.deepEqual([local.status, local.reason], ['runtime_profile_unqualified', 'qualification_missing']);
});

test('denies Proxy, revoked Proxy and accessors without invoking traps', () => {
    let reads = 0; const evidence = compatibleEvidence();
    Object.defineProperty(evidence, 'pythonVersion', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, evidence).reason, 'invalid_runtime_evidence');
    assert.equal(reads, 0);
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(new Proxy(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, {}), compatibleEvidence()).reason,
        'invalid_manifest');
    const revoked = Proxy.revocable(compatibleEvidence(), {}); revoked.revoke();
    assert.equal(evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, revoked.proxy).reason,
        'invalid_runtime_evidence');
    const hostile = new Proxy({ kind: 'test_fake', run: async () => output(), cancel: () => undefined }, {});
    const result = createDeepSeekOcr2FakeAdapter(hostile).execute(request());
    const revokedEngine = Proxy.revocable({ kind: 'test_fake', run: async () => output(), cancel: () => undefined }, {});
    revokedEngine.revoke();
    return Promise.all([result, createDeepSeekOcr2FakeAdapter(revokedEngine.proxy).execute(request())])
        .then((values) => assert.deepEqual(values.map((value) => value.reason), ['invalid_engine', 'invalid_engine']));
});

test('binds fake output to manifest, renderer, currentness and preflight without receipt payload', async () => {
    let release!: (value: unknown) => void; const pending = new Promise<unknown>((resolve) => { release = resolve; });
    let seenRasterSha256: string | null = null;
    const adapter = createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: async (input: unknown) => {
        const value = input as { rasterBytes: Buffer }; seenRasterSha256 = sha256(value.rasterBytes); return pending;
    }, cancel: () => undefined });
    const input = request(); const execution = adapter.execute(input); input.rendererPage.pngBytes.fill(0); release(output());
    const result = await execution;
    assert.equal(result.status, 'fake_completed');
    if (result.status !== 'fake_completed' || !result.receipt || result.output === null) return;
    assert.equal(seenRasterSha256, sha256(PNG)); assert.equal(result.output, 'Referto sintetico di test.');
    assert.equal(result.receipt.manifestSha256, DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256);
    assert.equal(result.receipt.rendererSha256, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256);
    assert.equal(result.receipt.rasterSha256, sha256(PNG)); assert.equal(result.receipt.outputSha256, sha256(result.output));
    assert.equal(result.receipt.preflightStatus, 'test_adapter_eligible');
    assert.doesNotMatch(JSON.stringify(result.receipt), /Referto|rasterBytes|pngBytes|text|path/iu);
    assert.deepEqual([result.review, result.writes, result.apply], ['required', 0, 'none']);
});

test('denies binding drift, hostile renderer evidence and non-compliant output', async () => {
    const engine = () => ({ kind: 'test_fake', run: async () => output(), cancel: () => undefined });
    let result = await createDeepSeekOcr2FakeAdapter(engine()).execute({ ...request(),
        currentness: { ...currentness(), documentRevision: 8 } });
    assert.equal(result.reason, 'binding_mismatch');
    let reads = 0; const page = rendererPage();
    Object.defineProperty(page.receipt, 'rasterSha256', { enumerable: true, get() { reads += 1; throw new Error('raw'); } });
    result = await createDeepSeekOcr2FakeAdapter(engine()).execute(request(eligible(), page));
    assert.equal(result.reason, 'invalid_renderer_receipt'); assert.equal(reads, 0);
    const invalid = [new Proxy(output(), {}), { ...output(), extra: true }, output(''),
        output('e\u0301'), output('x'.repeat(1_048_577))];
    for (const value of invalid) {
        result = await createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: async () => value, cancel: () => undefined })
            .execute(request());
        assert.equal(result.reason, 'invalid_output');
    }
    const hostileOutput = output(); Object.defineProperty(hostileOutput, 'text', {
        enumerable: true, get() { reads += 1; throw new Error('raw'); },
    });
    result = await createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: async () => hostileOutput,
        cancel: () => undefined }).execute(request());
    assert.equal(result.reason, 'invalid_output'); assert.equal(reads, 0);
});

test('rejects thenables, reentrancy and restart without invoking hostile then accessors', async () => {
    let thenReads = 0; const thenable = {};
    Object.defineProperty(thenable, 'then', { get() { thenReads += 1; throw new Error('raw'); } });
    let result = await createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: () => thenable, cancel: () => undefined })
        .execute(request());
    assert.equal(result.reason, 'invalid_engine_promise'); assert.equal(thenReads, 0);
    const native = Promise.resolve(output()); const revokedPromise = Proxy.revocable(native, {}); revokedPromise.revoke();
    result = await createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: () => revokedPromise.proxy,
        cancel: () => undefined }).execute(request());
    assert.equal(result.reason, 'invalid_engine_promise');
    let release!: (value: unknown) => void; const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const adapter = createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: () => pending, cancel: () => undefined });
    const first = adapter.execute(request());
    result = await adapter.execute(request()); assert.equal(result.reason, 'restart_forbidden');
    release(output()); assert.equal((await first).status, 'fake_completed');
    result = await adapter.execute(request()); assert.equal(result.reason, 'restart_forbidden');
});

test('times out, observes cancel, discards late completion and exposes no runtime/network surface', async () => {
    let release!: (value: unknown) => void; let cancelled = 0;
    const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const adapter = createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: () => pending,
        cancel: () => { cancelled += 1; return Promise.reject(new Error('private')); } });
    const started = performance.now(); const result = await adapter.execute(request());
    assert.equal(result.reason, 'timeout'); assert.equal(cancelled, 0);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS - 5 && elapsed < 500);
    release(output()); await new Promise((resolve) => setImmediate(resolve)); assert.equal(cancelled, 1);
    assert.equal((await adapter.execute(request())).reason, 'restart_forbidden');
    const source = readFileSync(new URL('./deepseek-ocr2-runtime-preflight.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|https?:|child_process|spawn\(|exec\(|readFile|writeFile|trust_remote_code|Apple Vision|Ollama|app\/api|dbServer|lib\/schema/iu);
    assert.doesNotMatch(source, /AbortSignal|process\.env|modelPath|endpoint|markdown/iu);
    assert.equal(createDeepSeekOcr2FakeAdapter.length, 1);
});

test('terminalizes timeout before observing a synchronous blocking fake cancel', async () => {
    let cancelStarted = false; let cancelFinished = false;
    const pending = new Promise<unknown>(() => undefined);
    const adapter = createDeepSeekOcr2FakeAdapter({ kind: 'test_fake', run: () => pending, cancel: () => {
        cancelStarted = true; const until = performance.now() + 80;
        while (performance.now() < until) { /* cooperative fake stall */ }
        cancelFinished = true; return Promise.reject(new Error('private'));
    } });
    const started = performance.now(); const result = await adapter.execute(request());
    const elapsed = performance.now() - started;
    assert.equal(result.reason, 'timeout'); assert.equal(cancelStarted, false);
    assert.ok(elapsed < DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS + 45);
    await new Promise((resolve) => setImmediate(resolve)); assert.equal(cancelFinished, true);
    assert.equal((await adapter.execute(request())).reason, 'restart_forbidden');
});
