import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';

import { OllamaProviderAdapter } from '../ollama.ts';
import { admitDocumentSynthesisFabric, beginDocumentSynthesisFabricExecution } from './document-synthesis-fabric-admission.ts';
import { cancelDocumentSynthesisFabricExecutionPrepare, disposeDocumentSynthesisFabricPreparedExecution, finalizeDocumentSynthesisFabricPreparedExecution, prepareDocumentSynthesisFabricExecution, setDocumentSynthesisFabricExecutionPrepareTimeoutForTest } from './document-synthesis-fabric-execution-prepare.ts';
import { createDocumentSynthesisProviderBindingForTest } from './document-synthesis-provider-binding.ts';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';
import { createDocumentSynthesisSourceSetCurrentnessOwner } from './document-synthesis-source-set-currentness-owner.ts';
import { createServerSessionProjectionOwnerRegistry } from '../../security/server-session-projection-owner.ts';
import { clearAllSessions, createSession } from '../../security/server-session.ts';

const SETTINGS = Object.freeze({ aiProvider: 'ollama', aiModel_reasoning: 'reasoning-local', aiUrl: 'http://localhost:11434' }); const ATTESTATION = Object.freeze({ authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback', requestedModel: 'reasoning-local', canonicalModel: 'reasoning-local:latest', digest: 'sha256:synthetic', serverVersion: '0.32.5', checkedAt: '2026-08-25T12:00:00.000Z' }); const USER = Object.freeze({ id: ['synthetic', 'ds', 'prepare', 'user'].join('.'), username: ['synthetic', 'ds', 'prepare', 'clinician'].join('.'), role: 'clinician' as const }); const PAIR = Object.freeze({ patientId: 'patient.synthetic.ds.prepare', ambulatoryId: 'ambulatory.synthetic.ds.prepare' });
afterEach(() => clearAllSessions());
function body(text = 'Synthetic source.') { return JSON.stringify({ schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } }, citations: [{ label: 'S1', quote: text }], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] }); }
async function handoff(chat: OllamaProviderAdapter['chat'], clock: () => number = () => 1_000, sourceText = 'Synthetic source.') { const original = OllamaProviderAdapter.prototype.chat; OllamaProviderAdapter.prototype.chat = chat; let entropy = 0; const registry = createServerSessionProjectionOwnerRegistry({ clock, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => (entropy += 1) + index), resolve: (_session, pair) => Object.freeze({ ...pair, patientVersion: 1 }) }); const session = createSession(USER, 'web'); const owner = registry.acquire(session); owner.issueSelection({ expectedEpoch: 0, ...PAIR }); const captured = captureDocumentSynthesisSourceSet({ sourceSetEpoch: BigInt(3), revocationGeneration: BigInt(5), sources: [{ documentSourceRef: 'document.synthetic.ds.prepare', documentRevision: BigInt(7), documentFreshnessEpoch: BigInt(11), sourceText }] }); assert.equal(captured.status, 'available'); if (captured.status !== 'available') throw new Error('source'); const capsule = createDocumentSynthesisSourceSetCurrentnessOwner(Object.freeze({ owner, session, sourceSet: captured.sourceSet })); const binding = await createDocumentSynthesisProviderBindingForTest({ readSettings: async () => SETTINGS, attest: async () => ATTESTATION }).bind(); assert.equal(binding.status, 'available'); if (binding.status !== 'available') throw new Error('binding'); const admitted = admitDocumentSynthesisFabric(Object.freeze({ owner, session, capsule, providerToken: binding.token })); assert.equal(admitted.status, 'available'); const value = admitted.token && beginDocumentSynthesisFabricExecution(admitted.token); assert.ok(value); return { value, restore() { OllamaProviderAdapter.prototype.chat = original; } }; }
function exact(result: Awaited<ReturnType<typeof prepareDocumentSynthesisFabricExecution>>, code: string) { assert.deepEqual({ ...result }, { status: 'denied', code, preparedToken: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none', fallback: 'denied_by_contract' }); }

test('prepares one fixed lease-bound prompt with no output leakage or finalization', { concurrency: false }, async () => { const calls: unknown[][] = []; const fixture = await handoff(async (...args) => { calls.push(args); return { content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; }); try { const result = await prepareDocumentSynthesisFabricExecution(fixture.value); assert.equal(result.status, 'available'); if (result.status !== 'available') return; const message = calls[0]?.[0] as Array<{ role: string; content: string }>; assert.equal(message.length, 1); assert.equal(message[0]?.role, 'user'); assert.equal(message[0]?.content.includes('Synthetic source.'), true); assert.equal(calls.length, 1); assert.equal(calls[0]?.[1] instanceof AbortSignal, true); assert.equal(calls[0]?.[2], 2560); assert.deepEqual(calls[0]?.[3], { responseFormat: 'document_synthesis_v2' }); assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true); assert.deepEqual(Reflect.ownKeys(result), ['status', 'code', 'preparedToken', 'reviewOnly', 'writesPerformed', 'applyPolicy', 'fallback']); assert.deepEqual(Reflect.ownKeys(result.preparedToken), []); disposeDocumentSynthesisFabricPreparedExecution(result.preparedToken); } finally { fixture.restore(); } });

test('denies replay and hostile inputs without a second provider call', { concurrency: false }, async () => { let calls = 0; const fixture = await handoff(async () => { calls += 1; return { content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; }); try { const first = prepareDocumentSynthesisFabricExecution(fixture.value); exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'canceled'); exact(await first, 'canceled'); assert.equal(calls, 1); for (const value of [{}, { ...fixture.value }, structuredClone(fixture.value), Object.freeze(Object.defineProperty({}, 'then', { value() {} }))]) exact(await prepareDocumentSynthesisFabricExecution(value), 'handoff_unavailable'); exact(await prepareDocumentSynthesisFabricExecution(new Proxy(fixture.value, {})), 'input_invalid'); } finally { fixture.restore(); } });

test('burns the handoff after timeout, malformed envelope, or source validation denial', { concurrency: false }, async () => { for (const [content, code, expectedCalls] of [[null, 'response_invalid', 2], [body('Different synthetic source.'), 'citation_not_literal', 2], [body().replace(',{"claimPath":"data.qualityLevel","labels":["S1"]}', ''), 'validation_denied', 1]] as const) { let calls = 0; const fixture = await handoff(async () => { calls += 1; return { content: content as string, stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; }); try { const result = await prepareDocumentSynthesisFabricExecution(fixture.value); exact(result, code); exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable'); assert.equal(calls, expectedCalls); } finally { fixture.restore(); } } });

test('aborts timeout or cancellation, burns the handoff, absorbs late rejection, and skips parse validation after return', { concurrency: false }, async () => { let rejectLate!: (reason: unknown) => void; const fixture = await handoff(async () => new Promise((_, reject) => { rejectLate = reject; })); const restore = setDocumentSynthesisFabricExecutionPrepareTimeoutForTest(0); const unhandled: unknown[] = []; const listener = (reason: unknown) => { unhandled.push(reason); }; process.on('unhandledRejection', listener); try { exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'provider_timeout'); exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable'); rejectLate(new Error('late')); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []); } finally { process.off('unhandledRejection', listener); restore?.(); fixture.restore(); } });

test('burns before direct finalization and returns only the private publication', { concurrency: false }, async () => { let calls = 0; const fixture = await handoff(async () => { calls += 1; return { content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }; }); try { const prepared = await prepareDocumentSynthesisFabricExecution(fixture.value); assert.equal(prepared.status, 'available'); if (prepared.status !== 'available') return; assert.equal(calls, 1); const publication = finalizeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken); assert.ok(publication); assert.equal(calls, 1); assert.equal(Object.getPrototypeOf(publication), null); assert.equal(Object.isFrozen(publication), true); assert.deepEqual(Reflect.ownKeys(publication), ['schemaVersion', 'output', 'citations', 'claims', 'receipt', 'provenance']); assert.equal(Object.getPrototypeOf(publication.receipt), null); assert.equal(Object.isFrozen(publication.receipt), true); assert.deepEqual(Reflect.ownKeys(publication.receipt), ['schemaVersion', 'capability', 'outputSha256', 'claimCitationsDigestSha256', 'sourceSetDigestSha256', 'providerBindingReceipt', 'reviewOnly', 'applyPolicy', 'writesPerformed']); assert.equal(Object.getPrototypeOf(publication.provenance), null); assert.equal(Object.isFrozen(publication.provenance), true); assert.equal(finalizeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken), null); disposeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken); } finally { fixture.restore(); } });

test('burn makes nested finalization and disposal inert while exactly one commit succeeds', { concurrency: false }, async () => { let token: object | null = null; let armed = false; let reads = 0; let nested = 0; const fixture = await handoff(async () => ({ content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }), () => { if (armed && (reads += 1) === 3) { nested += 1; assert.equal(finalizeDocumentSynthesisFabricPreparedExecution(token), null); disposeDocumentSynthesisFabricPreparedExecution(token); } return 1_000; }); try { const prepared = await prepareDocumentSynthesisFabricExecution(fixture.value); assert.equal(prepared.status, 'available'); if (prepared.status !== 'available') return; token = prepared.preparedToken; armed = true; assert.ok(finalizeDocumentSynthesisFabricPreparedExecution(token)); assert.equal(nested, 1); const closedReads = reads; assert.equal(finalizeDocumentSynthesisFabricPreparedExecution(token), null); disposeDocumentSynthesisFabricPreparedExecution(token); assert.equal(reads, closedReads); } finally { fixture.restore(); } });

test('denies disposal-first and hostile finalizer tokens without reflection or deferred work', { concurrency: false }, async () => { const fixture = await handoff(async () => ({ content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } })); let reads = 0; let traps = 0; const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); try { const prepared = await prepareDocumentSynthesisFabricExecution(fixture.value); assert.equal(prepared.status, 'available'); if (prepared.status !== 'available') return; disposeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken); assert.equal(finalizeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken), null); const accessor = Object.freeze(Object.defineProperty({}, 'token', { enumerable: true, get() { reads += 1; return prepared.preparedToken; } })); const proxy = new Proxy(prepared.preparedToken, { get() { traps += 1; throw new Error('trap'); } }); Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } }); for (const value of [{}, { ...prepared.preparedToken }, structuredClone(prepared.preparedToken), accessor, proxy, Object.freeze({ then() {} }), Object.freeze({ evidence: Object.freeze({ receipt: 'forged' }) })]) assert.equal(finalizeDocumentSynthesisFabricPreparedExecution(value), null); assert.equal(reads, 0); assert.equal(traps, 0); await new Promise<void>((resolve) => setImmediate(resolve)); } finally { if (descriptor) Object.defineProperty(Object.prototype, 'then', descriptor); else delete (Object.prototype as { then?: unknown }).then; fixture.restore(); } });

