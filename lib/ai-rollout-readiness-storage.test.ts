/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    AI_ROLLOUT_READINESS_LANES,
    buildAiRolloutReadinessArtifactsPayload,
    ensureAiRolloutReadinessArtifactDirectory,
} from './ai-rollout-readiness-storage.ts';

test('rollout readiness contract helper keeps all known lanes visible and marks missing artifacts explicitly', () => {
    const previousDataDir = process.env.MEDIFLOW_DATA_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-rollout-readiness-'));

    process.env.MEDIFLOW_DATA_DIR = tempDir;

    try {
        const patientInsightPaths = ensureAiRolloutReadinessArtifactDirectory('patient_insight');
        fs.writeFileSync(patientInsightPaths.jsonPath, JSON.stringify({
            status: 'shadow-ready',
            currentState: 'hold',
            selectedModel: 'qwen3.5:35b-a3b',
            blockers: [],
            warnings: [{ id: 'stale-benchmark', message: 'Benchmark age approaching limit.' }],
            evidence: {
                benchmarkFresh: true,
                owner: 'leonardo',
                reportGeneratedAt: '2026-04-03T09:00:00.000Z',
            },
        }), 'utf8');
        fs.writeFileSync(patientInsightPaths.markdownPath, '# Patient Insight verdict', 'utf8');

        const payload = buildAiRolloutReadinessArtifactsPayload();

        assert.equal(payload.lanes.length, AI_ROLLOUT_READINESS_LANES.length);

        const patientInsight = payload.lanes.find((lane) => lane.lane === 'patient_insight');
        assert.equal(patientInsight?.available, true);
        assert.equal(patientInsight?.report?.status, 'shadow-ready');
        assert.equal(patientInsight?.markdown, '# Patient Insight verdict');
        assert.equal(patientInsight?.jsonPath, patientInsightPaths.jsonPath);
        assert.equal(patientInsight?.markdownPath, patientInsightPaths.markdownPath);

        const redaction = payload.lanes.find((lane) => lane.lane === 'redaction');
        assert.equal(redaction?.available, false);
        assert.equal(redaction?.updatedAt, null);
        assert.equal(redaction?.jsonPath, null);
        assert.equal(redaction?.markdownPath, null);
        assert.equal(redaction?.markdown, null);
        assert.equal(redaction?.report, null);
    } finally {
        if (previousDataDir) {
            process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        } else {
            delete process.env.MEDIFLOW_DATA_DIR;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
