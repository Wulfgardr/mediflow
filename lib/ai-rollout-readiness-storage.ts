/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
    isAiDocumentSynthesisEnabledValue,
} from './ai-document-synthesis-kill-switch';
import {
    AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
    isAiPatientInsightEnabledValue,
} from './ai-patient-insight-kill-switch';
import {
    AI_SMART_IMPORT_KILL_SWITCH_KEY,
    isAiSmartImportEnabledValue,
} from './ai-smart-import-kill-switch';
import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
} from './ai-treatment-reasoning-kill-switch';

export type RolloutReadinessArtifactLane =
    | 'patient_insight'
    | 'smart_import'
    | 'redaction'
    | 'clinical_entities'
    | 'generative_challenger';

export const AI_ROLLOUT_READINESS_LANES: RolloutReadinessArtifactLane[] = [
    'patient_insight',
    'smart_import',
    'redaction',
    'clinical_entities',
    'generative_challenger',
];

export type RolloutReadinessLocalControlLane =
    | 'patient_insight'
    | 'smart_import'
    | 'document_synthesis'
    | 'treatment_reasoning';

export const AI_ROLLOUT_LOCAL_CONTROL_LANES: RolloutReadinessLocalControlLane[] = [
    'patient_insight',
    'smart_import',
    'document_synthesis',
    'treatment_reasoning',
];

const AI_ROLLOUT_LOCAL_CONTROL_META: Record<RolloutReadinessLocalControlLane, {
    label: string;
    key: string;
    resolveEnabled: (value: unknown) => boolean;
}> = {
    patient_insight: {
        label: 'Patient Insight',
        key: AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
        resolveEnabled: isAiPatientInsightEnabledValue,
    },
    smart_import: {
        label: 'Smart Import',
        key: AI_SMART_IMPORT_KILL_SWITCH_KEY,
        resolveEnabled: isAiSmartImportEnabledValue,
    },
    document_synthesis: {
        label: 'Document Synthesis',
        key: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
        resolveEnabled: isAiDocumentSynthesisEnabledValue,
    },
    treatment_reasoning: {
        label: 'Treatment Reasoning',
        key: AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
        resolveEnabled: isAiTreatmentReasoningEnabledValue,
    },
};

export type AiRolloutReadinessArtifactsPayload = {
    lanes: Array<{
        lane: RolloutReadinessArtifactLane;
        available: boolean;
        updatedAt: string | null;
        jsonPath: string | null;
        markdownPath: string | null;
        markdown: string | null;
        report: Record<string, unknown> | null;
        error: string | null;
    }>;
    localControls: Array<{
        lane: RolloutReadinessLocalControlLane;
        label: string;
        key: string;
        uiDriven: true;
        state: 'enabled' | 'disabled';
    }>;
};

export type AiRolloutLocalControlRawValues = Partial<Record<RolloutReadinessLocalControlLane, unknown>> & Record<string, unknown>;

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(/* turbopackIgnore: true */ os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(/* turbopackIgnore: true */ os.homedir(), '.mediflow'));
}

export function getAiRolloutReadinessArtifactPaths(lane: RolloutReadinessArtifactLane) {
    const directory = path.join(
        /* turbopackIgnore: true */ getDefaultDataDir(),
        'ai',
        'rollout-readiness',
        lane
    );
    return {
        directory,
        jsonPath: path.join(directory, 'latest.json'),
        markdownPath: path.join(directory, 'latest.md'),
    };
}

export function ensureAiRolloutReadinessArtifactDirectory(lane: RolloutReadinessArtifactLane) {
    const paths = getAiRolloutReadinessArtifactPaths(lane);
    fs.mkdirSync(/* turbopackIgnore: true */ paths.directory, { recursive: true });
    return paths;
}

export function readAiRolloutReadinessArtifact(lane: RolloutReadinessArtifactLane) {
    const paths = getAiRolloutReadinessArtifactPaths(lane);
    if (!fs.existsSync(/* turbopackIgnore: true */ paths.jsonPath)) {
        return null;
    }

    const raw = fs.readFileSync(/* turbopackIgnore: true */ paths.jsonPath, 'utf8');
    const stats = fs.statSync(/* turbopackIgnore: true */ paths.jsonPath);
    const markdown = fs.existsSync(/* turbopackIgnore: true */ paths.markdownPath)
        ? fs.readFileSync(/* turbopackIgnore: true */ paths.markdownPath, 'utf8')
        : null;

    try {
        return {
            paths,
            updatedAt: stats.mtime.toISOString(),
            markdown,
            report: JSON.parse(raw) as Record<string, unknown>,
            error: null,
        };
    } catch (error) {
        return {
            paths,
            updatedAt: stats.mtime.toISOString(),
            markdown,
            report: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function readAiRolloutReadinessArtifacts() {
    return AI_ROLLOUT_READINESS_LANES.map((lane) => {
        const artifact = readAiRolloutReadinessArtifact(lane);
        return {
            lane,
            available: Boolean(artifact?.report),
            artifact,
        };
    });
}

export function buildAiRolloutLocalControlsPayload(
    rawValues: AiRolloutLocalControlRawValues
): AiRolloutReadinessArtifactsPayload['localControls'] {
    return AI_ROLLOUT_LOCAL_CONTROL_LANES.map((lane) => {
        const meta = AI_ROLLOUT_LOCAL_CONTROL_META[lane];
        const hasCanonicalKey = Object.prototype.hasOwnProperty.call(rawValues, meta.key);
        const rawValue = hasCanonicalKey ? rawValues[meta.key] : rawValues[lane];
        const state: 'enabled' | 'disabled' = meta.resolveEnabled(rawValue) ? 'enabled' : 'disabled';
        return {
            lane,
            label: meta.label,
            key: meta.key,
            uiDriven: true as const,
            state,
        };
    });
}

export function buildAiRolloutReadinessArtifactsPayload(options?: {
    localControls?: AiRolloutReadinessArtifactsPayload['localControls'];
}): AiRolloutReadinessArtifactsPayload {
    const artifacts = readAiRolloutReadinessArtifacts();
    return {
        lanes: artifacts.map((artifact) => ({
            lane: artifact.lane,
            available: artifact.available,
            updatedAt: artifact.artifact?.updatedAt || null,
            jsonPath: artifact.artifact?.paths.jsonPath || null,
            markdownPath: artifact.artifact?.paths.markdownPath || null,
            markdown: artifact.artifact?.markdown || null,
            report: artifact.artifact?.report || null,
            error: artifact.artifact?.error || null,
        })),
        localControls: options?.localControls || buildAiRolloutLocalControlsPayload({}),
    };
}