test('uses captured finalizer intrinsics after post-import poison', { concurrency: false }, async () => { const fixture = await handoff(async () => ({ content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } })); const get = WeakMap.prototype.get; const remove = WeakMap.prototype.delete; const apply = Reflect.apply; try { const prepared = await prepareDocumentSynthesisFabricExecution(fixture.value); assert.equal(prepared.status, 'available'); if (prepared.status !== 'available') return; WeakMap.prototype.get = () => { throw new Error('poisoned'); }; WeakMap.prototype.delete = () => { throw new Error('poisoned'); }; Reflect.apply = () => { throw new Error('poisoned'); }; assert.ok(finalizeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken)); } finally { WeakMap.prototype.get = get; WeakMap.prototype.delete = remove; Reflect.apply = apply; fixture.restore(); } });

test('burns the prepared token before a literal tail call with no caller evidence', async () => { const source = await readFile('lib/ai-providers/fabric/document-synthesis-fabric-execution-prepare.ts', 'utf8'); const finalizer = source.match(/export function finalizeDocumentSynthesisFabricPreparedExecution[^\n]*/u)?.[0] ?? ''; assert.match(finalizer, /entry\.state = 'aborted'; ReflectApply\(WeakMapDelete, prepared, \[token\]\); return execution\.finalize\(\);/u); assert.doesNotMatch(finalizer, /catch|finally|Promise|frozen\(|JSON\.|structuredClone|callback|provenance|receipt/u); });

test('cancellation accepts only authentic active handoffs and burns the handoff', { concurrency: false }, async () => { let release!: () => void; const fixture = await handoff(async () => new Promise((resolve) => { release = () => resolve({ content: body(), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }); })); const unhandled: unknown[] = []; const listener = (reason: unknown) => { unhandled.push(reason); }; process.on('unhandledRejection', listener); try { const pending = prepareDocumentSynthesisFabricExecution(fixture.value); await new Promise<void>((resolve) => setImmediate(resolve)); cancelDocumentSynthesisFabricExecutionPrepare({}); cancelDocumentSynthesisFabricExecutionPrepare(new Proxy(fixture.value, {})); cancelDocumentSynthesisFabricExecutionPrepare(fixture.value); exact(await pending, 'canceled'); exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable'); release(); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []); } finally { process.off('unhandledRejection', listener); fixture.restore(); } });

test('structured generation still denies missing or wrong output schemaVersion without retry', { concurrency: false }, async () => {
    for (const version of [undefined, 'wrong.synthetic.version']) {
        const envelope = JSON.parse(body());
        if (version === undefined) delete envelope.output.schemaVersion;
        else envelope.output.schemaVersion = version;
        let calls = 0;
        const fixture = await handoff(async (...args) => {
            calls += 1;
            assert.deepEqual(args[3], { responseFormat: 'document_synthesis_v2' });
            return { content: JSON.stringify(envelope), stats: { latency: 0, tokensIn: 0, tokensOut: 0 } };
        });
        try {
            exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'validation_denied');
            exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable');
            assert.equal(calls, 1);
        } finally { fixture.restore(); }
    }
});

// Secondo tentativo sul modello locale, come il Quadro paziente (#891): solo per un involucro
// illeggibile o tagliato dal tetto di token, mai piu' di due chiamate, stesso prompt.
type Scripted = string | Readonly<{ content: string; truncated: true }>;
function scriptedChat(answers: readonly Scripted[], prompts: string[], before?: (call: number) => void): OllamaProviderAdapter['chat'] {
    return async (messages) => {
        prompts.push(String(messages[0]?.content)); before?.(prompts.length);
        const answer = answers[Math.min(prompts.length - 1, answers.length - 1)]!;
        return typeof answer === 'string' ? { content: answer, stats: { latency: 0, tokensIn: 0, tokensOut: 0 } }
            : { content: answer.content, stats: { latency: 0, tokensIn: 0, tokensOut: 1400, truncated: true } };
    };
}

test('local: an unreadable first envelope is retried once with the same prompt and the valid second one is prepared', { concurrency: false }, async () => {
    const prompts: string[] = [];
    const fixture = await handoff(scriptedChat(['{malformed', body()], prompts));
    try {
        const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
        assert.equal(result.status, 'available'); if (result.status !== 'available') return;
        assert.equal(prompts.length, 2); assert.equal(prompts[0], prompts[1]);
        const publication = finalizeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
        assert.ok(publication); assert.equal(publication.receipt.reviewOnly, true); assert.equal(publication.receipt.writesPerformed, 0);
    } finally { fixture.restore(); }
});

test('local: an answer cut at the token ceiling is not used even when it parses, and is retried once', { concurrency: false }, async () => {
    const prompts: string[] = [];
    const fixture = await handoff(scriptedChat([{ content: body(), truncated: true }, body()], prompts));
    try {
        const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
        assert.equal(result.status, 'available'); assert.equal(prompts.length, 2);
        if (result.status === 'available') disposeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
    } finally { fixture.restore(); }
});

test('local: two unreadable envelopes keep response_invalid after two calls, never three', { concurrency: false }, async () => {
    const prompts: string[] = [];
    const fixture = await handoff(scriptedChat(['{malformed', { content: body(), truncated: true }, body()], prompts));
    try {
        exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'response_invalid');
        exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable');
        assert.equal(prompts.length, 2);
    } finally { fixture.restore(); }
});

test('local: consent withdrawn or selection changed between the attempts sends no second call', { concurrency: false }, async () => {
    const prompts: string[] = [];
    let reads = 0;
    const fixture = await handoff(scriptedChat(['{malformed', body()], prompts));
    try {
        exact(await prepareDocumentSynthesisFabricExecution(fixture.value, () => { reads += 1; return false; }), 'canceled');
        assert.equal(prompts.length, 1); assert.equal(reads, 1);
        exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable');
    } finally { fixture.restore(); }
});

test('local: cancelling the preparation between the attempts sends no second call', { concurrency: false }, async () => {
    const prompts: string[] = [];
    const fixture = await handoff(scriptedChat(['{malformed', body()], prompts));
    try {
        exact(await prepareDocumentSynthesisFabricExecution(fixture.value, () => { cancelDocumentSynthesisFabricExecutionPrepare(fixture.value); return true; }), 'canceled');
        assert.equal(prompts.length, 1);
    } finally { fixture.restore(); }
});

// Collaudo a schermo 0.9.1 (11/11/2026): l'involucro completo del referto cardiologico sintetico
// chiedeva 1911 token e il tetto di 1400 lo tagliava due volte su due. L'adapter finto si comporta
// come Ollama: sotto il conteggio reale della risposta restituisce il prefisso con `truncated`.
test('local: the measured 1911-token envelope of an ordinary report fits the response budget', { concurrency: false }, async () => {
    const long = JSON.parse(await readFile('lib/ai-providers/fabric/fixtures/document-synthesis-long-envelope.json', 'utf8')) as { evalCount: number; sourceText: string; content: string };
    assert.equal(long.evalCount, 1911);
    const budgets: unknown[] = [];
    const fixture = await handoff(async (_messages, _signal, maxTokens) => {
        budgets.push(maxTokens);
        const fits = typeof maxTokens === 'number' && maxTokens >= long.evalCount;
        const content = fits ? long.content : long.content.slice(0, Math.floor(long.content.length * (maxTokens ?? 0) / long.evalCount));
        return { content, stats: { latency: 0, tokensIn: 0, tokensOut: fits ? long.evalCount : maxTokens ?? 0, ...(fits ? {} : { truncated: true as const }) } };
    }, undefined, long.sourceText);
    try {
        const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
        assert.equal(result.status, 'available', `budget ${String(budgets[0])}`);
        assert.equal(budgets.length, 1);
        if (result.status !== 'available') return;
        const publication = finalizeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
        assert.ok(publication); assert.equal(publication.output.data.therapyCandidates.length, 2); assert.equal(publication.receipt.writesPerformed, 0);
    } finally { fixture.restore(); }
});

// Risposte reali di qwen3.5:35b-a3b (misura dell'11/11/2026 su main): riassunti in inglese accettati
// e citazioni scartate col messaggio generico. Sorgenti e citazioni sono quelli veri, con il
// codice fiscale finto tolto.
const REAL = JSON.parse(await readFile('lib/ai-providers/fabric/fixtures/document-synthesis-real-answers.json', 'utf8')) as {
    summaries: Array<{ run: string; outcomeOnMain: string; english: boolean; summary: string }>;
    citations: Record<'referto' | 'esami' | 'fusedNewlines' | 'fusedNewlinesLab' | 'omittedMmolMol' | 'omittedRows', string>;
};
const ITALIAN_SUMMARY = REAL.summaries.find((item) => !item.english)!.summary;
function realBody(summary: string, quote: string) { return JSON.stringify({ schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary, data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } }, citations: [{ label: 'S1', quote }], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] }); }
const EXACT_LAB_QUOTE = 'Emoglobina glicata HbA1c: 8,1% (65 mmol/mol)';

