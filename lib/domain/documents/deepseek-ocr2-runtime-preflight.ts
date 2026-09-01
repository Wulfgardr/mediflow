/* @Codex */
import { createHash } from 'node:crypto';
import { statfsSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { types } from 'node:util';

import { ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';
import { ANYDOC_PDF_PAGE_RENDERER_DPI, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
    ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS, ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS,
    ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES, ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS,
    ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID } from './anydoc-pdf-page-renderer';

export const DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.artifact_manifest.v1' as const;
export const DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.runtime_preflight.v1' as const;
export const DEEPSEEK_OCR2_FAKE_ADAPTER_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.fake_adapter.v1' as const;
export const DEEPSEEK_OCR2_FAKE_RECEIPT_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.fake_receipt.v1' as const;
export const DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS = 50;
export const DEEPSEEK_OCR2_MAX_OUTPUT_BYTES = 1024 * 1024;
const GIB = 1024 ** 3; const SHA256 = /^[a-f0-9]{64}$/u;
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

const source = Object.freeze({ repository: 'deepseek-ai/DeepSeek-OCR-2', revision: '2f3699ebbb96fa8af32212e8c170f2cc28730fad',
    archiveSha256: '9476e0418ed9f644353dd7a51f089d09df5e217365bc87c72a672eb0fb054b9b', archiveByteLength: 1_093_998 });
const model = Object.freeze({ id: 'deepseek-ai/DeepSeek-OCR-2', revision: 'aaa02f3811945a91062062994c5c4a3f4c0af2b0',
    digestSha256: 'd8ff67a424ba6f4dd077885eb9d6a05d2537e76fe5491f0e2a9b712f8c8870fa',
    weightFile: 'model-00001-of-000001.safetensors', weightByteLength: 6_778_573_880 });
const backendProfile = Object.freeze({ id: 'mediflow.deepseek_ocr2.transformers_nvidia_cuda11_8.v1',
    policyOrigin: 'mediflow_unbenchmarked_v1', qualification: 'preflight_only', operatingSystem: 'linux', architecture: 'x64',
    acceleratorVendor: 'nvidia', computeBackend: 'cuda', pythonVersion: '3.12.9', cudaVersion: '11.8',
    pytorchVersion: '2.6.0', transformersVersion: '4.46.3', tokenizersVersion: '0.20.3', flashAttentionVersion: '2.7.3',
    minimumHostMemoryBytes: 32 * GIB, minimumAcceleratorMemoryBytes: 16 * GIB, minimumTemporaryStorageBytes: 16 * GIB,
    maximumRasterBytes: ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES, maximumDimensionPixels: ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS,
    maximumPixels: ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS, maximumOutputBytes: DEEPSEEK_OCR2_MAX_OUTPUT_BYTES, concurrency: 1 });
export const DEEPSEEK_OCR2_ARTIFACT_MANIFEST = Object.freeze({ schemaVersion: DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactId: 'mediflow.ocr.deepseek_ocr2.page.v1', provenance: 'official_deepseek_github_and_huggingface',
    license: 'Apache-2.0', source, model, backendProfile });
const MANIFEST_CANONICAL = JSON.stringify(DEEPSEEK_OCR2_ARTIFACT_MANIFEST);
export const DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256 = '6e9cb4e2e627440cefa50e0b70050872368a93e6256e3cd62f65ecdaa3113e80';

type Exact = Record<string, unknown>;
export type DeepSeekOcr2PreflightStatus = 'test_adapter_eligible' | 'HOLD_HARDWARE_UPSTREAM_RUNTIME'
    | 'runtime_profile_unqualified' | 'review_required';
export type DeepSeekOcr2PreflightReason = 'test_only' | 'nvidia_cuda_upstream_required' | 'insufficient_resources'
    | 'runtime_or_artifact_drift' | 'qualification_missing' | 'invalid_manifest' | 'invalid_runtime_evidence';
export interface DeepSeekOcr2PreflightDecision { readonly schemaVersion: typeof DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION;
    readonly status: DeepSeekOcr2PreflightStatus; readonly reason: DeepSeekOcr2PreflightReason;
    readonly manifestSha256: string | null; readonly runtimeProfileId: string | null; readonly evidenceSha256: string | null;
    readonly review: 'required'; readonly writes: 0; readonly apply: 'none' }
export type DeepSeekOcr2FakeAdapterFailure = 'invalid_engine' | 'invalid_request' | 'invalid_manifest'
    | 'invalid_renderer_receipt' | 'binding_mismatch' | 'invalid_preflight' | 'preflight_denied'
    | 'invalid_engine_promise' | 'engine_failure' | 'timeout' | 'invalid_output' | 'restart_forbidden';
export interface DeepSeekOcr2FakeReceipt { readonly schemaVersion: typeof DEEPSEEK_OCR2_FAKE_RECEIPT_SCHEMA_VERSION;
    readonly adapter: 'test_fake'; readonly manifestSha256: string; readonly runtimeProfileId: string;
    readonly preflightStatus: 'test_adapter_eligible'; readonly preflightDecisionSha256: string;
    readonly currentnessSha256: string; readonly rendererReceiptSha256: string; readonly documentSourceRef: string;
    readonly documentRevision: number; readonly documentFreshnessEpoch: number; readonly sourceSha256: string;
    readonly page: number; readonly rendererSha256: string; readonly rasterSha256: string; readonly outputSha256: string;
    readonly outputByteLength: number; readonly timeoutMs: typeof DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS;
    readonly review: 'required'; readonly writes: 0; readonly apply: 'none' }
export interface DeepSeekOcr2FakeAdapterResult { readonly schemaVersion: typeof DEEPSEEK_OCR2_FAKE_ADAPTER_SCHEMA_VERSION;
    readonly status: 'fake_completed' | 'review_required'; readonly reason: DeepSeekOcr2FakeAdapterFailure | null;
    readonly output: string | null; readonly receipt: DeepSeekOcr2FakeReceipt | null;
    readonly review: 'required'; readonly writes: 0; readonly apply: 'none' }

function exact(value: unknown, keys: readonly string[]): Exact | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value); if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
        const output: Exact = Object.create(null);
        for (const key of keys) { const descriptor = descriptors[key];
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null; output[key] = descriptor.value; }
        return output;
    } catch { return null; }
}
function manifestSnapshot(value: unknown): typeof DEEPSEEK_OCR2_ARTIFACT_MANIFEST | null {
    const root = exact(value, ['schemaVersion', 'artifactId', 'provenance', 'license', 'source', 'model', 'backendProfile']);
    const sourceValue = exact(root?.source, ['repository', 'revision', 'archiveSha256', 'archiveByteLength']);
    const modelValue = exact(root?.model, ['id', 'revision', 'digestSha256', 'weightFile', 'weightByteLength']);
    const profileValue = exact(root?.backendProfile, ['id', 'policyOrigin', 'qualification', 'operatingSystem', 'architecture',
        'acceleratorVendor', 'computeBackend', 'pythonVersion', 'cudaVersion', 'pytorchVersion', 'transformersVersion',
        'tokenizersVersion', 'flashAttentionVersion', 'minimumHostMemoryBytes', 'minimumAcceleratorMemoryBytes',
        'minimumTemporaryStorageBytes', 'maximumRasterBytes', 'maximumDimensionPixels', 'maximumPixels',
        'maximumOutputBytes', 'concurrency']);
    if (!root || !sourceValue || !modelValue || !profileValue) return null;
    const canonical = JSON.stringify({ schemaVersion: root.schemaVersion, artifactId: root.artifactId,
        provenance: root.provenance, license: root.license, source: sourceValue, model: modelValue, backendProfile: profileValue });
    return canonical === MANIFEST_CANONICAL && sha256(canonical) === DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256
        ? DEEPSEEK_OCR2_ARTIFACT_MANIFEST : null;
}
const EVIDENCE_KEYS = ['mode', 'operatingSystem', 'architecture', 'hostMemoryBytes', 'temporaryStorageBytes',
    'acceleratorVendor', 'acceleratorMemoryBytes', 'computeBackend', 'pythonVersion', 'cudaVersion', 'pytorchVersion',
    'transformersVersion', 'tokenizersVersion', 'flashAttentionVersion', 'modelDigestSha256'] as const;
