import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'tsconfig.audit-test.json');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');

function withOutputDir(run) {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-config-'));
    try {
        run(outputDir);
    } finally {
        rmSync(outputDir, { recursive: true, force: true });
    }
}

function compile(project, outputDir) {
    const result = spawnSync(process.execPath, [compiler, '-p', project, '--outDir', outputDir], {
        cwd: root,
        encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
}

test('audit test configuration emits the executable audit suite', () => {
    withOutputDir((outputDir) => {
        const result = compile(configPath, outputDir);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(existsSync(path.join(outputDir, 'security/audit.test.js')), true);
    });
});

test('removing the audit override exposes the inherited TS5096 regression', () => {
    withOutputDir((outputDir) => {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        config.extends = path.resolve(root, config.extends);
        config.include = config.include.map((file) => path.resolve(root, file));
        delete config.compilerOptions.allowImportingTsExtensions;
        const mutatedConfigPath = path.join(outputDir, 'tsconfig.json');
        writeFileSync(mutatedConfigPath, JSON.stringify(config));

        const result = compile(mutatedConfigPath, outputDir);
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, /error TS5096:/);
    });
});