test('local: the six English summaries accepted on main are retried once and never prepared', { concurrency: false }, async () => {
    const english = REAL.summaries.filter((item) => item.english && item.outcomeOnMain === 'proposta');
    assert.equal(english.length, 6);
    for (const item of english) {
        const twice: string[] = [];
        const refused = await handoff(scriptedChat([realBody(item.summary, EXACT_LAB_QUOTE)], twice), undefined, REAL.citations.esami);
        try {
            exact(await prepareDocumentSynthesisFabricExecution(refused.value), 'response_invalid');
            assert.equal(twice.length, 2, item.run);
            assert.match(twice[0]!, /Write summary and qualityReason in Italian/u);
        } finally { refused.restore(); }
        const prompts: string[] = [];
        const fixture = await handoff(scriptedChat([realBody(item.summary, EXACT_LAB_QUOTE), realBody(ITALIAN_SUMMARY, EXACT_LAB_QUOTE)], prompts), undefined, REAL.citations.esami);
        try {
            const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
            assert.equal(result.status, 'available', item.run); assert.equal(prompts.length, 2);
            if (result.status !== 'available') continue;
            const publication = finalizeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
            assert.equal(publication?.output.summary, ITALIAN_SUMMARY, item.run);
        } finally { fixture.restore(); }
    }
});

