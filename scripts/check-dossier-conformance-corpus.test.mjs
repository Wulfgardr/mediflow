import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    compareCorpusDirectories,
    GENERATED_CORPUS_FILES,
    REGENERATE_COMMAND,
} from './check-dossier-conformance-corpus.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeTempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('compareCorpusDirectories reports zero mismatches on byte-identical files', (t) => {
    const committed = makeTempDir(t, 'mediflow-corpus-committed-');
    const generated = makeTempDir(t, 'mediflow-corpus-generated-');
    for (const file of GENERATED_CORPUS_FILES) {
        const payload = JSON.stringify([file]);
        fs.writeFileSync(path.join(committed, file), payload);
        fs.writeFileSync(path.join(generated, file), payload);
    }
    assert.deepEqual(compareCorpusDirectories(committed, generated), []);
});

test('compareCorpusDirectories detects drifted and missing corpus files', (t) => {
    const committed = makeTempDir(t, 'mediflow-corpus-committed-');
    const generated = makeTempDir(t, 'mediflow-corpus-generated-');
    for (const file of GENERATED_CORPUS_FILES) {
        fs.writeFileSync(path.join(generated, file), JSON.stringify([file, 'new']));
        if (file !== 'expected.json') {
            fs.writeFileSync(path.join(committed, file), JSON.stringify([file, file === 'ts-cases.json' ? 'old' : 'new']));
        }
    }
    assert.deepEqual(compareCorpusDirectories(committed, generated), [
        { file: 'ts-cases.json', reason: 'differs', committedBytes: 23, generatedBytes: 23 },
        { file: 'expected.json', reason: 'missing', generatedBytes: 23 },
    ]);
});

test('CLI guard fails with remediation command when committed corpus drifts from generator', (t) => {
    const staleDir = makeTempDir(t, 'mediflow-corpus-stale-');
    const committedDir = path.join(ROOT_DIR, 'native/contracts/dossier-conformance');
    for (const file of GENERATED_CORPUS_FILES) {
        fs.copyFileSync(path.join(committedDir, file), path.join(staleDir, file));
    }
    fs.writeFileSync(path.join(staleDir, 'ts-cases.json'), '[]');
    const run = spawnSync(
        process.execPath,
        ['scripts/check-dossier-conformance-corpus.mjs', '--committed-dir', staleDir],
        { cwd: ROOT_DIR, encoding: 'utf8' },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ts-cases\.json/u);
    assert.ok(run.stderr.includes(REGENERATE_COMMAND), run.stderr);
});