function evidenceSnapshot(value: unknown): Exact | null {
    const input = exact(value, EVIDENCE_KEYS); if (!input || (input.mode !== 'synthetic_test' && input.mode !== 'local_probe')) return null;
    for (const key of ['operatingSystem', 'architecture', 'acceleratorVendor', 'computeBackend'] as const)
        if (typeof input[key] !== 'string' || input[key].length < 1 || input[key].length > 64) return null;
    for (const key of ['hostMemoryBytes', 'temporaryStorageBytes'] as const)
        if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) return null;
    if (input.acceleratorMemoryBytes !== null
        && (!Number.isSafeInteger(input.acceleratorMemoryBytes) || (input.acceleratorMemoryBytes as number) < 0)) return null;
    for (const key of ['pythonVersion', 'cudaVersion', 'pytorchVersion', 'transformersVersion', 'tokenizersVersion',
        'flashAttentionVersion'] as const) if (input[key] !== null && typeof input[key] !== 'string') return null;
    if (input.modelDigestSha256 !== null && (typeof input.modelDigestSha256 !== 'string' || !SHA256.test(input.modelDigestSha256))) return null;
    return Object.freeze(input);
}
function decision(status: DeepSeekOcr2PreflightStatus, reason: DeepSeekOcr2PreflightReason,
    manifestSha256: string | null, runtimeProfileId: string | null, evidenceSha256: string | null): DeepSeekOcr2PreflightDecision {
    return Object.freeze({ schemaVersion: DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION, status, reason, manifestSha256,
        runtimeProfileId, evidenceSha256, review: 'required', writes: 0, apply: 'none' });
}
export function evaluateDeepSeekOcr2RuntimePreflight(manifestInput: unknown, evidenceInput: unknown): DeepSeekOcr2PreflightDecision {
    const manifest = manifestSnapshot(manifestInput); if (!manifest) return decision('review_required', 'invalid_manifest', null, null, null);
    const evidence = evidenceSnapshot(evidenceInput); if (!evidence) return decision('review_required', 'invalid_runtime_evidence',
        DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256, manifest.backendProfile.id, null);
    const profile = manifest.backendProfile; const evidenceSha256 = sha256(JSON.stringify(evidence));
    if (evidence.operatingSystem !== profile.operatingSystem || evidence.architecture !== profile.architecture
        || evidence.acceleratorVendor !== profile.acceleratorVendor || evidence.computeBackend !== profile.computeBackend)
        return decision('HOLD_HARDWARE_UPSTREAM_RUNTIME', 'nvidia_cuda_upstream_required',
            DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256, profile.id, evidenceSha256);
    if ((evidence.hostMemoryBytes as number) < profile.minimumHostMemoryBytes
        || (evidence.temporaryStorageBytes as number) < profile.minimumTemporaryStorageBytes
        || typeof evidence.acceleratorMemoryBytes !== 'number'
        || evidence.acceleratorMemoryBytes < profile.minimumAcceleratorMemoryBytes)
        return decision('runtime_profile_unqualified', 'insufficient_resources', DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
            profile.id, evidenceSha256);
    if (evidence.pythonVersion !== profile.pythonVersion || evidence.cudaVersion !== profile.cudaVersion
        || evidence.pytorchVersion !== profile.pytorchVersion || evidence.transformersVersion !== profile.transformersVersion
        || evidence.tokenizersVersion !== profile.tokenizersVersion || evidence.flashAttentionVersion !== profile.flashAttentionVersion
        || evidence.modelDigestSha256 !== manifest.model.digestSha256)
        return decision('runtime_profile_unqualified', 'runtime_or_artifact_drift', DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
            profile.id, evidenceSha256);
    return evidence.mode === 'synthetic_test'
        ? decision('test_adapter_eligible', 'test_only', DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256, profile.id, evidenceSha256)
        : decision('runtime_profile_unqualified', 'qualification_missing', DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
            profile.id, evidenceSha256);
}
function temporaryStorageBytes(): number {
    try { const value = statfsSync(tmpdir()); const bytes = Number(value.bavail) * Number(value.bsize);
        return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0; } catch { return 0; }
}
export function preflightCurrentDeepSeekOcr2Runtime(): DeepSeekOcr2PreflightDecision {
    const apple = process.platform === 'darwin' && process.arch === 'arm64'
        && cpus().some((cpu) => cpu.model.toLowerCase().includes('apple'));
    return evaluateDeepSeekOcr2RuntimePreflight(DEEPSEEK_OCR2_ARTIFACT_MANIFEST, { mode: 'local_probe',
        operatingSystem: process.platform, architecture: process.arch, hostMemoryBytes: totalmem(),
        temporaryStorageBytes: temporaryStorageBytes(), acceleratorVendor: apple ? 'apple' : 'unknown',
        acceleratorMemoryBytes: null, computeBackend: apple ? 'metal' : 'unknown', pythonVersion: null, cudaVersion: null,
        pytorchVersion: null, transformersVersion: null, tokenizersVersion: null, flashAttentionVersion: null,
        modelDigestSha256: null });
}