test('local: the 32 real Italian summaries pass the language check at the first attempt', { concurrency: false }, async () => {
    const italian = REAL.summaries.filter((item) => !item.english);
    assert.equal(italian.length, 32);
    for (const item of italian) {
        const prompts: string[] = [];
        const fixture = await handoff(scriptedChat([realBody(item.summary, EXACT_LAB_QUOTE)], prompts), undefined, REAL.citations.esami);
        try {
            const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
            assert.equal(result.status, 'available', item.run); assert.equal(prompts.length, 1, item.run);
            if (result.status === 'available') disposeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
        } finally { fixture.restore(); }
    }
});

test('local: a real quote with the title line breaks fused is accepted as the exact source text', { concurrency: false }, async () => {
    for (const [quote, source] of [[REAL.citations.fusedNewlines, REAL.citations.referto], [REAL.citations.fusedNewlinesLab, REAL.citations.esami]] as const) {
        assert.equal(source.includes(quote), false, 'su main la citazione non e’ letterale');
        const prompts: string[] = [];
        const fixture = await handoff(scriptedChat([realBody(ITALIAN_SUMMARY, quote)], prompts), undefined, source);
        try {
            const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
            assert.equal(result.status, 'available'); assert.equal(prompts.length, 1);
            if (result.status !== 'available') continue;
            const publication = finalizeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
            const citation = publication!.citations[0]!;
            assert.notEqual(citation.quote, quote, 'la citazione mostrata e’ il testo della fonte, non quello del modello');
            assert.equal(citation.quote.replace(/\s+/gu, ' '), quote.replace(/\s+/gu, ' '));
            assert.equal(Buffer.from(source, 'utf8').subarray(citation.startByte, citation.endByte).toString('utf8'), citation.quote);
            assert.match(citation.quote, /\(documento sintetico\)\n\nPaziente/u);
        } finally { fixture.restore(); }
    }
});

