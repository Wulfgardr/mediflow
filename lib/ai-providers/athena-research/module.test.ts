import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractAthenaResearchAnswer } from './extractor';
import { replayAthenaResearchAnswer } from './replay';
import { createAthenaResearchModule } from './module';
import { buildAthenaResearchInstruction } from './method';
import { PROMPT_MULTI_STEP, _STAGE1_PROMPT_TEMPLATE } from './original-prompts';
import { snapshotTreatmentReasoningProjectionAttachment } from '../fabric/treatment-reasoning-projection';

const fixture = JSON.parse(readFileSync(new URL('../../../scripts/fixtures/athena-fabric-output-contract.json', import.meta.url), 'utf8'));
const attestation = Object.freeze({ schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1' as const,
    readiness: 'available_unqualified' as const, provider: 'athena_mlx' as const, venue: 'local_process' as const,
    egress: 'none' as const, receiptRef: 'receipt.synthetic', provenanceRef: 'provenance.synthetic' });
const config = { allowedEvidenceRefs: fixture.allowedEvidenceRefs, attestation };
const raw = JSON.stringify(fixture.expectedOutput);
const capturedAt = '2026-10-30T12:00:00.000Z';
const projection = snapshotTreatmentReasoningProjectionAttachment({
    schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1', capability: 'treatment_reasoning',
    capturedAt, patientRevision: 1, sourceRevision: 'source.synthetic', therapyRefs: [], evidenceRefs: fixture.allowedEvidenceRefs,
    sources: fixture.allowedEvidenceRefs.map((id: string) => ({ id, sourceKind: 'clinical-entry', label: 'Nota inventata', excerpt: 'Non assume terapia dal 2024; possibile intolleranza.', date: capturedAt })),
}, capturedAt)!;

test('canonical prompts are pinned; the MediFlow question is separate and requests a free answer', () => {
    assert.ok(projection);
    assert.equal(createHash('sha256').update(PROMPT_MULTI_STEP).digest('hex'), 'ae538f99c674beec10ad46ae6f3083112027b1487651e1917a4670a58675c858');
    assert.equal(createHash('sha256').update(_STAGE1_PROMPT_TEMPLATE).digest('hex'), '4f5a01cdb6aa2dcba0343907c9a78625795bc0fa4c88bf7a5b309bb42334bf23');
    const input = buildAthenaResearchInstruction(projection);
    assert.equal(input.systemPrompt, PROMPT_MULTI_STEP);
    assert.ok(input.prompt.startsWith(_STAGE1_PROMPT_TEMPLATE.split('{question}')[0]!));
    assert.ok(input.prompt.endsWith(_STAGE1_PROMPT_TEMPLATE.split('{question}')[1]!));
    assert.match(input.prompt, /Rispondi liberamente/);
    assert.doesNotMatch(input.prompt, /response_schema|sourceBindings|response_shape_json/);
});

test('extracts only explicit complete content, preserving every literal and its raw range', () => {
    for (const text of [raw, '```json\n' + raw + '\n```', '```json\r\n' + raw + '\r\n```']) {
        const result = extractAthenaResearchAnswer(text, config);
        assert.equal(result.status, 'extracted');
        if (result.status !== 'extracted') throw new Error('Expected extraction');
        assert.deepEqual(result.value, (({ sourceBindings: _, ...value }) => value)(fixture.expectedOutput));
        assert.deepEqual(result.sourceBindings, fixture.expectedOutput.sourceBindings);
        for (const segment of result.segments) assert.equal(JSON.parse(text.slice(segment.start, segment.end)), segment.text);
    }
});

