#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from './crypto.mjs';

export function compareReports(javascript, rust) {
    for (const report of [javascript, rust]) {
        assert.equal(report.schemaVersion, 1);
        assert.equal(report.result, 'pass', 'An adapter failure is never an equivalence result');
        assert.ok(['paired-v3-snapshot-1', 'paired-v3-snapshot-2'].includes(report.protocolId),
            'The release Web PIN path is a separate compatibility observation');
        assert.ok(typeof report.archiveGeneration === 'string' && report.archiveGeneration.length > 0);
        if (report.protocolId === 'paired-v3-snapshot-2') {
            assert.ok(Array.isArray(report.snapshot?.agenda) && Array.isArray(report.snapshot?.globalDiary),
                'Snapshot 2 requires both declared aggregate projections');
        }
    }
    assert.equal(javascript.protocolId, rust.protocolId, 'Both clients must implement the same declared projection protocol');
    assert.equal(javascript.baseUrl, rust.baseUrl, 'Both clients must use the exact same host origin');
    assert.equal(javascript.archiveGeneration, rust.archiveGeneration, 'Both clients must observe the same archive generation');
    assert.equal(javascript.corpusSha256, rust.corpusSha256, 'Both clients must use the same corpus');
    assert.deepEqual(javascript.snapshot, rust.snapshot, 'The complete declared read projection must match');
    const snapshotCanonicalSha256 = sha256(canonicalJson(javascript.snapshot));
    for (const report of [javascript, rust]) {
        if (report.snapshotCanonicalSha256) assert.equal(report.snapshotCanonicalSha256, snapshotCanonicalSha256);
    }
    const checkedWrites = Boolean(javascript.writes || rust.writes);
    if (checkedWrites) {
        assert.ok(javascript.writes && rust.writes, 'Mutation comparison requires results from both clients');
        for (const writes of [javascript.writes, rust.writes]) {
            assert.equal(writes.beforeVersion, 1, 'Mutation scenarios start from equivalent fresh fixtures');
            assert.equal(writes.afterVersion, 2);
            assert.equal(writes.notesSha256, sha256('Confronto sintetico JS/Rust: aggiornamento verificato. Città e 🩺.'));
            assert.equal(writes.readback, true);
            assert.equal(writes.staleStatus, 409, 'An actual second-session stale write must be rejected');
            assert.equal(writes.replay.source, 'client');
            assert.deepEqual(writes.entry, { version: 1,
                titleSha256: sha256('Confronto sintetico JS/Rust'),
                contentSha256: sha256('<p>Voce sintetica JS/Rust: città e 🩺.</p>'), readback: true });
        }
        // These are different existing state machines. Check each observed
        // boundary explicitly, rather than inventing identical local errors.
        assert.equal(javascript.writes.replay.error, 'journal-locked');
        assert.equal(rust.writes.replay.error, 'read-required');
        assert.equal(javascript.writes.unchangedWrites, 0);
    }
    return {
        schemaVersion: 1, result: 'pass', protocolId: javascript.protocolId,
        baseUrl: javascript.baseUrl, archiveGeneration: javascript.archiveGeneration,
        corpusSha256: javascript.corpusSha256, snapshotCanonicalSha256,
        checkedWrites,
        ...(checkedWrites ? { observedDifference: 'JavaScript rejects another submit through its journal; Rust requires a new read receipt. Both local retries sent no second write.' } : {}),
        scope: 'Declared synthetic read projections, decryption, and explicitly exercised versioned writes. UI, IME, accessibility, durability and complete feature equivalence are not measured by this protocol.',
    };
}

