/* @Codex */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

import { ANYDOC_PDF_PAGE_MATERIALIZER_SHA256 } from './anydoc-pdf-page-materializer';
import { ANYDOC_PDF_PAGE_RENDERER_DPI, ANYDOC_PDF_PAGE_RENDERER_ENGINE_SHA256,
    ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS, ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS,
    ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES, ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS,
    ANYDOC_PDF_PAGE_RENDERER_RUNTIME_PROFILE_ID } from './anydoc-pdf-page-renderer';
import { DEEPSEEK_OCR2_ARTIFACT_MANIFEST, DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
    DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION } from './deepseek-ocr2-runtime-preflight';

export const DEEPSEEK_OCR2_OFFICIAL_ADAPTER_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.official_adapter.v1' as const;
export const DEEPSEEK_OCR2_OFFICIAL_RECEIPT_SCHEMA_VERSION = 'mediflow.deepseek_ocr2.official_receipt.v1' as const;
export const DEEPSEEK_OCR2_OFFICIAL_ADAPTER_TIMEOUT_MS = DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.pageTimeoutMs;
export type DeepSeekOcr2OfficialAdapterFailure = 'invalid_engine' | 'invalid_request' | 'invalid_manifest'
    | 'invalid_renderer_receipt' | 'binding_mismatch' | 'invalid_preflight' | 'preflight_denied'
    | 'invalid_engine_promise' | 'engine_failure' | 'timeout' | 'cancelled' | 'invalid_output'
    | 'resource_limit' | 'low_quality' | 'restart_forbidden';
export interface DeepSeekOcr2OfficialReceipt {
    readonly schemaVersion: typeof DEEPSEEK_OCR2_OFFICIAL_RECEIPT_SCHEMA_VERSION;
    readonly adapter: 'official_local_contract'; readonly runtimeQualification: 'synthetic_contract_only';
    readonly manifestSha256: string; readonly runtimeProfileId: string;
    readonly preflightStatus: 'test_adapter_eligible'; readonly preflightDecisionSha256: string;
    readonly currentnessSha256: string; readonly rendererReceiptSha256: string;
    readonly documentSourceRef: string; readonly documentRevision: number; readonly documentFreshnessEpoch: number;
    readonly sourceSha256: string; readonly page: number; readonly rendererSha256: string; readonly rasterSha256: string;
    readonly outputSha256: string; readonly outputByteLength: number; readonly outputTokenCount: number;
    readonly peakResidentMemoryBytes: number; readonly qualityValidatorVersion: string; readonly qualityPermille: number;
    readonly durationMs: number; readonly timeoutMs: number; readonly review: 'required'; readonly writes: 0;
    readonly apply: 'none';
}
export interface DeepSeekOcr2OfficialAdapterResult {
    readonly schemaVersion: typeof DEEPSEEK_OCR2_OFFICIAL_ADAPTER_SCHEMA_VERSION;
    readonly status: 'contract_completed' | 'review_required'; readonly reason: DeepSeekOcr2OfficialAdapterFailure | null;
    readonly output: string | null; readonly receipt: DeepSeekOcr2OfficialReceipt | null;
    readonly review: 'required'; readonly writes: 0; readonly apply: 'none';
}

type Exact = Record<string, unknown>;
type Engine = Readonly<{ run: (...input: unknown[]) => unknown; terminate: (...input: unknown[]) => unknown;
    kill: (...input: unknown[]) => unknown }>;
type RendererSnapshot = Readonly<{ page: number; bytes: Buffer; receipt: Exact }>;
type TerminalKind = 'timeout' | 'cancelled';
type RetirementReason = TerminalKind | 'invalid_engine_promise' | 'engine_failure';
const SHA256 = /^[a-f0-9]{64}$/u;
const RECEIPT_KEYS = ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength',
    'page', 'admission', 'pageSha256', 'pageByteLength', 'routingSha256', 'materializerSha256', 'rendererProfileId',
    'rendererSha256', 'engine', 'engineVersion', 'engineSha256', 'backend', 'backendVersion', 'backendSha256',
    'backendProfile', 'backendProfileSha256', 'format', 'dpi', 'widthPixels', 'heightPixels', 'pixelCount', 'rasterSha256',
    'rasterByteLength', 'durationMs', 'timeoutMs'] as const;
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