test('local: a real quote that leaves out «(65 mmol/mol)» stays refused with its own code after two calls', { concurrency: false }, async () => {
    for (const quote of [REAL.citations.omittedMmolMol, REAL.citations.omittedRows]) {
        assert.equal(quote.includes('8,1% (valore desiderabile'), true);
        const prompts: string[] = [];
        const fixture = await handoff(scriptedChat([realBody(ITALIAN_SUMMARY, quote)], prompts), undefined, REAL.citations.esami);
        try {
            exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'citation_not_literal');
            exact(await prepareDocumentSynthesisFabricExecution(fixture.value), 'handoff_unavailable');
            assert.equal(prompts.length, 2);
        } finally { fixture.restore(); }
    }
    const prompts: string[] = [];
    const fixture = await handoff(scriptedChat([realBody(ITALIAN_SUMMARY, REAL.citations.omittedMmolMol), realBody(ITALIAN_SUMMARY, EXACT_LAB_QUOTE)], prompts), undefined, REAL.citations.esami);
    try {
        const result = await prepareDocumentSynthesisFabricExecution(fixture.value);
        assert.equal(result.status, 'available'); assert.equal(prompts.length, 2, 'il secondo tentativo con la citazione letterale passa');
        if (result.status === 'available') disposeDocumentSynthesisFabricPreparedExecution(result.preparedToken);
    } finally { fixture.restore(); }
});
