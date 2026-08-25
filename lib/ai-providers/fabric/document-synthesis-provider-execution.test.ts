/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDocumentSynthesisExtractionPrompt } from '@/lib/ai-task-contract-prompts.ts';
import { OllamaProviderAdapter } from '../ollama.ts';
import { createDocumentSynthesisProviderBindingForTest } from './document-synthesis-provider-binding.ts';
import { executeDocumentSynthesisProvider } from './document-synthesis-provider-execution.ts';

const SETTINGS = { aiProvider: 'ollama', aiModel_reasoning: 'reasoning-local', aiUrl: 'http://localhost:11434/v1' };
const ATTESTATION = { authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback', requestedModel: 'reasoning-local', canonicalModel: 'reasoning-local:latest', digest: 'sha256:synthetic', serverVersion: '0.32.5', checkedAt: '2026-08-25T12:00:00.000Z' };
const projection = { schemaVersion: 'mediflow.document-synthesis.host-projection.v1', sourceKind: 'ocr_text', sourceText: 'Synthetic OCR text.', classification: 'review_required', rationale: 'ocr_text_normalized' };
const output = () => ({ schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic review.', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } });

async function token(chat: OllamaProviderAdapter['chat']): Promise<{ value: object; restore(): void }> {
    const original = OllamaProviderAdapter.prototype.chat;
    OllamaProviderAdapter.prototype.chat = chat;
    const result = await createDocumentSynthesisProviderBindingForTest({ readSettings: async () => SETTINGS, attest: async () => ATTESTATION }).bind();
    assert.equal(result.status, 'available');
    if (result.status !== 'available') throw new Error('binding unavailable');
    return { value: result.token, restore() { OllamaProviderAdapter.prototype.chat = original; } };
}

function input(providerToken: object, value: object = projection) { return { projection: value, providerToken }; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function denied(result: Awaited<ReturnType<typeof executeDocumentSynthesisProvider>>, code: string) {
    assert.deepEqual({ ...result }, { status: 'denied', code, output: null, outputSha256: null, receipt: null, provenance: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none', fallback: 'denied' });
}

test('executes exactly the fixed prompt through a valid one-shot binding and seals the review-only result', async () => {
    const calls: unknown[][] = [];
    const bound = await token(async (...args) => { calls.push(args); return { content: JSON.stringify(output()), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; });
    try {
        const result = await executeDocumentSynthesisProvider(input(bound.value));
        assert.equal(result.status, 'available'); if (result.status !== 'available') return;
        assert.deepEqual(calls[0]?.[0], [{ role: 'user', content: buildDocumentSynthesisExtractionPrompt(projection.sourceText) }]);
        assert.equal(calls[0]?.[1] instanceof AbortSignal, true); assert.equal(calls[0]?.[2], 1400); assert.deepEqual(calls[0]?.[3], { responseFormat: 'json' });
        assert.equal(result.outputSha256, hash(result.output));
        assert.deepEqual({ ...result.receipt }, { capability: 'document_synthesis', task: 'reasoning', provider: 'ollama', model: 'reasoning-local', venue: 'local_process', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallback: 'none' });
        assert.deepEqual({ ...result.provenance }, { sourceAuthority: 'not_bound', modelDigestCausality: 'not_established' });
        assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(result.fallback, 'denied');
    } finally { bound.restore(); }
});

test('fails closed before a provider call for malformed projections and invalid binding values', async () => {
    let calls = 0; const bound = await token(async () => { calls += 1; return { content: JSON.stringify(output()), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; });
    try {
        for (const [value, code] of [[null, 'input_invalid'], [{}, 'input_invalid'], [{ projection, providerToken: bound.value, extra: true }, 'input_invalid'], [input(bound.value, { ...projection, sourceText: ' unnormalized ' }), 'input_invalid'], [input({}, projection), 'binding_invalid'], [input({ ...bound.value }, projection), 'binding_invalid'], [input(Object.create(null), projection), 'binding_invalid'], [input(new Proxy(bound.value, {}), projection), 'binding_invalid']] as const) {
            denied(await executeDocumentSynthesisProvider(value), code);
        }
        assert.equal(calls, 0);
    } finally { bound.restore(); }
});

test('consumes a valid token before async work, including concurrent replay', async () => {
    let release!: () => void; let calls = 0;
    const bound = await token(async () => { calls += 1; await new Promise<void>((resolve) => { release = resolve; }); return { content: JSON.stringify(output()), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; });
    try {
        const first = executeDocumentSynthesisProvider(input(bound.value));
        const second = await executeDocumentSynthesisProvider(input(bound.value)); denied(second, 'binding_consumed'); assert.equal(calls, 1);
        release(); assert.equal((await first).status, 'available');
    } finally { bound.restore(); }
});

test('maps provider failure and non-canonical provider content without a fallback', async () => {
    const unavailable = await token(async () => { throw new Error('offline'); });
    try { denied(await executeDocumentSynthesisProvider(input(unavailable.value)), 'provider_unavailable'); } finally { unavailable.restore(); }
    const invalid = await token(async () => ({ content: `{"schemaVersion":"mediflow.ai.extract.v1","schemaVersion":"mediflow.ai.extract.v1"}`, stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }));
    try { denied(await executeDocumentSynthesisProvider(input(invalid.value)), 'output_invalid'); } finally { invalid.restore(); }
    const oversized = await token(async () => ({ content: ' '.repeat(262_145), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }));
    try { denied(await executeDocumentSynthesisProvider(input(oversized.value)), 'output_invalid'); } finally { oversized.restore(); }
});

test('rejects post-binding adapter drift before the replacement can run', async () => {
    let replacements = 0; const bound = await token(async () => ({ content: JSON.stringify(output()), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }));
    const stable = OllamaProviderAdapter.prototype.chat;
    OllamaProviderAdapter.prototype.chat = async () => { replacements += 1; throw new Error('replacement'); };
    try { denied(await executeDocumentSynthesisProvider(input(bound.value)), 'provider_unavailable'); assert.equal(replacements, 0); } finally { OllamaProviderAdapter.prototype.chat = stable; bound.restore(); }
});

test('aborts on the internal timeout and observes late rejection without an unhandled rejection', async () => {
    const originalTimeout = AbortSignal.timeout; const controller = new AbortController(); const unhandled: unknown[] = []; const observe = (reason: unknown) => { unhandled.push(reason); };
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => controller.signal });
    let rejectLate!: (reason: unknown) => void; const bound = await token(async () => new Promise((_, reject) => { rejectLate = reject; }));
    process.on('unhandledRejection', observe);
    try {
        const pending = executeDocumentSynthesisProvider(input(bound.value)); controller.abort(); denied(await pending, 'provider_timeout');
        rejectLate(new Error('late')); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', observe); bound.restore(); Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: originalTimeout }); }
});

test('keeps the static claim ceiling to one host-only adapter invocation without routes, persistence, callers, or apply', () => {
    const source = readFileSync(new URL('./document-synthesis-provider-execution.ts', import.meta.url), 'utf8');
    assert.match(source, /^\/\* @Codex \*\/\nimport 'server-only';/u);
    assert.match(source, /buildDocumentSynthesisExtractionPrompt\(source\.sourceText\)/u);
    assert.doesNotMatch(source, /(?:fetch\(|sqlite|database|route|citation|receiptRef|provenanceRef|Date\.|Math\.random|retry|fallback\()/iu);
});