export function compareResourceWritesReports(javascript, rust) {
    const snapshot = compareReports(javascript, rust);
    assert.equal(snapshot.checkedWrites, false, 'Resource scenarios must not repeat the notes phase');
    const fixture = JSON.parse(fs.readFileSync(new URL('./resource-writes.json', import.meta.url), 'utf8'));
    const fixtureSha256 = sha256(canonicalJson(fixture));
    for (const report of [javascript, rust]) {
        const writes = report.resourceWrites;
        assert.ok(writes, 'Both clients must provide an observed resource-write receipt');
        assert.equal(writes.protocolId, fixture.protocolId);
        assert.equal(writes.fixtureSha256, fixtureSha256);
        for (const domain of ['therapies', 'observations', 'checkups']) {
            assert.deepEqual(writes[domain], { createdVersion: 1, updatedVersion: 2,
                createdProjectionSha256: sha256(canonicalJson(fixture[domain].create)),
                updatedProjectionSha256: sha256(canonicalJson(fixture[domain].update)),
                readback: true, staleStatus: 409, stalePreserved: true });
        }
        const bytes = Buffer.from(fixture.attachment.text, 'utf8');
        assert.deepEqual(writes.attachment, { created: true, size: bytes.length,
            nameSha256: sha256(fixture.attachment.name), bytesSha256: sha256(bytes),
            dataSha256: sha256(`data:${fixture.attachment.type};base64,${bytes.toString('base64')}`),
            listPayloadOmitted: true, readback: true });
    }
    assert.deepEqual(javascript.resourceWrites, rust.resourceWrites);
    return { schemaVersion: 1, result: 'pass', protocolId: fixture.protocolId,
        baseUrl: snapshot.baseUrl, archiveGeneration: snapshot.archiveGeneration,
        corpusSha256: snapshot.corpusSha256, fixtureSha256,
        snapshotProtocolId: snapshot.protocolId, snapshotCanonicalSha256: snapshot.snapshotCanonicalSha256,
        resources: javascript.resourceWrites,
        scope: 'Observed create/read/update/read and independent stale HTTP409 for therapy, observation and checkup; document create, payload-free list and verified detail. No deletion, document update, UI or product performance qualification.' };
}

export function comparePatientProfileWritesReports(javascript, rust) {
    const fixture = JSON.parse(fs.readFileSync(new URL('./patient-profile-writes.json', import.meta.url), 'utf8'));
    const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
    const fixtureSha256 = sha256(canonicalJson(fixture));
    const common = { protocolId: fixture.protocolId, fixtureSha256,
        createdVersion: 1, updatedVersion: 2, clearedVersion: 3,
        createdProjectionSha256: sha256(canonicalJson(fixture.create)),
        updatedProjectionSha256: sha256(canonicalJson({ ...fixture.create, ...fixture.update })),
        clearedProjectionSha256: sha256(canonicalJson({ ...fixture.create, ...fixture.update, ...fixture.clear })),
        sparsePreserved: true, clearPreserved: true, staleStatus: 409, stalePreserved: true, readback: true };
    for (const [client, report] of [['javascript', javascript], ['rust', rust]]) {
        assert.equal(report.schemaVersion, 1);
        assert.equal(report.result, 'pass');
        assert.equal(report.synthetic, true);
        assert.equal(report.client, client);
        assert.equal(report.protocolId, fixture.protocolId);
        assert.equal(report.corpusSha256, sha256(canonicalJson(corpus)));
        assert.ok(typeof report.archiveGeneration === 'string' && report.archiveGeneration.length > 0);
        assert.equal(report.snapshot, null, 'Patient creation changes the global list; this phase must not present it as a paired snapshot');
        assert.equal(report.snapshotCanonicalSha256, null);
        assert.equal(report.timingsMs.snapshot, null);
        assert.equal(report.requestCounts.snapshot, 0);
        if (client === 'javascript') assert.equal(report.missingSessionStatus, 401,
            'The reference HTTP adapter independently probes a request without an operator session');
        assert.equal(Boolean(report.writes || report.resourceWrites), false, 'Profile scenarios are a separate mutation phase');
        const writes = report.patientProfileWrites;
        assert.ok(writes, 'Both clients must provide an observed patient-profile receipt');
        assert.match(writes.patientIdSha256, /^[a-f0-9]{64}$/u);
        assert.deepEqual(writes, { ...common, patientIdSha256: writes.patientIdSha256,
            taxCodeSha256: sha256(fixture.taxCodes[client]) }, 'Each client must match its own exact synthetic fixture and all shared readback fields');
    }
    assert.equal(javascript.baseUrl, rust.baseUrl);
    assert.equal(javascript.archiveGeneration, rust.archiveGeneration);
    assert.notEqual(javascript.patientProfileWrites.patientIdSha256, rust.patientProfileWrites.patientIdSha256,
        'The two clients must create distinct patient identities');
    return { schemaVersion: 1, result: 'pass', protocolId: fixture.protocolId,
        baseUrl: javascript.baseUrl, archiveGeneration: javascript.archiveGeneration,
        corpusSha256: javascript.corpusSha256, fixtureSha256,
        profile: common, patients: Object.fromEntries([['javascript', javascript], ['rust', rust]].map(([client, report]) => [client, {
            patientIdSha256: report.patientProfileWrites.patientIdSha256, taxCodeSha256: report.patientProfileWrites.taxCodeSha256,
        }])), snapshotOmitted: true,
        scope: 'Observed distinct synthetic patient create/read v1, sparse update/read v2, independent stale HTTP409 with preserved accepted fields, and explicit null/read v3 with omitted profile fields unchanged. Global patient counts differ by design. No lifecycle deletion/restoration, UI, or product performance qualification.' };
}

