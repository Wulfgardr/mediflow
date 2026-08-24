/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from '../../attachment-payload';
import { systemAppleVisionOcrRunner } from './local-ocr-apple-vision-process-runner';
import { createLocalOcrExecutionContract, type LocalOcrExecutionResult } from './local-ocr-execution-contract';

const MAX_OUTPUT_BYTES = 32 * 1024;
const MIN_RECOGNIZED_TEXT_CHARS = 3;

type Mode = 'full' | 'patient' | 'labs';
type Request = Readonly<{ evidence: unknown; image: Readonly<{ source: 'host_attachment'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; payload: string }>; mode: Mode }>;
type ResultMeta = Readonly<{ fallback: 'denied_by_contract'; applyPolicy: 'none'; writesPerformed: 0 }>;

export type LocalOcrAppleVisionExecutionDenialCode =
    | 'request_invalid' | 'host_unavailable' | 'host_evidence_invalid'
    | 'platform_unavailable' | 'execution_failed' | 'recognition_unavailable';

export type LocalOcrAppleVisionExecutionResult = ResultMeta & (
    | Extract<LocalOcrExecutionResult, Readonly<{ status: 'succeeded' }>>
    | Readonly<{ status: 'denied'; code: LocalOcrAppleVisionExecutionDenialCode; binding: null; mode: null; output: null; receipt: null; provenance: null }>
);

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

function deny(code: LocalOcrAppleVisionExecutionDenialCode): LocalOcrAppleVisionExecutionResult {
    return Object.freeze({ status: 'denied' as const, code, binding: null, mode: null, output: null, receipt: null, provenance: null,
        fallback: 'denied_by_contract' as const, applyPolicy: 'none' as const, writesPerformed: 0 as const });
}

function snapshotRequest(value: unknown): Request | null {
    const input = record(value, ['evidence', 'image', 'mode']);
    const image = input && record(input.image, ['source', 'mimeType', 'payload']);
    if (!input || !image || image.source !== 'host_attachment'
        || (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/webp')
        || typeof image.payload !== 'string' || !image.payload || image.payload.startsWith('ENC:') || image.payload.startsWith('data:')
        || (input.mode !== 'full' && input.mode !== 'patient' && input.mode !== 'labs')) return null;
    const size = getAttachmentPayloadByteSize(image.payload);
    const payload = Buffer.from(image.payload, 'base64');
    if (!size.ok || size.size <= 0 || size.size > resolveMaxAttachmentBytes() || payload.length === 0 || payload.length > resolveMaxAttachmentBytes()) return null;
    return Object.freeze({ evidence: input.evidence, image: Object.freeze({ source: 'host_attachment' as const, mimeType: image.mimeType, payload: image.payload }), mode: input.mode });
}

function isAcceptedAppleVisionEnvelope(request: Request): boolean {
    const result = createLocalOcrExecutionContract().freeze({ ...request, outcome: { kind: 'success', text: 'ok' } });
    return result.status === 'succeeded' && result.binding.provider === 'apple_vision' && result.binding.venue === 'on_device';
}

function recognizedText(value: string): string | null {
    try {
        const output = record(JSON.parse(value), ['ok', 'engine', 'avg_confidence', 'text']);
        if (!output || output.ok !== true || output.engine !== 'apple_vision' || typeof output.avg_confidence !== 'number'
            || !Number.isFinite(output.avg_confidence) || output.avg_confidence < 0 || output.avg_confidence > 1 || typeof output.text !== 'string') return null;
        const text = output.text.trim();
        return text.length >= MIN_RECOGNIZED_TEXT_CHARS && text.length <= MAX_OUTPUT_BYTES ? text : null;
    } catch { return null; }
}

/** Server-only X0 executor: exact host evidence and one fixed Apple Vision system runner. */
export function createLocalOcrAppleVisionExecutionAdapter(options: unknown) {
    const snapshot = record(options, ['readHostEvidence']);
    const candidate = snapshot?.readHostEvidence;
    const readHostEvidence = typeof candidate === 'function' && !types.isProxy(candidate) ? candidate as () => Promise<unknown> : null;
    return Object.freeze({
        async execute(value: unknown): Promise<LocalOcrAppleVisionExecutionResult> {
            const request = snapshotRequest(value);
            if (!request || !isAcceptedAppleVisionEnvelope(request)) return deny('request_invalid');
            if (!readHostEvidence) return deny('host_unavailable');
            let hostEvidence: unknown;
            try { hostEvidence = await readHostEvidence(); } catch { return deny('host_unavailable'); }
            if (hostEvidence === null || hostEvidence === undefined) return deny('host_unavailable');
            if (hostEvidence !== request.evidence) return deny('host_evidence_invalid');
            if (process.platform !== 'darwin') return deny('platform_unavailable');
            let executed: Awaited<ReturnType<typeof systemAppleVisionOcrRunner.run>>;
            try { executed = await systemAppleVisionOcrRunner.run({ mimeType: request.image.mimeType, payload: request.image.payload }); } catch { return deny('execution_failed'); }
            if (executed.status === 'failed') return deny('execution_failed');
            const text = recognizedText(executed.output);
            if (!text) return deny('recognition_unavailable');
            const frozen = createLocalOcrExecutionContract().freeze({ ...request, outcome: { kind: 'success', text } });
            return frozen.status === 'succeeded' ? frozen : deny('recognition_unavailable');
        },
    });
}
