/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AI_PATIENT_INSIGHT_KILL_SWITCH_KEY = 'aiPatientInsightKillSwitch';
const AI_SMART_IMPORT_KILL_SWITCH_KEY = 'aiSmartImportKillSwitch';
const AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY = 'aiDocumentSynthesisKillSwitch';

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
    | 'document_synthesis';

export const AI_ROLLOUT_LOCAL_CONTROL_LANES: RolloutReadinessLocalControlLane[] = [
    'patient_insight',
    'smart_import',
    'document_synthesis',
];

const AI_ROLLOUT_LOCAL_CONTROL_META: Record<RolloutReadinessLocalControlLane, {
    label: string;
    key: string;
    resolveEnabled: (value: unknown) => boolean;
}> = {
    patient_insight: {
        label: 'Patient Insight',
        key: AI_PATIENT_INSIGHT_KILL_SWITCH_KEY,
        resolveEnabled: isAiRolloutLocalControlEnabledValue,
    },
    smart_import: {
        label: 'Smart Import',
        key: AI_SMART_IMPORT_KILL_SWITCH_KEY,
        resolveEnabled: isAiRolloutLocalControlEnabledValue,
    },
    document_synthesis: {
        label: 'Document Synthesis',
        key: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY,
        resolveEnabled: isAiRolloutLocalControlEnabledValue,
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
    }>;
    localControls: Array<{
        lane: RolloutReadinessLocalControlLane;
        label: string;
        key: string;
        uiDriven: true;
        state: 'enabled' | 'disabled';
    }>;
};

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
}

function isAiRolloutLocalControlEnabledValue(value: unknown): boolean {
    return !(value === 'disabled' || value === false || value === 'false' || value === 0 || value === '0');
}

export function getAiRolloutReadinessArtifactPaths(lane: RolloutReadinessArtifactLane) {
    const directory = path.join(getDefaultDataDir(), 'ai', 'rollout-readiness', lane);
    return {
        directory,
        jsonPath: path.join(directory, 'latest.json'),
        markdownPath: path.join(directory, 'latest.md'),
    };
}

export function ensureAiRolloutReadinessArtifactDirectory(lane: RolloutReadinessArtifactLane) {
    const paths = getAiRolloutReadinessArtifactPaths(lane);
    fs.mkdirSync(paths.directory, { recursive: true });
    return paths;
}

export function readAiRolloutReadinessArtifact(lane: RolloutReadinessArtifactLane) {
    const paths = getAiRolloutReadinessArtifactPaths(lane);
    if (!fs.existsSync(paths.jsonPath)) {
        return null;
    }

    const raw = fs.readFileSync(paths.jsonPath, 'utf8');
    const stats = fs.statSync(paths.jsonPath);

    return {
        paths,
        updatedAt: stats.mtime.toISOString(),
        markdown: fs.existsSync(paths.markdownPath)
            ? fs.readFileSync(paths.markdownPath, 'utf8')
            : null,
        report: JSON.parse(raw) as Record<string, unknown>,
    };
}

export function readAiRolloutReadinessArtifacts() {
    return AI_ROLLOUT_READINESS_LANES.map((lane) => {
        const artifact = readAiRolloutReadinessArtifact(lane);
        return {
            lane,
            available: Boolean(artifact),
            artifact,
        };
    });
}

export function buildAiRolloutLocalControlsPayload(
    rawValues: Partial<Record<RolloutReadinessLocalControlLane, unknown>>
): AiRolloutReadinessArtifactsPayload['localControls'] {
    return AI_ROLLOUT_LOCAL_CONTROL_LANES.map((lane) => {
        const meta = AI_ROLLOUT_LOCAL_CONTROL_META[lane];
        const state: 'enabled' | 'disabled' = meta.resolveEnabled(rawValues[lane]) ? 'enabled' : 'disabled';
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
        })),
        localControls: options?.localControls || buildAiRolloutLocalControlsPayload({}),
    };
}