export function compareReleaseProjection(release, candidate) {
    for (const report of [release, candidate]) {
        assert.equal(report.schemaVersion, 1);
        assert.equal(report.result, 'pass');
        assert.ok(typeof report.archiveGeneration === 'string' && report.archiveGeneration.length > 0);
    }
    assert.equal(release.protocolId, 'release-web-pin-snapshot-1');
    assert.equal(candidate.protocolId, 'paired-v3-snapshot-1');
    assert.notEqual(release.baseUrl, candidate.baseUrl);
    assert.notEqual(release.archiveGeneration, candidate.archiveGeneration);
    assert.equal(release.corpusSha256, candidate.corpusSha256);
    assert.deepEqual(release.snapshot, candidate.snapshot);
    const snapshotCanonicalSha256 = sha256(canonicalJson(release.snapshot));
    assert.equal(release.snapshotCanonicalSha256, snapshotCanonicalSha256);
    return { schemaVersion: 1, result: 'pass', protocolId: 'release-candidate-read-compatibility-1',
        release: { baseUrl: release.baseUrl, archiveGeneration: release.archiveGeneration, protocolId: release.protocolId },
        candidate: { baseUrl: candidate.baseUrl, archiveGeneration: candidate.archiveGeneration, protocolId: candidate.protocolId },
        corpusSha256: release.corpusSha256, snapshotCanonicalSha256, projectionEqual: true,
        qualification: 'Exact declared decrypted resource projections agree across separately seeded release and candidate archives. Authentication protocols and generations differ. This is read compatibility, not same-host paired-v3 equivalence, UI qualification, or a performance comparison.' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const mode = args[0]?.startsWith('--') ? args.shift() : '--snapshot';
    const [javascriptPath, rustPath] = args;
    if (!javascriptPath || !rustPath || args.length !== 2 || !['--snapshot', '--resources', '--patient-profiles', '--release'].includes(mode)) {
        throw new Error('Usage: node compare.mjs [--resources|--patient-profiles|--release] javascript-report.json rust-report.json');
    }
    const compare = mode === '--resources' ? compareResourceWritesReports
        : mode === '--patient-profiles' ? comparePatientProfileWritesReports : mode === '--release' ? compareReleaseProjection : compareReports;
    console.log(JSON.stringify(compare(JSON.parse(fs.readFileSync(javascriptPath, 'utf8')), JSON.parse(fs.readFileSync(rustPath, 'utf8')))));
}
