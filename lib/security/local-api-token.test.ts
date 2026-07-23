/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const loaderPath = path.join(repoRoot, 'scripts/register-strip-types-loader.mjs');
const tokenModuleUrl = pathToFileURL(path.join(repoRoot, 'lib/security/local-api-token.ts')).href;

function withTemporaryDataDir(run: (dataDir: string) => void): void {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-local-api-token-'));
    try {
        run(dataDir);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

function readToken(dataDir: string, override?: string): string {
    const env: NodeJS.ProcessEnv = { ...process.env, MEDIFLOW_DATA_DIR: dataDir };
    if (override === undefined) {
        delete env.MEDIFLOW_LOCAL_API_TOKEN;
    } else {
        env.MEDIFLOW_LOCAL_API_TOKEN = override;
    }

    const result = spawnSync(
        process.execPath,
        [
            '--experimental-strip-types',
            '--import',
            loaderPath,
            '--input-type=module',
            '--eval',
            `import { getOrCreateLocalApiToken } from ${JSON.stringify(tokenModuleUrl)}; process.stdout.write(getOrCreateLocalApiToken());`,
        ],
        { cwd: repoRoot, encoding: 'utf8', env }
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function assertGeneratedToken(token: string, tokenPath: string): void {
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(tokenPath, 'utf8'), token);
}

function assertPrivateFileMode(tokenPath: string): void {
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    }
}

test('uses the environment override without creating a token file', () => {
    withTemporaryDataDir((dataDir) => {
        assert.equal(readToken(dataDir, 'synthetic-override-token'), 'synthetic-override-token');
        assert.equal(fs.existsSync(path.join(dataDir, 'local-api-token')), false);
    });
});

test('reads and trims an existing token', () => {
    withTemporaryDataDir((dataDir) => {
        const tokenPath = path.join(dataDir, 'local-api-token');
        fs.writeFileSync(tokenPath, '  existing-synthetic-token\n');
        assert.equal(readToken(dataDir), 'existing-synthetic-token');
    });
});

test('creates a lowercase hexadecimal token when the file is absent', () => {
    withTemporaryDataDir((dataDir) => {
        const tokenPath = path.join(dataDir, 'local-api-token');
        assertGeneratedToken(readToken(dataDir), tokenPath);
        assertPrivateFileMode(tokenPath);
    });
});

test('replaces an empty token file with a generated token', () => {
    withTemporaryDataDir((dataDir) => {
        const tokenPath = path.join(dataDir, 'local-api-token');
        fs.writeFileSync(tokenPath, '', { mode: 0o644 });
        if (process.platform !== 'win32') {
            assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o644);
        }
        assertGeneratedToken(readToken(dataDir), tokenPath);
        assertPrivateFileMode(tokenPath);
    });
});

test('keeps generated token files isolated between temporary directories', () => {
    withTemporaryDataDir((firstDataDir) => {
        withTemporaryDataDir((secondDataDir) => {
            const firstToken = readToken(firstDataDir);
            const secondToken = readToken(secondDataDir);
            assert.notEqual(firstToken, secondToken);
            assert.equal(fs.readFileSync(path.join(firstDataDir, 'local-api-token'), 'utf8'), firstToken);
            assert.equal(fs.readFileSync(path.join(secondDataDir, 'local-api-token'), 'utf8'), secondToken);
        });
    });
});