test('denies missing associations, prose, invented refs, repairs, tool calls and omitted fields with extraction codes', () => {
    const missingBindings = structuredClone(fixture.expectedOutput); delete missingBindings.sourceBindings;
    assert.equal(extractAthenaResearchAnswer(JSON.stringify(missingBindings), config).code, 'extraction_bindings_missing');
    for (const text of ['Risposta libera senza associazioni.', '{"review":{"rischi":"Rivedere"}}', raw.slice(0, -1),
        'Testo aggiunto\n```json\n' + raw + '\n```', '<think>trace</think>' + raw,
        raw.replace('"task":', '"ta\\u0073k":"treatment_reasoning","task":')]) {
        const result = extractAthenaResearchAnswer(text, config);
        assert.equal(result.status, 'denied'); assert.match(result.code!, /^extraction_/);
    }
    const mutations = [
        (v: typeof fixture.expectedOutput) => { v.sourceBindings[0].evidenceRefs = ['source.invented']; },
        (v: typeof fixture.expectedOutput) => { v.sourceBindings.pop(); },
        (v: typeof fixture.expectedOutput) => { v.data.suggestedActions[0].writePolicy = 'apply'; },
        (v: typeof fixture.expectedOutput) => { delete v.data.caveats; },
        (v: typeof fixture.expectedOutput) => { v.data.trace.toolsUsed = ['tool.synthetic']; },
        (v: typeof fixture.expectedOutput) => { v.data.trace.limitations = [' Spazi da correggere ']; },
    ];
    for (const mutate of mutations) {
        const value = structuredClone(fixture.expectedOutput); mutate(value);
        assert.equal(extractAthenaResearchAnswer(JSON.stringify(value), config).status, 'denied');
    }
    assert.equal(extractAthenaResearchAnswer('<tool_call>{}</tool_call>', config).code, 'extraction_tool_call');
    let reads = 0;
    assert.equal(extractAthenaResearchAnswer(new Proxy({}, { get() { reads++; } }), config).code, 'extraction_input_invalid');
    assert.equal(reads, 0);
});

test('absent optional runtime denies without invocation; unknown/truncated completion is never extracted', async () => {
    const absent = createAthenaResearchModule({ attestation, guard: () => null });
    assert.equal(absent.availability().code, 'research_module_absent');
    assert.equal((await absent.execute(projection)).code, 'research_module_absent');
    for (const finishReason of ['length', 'unknown', 'stop'] as const) {
        let calls = 0;
        const researchModule = createAthenaResearchModule({ attestation, guard: () => null,
            runtime: { available: () => true, async invoke(instruction) {
                calls++; assert.equal(instruction.systemPrompt, PROMPT_MULTI_STEP); return { raw, finishReason };
            } } });
        const result = await researchModule.execute(projection);
        assert.equal(calls, 1); assert.equal(result.publication, null); assert.equal(result.writesPerformed, 0);
        assert.equal(result.code, finishReason === 'stop' ? null : 'research_answer_incomplete');
    }
});

test('revocation/context guards win over malformed text; no-source input never invokes a model', async () => {
    for (const code of ['research_revoked', 'research_context_lost'] as const) {
        let current = true; let calls = 0;
        const researchModule = createAthenaResearchModule({ attestation, guard: () => current ? null : code,
            runtime: { available: () => true, async invoke() { calls++; current = false; return { raw: '{invalid', finishReason: 'stop' }; } } });
        assert.equal((await researchModule.execute(projection)).code, code);
        assert.equal((await researchModule.execute(projection)).code, code);
        assert.equal(calls, 1);
    }
    let calls = 0;
    const researchModule = createAthenaResearchModule({ attestation, guard: () => null,
        runtime: { available: () => true, async invoke() { calls++; return { raw, finishReason: 'stop' }; } } });
    assert.equal((await researchModule.execute({ ...projection, sources: [], evidenceRefs: [] })).status, 'denied');
    assert.equal(calls, 0);
});

test('replay preserves denied raw and distinguishes unobserved human diagnostics from zero errors', () => {
    const result = replayAthenaResearchAnswer('{"review":"Testo senza binding"}', config);
    assert.equal(result.raw, '{"review":"Testo senza binding"}');
    assert.equal(result.validJson, true); assert.equal(result.extraction.status, 'denied');
    assert.equal(result.newInference, false); assert.equal(result.humanAssessment.unsupportedClaims, null);
    assert.equal(result.humanAssessment.totalTexts, 1); assert.equal(result.humanAssessment.reviewedTexts, 0);
});
