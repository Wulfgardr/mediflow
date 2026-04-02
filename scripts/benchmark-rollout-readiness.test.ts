/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRolloutReadiness } from './benchmark-rollout-readiness.ts';

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
        owner: 'leonardo',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'shadow-ready');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.selectedModel, 'qwen3.5:35b-a3b');
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
        owner: 'leonardo',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.id).join(','), /fallback-written/);
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
        owner: 'leonardo',
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
        owner: 'leonardo',
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
        owner: 'leonardo',
        licenseClear: true,
        maxAgeDays: 30,
    });

    assert.equal(result.status, 'hold');
    assert.match(result.blockers.map((entry) => entry.message).join(' | '), /therapyStateRecall 0.6 < 0.95/);
    assert.equal(result.selectedModel, 'gemma4:e4b');
});
