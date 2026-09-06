/* @Codex: Pure synthetic receipt tests; no host, app or simulator is contacted. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stages, validateCase, validateParticipants, expectedFields, validateRelayEvidence }
    from './mobile-home-base-interop-cas-relay.mjs';

const cas = { schemaVersion: 1, synthetic: true, fixtureId: 'unit-fixture', groupID: 'unit-cas',
    patientId: 'unit-patient', entryID: 'unit-entry', baseVersion: 7,
    baseTitle: 'Voce sintetica', baseBody: 'Corpo sintetico & <test>', baseType: 'note' };
const hostSourceCommit = 'a'.repeat(40);
const participants = Object.fromEntries(['contender', 'peer'].map((role, index) => [role, {
    schemaVersion: 1, synthetic: true, fixtureId: cas.fixtureId, casGroupID: cas.groupID,
    casRole: role, entryID: cas.entryID, baseVersion: cas.baseVersion,
    runID: `unit-${role}`, clientPlatform: index === 0 ? 'ios' : 'ipados', hostSourceCommit,
}]));

function evidence(stage) {
    const participant = participants[stage.source];
    const envelope = { schemaVersion: 1, synthetic: true, fixtureId: cas.fixtureId,
        runID: participant.runID, clientPlatform: participant.clientPlatform };
    const content = '<p>Corpo sintetico &amp; &lt;test></p>'
        + (stage.contentRole ? `<p>Paragrafo sintetico ${stage.contentRole} unit-cas</p>` : '');
    const title = stage.contentRole ? `CAS ${stage.contentRole} unit-cas` : 'Voce sintetica';
    return {
        event: { ...envelope, event: stage.event, casGroupID: cas.groupID,
            entryID: cas.entryID, baseVersion: 7, checkpointID: stage.checkpointID },
        checkpoint: { ...envelope, stepID: stage.checkpointID, module: 'entry', patientId: cas.patientId,
            recordId: cas.entryID, version: 7 + stage.delta, deleted: false,
            expected: { title, type: 'note', content } },
        receipt: { schemaVersion: 1, status: 'pass', fixtureId: cas.fixtureId, runID: participant.runID,
            stepID: stage.checkpointID, module: 'entry', recordId: cas.entryID,
            writerClientPlatform: participant.clientPlatform, hostSourceCommit,
            comparison: { version: 7 + stage.delta, deleted: false, comparedFields: ['title', 'type', 'content'] } },
    };
}

test('CAS case requires positive prior UI evidence and the exact one-paragraph fixture', () => {
    assert.equal(validateCase(cas), cas);
    for (const invalid of [null, [], { ...cas, synthetic: false }, { ...cas, groupID: '../other' },
        { ...cas, baseVersion: 0 }, { ...cas, baseVersion: true }, { ...cas, baseBody: 'one\ntwo' },
        { ...cas, entryID: '' }, { ...cas, baseType: 'unknown' }]) assert.throws(() => validateCase(invalid));
    assert.deepEqual(expectedFields(cas, 'peer'), { title: 'CAS peer unit-cas', type: 'note',
        content: '<p>Corpo sintetico &amp; &lt;test></p><p>Paragrafo sintetico peer unit-cas</p>' });
});

test('two participants must bind different native clients and runs to the same exact host and entry', () => {
    validateParticipants(cas, participants.contender, participants.peer);
    for (const changes of [{ runID: 'unit-contender' }, { clientPlatform: 'ios' },
        { hostSourceCommit: 'b'.repeat(40) }, { entryID: 'other-entry' }, { fixtureId: 'other-fixture' },
        { casGroupID: 'other-group' }, { baseVersion: 8 }, { casRole: 'contender' }]) {
        assert.throws(() => validateParticipants(cas, participants.contender, { ...participants.peer, ...changes }));
    }
});

test('only the four ordered UI and independent-read checkpoints can advance CAS', () => {
    assert.deepEqual(stages.map(stage => [stage.event, stage.checkpointID, stage.delta]), [
        ['contender-ready', 'step-001', 0], ['peer-saved', 'step-002', 1],
        ['contender-saved', 'step-005', 2], ['peer-reread', 'step-003', 2],
    ]);
    for (const stage of stages) {
        const { event, checkpoint, receipt } = evidence(stage);
        validateRelayEvidence(cas, stage, participants[stage.source], event, checkpoint, receipt);
    }
});

test('a matching revision alone cannot relay stale, foreign, incomplete or failed evidence', () => {
    const stage = stages[1];
    const invalidations = [
        value => { value.event.runID = 'another-run'; },
        value => { value.event.event = 'contender-saved'; },
        value => { value.event.checkpointID = 'step-001'; },
        value => { value.checkpoint.patientId = 'another-patient'; },
        value => { value.checkpoint.version = 9; },
        value => { value.checkpoint.expected.content = '<p>Locally altered without peer save</p>'; },
        value => { value.receipt.status = 'failed'; },
        value => { value.receipt.writerClientPlatform = 'ios'; },
        value => { value.receipt.hostSourceCommit = 'b'.repeat(40); },
        value => { value.receipt.recordId = 'another-entry'; },
        value => { value.receipt.comparison.comparedFields = ['title', 'type']; },
        value => { value.receipt.comparison.deleted = true; },
    ];
    for (const invalidate of invalidations) {
        const value = evidence(stage);
        invalidate(value);
        assert.throws(() => validateRelayEvidence(cas, stage, participants.peer, value.event, value.checkpoint, value.receipt));
    }
});

function privateFixture(t, invalid = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cas-relay-unit-'));
    fs.chmodSync(root, 0o700);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    write(path.join(root, 'case.json'), cas);
    const directories = {};
    for (const role of ['contender', 'peer']) {
        directories[role] = path.join(root, role);
        fs.mkdirSync(directories[role], { mode: 0o700 });
        write(path.join(directories[role], 'cas-participant.json'), participants[role]);
    }
    for (const stage of stages) {
        const value = evidence(stage);
        if (invalid && stage.event === 'peer-saved') value.receipt.comparison.version = 7;
        const directory = directories[stage.source];
        write(path.join(directory, `cas-${stage.event}.json`), value.event);
        write(path.join(directory, `${stage.checkpointID}.json`), value.checkpoint);
        write(path.join(directory, `${stage.checkpointID}-receipt.json`), value.receipt);
    }
    const args = [fileURLToPath(new URL('./mobile-home-base-interop-cas-relay.mjs', import.meta.url)),
        '--case', path.join(root, 'case.json'), '--contender-directory', directories.contender,
        '--peer-directory', directories.peer];
    return { directories, args };
}

test('local relay publishes private recipient-bound receipts without claiming an app test pass', t => {
    const { directories, args } = privateFixture(t);
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 3000 });
    assert.match(stdout, /both XCTest terminal results remain required/u);
    for (const stage of stages) {
        const file = path.join(directories[stage.target], `cas-relay-${stage.event}.json`);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(receipt.runID, participants[stage.target].runID);
        assert.equal(receipt.sourceRunID, participants[stage.source].runID);
        assert.equal(receipt.event, stage.event);
        assert.match(receipt.sourceReceiptSHA256, /^[a-f0-9]{64}$/u);
    }
});

test('an inconsistent peer receipt aborts both private runs without publishing a peer-save event', t => {
    const { directories, args } = privateFixture(t, true);
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(path.join(directories.contender, 'cas-relay-peer-saved.json')), false);
    for (const directory of Object.values(directories)) {
        const aborted = path.join(directory, 'cas-aborted.json');
        assert.equal(fs.statSync(aborted).mode & 0o777, 0o600);
        assert.equal(JSON.parse(fs.readFileSync(aborted, 'utf8')).casGroupID, cas.groupID);
    }
});
