/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import { createSyntheticTrustedAgentService } from '../../../lib/agent-interface/trusted-service';
import { MINI_EXIT, MINI_STDIN_MAX_BYTES, runMini } from './cli';

const PATIENT = 'synthetic-patient-001';
const json = (run: ReturnType<typeof runMini>) => JSON.parse(run.stdout);
const CLI = ['scripts/run-strip-types.mjs', 'packages/mini/src/cli.ts'];

function runWithOpenStdin(args: readonly string[], input = ''): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [...CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
        child.stdin.on('error', () => undefined);
        if (input) child.stdin.write(input);
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Mini waited for stdin')); }, 1_500);
        child.on('error', reject);
        child.on('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    });
}

test('nega il broker live assente e mostra help stabile', () => {
    assert.deepEqual(json(runMini(['whoami'])), { schemaVersion: 'mediflow.mini.output.v1', ok: false, error: 'BROKER_UNAVAILABLE' });
    assert.equal(runMini(['whoami']).exitCode, MINI_EXIT.BROKER_UNAVAILABLE);
    assert.match(runMini(['--help']).stdout, /patient search <query>/);
    assert.match(runMini(['--help']).stdout, /npm run --silent mini --/);
    assert.doesNotMatch(runMini(['--help']).stdout, /Usage: mediflow-mini/);
});

test('espone tutte le superfici sintetiche autorizzate con JSON deterministico', () => {
    const cases = [
        [['whoami'], 'sessionRef'], [['capabilities'], '0'],
        [['patient', 'search', 'Sintetico'], '0'], [['patient', 'show', PATIENT], 'patientRef'],
        [['open-loops', PATIENT], 'items'], [['draft', 'preview', PATIENT], 'kind'],
    ];
    for (const [words, key] of cases) {
        const first = runMini(['--synthetic', ...(words as string[])]);
        assert.equal(first.exitCode, MINI_EXIT.OK);
        assert.ok(Object.hasOwn(json(first).data, key as string));
        assert.equal(first.stdout, runMini(['--synthetic', ...(words as string[])]).stdout);
    }
});

test('accetta il contratto pipe JSON e rende array NDJSON ordinati', () => {
    const pipe = runMini(['--synthetic'], JSON.stringify({ command: 'patient.search', args: { query: 'Sintetico' } }));
    assert.equal(json(pipe).data[0].patientRef, PATIENT);
    const ndjson = runMini(['--synthetic', '--format', 'ndjson', 'capabilities']);
    const rows = ndjson.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rows.length, 7); assert.equal(rows[0].index, 0); assert.equal(rows[6].data.command, 'apply');
});

test('nega authority extra, query vuota, apply e lifecycle del broker', () => {
    const forged = runMini(['--synthetic'], JSON.stringify({ command: 'whoami', args: {}, session: { role: 'admin' } }));
    assert.equal(forged.exitCode, MINI_EXIT.USAGE); assert.equal(forged.stdout.includes('admin'), false);
    assert.equal(runMini(['--synthetic', 'patient', 'search', '   ']).exitCode, MINI_EXIT.USAGE);
    assert.equal(runMini(['--synthetic', 'patient', 'show', 'synthetic-missing']).exitCode, MINI_EXIT.NOT_FOUND);
    assert.equal(runMini(['--synthetic', 'apply', PATIENT]).exitCode, MINI_EXIT.APPLY_DENIED);

    const replay = createSyntheticTrustedAgentService();
    assert.equal(runMini(['--synthetic', 'whoami'], '', replay.service).exitCode, MINI_EXIT.OK);
    const replayed = runMini(['--synthetic', 'whoami'], '', replay.service);
    assert.equal(replayed.exitCode, MINI_EXIT.AUTHORITY); assert.equal(json(replayed).error, 'REQUEST_REPLAYED');
    const revoked = createSyntheticTrustedAgentService(); revoked.control.revoke();
    const revokedRun = runMini(['--synthetic', 'whoami'], '', revoked.service);
    assert.equal(revokedRun.exitCode, MINI_EXIT.AUTHORITY); assert.equal(json(revokedRun).error, 'SESSION_REVOKED');
    const changed = createSyntheticTrustedAgentService(); changed.control.changeSelection();
    const changedRun = runMini(['--synthetic', 'whoami'], '', changed.service);
    assert.equal(changedRun.exitCode, MINI_EXIT.AUTHORITY); assert.equal(json(changedRun).error, 'SELECTION_CHANGED');
});

test('mantiene stdout pulito e chiude argv e input eccessivo senza attendere EOF', async () => {
    const clean = spawnSync('npm', ['run', '--silent', 'mini', '--', '--synthetic', 'whoami'], { encoding: 'utf8' });
    assert.equal(clean.status, MINI_EXIT.OK); assert.equal(clean.stderr, ''); assert.equal(JSON.parse(clean.stdout).ok, true);

    const argvRun = await runWithOpenStdin(['--synthetic', 'whoami']);
    assert.equal(argvRun.code, MINI_EXIT.OK); assert.equal(argvRun.stderr, ''); assert.equal(JSON.parse(argvRun.stdout).ok, true);

    const oversized = await runWithOpenStdin(['--synthetic'], 'caller-text'.repeat(Math.ceil((MINI_STDIN_MAX_BYTES + 1) / 11)));
    assert.equal(oversized.code, MINI_EXIT.USAGE); assert.equal(oversized.stderr, '');
    assert.deepEqual(JSON.parse(oversized.stdout), {
        schemaVersion: 'mediflow.mini.output.v1', ok: false, error: 'INPUT_TOO_LARGE',
    });
    assert.equal(oversized.stdout.includes('caller-text'), false);
});