function exactFrozen(value: unknown, keys: readonly string[]): Exact | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== Object.prototype || !Object.isFrozen(value)) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
        const output: Exact = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}
function nativePromise(value: unknown): Promise<unknown> | null {
    try {
        return !types.isProxy(value) && types.isPromise(value) && Object.getPrototypeOf(value) === Promise.prototype
            ? value as Promise<unknown> : null;
    } catch { return null; }
}
function engineSnapshot(value: unknown): Engine | null {
    const input = exactFrozen(value, ['kind', 'run', 'terminate', 'kill']);
    if (!input || input.kind !== 'official_local_process') return null;
    for (const key of ['run', 'terminate', 'kill'] as const)
        if (typeof input[key] !== 'function' || types.isProxy(input[key])) return null;
    return Object.freeze({ run: input.run as (...input: unknown[]) => unknown,
        terminate: input.terminate as (...input: unknown[]) => unknown,
        kill: input.kill as (...input: unknown[]) => unknown });
}
function rendererSnapshot(value: unknown): RendererSnapshot | null {
    const input = exactFrozen(value, ['page', 'pngBytes', 'receipt']);
    const receipt = exactFrozen(input?.receipt, RECEIPT_KEYS);
    if (!input || !receipt || types.isProxy(input.pngBytes) || !Buffer.isBuffer(input.pngBytes)
        || Object.getPrototypeOf(input.pngBytes) !== Buffer.prototype
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
        || receipt.format !== 'png' || receipt.dpi !== ANYDOC_PDF_PAGE_RENDERER_DPI
        || receipt.timeoutMs !== ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS
        || !Number.isSafeInteger(receipt.widthPixels) || (receipt.widthPixels as number) < 1
        || (receipt.widthPixels as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS
        || !Number.isSafeInteger(receipt.heightPixels) || (receipt.heightPixels as number) < 1
        || (receipt.heightPixels as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_DIMENSION_PIXELS
        || receipt.pixelCount !== (receipt.widthPixels as number) * (receipt.heightPixels as number)
        || (receipt.pixelCount as number) > ANYDOC_PDF_PAGE_RENDERER_MAX_PIXELS
        || typeof receipt.rasterSha256 !== 'string' || !SHA256.test(receipt.rasterSha256)
        || receipt.rasterByteLength !== (input.pngBytes as Buffer).byteLength
        || (input.pngBytes as Buffer).byteLength < 8 || (input.pngBytes as Buffer).byteLength > ANYDOC_PDF_PAGE_RENDERER_MAX_RASTER_BYTES
        || typeof receipt.durationMs !== 'number' || !Number.isFinite(receipt.durationMs)
        || receipt.durationMs < 0 || receipt.durationMs > ANYDOC_PDF_PAGE_RENDERER_PAGE_TIMEOUT_MS) return null;
    const bytes = Buffer.from(input.pngBytes as Buffer);
    if (sha256(bytes) !== receipt.rasterSha256
        || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))) return null;
    return Object.freeze({ page: input.page as number, bytes, receipt: Object.freeze(receipt) });
}
function currentnessSnapshot(value: unknown): Exact | null {
    const input = exactFrozen(value, ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch',
        'sourceSha256', 'sourceByteLength']);
    if (!input || typeof input.documentSourceRef !== 'string' || !SHA256.test(input.documentSourceRef)
        || !Number.isSafeInteger(input.documentRevision) || (input.documentRevision as number) < 1
        || !Number.isSafeInteger(input.documentFreshnessEpoch) || (input.documentFreshnessEpoch as number) < 1
        || typeof input.sourceSha256 !== 'string' || !SHA256.test(input.sourceSha256)
        || !Number.isSafeInteger(input.sourceByteLength) || (input.sourceByteLength as number) < 1) return null;
    return Object.freeze(input);
}
function preflightSnapshot(value: unknown): Exact | null {
    const input = exactFrozen(value, ['schemaVersion', 'status', 'reason', 'manifestSha256', 'runtimeProfileId',
        'evidenceSha256', 'review', 'writes', 'apply']);
    if (!input || input.schemaVersion !== DEEPSEEK_OCR2_PREFLIGHT_SCHEMA_VERSION || input.review !== 'required'
        || input.writes !== 0 || input.apply !== 'none') return null;
    return Object.freeze(input);
}
function denied(reason: DeepSeekOcr2OfficialAdapterFailure): DeepSeekOcr2OfficialAdapterResult {
    return Object.freeze({ schemaVersion: DEEPSEEK_OCR2_OFFICIAL_ADAPTER_SCHEMA_VERSION, status: 'review_required', reason,
        output: null, receipt: null, review: 'required', writes: 0, apply: 'none' });
}
function outputSnapshot(value: unknown): Readonly<{ text: string; outputTokenCount: number;
    peakResidentMemoryBytes: number; qualityPermille: number }> | DeepSeekOcr2OfficialAdapterFailure {
    const input = exactFrozen(value, ['schemaVersion', 'status', 'text', 'outputTokenCount', 'peakResidentMemoryBytes']);
    if (!input || input.schemaVersion !== 'mediflow.deepseek_ocr2.official_process_output.v1'
        || input.status !== 'complete' || typeof input.text !== 'string' || input.text.trim().length < 1
        || input.text !== input.text.normalize('NFC') || input.text.includes('\0') || input.text.includes('\r')
        || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.text)) return 'invalid_output';
    const bytes = Buffer.byteLength(input.text, 'utf8');
    if (bytes > DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputBytes
        || !Number.isSafeInteger(input.outputTokenCount) || (input.outputTokenCount as number) < 1
        || (input.outputTokenCount as number) > DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputTokens
        || !Number.isSafeInteger(input.peakResidentMemoryBytes) || (input.peakResidentMemoryBytes as number) < 1
        || (input.peakResidentMemoryBytes as number) > DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumResidentMemoryBytes)
        return 'resource_limit';
    const meaningful = Array.from(input.text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
    const qualityPermille = Math.min(1_000, Math.floor(meaningful * 1_000
        / DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.minimumMeaningfulCharacters));
    if (qualityPermille < DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.minimumQualityPermille) return 'low_quality';
    return Object.freeze({ text: input.text, outputTokenCount: input.outputTokenCount as number,
        peakResidentMemoryBytes: input.peakResidentMemoryBytes as number, qualityPermille });
}
function observe(value: unknown, fulfilled: () => void = () => undefined): boolean {
    const promise = nativePromise(value); if (!promise) return false;
    Reflect.apply(Promise.prototype.then, promise, [fulfilled, () => undefined]); return true;
}

