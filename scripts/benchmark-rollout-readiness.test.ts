/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getAiRolloutReadinessArtifactPaths } from '../lib/ai-rollout-readiness-storage.ts';
import {
    buildRolloutReadinessMarkdown,
    evaluateRolloutReadiness,
    resolveRolloutReadinessOutputPaths,
} from './benchmark-rollout-readiness.ts';

const NOW = new Date().toISOString();

test('patient insight can become shadow-ready when prerequisites and metrics pass', () => {
    const result = evaluateRolloutReadiness({
        lane: 'patient_insight',
        reportPath: '/tmp/patient-insight.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 0.99,
                    focusRecall: 0.9,
                    citationCoverageRate: 1,
                    preferredSourceCoverage: 0.9,
                    forbiddenLeakRate: 0,
                    forbiddenSourceLeakRate: 0,
                    moralizingLeakRate: 0,
                    incompleteClaimRate: 0.1,
                },
            }],
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'shadow-ready');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.selectedModel, 'qwen3.5:35b-a3b');
});

test('patient insight stays on hold when a required metric is missing', () => {
    const result = evaluateRolloutReadiness({
        lane: 'patient_insight',
        reportPath: '/tmp/patient-insight.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 0.99,
                    focusRecall: 0.9,
                    preferredSourceCoverage: 0.9,
                    forbiddenLeakRate: 0,
                    forbiddenSourceLeakRate: 0,
                    moralizingLeakRate: 0,
                    incompleteClaimRate: 0.1,
                },
            }],
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /citation-coverage-rate-invalid/);
});

test('smart import stays on hold when a required metric is malformed', () => {
    const result = evaluateRolloutReadiness({
        lane: 'smart_import',
        reportPath: '/tmp/smart-import.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 1,
                    jsonValidRate: 1,
                    diagnosisRecall: 1,
                    diagnosisQueryRecall: 1,
                    therapyRecall: 1,
                    dosageRecall: 1,
                    therapyStateRecall: '1',
                    sourceIdRate: 1,
                    forbiddenLeakRate: 0,
                },
            }],
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /therapy-state-recall-invalid/);
});

test('missing fallback keeps a lane on hold even when metrics pass', () => {
    const result = evaluateRolloutReadiness({
        lane: 'patient_insight',
        reportPath: '/tmp/patient-insight.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 0.99,
                    focusRecall: 0.9,
                    citationCoverageRate: 1,
                    preferredSourceCoverage: 0.9,
                    forbiddenLeakRate: 0,
                    forbiddenSourceLeakRate: 0,
                    moralizingLeakRate: 0,
                    incompleteClaimRate: 0.1,
                },
            }],
        },
        currentState: 'hold',
        fallbackWritten: false,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /fallback-written/);
});

test('future benchmark timestamp is a blocker instead of fresh evidence', () => {
    const futureGeneratedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = evaluateRolloutReadiness({
        lane: 'redaction',
        reportPath: '/tmp/redaction.json',
        report: {
            generatedAt: futureGeneratedAt,
            shadowReady: true,
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /generated-at-future/);
});

test('smart import regression becomes rollback-required when lane is already active-ish', () => {
    const result = evaluateRolloutReadiness({
        lane: 'smart_import',
        reportPath: '/tmp/smart-import.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 1,
                    jsonValidRate: 1,
                    diagnosisRecall: 0.98,
                    diagnosisQueryRecall: 0.98,
                    therapyRecall: 0.98,
                    dosageRecall: 0.98,
                    therapyStateRecall: 0.8,
                    sourceIdRate: 1,
                    forbiddenLeakRate: 0.2,
                    alreadyPresentLeakRate: 0.1,
                },
            }],
        },
        currentState: 'shadow-active',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'rollback-required');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /therapy-state-recall/);
    assert.match(result.blockers.map((entry) => entry.id).join(','), /forbidden-leak-rate/);
});

test('redaction validation artifact maps to hold when shadow readiness fails before activation', () => {
    const result = evaluateRolloutReadiness({
        lane: 'redaction',
        reportPath: '/tmp/redaction.json',
        report: {
            generatedAt: NOW,
            shadowReady: false,
            failures: [
                { id: 'critical-recall', message: 'criticalRecall=0.8 < 1.0' },
            ],
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /critical-recall/);
});

test('generative challenger stays on hold when parliament shows failed smart import chamber', () => {
    const result = evaluateRolloutReadiness({
        lane: 'generative_challenger',
        reportPath: '/tmp/parliament.json',
        report: {
            generatedAt: NOW,
            candidates: [{
                id: 'gemma4_e4b',
                label: 'Gemma 4 E4B',
                runtimeModel: 'gemma4:e4b',
                verdict: 'prune_failed',
                contractChamber: {
                    available: true,
                    passed: true,
                    reasons: ['Shared extraction contract thresholds passed.'],
                },
                smartImportChamber: {
                    available: true,
                    passed: false,
                    reasons: ['therapyStateRecall 0.6 < 0.95'],
                },
            }],
        },
        model: 'gemma4:e4b',
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.message).join(' | '), /therapyStateRecall 0.6 < 0.95/);
    assert.equal(result.selectedModel, 'gemma4:e4b');
});

test('default output paths follow the canonical rollout readiness artifact location', () => {
    const resolved = resolveRolloutReadinessOutputPaths('smart_import', null, null);
    const expected = getAiRolloutReadinessArtifactPaths('smart_import');

    assert.deepEqual(resolved.defaults, expected);
    assert.equal(resolved.jsonOutPath, expected.jsonPath);
    assert.equal(resolved.markdownOutPath, expected.markdownPath);
});

test('custom json output derives sibling markdown when markdown path is omitted', () => {
    const resolved = resolveRolloutReadinessOutputPaths(
        'patient_insight',
        '/tmp/rollout/patient-insight-verdict.json',
        null,
    );

    assert.equal(resolved.jsonOutPath, '/tmp/rollout/patient-insight-verdict.json');
    assert.equal(resolved.markdownOutPath, '/tmp/rollout/patient-insight-verdict.md');
});

test('markdown report includes status, blockers, warnings and evidence', () => {
    const report = evaluateRolloutReadiness({
        lane: 'smart_import',
        reportPath: '/tmp/smart-import.json',
        report: {
            generatedAt: NOW,
            decision: { recommendedModel: 'qwen3.5:35b-a3b' },
            models: [{
                model: 'qwen3.5:35b-a3b',
                status: 'completed',
                metrics: {
                    contractValidRate: 1,
                    jsonValidRate: 1,
                    diagnosisRecall: 1,
                    diagnosisQueryRecall: 1,
                    therapyRecall: 1,
                    dosageRecall: 1,
                    therapyStateRecall: 1,
                    sourceIdRate: 1,
                    forbiddenLeakRate: 0,
                    alreadyPresentLeakRate: 0.2,
                },
            }],
        },
        currentState: 'hold',
        fallbackWritten: true,
        owner: 'release-operator',
        licenseClear: true,
        maxAgeDays: 30,
    });

    const markdown = buildRolloutReadinessMarkdown(report);

    assert.match(markdown, /# AI Rollout Readiness/);
    assert.match(markdown, /Status: `shadow-ready`/);
    assert.match(markdown, /Lane: `smart_import`/);
    assert.match(markdown, /## Blockers/);
    assert.match(markdown, /No blocking conditions detected/);
    assert.match(markdown, /## Warnings/);
    assert.match(markdown, /already-present-leak-rate/);
    assert.match(markdown, /## Evidence/);
    assert.match(markdown, /Fallback written: yes/);
});
