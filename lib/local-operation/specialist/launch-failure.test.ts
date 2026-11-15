import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const LIMIT_MS = 30_000;

test('CU-1 verticale: un lancio fallito del browser chiude la fixture e termina con l’errore', { timeout: LIMIT_MS + 10_000 }, async t => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'mediflow-cu-launch-failure-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', '--test',
        '--test-name-pattern=sospensione e riapertura', 'lib/local-operation/specialist/vertical.test.ts'], {
        cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MEDIFLOW_DATA_DIR: scratch, PLAYWRIGHT_BROWSERS_PATH: path.join(scratch, 'no-browsers'), MEDIFLOW_CU_CAPTURE_DIR: '' },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const started = Date.now();
    const outcome = await new Promise<{ code: number | null; timedOut: boolean }>(resolve => {
        const timer = setTimeout(() => { process.kill(-child.pid!, 'SIGKILL'); resolve({ code: null, timedOut: true }); }, LIMIT_MS);
        child.on('exit', code => { clearTimeout(timer); resolve({ code, timedOut: false }); });
    });
    assert.equal(outcome.timedOut, false, `la verticale è rimasta appesa oltre ${LIMIT_MS} ms dopo il lancio fallito\n${output}`);
    assert.notEqual(outcome.code, 0, output);
    assert.match(output, /browserType\.launch/);
    assert.ok(Date.now() - started < LIMIT_MS);
});