function createAdapter(engineInput: unknown, timeoutMs: number, terminationGraceMs: number): Readonly<{
    execute: (input: unknown) => Promise<DeepSeekOcr2OfficialAdapterResult>; cancel: () => boolean }> {
    const engine = engineSnapshot(engineInput); let state: 'idle' | 'running' | 'terminal' = 'idle';
    let terminalKind: TerminalKind | null = null; let terminalResolve: ((value: Readonly<{ kind: TerminalKind }>) => void) | null = null;
    let retainedRaster: Buffer | null = null; let retirementScheduled = false;
    const wipe = () => { if (retainedRaster) retainedRaster.fill(0); retainedRaster = null; };
    const scheduleRetirement = (reason: RetirementReason) => {
        if (!engine || retirementScheduled) return; retirementScheduled = true;
        setImmediate(() => {
            const force = () => { try { observe(Reflect.apply(engine.kill, undefined, [reason])); } catch { /* terminal */ } };
            const killTimer: ReturnType<typeof setTimeout> = setTimeout(force, terminationGraceMs);
            (killTimer as unknown as { unref?: () => void }).unref?.();
            try {
                const returned = Reflect.apply(engine.terminate, undefined, [reason]);
                if (observe(returned, () => clearTimeout(killTimer))) return;
            } catch { /* force timer remains authoritative */ }
        });
    };
    const terminalize = (kind: TerminalKind) => {
        if (state !== 'running') return false; state = 'terminal'; terminalKind = kind; wipe();
        terminalResolve?.(Object.freeze({ kind })); scheduleRetirement(kind); return true;
    };
    const retireFailure = (reason: Extract<RetirementReason, 'invalid_engine_promise' | 'engine_failure'>) => {
        if (state === 'running') { state = 'terminal'; wipe(); scheduleRetirement(reason); }
    };
    const finish = <T extends DeepSeekOcr2OfficialAdapterResult>(value: T): T => { state = 'terminal'; wipe(); return value; };
    const execute = async (value: unknown): Promise<DeepSeekOcr2OfficialAdapterResult> => {
        if (state !== 'idle') return denied('restart_forbidden'); state = 'running'; const startedAt = performance.now();
        const terminal = new Promise<Readonly<{ kind: TerminalKind }>>((resolve) => { terminalResolve = resolve; });
        if (!engine) return finish(denied('invalid_engine'));
        const input = exactFrozen(value, ['manifest', 'rendererPage', 'currentness', 'preflight']);
        if (!input) return finish(denied('invalid_request'));
        if (input.manifest !== DEEPSEEK_OCR2_ARTIFACT_MANIFEST) return finish(denied('invalid_manifest'));
        const renderer = rendererSnapshot(input.rendererPage); if (!renderer) return finish(denied('invalid_renderer_receipt'));
        const currentness = currentnessSnapshot(input.currentness); if (!currentness) return finish(denied('binding_mismatch'));
        for (const key of ['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSha256', 'sourceByteLength'] as const)
            if (renderer.receipt[key] !== currentness[key]) return finish(denied('binding_mismatch'));
        const preflight = preflightSnapshot(input.preflight); if (!preflight) return finish(denied('invalid_preflight'));
        if (preflight.status !== 'test_adapter_eligible' || preflight.reason !== 'test_only'
            || preflight.manifestSha256 !== DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256
            || preflight.runtimeProfileId !== DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.id
            || typeof preflight.evidenceSha256 !== 'string' || !SHA256.test(preflight.evidenceSha256))
            return finish(denied('preflight_denied'));
        retainedRaster = Buffer.from(renderer.bytes);
        const engineRequest = Object.freeze({ schemaVersion: 'mediflow.deepseek_ocr2.official_process_request.v1',
            artifactId: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.artifactId,
            sourceRevision: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.source.revision,
            sourceArchiveSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.source.archiveSha256,
            modelRevision: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.revision,
            modelDigestSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.model.digestSha256,
            runtimeProfileId: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.id,
            page: renderer.page, rasterBytes: retainedRaster, localFilesOnly: true, network: 'denied', fallback: 'none',
            trustRemoteCode: false, maximumOutputBytes: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputBytes,
            maximumOutputTokens: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumOutputTokens,
            maximumResidentMemoryBytes: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.maximumResidentMemoryBytes,
            timeoutMs });
        const timer = setTimeout(() => terminalize('timeout'), timeoutMs);
        let processPromise: unknown;
        try { processPromise = Reflect.apply(engine.run, undefined, [engineRequest]); }
        catch {
            clearTimeout(timer); if (terminalKind) return denied(terminalKind);
            retireFailure('engine_failure'); return denied('engine_failure');
        }
        if (terminalKind) { clearTimeout(timer); observe(processPromise); return denied(terminalKind); }
        const promise = nativePromise(processPromise);
        if (!promise) { clearTimeout(timer); retireFailure('invalid_engine_promise'); return denied('invalid_engine_promise'); }
        const observed = new Promise<Readonly<{ kind: 'output'; value: unknown } | { kind: 'failure' }>>((resolve) => {
            Reflect.apply(Promise.prototype.then, promise, [(output: unknown) => {
                if (state === 'running') resolve(Object.freeze({ kind: 'output', value: output }));
            }, () => { if (state === 'running') resolve(Object.freeze({ kind: 'failure' })); }]);
        });
        const settled = await Promise.race([observed, terminal]); clearTimeout(timer);
        if (settled.kind === 'timeout' || settled.kind === 'cancelled') return denied(settled.kind);
        if (state !== 'running' && terminalKind) return denied(terminalKind);
        if (settled.kind === 'failure') { retireFailure('engine_failure'); return denied('engine_failure'); }
        if (settled.kind !== 'output') return finish(denied('engine_failure'));
        if (performance.now() - startedAt >= timeoutMs) { terminalize('timeout'); return denied('timeout'); }
        const output = outputSnapshot(settled.value);
        if (typeof output === 'string') return finish(denied(output));
        if (performance.now() - startedAt >= timeoutMs) { terminalize('timeout'); return denied('timeout'); }
        const durationMs = Math.max(0, Math.min(timeoutMs, Math.ceil(performance.now() - startedAt)));
        const receipt = Object.freeze({ schemaVersion: DEEPSEEK_OCR2_OFFICIAL_RECEIPT_SCHEMA_VERSION,
            adapter: 'official_local_contract', runtimeQualification: 'synthetic_contract_only',
            manifestSha256: DEEPSEEK_OCR2_ARTIFACT_MANIFEST_SHA256,
            runtimeProfileId: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.id,
            preflightStatus: 'test_adapter_eligible', preflightDecisionSha256: sha256(JSON.stringify(preflight)),
            currentnessSha256: sha256(JSON.stringify(currentness)), rendererReceiptSha256: sha256(JSON.stringify(renderer.receipt)),
            documentSourceRef: currentness.documentSourceRef, documentRevision: currentness.documentRevision,
            documentFreshnessEpoch: currentness.documentFreshnessEpoch, sourceSha256: currentness.sourceSha256,
            page: renderer.page, rendererSha256: renderer.receipt.rendererSha256, rasterSha256: renderer.receipt.rasterSha256,
            outputSha256: sha256(output.text), outputByteLength: Buffer.byteLength(output.text, 'utf8'),
            outputTokenCount: output.outputTokenCount, peakResidentMemoryBytes: output.peakResidentMemoryBytes,
            qualityValidatorVersion: DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.qualityValidatorVersion,
            qualityPermille: output.qualityPermille, durationMs, timeoutMs, review: 'required', writes: 0, apply: 'none',
        }) as DeepSeekOcr2OfficialReceipt;
        return finish(Object.freeze({ schemaVersion: DEEPSEEK_OCR2_OFFICIAL_ADAPTER_SCHEMA_VERSION,
            status: 'contract_completed', reason: null, output: output.text, receipt,
            review: 'required', writes: 0, apply: 'none' }));
    };
    return Object.freeze({ execute, cancel: () => terminalize('cancelled') });
}

/** Official host-owned factory. It accepts no caller-selected runtime, artifact, network or limit controls. */
export function createDeepSeekOcr2OfficialRuntimeAdapter(engineInput: unknown) {
    return createAdapter(engineInput, DEEPSEEK_OCR2_OFFICIAL_ADAPTER_TIMEOUT_MS,
        DEEPSEEK_OCR2_ARTIFACT_MANIFEST.backendProfile.terminationGraceMs);
}
/** @internal Contract-test clock seam; it does not weaken the public factory. */
export const DEEPSEEK_OCR2_OFFICIAL_ADAPTER_INTERNAL_TEST_SEAM = Object.freeze({
    create: (engineInput: unknown) => createAdapter(engineInput, 20, 10),
});
