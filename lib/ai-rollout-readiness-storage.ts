/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
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
