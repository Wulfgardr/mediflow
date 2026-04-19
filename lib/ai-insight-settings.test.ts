import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_AI_INSIGHT_MANUAL_CONFIG,
    estimateAIInsightComplexityScore,
    resolveAIInsightRuntimeSettings,
    sanitizeAIInsightManualConfig,
} from './ai-insight-settings';

test('sanitizeAIInsightManualConfig clamps invalid numeric values', () => {
    const sanitized = sanitizeAIInsightManualConfig({
        maxDocuments: 50,
        maxDocumentSummaryChars: 20,
        maxDocumentContextChars: '99999',
        outputMaxTokens: 'x',
    });

    assert.deepEqual(sanitized, {
        maxDocuments: 12,
        maxDocumentSummaryChars: 120,
        maxDocumentContextChars: 5000,
        outputMaxTokens: DEFAULT_AI_INSIGHT_MANUAL_CONFIG.outputMaxTokens,
    });
});

test('resolveAIInsightRuntimeSettings keeps manual mode explicit and sanitized', () => {
    const runtime = resolveAIInsightRuntimeSettings({
        mode: 'manual',
        hardwareProfile: 'high',
        manualConfig: {
            maxDocuments: 1,
            maxDocumentSummaryChars: 999,
            maxDocumentContextChars: 900,
            outputMaxTokens: 2000,
        },
    });

    assert.equal(runtime.mode, 'manual');
    assert.equal(runtime.resolvedProfile, 'manual');
    assert.deepEqual(runtime, {
        mode: 'manual',
        resolvedProfile: 'manual',
        maxDocuments: 2,
        maxDocumentSummaryChars: 480,
        maxDocumentContextChars: 900,
        outputMaxTokens: 1200,
    });
});

test('resolveAIInsightRuntimeSettings picks complete auto profile for complex patients', () => {
    const runtime = resolveAIInsightRuntimeSettings({
        mode: 'full_auto',
        hardwareProfile: 'medium',
        manualConfig: DEFAULT_AI_INSIGHT_MANUAL_CONFIG,
        patientComplexityScore: estimateAIInsightComplexityScore({
            diagnoses: 4,
            entries: 4,
            documents: 3,
        }),
    });

    assert.equal(runtime.mode, 'full_auto');
    assert.equal(runtime.resolvedProfile, 'complete');
    assert.equal(runtime.maxDocuments, 8);
    assert.equal(runtime.outputMaxTokens, 768);
});

test('resolveAIInsightRuntimeSettings picks light auto profile on low hardware for simple patients', () => {
    const runtime = resolveAIInsightRuntimeSettings({
        mode: 'full_auto',
        hardwareProfile: 'low',
        manualConfig: DEFAULT_AI_INSIGHT_MANUAL_CONFIG,
        patientComplexityScore: estimateAIInsightComplexityScore({
            diagnoses: 1,
            entries: 1,
            documents: 0,
        }),
    });

    assert.equal(runtime.resolvedProfile, 'light');
    assert.equal(runtime.maxDocuments, 4);
    assert.equal(runtime.outputMaxTokens, 384);
});