const RECEIPT_KEYS = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength',
    'page', 'admission', 'pageSha256', 'pageByteLength', 'routingSha256', 'materializerSha256', 'rendererProfileId',
    'rendererSha256', 'engine', 'engineVersion', 'engineSha256', 'backend', 'backendVersion', 'backendSha256',
    'backendProfile', 'backendProfileSha256', 'format', 'dpi', 'widthPixels', 'heightPixels', 'pixelCount', 'rasterSha256',
    'rasterByteLength', 'durationMs', 'timeoutMs'] as const;
function rendererSnapshot(value: unknown): { page: number; bytes: Buffer; receipt: Exact } | null {
    const input = exact(value, ['page', 'pngBytes', 'receipt']); const receipt = exact(input?.receipt, RECEIPT_KEYS);
    if (!input || !receipt || types.isProxy(input.pngBytes) || !Buffer.isBuffer(input.pngBytes)
        || !Number.isSafeInteger(input.page) || (input.page as number) < 1 || receipt.page !== input.page
        || typeof receipt.documentSourceRef !== 'string' || !SHA256.test(receipt.documentSourceRef)
        || !Number.isSafeInteger(receipt.documentRevision) || (receipt.documentRevision as number) < 1
        || !Number.isSafeInteger(receipt.documentFreshnessEpoch) || (receipt.documentFreshnessEpoch as number) < 1
        || typeof receipt.sourceSha256 !== 'string' || !SHA256.test(receipt.sourceSha256)
        || !Number.isSafeInteger(receipt.sourceByteLength) || (receipt.sourceByteLength as number) < 1
        || receipt.admission !== 'needsOcr' || receipt.materializerSha256 !== ANYDOC_PDF_PAGE_MATERIALIZER_SHA256
        || typeof receipt.pageSha256 !== 'string' || !SHA256.test(receipt.pageSha256)
        || !Number.isSafeInteger(receipt.pageByteLength) || (receipt.pageByteLength as number) < 1
        || typeof receipt.routingSha256 !== 'string' || !SHA256.test(receipt.routingSha256)
        || receipt.rendererProfileId !== ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID
        || receipt.rendererSha256 !== ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256
        || receipt.engine !== 'pdfjs-dist' || receipt.engineVersion !== '4.10.38'
        || receipt.engineSha256 !== '1011b38553532d7078c59f26b15a471f8dae00f101b60e2add9b8511737a1ce0'
        || receipt.backend !== '@napi-rs/canvas' || receipt.backendVersion !== '0.1.100'
        || receipt.backendSha256 !== 'ec7dc504d4ade7fd36846d16643e50eed5c914335f3a86b6a2a8d632391e5bfa'
        || receipt.backendProfile !== '@napi-rs/canvas-darwin-arm64'
        || receipt.backendProfileSha256 !== 'c7c8dcb69aae6ddb58fe23e5f20d1c772a8065b077560f5a18336307779add91'
        || receipt.format !== 'png'
        || receipt.dpi !== ANYDOC_PDF_PAGE_RENDERER_DPI || receipt.timeoutMs !== ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS
        || !Number.isSafeInteger(receipt.widthPixels) || (receipt.widthPixels as number) < 1
        || (receipt.widthPixels as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS
        || !Number.isSafeInteger(receipt.heightPixels) || (receipt.heightPixels as number) < 1
        || (receipt.heightPixels as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS
        || receipt.pixelCount !== (receipt.widthPixels as number) * (receipt.heightPixels as number)
        || (receipt.pixelCount as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS
        || typeof receipt.rasterSha256 !== 'string' || !SHA256.test(receipt.rasterSha256)
        || receipt.rasterByteLength !== input.pngBytes.byteLength || input.pngBytes.byteLength < 8
        || input.pngBytes.byteLength > ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES
        || typeof receipt.durationMs !== 'number' || !Number.isFinite(receipt.durationMs)
        || receipt.durationMs < 0 || receipt.durationMs > ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS) return null;
    const bytes = Buffer.from(input.pngBytes); if (sha256(bytes) !== receipt.rasterSha256) return null;
    if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))) return null;
    return Object.freeze({ page: input.page as number, bytes, receipt: Object.freeze(receipt) });
}
function currentnessSnapshot(value: unknown): Exact | null {
    const input = exact(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength']);
    if (!input || typeof input.documentSourceRef !== 'string' || !SHA256.test(input.documentSourceRef)
        || !Number.isSafeInteger(input.documentRevision) || (input.documentRevision as number) < 1
        || !Number.isSafeInteger(input.documentFreshnessEpoch) || (input.documentFreshnessEpoch as number) < 1
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || (input.sourceByteLength as number) < 1) return null;
    return Object.freeze(input);
}
function preflightSnapshot(value: unknown): Exact | null {
    const input = exact(value, ['schemaVersion', 'status', 'reason', 'manifestSha256', 'runtimeProfileId', 'evidenceSha256',
        'review', 'writes', 'apply']);
    if (!input || input.schemaVersion !== DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION || input.review !== 'required'
        || input.writes !== 0 || input.apply !== 'none' || typeof input.status !== 'string' || typeof input.reason !== 'string') return null;
    return Object.freeze(input);
}
function denied(reason: DeepSeekOcr2FakeAdapterFailure): DeepSeekOcr2FakeAdapterResult {
    return Object.freeze({ schemaVersion: DEEPSEEK_OCR2_FAKE_ADAPTER_SCHEMA_VERSION, status: 'review_required', reason,
        output: null, receipt: null, review: 'required', writes: 0, apply: 'none' });
}
function engineSnapshot(value: unknown): { run: (...input: unknown[]) => unknown; cancel: (...input: unknown[]) => unknown } | null {
    const input = exact(value, ['kind', 'run', 'cancel']); return input?.kind === 'test_fake'
        && typeof input.run === 'function' && typeof input.cancel === 'function'
        ? { run: input.run as (...input: unknown[]) => unknown, cancel: input.cancel as (...input: unknown[]) => unknown } : null;
}
function outputSnapshot(value: unknown): string | null {
    const input = exact(value, ['schemaVersion', 'status', 'text']); if (!input || input.schemaVersion !== 'mediflow.deepseek_ocr2.fake_output.v1'
        || input.status !== 'complete' || typeof input.text !== 'string' || input.text.length < 1
        || input.text !== input.text.normalize('NFC') || input.text.includes('\0')
        || Buffer.byteLength(input.text, 'utf8') > DEEPSEEK_OCR2_MAX_OUTPUT_BYTES) return null;
    return input.text;
}
function observeCancel(cancel: (...input: unknown[]) => unknown): void {
    try { const value = Reflect.apply(cancel, undefined, []); if (types.isProxy(value) || !types.isPromise(value)) return;
        Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]); } catch { /* denial is already terminal */ }
}
export function createDeepSeekOcr2FakeAdapter(engineInput: unknown): Readonly<{
    execute: (input: unknown) => Promise<DeepSeekOcr2FakeAdapterResult> }> {
    const engine = engineSnapshot(engineInput); let state: 'idle' | 'running' | 'terminal' = 'idle';
    const finish = (result: DeepSeekOcr2FakeAdapterResult) => { state = 'terminal'; return result; };
    return Object.freeze({ execute: async (value: unknown) => {
        if (state !== 'idle') return denied('restart_forbidden'); state = 'running';
        if (!engine) return finish(denied('invalid_engine'));
        const input = exact(value, ['manifest', 'rendererPage', 'currentness', 'preflight']);
        if (!input) return finish(denied('invalid_request'));
        const manifest = manifestSnapshot(input.manifest); if (!manifest) return finish(denied('invalid_manifest'));
        const renderer = rendererSnapshot(input.rendererPage); if (!renderer) return finish(denied('invalid_renderer_receipt'));
        const currentness = currentnessSnapshot(input.currentness); if (!currentness) return finish(denied('binding_mismatch'));
        for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength'] as const)
            if (renderer.receipt[key] !== currentness[key]) return finish(denied('binding_mismatch'));
        const preflight = preflightSnapshot(input.preflight); if (!preflight) return finish(denied('invalid_preflight'));
        if (preflight.status !== 'test_adapter_eligible' || preflight.reason !== 'test_only'
            || preflight.manifestSha256 !== DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256
            || preflight.runtimeProfileId !== manifest.backendProfile.id || typeof preflight.evidenceSha256 !== 'string'
            || !SHA256.test(preflight.evidenceSha256)) return finish(denied('preflight_denied'));
        const engineRequest = Object.freeze({ schemaVersion: 'mediflow.deepseek_ocr2.fake_request.v1', modelId: manifest.model.id,
            modelRevision: manifest.model.revision, modelDigestSha256: manifest.model.digestSha256,
            runtimeProfileId: manifest.backendProfile.id, page: renderer.page, rasterBytes: Buffer.from(renderer.bytes) });
        let promise: unknown; try { promise = Reflect.apply(engine.run, undefined, [engineRequest]); }
        catch { return finish(denied('engine_failure')); }
        try {
            if (types.isProxy(promise) || !types.isPromise(promise) || Object.getPrototypeOf(promise) !== Promise.prototype)
                return finish(denied('invalid_engine_promise'));
        } catch { return finish(denied('invalid_engine_promise')); }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observed = new Promise<{ kind: 'output'; value: unknown } | { kind: 'failure' }>((resolve) => {
            Reflect.apply(Promise.prototype.then, promise, [(result: unknown) => resolve({ kind: 'output', value: result }),
                () => resolve({ kind: 'failure' })]);
        });
        const timeout = new Promise<{ kind: 'timeout' }>((resolve) => { timer = setTimeout(() => {
            state = 'terminal'; resolve({ kind: 'timeout' }); setImmediate(() => observeCancel(engine.cancel));
        }, DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS); });
        const settled = await Promise.race([observed, timeout]); if (timer) clearTimeout(timer);
        if (settled.kind === 'timeout') return finish(denied('timeout'));
        if (settled.kind === 'failure') return finish(denied('engine_failure'));
        const text = outputSnapshot(settled.value); if (text === null) return finish(denied('invalid_output'));
        const receipt = Object.freeze({ schemaVersion: DEEPSEEK_OCR2_FAKE_RECEIPT_SCHEMA_VERSION, adapter: 'test_fake',
            manifestSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256, runtimeProfileId: manifest.backendProfile.id,
            preflightStatus: preflight.status, preflightDecisionSha256: sha256(JSON.stringify(preflight)),
            currentnessSha256: sha256(JSON.stringify(currentness)), rendererReceiptSha256: sha256(JSON.stringify(renderer.receipt)),
            documentSourceRef: currentness.documentSourceRef, documentRevision: currentness.documentRevision,
            documentFreshnessEpoch: currentness.documentFreshnessEpoch, sourceSha256: currentness.sourceSha256,
            page: renderer.page, rendererSha256: renderer.receipt.rendererSha256, rasterSha256: renderer.receipt.rasterSha256,
            outputSha256: sha256(text), outputByteLength: Buffer.byteLength(text, 'utf8'),
            timeoutMs: DEEPSEEK_OCR2_FAKE_ADAPTER_TIMEOUT_MS, review: 'required', writes: 0, apply: 'none' }) as DeepSeekOcr2FakeReceipt;
        return finish(Object.freeze({ schemaVersion: DEEPSEEK_OCR2_FAKE_ADAPTER_SCHEMA_VERSION, status: 'fake_completed',
            reason: null, output: text, receipt, review: 'required', writes: 0, apply: 'none' }));
    } });
}
