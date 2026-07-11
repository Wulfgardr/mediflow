/* @Codex */
import fs from 'fs';
import os from 'os';
import path from 'path';

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(/* turbopackIgnore: true */ os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(/* turbopackIgnore: true */ os.homedir(), '.mediflow'));
}

export function getAiModelParliamentArtifactPaths() {
    const directory = path.join(
        /* turbopackIgnore: true */ getDefaultDataDir(),
        'ai',
        'model-parliament'
    );
    return {
        directory,
        jsonPath: path.join(directory, 'latest.json'),
        markdownPath: path.join(directory, 'latest.md'),
    };
}

export function ensureAiModelParliamentArtifactDirectory() {
    const paths = getAiModelParliamentArtifactPaths();
    fs.mkdirSync(/* turbopackIgnore: true */ paths.directory, { recursive: true });
    return paths;
}

export function readAiModelParliamentArtifact() {
    const paths = getAiModelParliamentArtifactPaths();
    if (!fs.existsSync(/* turbopackIgnore: true */ paths.jsonPath)) {
        return null;
    }

    const raw = fs.readFileSync(/* turbopackIgnore: true */ paths.jsonPath, 'utf8');
    const stats = fs.statSync(/* turbopackIgnore: true */ paths.jsonPath);

    try {
        return {
            paths,
            updatedAt: stats.mtime.toISOString(),
            report: JSON.parse(raw) as Record<string, unknown>,
            error: null,
        };
    } catch (error) {
        return {
            paths,
            updatedAt: stats.mtime.toISOString(),
            report: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
