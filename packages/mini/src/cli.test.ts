/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSyntheticTrustedAgentService } from '../../../lib/agent-interface/trusted-service';
import { MINI_EXIT, runMini } from './cli';

const PATIENT = 'synthetic-patient-001';
const json = (run: ReturnType<typeof runMini>) => JSON.parse(run.stdout);

test('nega il broker live assente e mostra help stabile', () => {
    assert.deepEqual(json(runMini(['whoami'])), { schemaVersion: 'mediflow.mini.output.v1', ok: false, error: 'BROKER_UNAVAILABLE' });
    assert.equal(runMini(['whoami']).exitCode, MINI_EXIT.BROKER_UNAVAILABLE);
    assert.match(runMini(['--help']).stdout, /patient search <query>/);
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
    assert.equal(runMini(['--synthetic', 'apply', PATIENT]).exitCode, MINI_EXIT.APPLY_DENIED);

    const replay = createSyntheticTrustedAgentService();
    assert.equal(runMini(['--synthetic', 'whoami'], '', replay.service).exitCode, MINI_EXIT.OK);
    assert.equal(json(runMini(['--synthetic', 'whoami'], '', replay.service)).error, 'REQUEST_REPLAYED');
    const revoked = createSyntheticTrustedAgentService(); revoked.control.revoke();
    assert.equal(json(runMini(['--synthetic', 'whoami'], '', revoked.service)).error, 'SESSION_REVOKED');
    const changed = createSyntheticTrustedAgentService(); changed.control.changeSelection();
    assert.equal(json(runMini(['--synthetic', 'whoami'], '', changed.service)).error, 'SELECTION_CHANGED');
});
