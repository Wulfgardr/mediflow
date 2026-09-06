#!/usr/bin/env node
/* @Codex: Relay verified test checkpoints between two real native UI writers.
   No HTTP, clinical writer, app flag, simulator control or production import. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const stages = [
    { event: 'contender-ready', source: 'contender', target: 'peer', checkpointID: 'step-001', delta: 0, contentRole: null },
    { event: 'peer-saved', source: 'peer', target: 'contender', checkpointID: 'step-002', delta: 1, contentRole: 'peer' },
    { event: 'contender-saved', source: 'contender', target: 'peer', checkpointID: 'step-005', delta: 2, contentRole: 'contender' },
    { event: 'peer-reread', source: 'peer', target: 'contender', checkpointID: 'step-003', delta: 2, contentRole: 'contender' },
];

export function validateCase(value) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.synthetic, true);
    assert.match(value.groupID, /^[A-Za-z0-9._-]{1,100}$/u);
    for (const field of ['fixtureId', 'patientId', 'entryID', 'baseTitle', 'baseBody']) {
        assert.ok(typeof value[field] === 'string' && value[field].trim().length > 0);
    }
    assert.ok(Number.isSafeInteger(value.baseVersion) && value.baseVersion > 0);
    assert.ok(['note', 'visit', 'phone', 'other'].includes(value.baseType));
    assert.ok(!/[\r\n]/u.test(value.baseBody), 'Use the actual one-paragraph workflow fixture');
    return value;
}

export function validateParticipants(cas, contender, peer) {
    for (const [role, participant] of [['contender', contender], ['peer', peer]]) {
        assert.equal(participant.schemaVersion, 1);
        assert.equal(participant.synthetic, true);
        assert.equal(participant.casRole, role);
        assert.equal(participant.fixtureId, cas.fixtureId);
        assert.equal(participant.casGroupID, cas.groupID);
        assert.equal(participant.entryID, cas.entryID);
        assert.equal(participant.baseVersion, cas.baseVersion);
        assert.match(participant.runID, /^[A-Za-z0-9._-]{1,100}$/u);
        assert.match(participant.hostSourceCommit, /^[a-f0-9]{40}$/u);
        assert.ok(['ios', 'ipados'].includes(participant.clientPlatform));
    }
    assert.notEqual(contender.runID, peer.runID);
    assert.notEqual(contender.clientPlatform, peer.clientPlatform);
    assert.equal(contender.hostSourceCommit, peer.hostSourceCommit);
}

export function expectedFields(cas, role) {
    const paragraph = text => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`;
    return { title: role ? `CAS ${role} ${cas.groupID}` : cas.baseTitle,
        type: cas.baseType, content: paragraph(cas.baseBody)
            + (role ? paragraph(`Paragrafo sintetico ${role} ${cas.groupID}`) : '') };
}

export function validateRelayEvidence(cas, stage, participant, event, checkpoint, receipt) {
    for (const value of [event, checkpoint]) {
        assert.equal(value.schemaVersion, 1);
        assert.equal(value.synthetic, true);
        assert.equal(value.fixtureId, cas.fixtureId);
        assert.equal(value.runID, participant.runID);
        assert.equal(value.clientPlatform, participant.clientPlatform);
    }
    assert.equal(event.event, stage.event);
    assert.equal(event.casGroupID, cas.groupID);
    assert.equal(event.entryID, cas.entryID);
    assert.equal(event.baseVersion, cas.baseVersion);
    assert.equal(event.checkpointID, stage.checkpointID);
    assert.equal(checkpoint.stepID, stage.checkpointID);
    assert.equal(checkpoint.module, 'entry');
    assert.equal(checkpoint.patientId, cas.patientId);
    assert.equal(checkpoint.recordId, cas.entryID);
    assert.equal(checkpoint.version, cas.baseVersion + stage.delta);
    assert.equal(checkpoint.deleted, false);
    assert.deepEqual(checkpoint.expected, expectedFields(cas, stage.contentRole));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.status, 'pass');
    assert.equal(receipt.runID, participant.runID);
    assert.equal(receipt.fixtureId, cas.fixtureId);
    assert.equal(receipt.writerClientPlatform, participant.clientPlatform);
    assert.equal(receipt.hostSourceCommit, participant.hostSourceCommit);
    assert.equal(receipt.module, 'entry');
    assert.equal(receipt.recordId, cas.entryID);
    assert.equal(receipt.stepID, stage.checkpointID);
    assert.equal(receipt.comparison.version, cas.baseVersion + stage.delta);
    assert.equal(receipt.comparison.deleted, false);
    assert.deepEqual([...receipt.comparison.comparedFields].sort(), ['content', 'title', 'type']);
}

function privateJSON(file) {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && (stat.mode & 0o777) === 0o600);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function publish(directory, name, value) {
    const destination = path.join(directory, `${name}.json`);
    assert.ok(!fs.existsSync(destination), 'A CAS event cannot be replayed into an existing run');
    const temporary = path.join(directory, `.${randomUUID()}.json`);
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
}

async function waitFor(file, directories) {
    const deadline = Date.now() + 300_000;
    while (!fs.existsSync(file)) {
        if (directories.some(directory => fs.existsSync(path.join(directory, 'ui-finished.json'))
            || fs.existsSync(path.join(directory, 'cas-aborted.json')))) throw new Error('UI participant ended before its required evidence');
        assert.ok(Date.now() < deadline, 'Bounded two-app checkpoint wait elapsed');
        await delay(100);
    }
}

async function main() {
    const { values } = parseArgs({ options: { case: { type: 'string' },
        'contender-directory': { type: 'string' }, 'peer-directory': { type: 'string' } } });
    assert.ok(values.case && values['contender-directory'] && values['peer-directory']);
    const cas = validateCase(privateJSON(values.case));
    const directories = { contender: path.resolve(values['contender-directory']), peer: path.resolve(values['peer-directory']) };
    assert.notEqual(directories.contender, directories.peer);
    for (const directory of Object.values(directories)) {
        const stat = fs.lstatSync(directory);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700);
        fs.closeSync(fs.openSync(path.join(directory, '.cas-relay-owner'), 'wx', 0o600));
    }
    try {
        const participants = {};
        for (const role of ['contender', 'peer']) {
            const file = path.join(directories[role], 'cas-participant.json');
            await waitFor(file, Object.values(directories));
            participants[role] = privateJSON(file);
        }
        validateParticipants(cas, participants.contender, participants.peer);
        for (const stage of stages) {
            const from = directories[stage.source], source = participants[stage.source], target = participants[stage.target];
            const eventFile = path.join(from, `cas-${stage.event}.json`);
            const checkpointFile = path.join(from, `${stage.checkpointID}.json`);
            const receiptFile = path.join(from, `${stage.checkpointID}-receipt.json`);
            await waitFor(eventFile, Object.values(directories));
            await waitFor(receiptFile, Object.values(directories));
            validateRelayEvidence(cas, stage, source, privateJSON(eventFile), privateJSON(checkpointFile), privateJSON(receiptFile));
            publish(directories[stage.target], `cas-relay-${stage.event}`, {
                schemaVersion: 1, synthetic: true, fixtureId: cas.fixtureId, runID: target.runID,
                casGroupID: cas.groupID, entryID: cas.entryID, baseVersion: cas.baseVersion, event: stage.event,
                hostSourceCommit: source.hostSourceCommit, sourceRunID: source.runID, sourceClientPlatform: source.clientPlatform,
                sourceReceiptSHA256: createHash('sha256').update(fs.readFileSync(receiptFile)).digest('hex'),
            });
            console.log(`CAS receipt relayed: ${stage.event}`);
        }
        console.log('Four matching receipts relayed; both XCTest terminal results remain required.');
    } catch {
        for (const directory of Object.values(directories)) {
            if (!fs.existsSync(path.join(directory, 'cas-aborted.json'))) publish(directory, 'cas-aborted', {
                schemaVersion: 1, synthetic: true, fixtureId: cas.fixtureId, casGroupID: cas.groupID,
                reason: 'Two-app evidence missing or inconsistent; no CAS pass claim.',
            });
        }
        throw new Error('CAS relay stopped without a complete sequence');
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => { console.error('CAS relay failed; inspect private synthetic run receipts.'); process.exitCode = 1; });
}
