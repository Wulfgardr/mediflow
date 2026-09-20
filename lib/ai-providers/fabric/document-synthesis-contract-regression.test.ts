/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA } from '../document-synthesis-json-schema.ts';
import { buildDocumentSynthesisMultiSourcePrompt } from './document-synthesis-multi-source-prompt.ts';
import { normalizeDocumentSynthesisOutput } from './document-synthesis-output-contract.ts';
import { parseDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope.ts';
import { bindDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope-binding.ts';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract.ts';

// These strings stand for already extracted text. This tests the real contracts, not model or OCR quality.
const NATIVE = 'Nota nativa sintetica. Nessun dato di persona reale.';
const OCR = 'Qualità locale.\n12/03/2026 quantità 25 mg. ✅';
const QUOTE = '12/03/2026 quantità 25 mg. ✅';
function fixture() {
    const capture = captureDocumentSynthesisSourceSet({ sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1),
        sources: [
            { documentSourceRef: 'synthetic.b.ocr', documentRevision: BigInt(2), documentFreshnessEpoch: BigInt(3), sourceText: OCR },
            { documentSourceRef: 'synthetic.a.native', documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(1), sourceText: NATIVE },
        ],
    });
    assert.equal(capture.status, 'available');
    if (capture.status !== 'available') throw new Error('Synthetic source set rejected');
    const prompt = buildDocumentSynthesisMultiSourcePrompt(capture.sourceSet);
    assert.equal(prompt.status, 'available');
    if (prompt.status !== 'available') throw new Error('Synthetic prompt rejected');
    const exampleLine = prompt.prompt.split('\n').find((line) => line.startsWith('Output shape example only;'))!;
    const example = JSON.parse(exampleLine.slice(exampleLine.indexOf('{'), exampleLine.indexOf('. None of these fields')));
    const envelope = { schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2',
        output: { ...example, summary: 'Documento interamente sintetico da rivedere.' },
        citations: [{ label: 'S1', quote: NATIVE }, { label: 'S2', quote: QUOTE }],
        claims: [{ claimPath: 'summary', labels: ['S1', 'S2'] }, { claimPath: 'data.qualityLevel', labels: ['S2'] }],
    };
    const bind = (value: unknown) => {
        const parsed = parseDocumentSynthesisProviderEnvelope({ content: JSON.stringify(value) });
        return parsed.status === 'available'
            ? bindDocumentSynthesisProviderEnvelope({ sourceSet: capture.sourceSet, envelopeToken: parsed.token })
            : parsed;
    };
    return { sourceSet: capture.sourceSet, prompt: prompt.prompt, example, envelope, bind };
}

test('the actual prompt example agrees with the static required keys and passes the host output validator', () => {
    const f = fixture();
    const outputSchema = DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA.properties!.output!;
    assert.deepEqual(Object.keys(f.example).sort(), [...outputSchema.required!].sort());
    assert.deepEqual(Object.keys(f.example.data).sort(), [...outputSchema.properties!.data!.required!].sort());
    assert.equal(f.example.schemaVersion, outputSchema.properties!.schemaVersion!.const);
    assert.equal(normalizeDocumentSynthesisOutput(f.example).status, 'available');
    assert.equal(DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA.properties!.claims!.maxItems, 194);
    assert.match(f.prompt, /At most 194 canonical claims/);
});

test('a complete v2 response binds both sources, computes exact UTF-8 locators and stays review-only', () => {
    const f = fixture();
    const result = f.bind(f.envelope);
    assert.equal(result.status, 'available');
    assert.ok('citations' in result);
    if (result.status !== 'available' || !('citations' in result)) return;
    const citation = result.citations[1]!;
    assert.equal(citation.quote, QUOTE);
    const start = Buffer.byteLength(OCR.slice(0, OCR.indexOf(QUOTE)), 'utf8');
    assert.equal(citation.startByte, start);
    assert.equal(citation.endByte, start + Buffer.byteLength(QUOTE, 'utf8'));
    assert.equal(citation.quoteSha256, createHash('sha256').update(QUOTE, 'utf8').digest('hex'));
    assert.equal(Buffer.from(OCR).subarray(citation.startByte, citation.endByte).toString('utf8'), QUOTE);
    assert.deepEqual(result.claims.map((claim) => [...claim.labels]), [['S1', 'S2'], ['S2']]);
    assert.deepEqual([result.reviewOnly, result.writesPerformed, result.applyPolicy], [true, 0, 'none']);
    assert.equal(Object.isFrozen(result), true);
});

test('every field required by the static envelope/output/data schema is denied when absent, never repaired', () => {
    const f = fixture();
    const schema = DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA;
    for (const [level, required] of [
        ['root', schema.required!], ['output', schema.properties!.output!.required!],
        ['data', schema.properties!.output!.properties!.data!.required!],
    ] as const) {
        for (const key of required) {
            const candidate = structuredClone(f.envelope);
            const target = level === 'root' ? candidate : level === 'output' ? candidate.output : candidate.output.data;
            delete (target as Record<string, unknown>)[key];
            assert.equal(f.bind(candidate).status, 'denied', `${level}.${key}`);
            assert.equal(Object.hasOwn(target, key), false);
        }
    }
});

test('verbatim citations are not paraphrased, case-corrected or moved to a different source', () => {
    const f = fixture();
    for (const quote of [QUOTE.replace('quantità', 'Quantità'), QUOTE.replace('25 mg', 'venticinque milligrammi'), ' ' + QUOTE]) {
        const candidate = structuredClone(f.envelope); candidate.citations[1]!.quote = quote;
        assert.equal(f.bind(candidate).status, 'denied');
        assert.equal(candidate.citations[1]!.quote, quote);
    }
    const wrongSource = structuredClone(f.envelope);
    wrongSource.citations[1]!.quote = NATIVE;
    assert.equal(f.bind(wrongSource).status, 'denied');
});

test('a valid envelope is not rebound to a replacement source snapshot', () => {
    const f = fixture();
    const parsed = parseDocumentSynthesisProviderEnvelope({ content: JSON.stringify(f.envelope) });
    assert.equal(parsed.status, 'available');
    if (parsed.status !== 'available') return;
    const replaced = captureDocumentSynthesisSourceSet({ sourceSetEpoch: BigInt(2), revocationGeneration: BigInt(1),
        sources: f.sourceSet.sources.map((source) => ({ documentSourceRef: source.documentSourceRef,
            documentRevision: source.documentRevision + BigInt(1), documentFreshnessEpoch: source.documentFreshnessEpoch + BigInt(1),
            sourceText: source.label === 'S2' ? 'Nuovo documento sintetico, privo della citazione precedente.' : source.sourceText })),
    });
    assert.equal(replaced.status, 'available');
    if (replaced.status !== 'available') return;
    assert.equal(bindDocumentSynthesisProviderEnvelope({ sourceSet: replaced.sourceSet, envelopeToken: parsed.token }).status, 'denied');
    // Content binding only: authenticated lifecycle/currentness is covered separately, not emulated here.
});
