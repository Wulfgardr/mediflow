/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    AI_ROLLOUT_READINESS_LANES,
    buildAiRolloutLocalControlsPayload,
    buildAiRolloutReadinessArtifactsPayload,
    ensureAiRolloutReadinessArtifactDirectory,
} from './ai-rollout-readiness-storage.ts';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from './ai-document-synthesis-kill-switch.ts';
import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY } from './ai-patient-insight-kill-switch.ts';
import { AI_SMART_IMPORT_KILL_SWITCH_KEY } from './ai-smart-import-kill-switch.ts';
import { AI_TREATMENT_REASONING_KILL_SWITCH_KEY } from './ai-treatment-reasoning-kill-switch.ts';

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

        const payload = buildAiRolloutReadinessArtifactsPayload({
            localControls: buildAiRolloutLocalControlsPayload({
                patient_insight: 'disabled',
                smart_import: 'enabled',
                document_synthesis: false,
                treatment_reasoning: 'enabled',
            }),
        });

        assert.equal(payload.lanes.length, AI_ROLLOUT_READINESS_LANES.length);
        assert.equal(payload.localControls.length, 4);

        const patientInsight = payload.lanes.find((lane) => lane.lane === 'patient_insight');
        assert.equal(patientInsight?.available, true);
        assert.equal(patientInsight?.report?.status, 'shadow-ready');
        assert.equal(patientInsight?.markdown, '# Patient Insight verdict');
        assert.equal(patientInsight?.jsonPath, patientInsightPaths.jsonPath);
        assert.equal(patientInsight?.markdownPath, patientInsightPaths.markdownPath);
        assert.equal(patientInsight?.error, null);

        const patientInsightControl = payload.localControls.find((control) => control.lane === 'patient_insight');
        assert.equal(patientInsightControl?.state, 'disabled');

        const smartImportControl = payload.localControls.find((control) => control.lane === 'smart_import');
        assert.equal(smartImportControl?.state, 'enabled');

        const documentSynthesisControl = payload.localControls.find((control) => control.lane === 'document_synthesis');
        assert.equal(documentSynthesisControl?.state, 'disabled');

        const treatmentReasoningControl = payload.localControls.find((control) => control.lane === 'treatment_reasoning');
        assert.equal(treatmentReasoningControl?.state, 'enabled');

        assert.equal(payload.localControls.some((control) => (control.lane as string) === 'ocr'), false);

        const redaction = payload.lanes.find((lane) => lane.lane === 'redaction');
        assert.equal(redaction?.available, false);
        assert.equal(redaction?.updatedAt, null);
        assert.equal(redaction?.jsonPath, null);
        assert.equal(redaction?.markdownPath, null);
        assert.equal(redaction?.markdown, null);
        assert.equal(redaction?.report, null);
        assert.equal(redaction?.error, null);
    } finally {
        if (previousDataDir) {
            process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        } else {
            delete process.env.MEDIFLOW_DATA_DIR;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('corrupt rollout readiness JSON degrades only the affected lane', () => {
    const previousDataDir = process.env.MEDIFLOW_DATA_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-rollout-readiness-'));

    process.env.MEDIFLOW_DATA_DIR = tempDir;

    try {
        const patientInsightPaths = ensureAiRolloutReadinessArtifactDirectory('patient_insight');
        fs.writeFileSync(patientInsightPaths.jsonPath, JSON.stringify({
            status: 'shadow-ready',
            blockers: [],
        }), 'utf8');

        const smartImportPaths = ensureAiRolloutReadinessArtifactDirectory('smart_import');
        fs.writeFileSync(smartImportPaths.jsonPath, '{not valid json', 'utf8');
        fs.writeFileSync(smartImportPaths.markdownPath, '# Smart Import verdict', 'utf8');

        const payload = buildAiRolloutReadinessArtifactsPayload();
        const patientInsight = payload.lanes.find((lane) => lane.lane === 'patient_insight');
        const smartImport = payload.lanes.find((lane) => lane.lane === 'smart_import');

        assert.equal(patientInsight?.available, true);
        assert.equal(patientInsight?.report?.status, 'shadow-ready');
        assert.equal(patientInsight?.error, null);

        assert.equal(smartImport?.available, false);
        assert.equal(smartImport?.report, null);
        assert.equal(smartImport?.markdown, '# Smart Import verdict');
        assert.equal(smartImport?.jsonPath, smartImportPaths.jsonPath);
        assert.equal(smartImport?.markdownPath, smartImportPaths.markdownPath);
        assert.match(smartImport?.error || '', /JSON/);
    } finally {
        if (previousDataDir) {
            process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        } else {
            delete process.env.MEDIFLOW_DATA_DIR;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('rollout readiness local controls fail closed when settings are absent or malformed', () => {
    const absentControls = buildAiRolloutLocalControlsPayload({});
    assert.deepEqual(absentControls.map((control) => control.state), ['disabled', 'disabled', 'disabled', 'disabled']);

    const malformedControls = buildAiRolloutLocalControlsPayload({
        patient_insight: 'unexpected',
        smart_import: null,
        document_synthesis: 'true-ish',
        treatment_reasoning: 'unexpected',
    });
    assert.deepEqual(malformedControls.map((control) => control.state), ['disabled', 'disabled', 'disabled', 'disabled']);
});

test('rollout readiness local controls also accept canonical setting keys', () => {
    const controls = buildAiRolloutLocalControlsPayload({
        [AI_PATIENT_INSIGHT_KILL_SWITCH_KEY]: 'enabled',
        [AI_SMART_IMPORT_KILL_SWITCH_KEY]: true,
        [AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY]: '1',
        [AI_TREATMENT_REASONING_KILL_SWITCH_KEY]: 'enabled',
    });
    assert.deepEqual(controls.map((control) => control.state), ['enabled', 'enabled', 'enabled', 'enabled']);

    const canonicalNullWinsOverLaneFallback = buildAiRolloutLocalControlsPayload({
        [AI_PATIENT_INSIGHT_KILL_SWITCH_KEY]: null,
        patient_insight: 'enabled',
    });
    assert.equal(canonicalNullWinsOverLaneFallback.find((control) => control.lane === 'patient_insight')?.state, 'disabled');
});
