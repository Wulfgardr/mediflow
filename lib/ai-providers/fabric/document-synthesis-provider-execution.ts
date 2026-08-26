/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { buildDocumentSynthesisExtractionPrompt } from '@/lib/ai-task-contract-prompts';
import type { DocumentSynthesisOutput } from './document-synthesis-output-contract';
import { resolveDocumentSynthesisHostProjection, type DocumentSynthesisHostProjection } from './document-synthesis-host-projection';
import { claimDocumentSynthesisProviderBindingForExecution, type DocumentSynthesisProviderBindingReceipt } from './document-synthesis-provider-binding';
import { normalizeDocumentSynthesisProviderResponse } from './document-synthesis-provider-response';

const TIMEOUT_MS = 300_000;
const OBJECT = Object.prototype;
const COMMON = Object.freeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const, fallback: 'denied' as const });

type DenialCode = 'input_invalid' | 'binding_invalid' | 'binding_consumed' | 'provider_unavailable' | 'provider_timeout' | 'output_invalid';
type Receipt = DocumentSynthesisProviderBindingReceipt;
type Provenance = Readonly<{ sourceAuthority: 'not_bound'; modelDigestCausality: 'not_established' }>;
export type DocumentSynthesisProviderExecutionResult = Readonly<{ status: 'available'; code: null; output: DocumentSynthesisOutput; outputSha256: string; receipt: Receipt; provenance: Provenance } & typeof COMMON>
    | Readonly<{ status: 'denied'; code: DenialCode; output: null; outputSha256: null; receipt: null; provenance: null } & typeof COMMON>;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        const found = Reflect.ownKeys(value);
        if (found.length !== keys.length || !keys.every((key) => found.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function projection(value: unknown): DocumentSynthesisHostProjection | null {
    const source = record(value, ['schemaVersion', 'sourceKind', 'sourceText', 'classification', 'rationale']);
    if (!source) return null;
    try {
        const normalized = resolveDocumentSynthesisHostProjection({ sourceKind: source.sourceKind, sourceText: source.sourceText });
        if (source.schemaVersion !== normalized.schemaVersion || source.sourceKind !== normalized.sourceKind || source.sourceText !== normalized.sourceText
            || source.classification !== normalized.classification || source.rationale !== normalized.rationale) return null;
        return frozen({ ...normalized }) as DocumentSynthesisHostProjection;
    } catch { return null; }
}

function denied(code: DenialCode): DocumentSynthesisProviderExecutionResult {
    return frozen({ status: 'denied' as const, code, output: null, outputSha256: null, receipt: null, provenance: null, ...COMMON }) as DocumentSynthesisProviderExecutionResult;
}

/** Host-only, one-shot execution of a previously sealed local provider binding. */
export async function executeDocumentSynthesisProvider(value: unknown): Promise<DocumentSynthesisProviderExecutionResult> {
    const input = record(value, ['projection', 'providerToken']);
    const source = input && projection(input.projection);
    if (!input || !source) return denied('input_invalid');

    const token = input.providerToken;
    const binding = claimDocumentSynthesisProviderBindingForExecution(token);
    if (!binding) return denied('binding_invalid');
    const resolution = binding.resolution;

    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let onAbort: (() => void) | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
        onAbort = () => resolve('timeout');
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    const operation = Promise.resolve().then(() => resolution.adapter.chat(
        [{ role: 'user', content: buildDocumentSynthesisExtractionPrompt(source.sourceText) }], signal, 1400, { responseFormat: 'json' },
    ));
    const settled = await Promise.race([
        operation.then((response) => ({ kind: 'response' as const, response }), () => ({ kind: 'failure' as const })),
        expired,
    ]);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (settled === 'timeout') {
        void operation.then(() => undefined, () => undefined);
        return denied('provider_timeout');
    }
    if (settled.kind === 'failure') return denied('provider_unavailable');

    const response = record(settled.response, ['content', 'stats']);
    const normalized = normalizeDocumentSynthesisProviderResponse(response ? { content: response.content } : null);
    if (normalized.status !== 'available') return denied('output_invalid');
    const output = normalized.value;
    return frozen({
        status: 'available' as const,
        code: null,
        output,
        outputSha256: createHash('sha256').update(JSON.stringify(output), 'utf8').digest('hex'),
        receipt: binding.receipt,
        provenance: frozen({ sourceAuthority: 'not_bound' as const, modelDigestCausality: 'not_established' as const }) as Provenance,
        ...COMMON,
    }) as DocumentSynthesisProviderExecutionResult;
}
