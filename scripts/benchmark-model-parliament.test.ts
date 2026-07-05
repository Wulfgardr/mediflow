/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildParliamentScorecard,
    finalizeCandidateEconomics,
    resolveProvisionalBaselineModel,
    type CandidateParliamentDecision,
} from './benchmark-model-parliament.ts';

function makeCandidate(overrides: Partial<CandidateParliamentDecision> = {}): CandidateParliamentDecision {
    return {
        id: 'candidate',
        label: 'Candidate',
        lane: 'generative',
        origin: 'current_stack',
        runtime: 'ollama_chat',
        runtimeModel: 'candidate:model',
        executionStatus: 'runnable',
        registryStatus: 'benchmarked',
        notes: 'Generic candidate note.',
        verdict: 'challenger',
        reasons: [],
        blockers: [],
        contractChamber: {
            available: true,
            passed: true,
            reasons: ['Shared extraction contract thresholds passed.'],
            score: 3,
        },
        smartImportChamber: {
            available: true,
            passed: true,
            reasons: ['Smart import thresholds passed.'],
            score: 8,
        },
        capabilities: {
            summary: 'Baseline locale multi-task per patient insight, smart import e document synthesis.',
            tasks: ['patient_insight', 'smart_import', 'document_synthesis'],
        },
        economics: {
            qualityScore: 0.8,
            avgLatencyMs: 4000,
            p95LatencyMs: 4300,
            relativeLatency: null,
            valueScore: null,
        },
        ...overrides,
    };
}

test('finalizeCandidateEconomics normalizes relative latency and value score', () => {
    const candidates = finalizeCandidateEconomics([
        makeCandidate({
            id: 'fast',
            runtimeModel: 'gemma4:e4b',
            economics: {
                qualityScore: 0.82,
                avgLatencyMs: 4000,
                p95LatencyMs: 4200,
                relativeLatency: null,
                valueScore: null,
            },
        }),
        makeCandidate({
            id: 'slow',
            runtimeModel: 'qwen3.5:35b-a3b',
            economics: {
                qualityScore: 0.96,
                avgLatencyMs: 8000,
                p95LatencyMs: 8600,
                relativeLatency: null,
                valueScore: null,
            },
        }),
    ]);

    assert.equal(candidates[0].economics.relativeLatency, 1);
    assert.equal(candidates[0].economics.valueScore, 0.82);
    assert.equal(candidates[1].economics.relativeLatency, 0.5);
    assert.equal(candidates[1].economics.valueScore, 0.48);
});

test('buildParliamentScorecard surfaces best quality, best value and lane state', () => {
    const candidates: CandidateParliamentDecision[] = [
        makeCandidate({
            id: 'qwen',
            label: 'Qwen3.5 35B A3B',
            runtimeModel: 'qwen3.5:35b-a3b',
            verdict: 'baseline',
            economics: {
                qualityScore: 0.96,
                avgLatencyMs: 8000,
                p95LatencyMs: 8600,
                relativeLatency: 0.5,
                valueScore: 0.48,
            },
        }),
        makeCandidate({
            id: 'gemma',
            label: 'Gemma 4 E4B',
            runtimeModel: 'gemma4:e4b',
            verdict: 'challenger',
            economics: {
                qualityScore: 0.82,
                avgLatencyMs: 4000,
                p95LatencyMs: 4200,
                relativeLatency: 1,
                valueScore: 0.82,
            },
        }),
        makeCandidate({
            id: 'openmed',
            label: 'OpenMed PII Italian ClinicalLongformer',
            lane: 'pii',
            runtime: 'transformers_token_classification',
            runtimeModel: 'OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1',
            executionStatus: 'integration_required',
            registryStatus: 'blocked',
            notes: 'Benchmark-only PII sidecar awaiting shadow-ready metrics.',
            verdict: 'lane_pending',
            blockers: ['shadow_validation_failed'],
            contractChamber: {
                available: false,
                passed: false,
                reasons: ['No completed shared-contract benchmark available.'],
                score: 0,
            },
            smartImportChamber: {
                available: false,
                passed: false,
                reasons: ['No completed smart import benchmark available.'],
                score: 0,
            },
            capabilities: {
                summary: 'Lane specialistica privacy-first per redaction.v1 e de-identificazione locale.',
                tasks: ['redaction.v1', 'deidentify'],
            },
            economics: {
                qualityScore: 0,
                avgLatencyMs: null,
                p95LatencyMs: null,
                relativeLatency: null,
                valueScore: null,
            },
        }),
    ];

    const scorecard = buildParliamentScorecard(candidates);

    assert.equal(scorecard.summary.bestQualityModel, 'qwen3.5:35b-a3b');
    assert.equal(scorecard.summary.bestValueModel, 'gemma4:e4b');
    assert.equal(scorecard.summary.bestValueChallengerModel, 'gemma4:e4b');
    assert.equal(scorecard.summary.fastestModel, 'gemma4:e4b');

    const generativeLane = scorecard.lanes.find((lane) => lane.lane === 'generative');
    assert.equal(generativeLane?.state, 'competitive');
    assert.equal(generativeLane?.focusCandidateModel, 'gemma4:e4b');

    const piiLane = scorecard.lanes.find((lane) => lane.lane === 'pii');
    assert.equal(piiLane?.state, 'benchmark_only');
    assert.match((piiLane?.blockers || []).join(' | '), /shadow_validation_failed/);
});

test('resolveProvisionalBaselineModel keeps protected baseline when roles are unset', () => {
    assert.equal(resolveProvisionalBaselineModel({
        clinical: null,
        reasoning: null,
        ocr: null,
        legacy: null,
    }), 'qwen3.5:35b-a3b');

    assert.equal(resolveProvisionalBaselineModel({
        clinical: ' qwen3.6:35b-a3b ',
        reasoning: null,
        ocr: null,
        legacy: null,
    }), 'qwen3.6:35b-a3b');
});
