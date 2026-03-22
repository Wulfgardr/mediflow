/* @Codex */
import fs from 'fs';
import os from 'os';
import path from 'path';

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
}

export function getAiModelParliamentArtifactPaths() {
    const directory = path.join(getDefaultDataDir(), 'ai', 'model-parliament');
    return {
        directory,
        jsonPath: path.join(directory, 'latest.json'),
        markdownPath: path.join(directory, 'latest.md'),
    };
}

export function ensureAiModelParliamentArtifactDirectory() {
    const paths = getAiModelParliamentArtifactPaths();
    fs.mkdirSync(paths.directory, { recursive: true });
    return paths;
}

export function readAiModelParliamentArtifact() {
    const paths = getAiModelParliamentArtifactPaths();
    if (!fs.existsSync(paths.jsonPath)) {
        return null;
    }

    const raw = fs.readFileSync(paths.jsonPath, 'utf8');
    const stats = fs.statSync(paths.jsonPath);

    return {
        paths,
        updatedAt: stats.mtime.toISOString(),
        report: JSON.parse(raw) as Record<string, unknown>,
    };
}
