/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    ensureAiModelParliamentArtifactDirectory,
    readAiModelParliamentArtifact,
} from './ai-model-parliament-storage.ts';

test('corrupt model parliament JSON degrades to a readable artifact error', () => {
    const previousDataDir = process.env.MEDIFLOW_DATA_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-model-parliament-'));
    process.env.MEDIFLOW_DATA_DIR = tempDir;

    try {
        const paths = ensureAiModelParliamentArtifactDirectory();
        fs.writeFileSync(paths.jsonPath, '{not valid json', 'utf8');

        const artifact = readAiModelParliamentArtifact();

        assert.equal(artifact?.report, null);
        assert.match(artifact?.error || '', /JSON/);
        assert.equal(artifact?.paths.jsonPath, paths.jsonPath);
    } finally {
        if (previousDataDir) {
            process.env.MEDIFLOW_DATA_DIR = previousDataDir;
        } else {
            delete process.env.MEDIFLOW_DATA_DIR;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
