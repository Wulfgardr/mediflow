#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalJson, deriveUnlock, openPinWrapping, sha256, unwrapKey } from './crypto.mjs';

const [flag, privatePath] = process.argv.slice(2);
if (flag !== '--config' || !privatePath || process.argv.length !== 4) throw new Error('Usage: node js-client.mjs --config /tmp/owned/client-private.json');
assert.equal(fs.statSync(privatePath).mode & 0o077, 0, 'Client credentials require mode 600');
const config = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
assert.equal(config.synthetic, true);
assert.equal(config.corpusSha256, sha256(canonicalJson(corpus)), 'Configuration must refer to the exact public synthetic corpus');
assert.equal(Object.hasOwn(config, 'MEDIFLOW_LOCAL_API_TOKEN'), false, 'The comparison client must not receive an administrative bearer');
const baseUrl = new URL(config.baseUrl);
assert.equal(baseUrl.protocol, 'http:', 'This reference transport is only for the literal-loopback functional comparison; TLS is qualified separately');
assert.equal(baseUrl.hostname, '127.0.0.1');
assert.equal(baseUrl.pathname, '/');
assert.equal(baseUrl.username + baseUrl.password + baseUrl.search + baseUrl.hash, '');
assert.ok(!config.tlsPinSha256, 'A TLS pin must not be silently ignored');
const sourceRoot = path.resolve(config.javascriptSourceRoot);
const editorPath = path.join(sourceRoot, 'lib/patient-edit-session.ts');
const securityPath = path.join(sourceRoot, 'lib/security/security.ts');
const { PatientEditSession } = await import(pathToFileURL(editorPath));
const { encryptData, decryptData } = await import(pathToFileURL(securityPath));
const phaseFlags = ['exerciseWrites', 'exerciseResourceWrites', 'exercisePatientProfileWrites'];
for (const flag of phaseFlags) assert.ok(config[flag] === undefined || typeof config[flag] === 'boolean');
assert.ok(phaseFlags.filter((flag) => config[flag] === true).length <= 1, 'Mutation phases are mutually exclusive');
const releaseWeb = config.passphrase === undefined;
if (releaseWeb) assert.equal(config.exerciseWrites, false, 'The released Web path is a separate read-only compatibility observation');
if (releaseWeb) assert.equal(config.exerciseResourceWrites ?? false, false);
if (releaseWeb) assert.equal(config.exercisePatientProfileWrites ?? false, false);
const snapshotProtocolId = releaseWeb ? 'release-web-pin-snapshot-1'
    : config.comparisonProtocolId ?? 'paired-v3-snapshot-1';
if (!releaseWeb) assert.ok(['paired-v3-snapshot-1', 'paired-v3-snapshot-2'].includes(snapshotProtocolId), 'Unknown comparison protocol');
const comparisonProtocolId = config.exercisePatientProfileWrites ? 'paired-v3-patient-profile-1' : snapshotProtocolId;
const paired = {
    'x-mediflow-paired-client-id': config.pairingId,
    'x-mediflow-paired-client-token': config.pairingToken,
    ...(!releaseWeb ? { 'x-mediflow-source-surface': 'native' } : {}),
};
const requests = [];
const sessions = [];
let mutationCalls = 0;

async function request(method, pathname, { body, session, scope = config.scope, statuses = [200], headers = {} } = {}) {
    const cookie = session ? `${session.cookie}${scope ? `; ambulatory_id=${scope}` : ''}` : undefined;
    const response = await fetch(new URL(pathname, baseUrl), {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { ...paired, Accept: 'application/json', 'Cache-Control': 'no-store',
            ...(cookie ? { Cookie: cookie } : {}),
            ...(session?.channel === 'web' ? { 'x-mediflow-archive-generation': session.archiveGeneration } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`${method} ${pathname}: invalid response JSON`); }
    requests.push({ method, path: pathname, status: response.status });
    if (!statuses.includes(response.status)) {
        const error = new Error(`${method} ${pathname}: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return { response, json };
}

async function login() {
    const check = (await request('GET', '/api/auth/check')).json;
    assert.equal(check.status, 'ok');
    assert.equal(check.isSetup, true);
    if (config.archiveGeneration) assert.equal(check.archiveGeneration, config.archiveGeneration, 'The archive must still be the one prepared');
    let credentials;
    let material;
    if (config.passphrase !== undefined) {
        assert.equal(check.unlock?.credential, 'passphrase');
        assert.equal(check.unlock?.kdfVersion, 3);
        material = deriveUnlock(config.passphrase, check.unlock.salt);
        credentials = { username: config.username, verifier: material.verifier };
    } else {
        assert.equal(check.unlock?.credential, 'pin');
        credentials = { username: config.username, password: config.password };
    }
    let response;
    let session;
    if (releaseWeb) {
        const { loginWithWebAuthControl } = await import(pathToFileURL(path.join(sourceRoot, 'scripts/web-auth-control-test-client.mjs')));
        response = await loginWithWebAuthControl(baseUrl, credentials, async (url, options = {}) => {
            assert.equal(new URL(url).origin, baseUrl.origin);
            const result = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
            requests.push({ method: options.method ?? 'GET', path: new URL(url).pathname, status: result.status });
            return result;
        });
        assert.equal(response.response.status, 200, 'The released Web login must succeed');
        assert.ok(response.cookieHeader, 'The released Web login must issue its controlled session');
        session = { cookie: response.cookieHeader, key: null, archiveGeneration: check.archiveGeneration,
            channel: 'web', controlEtag: response.controlEtag };
    } else {
        response = await request('POST', '/api/auth/native/login', { body: credentials });
        const cookies = response.response.headers.getSetCookie().filter((value) => value.startsWith('mediflow_session='));
        assert.equal(cookies.length, 1, 'Native login must issue one session');
        const cookie = cookies[0].split(';')[0];
        assert.match(cookie, /^mediflow_session=[a-f0-9]{64}$/u);
        session = { cookie, key: null, archiveGeneration: check.archiveGeneration, channel: 'native' };
    }
    // Take custody before validating the returned generation or opening the key,
    // so a failed admission still retires a session issued by this test run.
    sessions.push(session);
    assert.equal(response.json.success, true);
    assert.equal(response.json.archiveGeneration, check.archiveGeneration);
    assert.equal(response.json.username, config.username);
    let bytes;
    if (material) {
        assert.equal(response.json.salt, check.unlock.salt);
        assert.ok(response.json.encryptedMasterKey.startsWith('v3:'));
        bytes = unwrapKey(response.json.encryptedMasterKey.slice(3), material.kek);
        material.kek.fill(0);
    } else {
        bytes = openPinWrapping(response.json.encryptedMasterKey, response.json.salt, config.password);
    }
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    bytes.fill(0);
    session.key = key;
    return session;
}

async function decode(record, session) {
    const decoded = { ...record };
    for (const [field, value] of Object.entries(decoded)) {
        if (typeof value !== 'string' || !value.startsWith('ENC:')) continue;
        const parts = value.split(':');
        assert.equal(parts.length, 3, 'A sealed field must have exactly one IV and one payload');
        decoded[field] = await decryptData(parts[2], parts[1], session.key);
    }
    return decoded;
}
async function encrypted(value, session) {
    const sealed = await encryptData(value, session.key);
    return `ENC:${sealed.iv}:${sealed.data}`;
}
const byId = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const textHash = (value) => {
    assert.ok(value === null || value === undefined || typeof value === 'string', 'Only text fields use UTF-8 field hashes');
    return sha256(value ?? '');
};
async function readPatient(session, id) {
    return decode((await request('GET', `/api/v1/network/patients/${id}`, { session })).json, session);
}
async function readChildren(session, patientId, domain) {
    const rows = (await request('GET', `/api/v1/network/patients/${patientId}/${domain}`, { session })).json;
    assert.ok(Array.isArray(rows));
    return (await Promise.all(rows.map((row) => decode(row, session)))).filter((row) => !row.deletedAt).sort(byId);
}
async function readAggregate(session, domain, filters) {
    const query = new URLSearchParams(filters);
    const rows = (await request('GET', `/api/v1/network/${domain}?${query}`, { session })).json;
    assert.ok(Array.isArray(rows));
    return (await Promise.all(rows.map((row) => decode(row, session)))).filter((row) => !row.deletedAt).sort(byId);
}

async function snapshot(session) {
    const ambulatories = (await request('GET', '/api/v1/network/ambulatories', { session, scope: null })).json;
    const patientRows = (await request('GET', '/api/v1/network/patients', { session })).json;
    const patient = await readPatient(session, config.patientId);
    assert.equal(patient.notes, corpus.patients.find((row) => row.id === config.patientId).notes, 'Main read fixture must retain its exact initial notes');
    const entries = await readChildren(session, config.patientId, 'entries');
    const therapies = await readChildren(session, config.patientId, 'therapies');
    const observations = await readChildren(session, config.patientId, 'observations');
    const checkups = await readChildren(session, config.patientId, 'checkups');
    const attachmentRows = (await request('GET', `/api/v1/network/patients/${config.patientId}/attachments`, { session })).json;
    const attachments = [];
    for (const row of attachmentRows.sort(byId)) {
        assert.equal(Object.hasOwn(row, 'data'), false, 'The document list must omit payloads');
        const item = await decode((await request('GET', `/api/v1/network/patients/${config.patientId}/attachments/${row.id}`, { session })).json, session);
        attachments.push({ id: item.id, nameSha256: textHash(item.name), size: item.size, dataSha256: textHash(item.data) });
    }
    let aggregates = {};
    if (comparisonProtocolId === 'paired-v3-snapshot-2') {
        const agenda = await readAggregate(session, 'checkups', {
            limit: '500', dateFrom: '2026-10-01T00:00:00.000Z', dateTo: '2026-11-01T00:00:00.000Z',
        });
        // The fixed read interval intentionally excludes the separately created
        // entries on 17 October, keeping sequential mutation snapshots comparable.
        const globalDiary = await readAggregate(session, 'entries', {
            limit: '100', type: 'note', dateFrom: '2026-10-01T00:00:00.000Z', dateTo: '2026-10-16T23:59:59.999Z',
        });
        aggregates = {
            agenda: agenda.map((row) => ({ id: row.id, patientId: row.patientId, version: row.version,
                date: row.date, status: row.status, titleSha256: textHash(row.title), notesSha256: textHash(row.notes) })),
            globalDiary: globalDiary.map((row) => ({ id: row.id, patientId: row.patientId, version: row.version,
                type: row.type, date: row.date, setting: row.setting ?? null,
                titleSha256: textHash(row.title), contentSha256: textHash(row.content) })),
        };
    }
    return {
        ambulatories: ambulatories.length,
        patients: patientRows.filter((row) => !row.deletedAt && !row.isArchived).length,
        archivedPatients: patientRows.filter((row) => !row.deletedAt && row.isArchived).length,
        patientVersion: patient.version, notesSha256: textHash(patient.notes),
        entries: entries.map((row) => ({ id: row.id, version: row.version, titleSha256: textHash(row.title), contentSha256: textHash(row.content) })),
        therapies: therapies.map((row) => ({ id: row.id, version: row.version, motivationSha256: textHash(row.motivation) })),
        observations: observations.map((row) => ({ id: row.id, version: row.version, value: String(row.value), unitCode: row.unitCode })),
        checkups: checkups.map((row) => ({ id: row.id, version: row.version, notesSha256: textHash(row.notes) })),
        attachments, ...aggregates,
    };
}

const writeNotes = 'Confronto sintetico JS/Rust: aggiornamento verificato. Città e 🩺.';
const entryTitle = 'Confronto sintetico JS/Rust';
const entryContent = '<p>Voce sintetica JS/Rust: città e 🩺.</p>';
async function exerciseWrites(session) {
    const patientId = config.writePatientId;
    const fixture = corpus.patients.find((patient) => patient.id === patientId);
    assert.ok(fixture && Object.values(corpus.writePatients).includes(fixture.key), 'Writes require a dedicated synthetic comparison patient');
    const before = await readPatient(session, patientId);
    assert.equal(before.version, 1, 'Mutation scenarios require a fresh fixture; no implicit reset or replay');
    assert.equal(before.notes, fixture.notes);
    const checkups = await readChildren(session, patientId, 'checkups');
    assert.equal(checkups.length, 0, 'The two mutation fixtures have equivalent empty checkup sets');
    const staleSession = await login();
    const staleBefore = await readPatient(staleSession, patientId);
    assert.equal(staleBefore.version, before.version);
    const makePort = (currentSession, accepted = [200]) => ({
        updatePatient: async (id, changes) => {
            assert.deepEqual(Object.keys(changes).sort(), ['notes', 'version'], 'The production JS editor must send only the changed notes and the read version');
            mutationCalls += 1;
            await request('PUT', `/api/v1/network/patients/${id}`, { session: currentSession,
                body: { ...changes, notes: await encrypted(changes.notes, currentSession) }, statuses: accepted });
        },
        updateCheckup: async () => { throw new Error('Unexpected checkup write'); },
        deleteCheckup: async () => { throw new Error('Unexpected checkup delete'); },
        createCheckup: async () => { throw new Error('Unexpected checkup create'); },
    });
    const record = { ...before, checkups };
    const unchanged = new PatientEditSession(record);
    const noOpCalls = mutationCalls;
    assert.deepEqual(await unchanged.submit(unchanged.getDefaultValues(), makePort(session), randomUUID), { status: 'complete', confirmed: 0, total: 0 });
    assert.equal(mutationCalls, noOpCalls);
    const editor = new PatientEditSession(record);
    const draft = { ...editor.getDefaultValues(), notes: writeNotes };
    const result = await editor.submit(draft, makePort(session), randomUUID);
    assert.equal(result.status, 'complete');
    assert.equal(result.confirmed, 1);
    const after = await readPatient(session, patientId);
    assert.equal(after.version, before.version + 1);
    assert.equal(after.notes, writeNotes);
    const callsBeforeReplay = mutationCalls;
    await assert.rejects(() => editor.submit(draft, makePort(session), randomUUID));
    assert.equal(mutationCalls, callsBeforeReplay, 'Local replay rejection must send no PUT');
    const staleEditor = new PatientEditSession({ ...staleBefore, checkups });
    const staleDraft = { ...staleEditor.getDefaultValues(), notes: 'Bozza sintetica in conflitto: conservare.' };
    const staleResult = await staleEditor.submit(staleDraft, makePort(staleSession), randomUUID);
    assert.equal(staleResult.status, 'interrupted');
    assert.equal(staleResult.confirmed, 0);
    assert.equal(staleResult.error?.status, 409, 'An independent stale session must reach the real HTTP version conflict');
    const confirmed = await readPatient(session, patientId);
    assert.equal(confirmed.version, after.version);
    assert.equal(confirmed.notes, writeNotes);
    assert.equal(staleDraft.notes, 'Bozza sintetica in conflitto: conservare.');
    const entryId = randomUUID();
    const created = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
        session, statuses: [201], body: { id: entryId, type: 'note', title: await encrypted(entryTitle, session),
            content: await encrypted(entryContent, session), date: '2026-10-17T12:00:00.000Z', setting: 'ambulatory' },
    });
    assert.equal(created.json.id, entryId);
    const entry = await decode((await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, { session })).json, session);
    assert.equal(entry.version, 1);
    assert.equal(entry.title, entryTitle);
    assert.equal(entry.content, entryContent);
    return { beforeVersion: before.version, afterVersion: after.version, notesSha256: textHash(after.notes),
        readback: true, unchangedWrites: 0, replay: { source: 'client', error: 'journal-locked' }, staleStatus: staleResult.error.status,
        entry: { version: entry.version, titleSha256: textHash(entry.title), contentSha256: textHash(entry.content), readback: true } };
}

async function exerciseResourceWrites(session) {
    assert.equal(config.exerciseWrites, false, 'Resource scenarios follow the notes phase without repeating it');
    const fixture = JSON.parse(fs.readFileSync(new URL('./resource-writes.json', import.meta.url), 'utf8'));
    const fixtureSha256 = sha256(canonicalJson(fixture));
    assert.equal(fixture.synthetic, true);
    assert.equal(config.resourceWritesSha256, fixtureSha256, 'Resource writes require the exact public scenario fixture');
    const patientId = config.writePatientId;
    const patientFixture = corpus.patients.find((row) => row.id === patientId);
    assert.ok(patientFixture && Object.values(corpus.writePatients).includes(patientFixture.key));
    const parent = await readPatient(session, patientId);
    assert.equal(parent.taxCode, patientFixture.taxCode);
    assert.equal(parent.version, fixture.parentVersion);
    assert.equal(parent.notes, fixture.parentNotes);
    for (const domain of ['therapies', 'observations', 'checkups', 'attachments']) {
        const rows = (await request('GET', `/api/v1/network/patients/${patientId}/${domain}`, { session })).json;
        assert.ok(Array.isArray(rows));
        assert.equal(rows.length, 0, 'Resource scenarios require untouched dedicated collections; no implicit reset');
    }
    const staleSession = await login();
    const result = { protocolId: fixture.protocolId, fixtureSha256 };
    for (const domain of ['therapies', 'observations', 'checkups']) {
        const specification = fixture[domain];
        const protectedField = domain === 'therapies' ? 'motivation' : 'notes';
        const bodyFor = async (draft, currentSession) => ({ ...draft,
            [protectedField]: await encrypted(draft[protectedField], currentSession) });
        const projectionHash = (record, draft) => {
            const projection = Object.fromEntries(Object.keys(draft).map((key) => [key,
                domain === 'observations' && key === 'value' ? String(record[key]) : record[key] ?? null]));
            const hash = sha256(canonicalJson(projection));
            assert.equal(hash, sha256(canonicalJson(draft)), 'Every declared draft field must be observed exactly in the readback');
            return hash;
        };
        const id = randomUUID();
        const listPath = `/api/v1/network/patients/${patientId}/${domain}`;
        const detailPath = `${listPath}/${id}`;
        const created = await request('POST', listPath, { session, statuses: [201],
            body: { id, ...await bodyFor(specification.create, session) } });
        assert.equal(created.json.id, id);
        const read = async (currentSession) => {
            const row = await decode((await request('GET', detailPath, { session: currentSession })).json, currentSession);
            assert.equal(row.id, id);
            assert.equal(row.patientId, patientId);
            return row;
        };
        const before = await read(session);
        assert.equal(before.version, 1);
        const createdProjectionSha256 = projectionHash(before, specification.create);
        const stale = await read(staleSession);
        assert.equal(stale.version, 1);
        projectionHash(stale, specification.create);
        await request('PUT', detailPath, { session,
            body: { version: before.version, ...await bodyFor(specification.update, session) } });
        const after = await read(session);
        assert.equal(after.version, 2);
        const updatedProjectionSha256 = projectionHash(after, specification.update);
        const conflict = await request('PUT', detailPath, { session: staleSession, statuses: [409],
            body: { version: stale.version, ...await bodyFor(specification.create, staleSession) } });
        const preserved = await read(session);
        assert.equal(preserved.version, 2);
        assert.equal(projectionHash(preserved, specification.update), updatedProjectionSha256);
        result[domain] = { createdVersion: before.version, updatedVersion: after.version,
            createdProjectionSha256, updatedProjectionSha256, readback: true,
            staleStatus: conflict.response.status, stalePreserved: true };
    }
    const document = fixture.attachment;
    const bytes = Buffer.from(document.text, 'utf8');
    const dataUri = `data:${document.type};base64,${bytes.toString('base64')}`;
    const listPath = `/api/v1/network/patients/${patientId}/attachments`;
    // The existing paired document writer issues the identifier and accepts
    // only these five fields; it has no versioned update operation.
    const created = await request('POST', listPath, { session, statuses: [201], body: {
        name: await encrypted(document.name, session), path: await encrypted(document.name, session),
        type: document.type, size: bytes.length, data: await encrypted(dataUri, session),
    } });
    assert.ok(typeof created.json.id === 'string' && created.json.id.length > 0);
    const rows = (await request('GET', listPath, { session })).json;
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, created.json.id);
    assert.equal(Object.hasOwn(rows[0], 'data'), false, 'The document list must not deliver payloads');
    const item = await decode((await request('GET', `${listPath}/${encodeURIComponent(created.json.id)}`, { session })).json, session);
    assert.equal(item.id, created.json.id);
    assert.equal(item.patientId, patientId);
    assert.equal(item.name, document.name);
    assert.equal(item.type, document.type);
    assert.equal(item.size, bytes.length);
    assert.equal(item.data, dataUri);
    const decodedBytes = Buffer.from(item.data.slice(item.data.indexOf(',') + 1), 'base64');
    assert.deepEqual(decodedBytes, bytes);
    result.attachment = { created: true, size: item.size, nameSha256: textHash(item.name),
        dataSha256: textHash(item.data), bytesSha256: sha256(decodedBytes), listPayloadOmitted: true, readback: true };
    return result;
}

async function exercisePatientProfileWrites(session) {
    const fixture = JSON.parse(fs.readFileSync(new URL('./patient-profile-writes.json', import.meta.url), 'utf8'));
    const fixtureSha256 = sha256(canonicalJson(fixture));
    assert.equal(fixture.synthetic, true);
    assert.equal(fixture.protocolId, 'paired-v3-patient-profile-1');
    assert.equal(config.patientProfileWritesSha256, fixtureSha256, 'Profile writes require the exact public scenario fixture');
    const taxCode = fixture.taxCodes.javascript;
    assert.notEqual(taxCode, fixture.taxCodes.rust);
    const listScopes = async (currentSession) => {
        const rows = (await request('GET', '/api/v1/network/ambulatories', { session: currentSession, scope: null })).json;
        assert.ok(Array.isArray(rows) && rows.some((row) => row.id === config.scope));
    };
    await listScopes(session);
    const existing = (await request('GET', '/api/v1/network/patients', { session })).json;
    assert.ok(Array.isArray(existing));
    assert.equal(existing.some((row) => row.taxCode === taxCode), false, 'Own synthetic profile must be absent from active and archived patients; no implicit reuse or reset');
    const bodyFor = async (draft, currentSession) => {
        const body = { ...draft };
        for (const field of ['address', 'phone', 'caregiver']) {
            if (Object.hasOwn(body, field) && body[field] !== null) body[field] = await encrypted(body[field], currentSession);
        }
        return body;
    };
    const created = await request('POST', '/api/v1/network/patients', { session, statuses: [201],
        body: await bodyFor({ ...fixture.create, taxCode }, session) });
    assert.equal(created.json.version, 1);
    const id = created.json.id;
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
    const detailPath = `/api/v1/network/patients/${id}`;
    const read = async (currentSession, version, expected) => {
        const row = await readPatient(currentSession, id);
        assert.equal(row.id, id);
        assert.equal(row.taxCode, taxCode);
        assert.equal(row.ambulatoryId, config.scope);
        assert.equal(row.version, version);
        assert.equal(row.isArchived ?? false, false);
        assert.equal(row.deletedAt ?? null, null);
        const projection = Object.fromEntries(Object.keys(fixture.create).map((key) => [key, row[key] ?? null]));
        assert.deepEqual(projection, expected, 'Readback must preserve every declared profile field, including omitted and explicitly cleared fields');
        return { version: row.version, projectionSha256: sha256(canonicalJson(projection)) };
    };
    const before = await read(session, 1, fixture.create);
    const staleSession = await login();
    await listScopes(staleSession);
    await read(staleSession, 1, fixture.create);
    await request('PUT', detailPath, { session,
        body: { version: before.version, ...await bodyFor(fixture.update, session) } });
    const updatedExpected = { ...fixture.create, ...fixture.update };
    const after = await read(session, 2, updatedExpected);
    const conflict = await request('PUT', detailPath, { session: staleSession, statuses: [409],
        body: { version: before.version, ...await bodyFor(fixture.staleUpdate, staleSession) } });
    await read(session, 2, updatedExpected);
    // A missing key is omitted. Explicit null crosses the writer boundary as
    // null; it is not an encrypted empty string or a default for other fields.
    await request('PUT', detailPath, { session,
        body: { version: after.version, ...await bodyFor(fixture.clear, session) } });
    const cleared = await read(session, 3, { ...updatedExpected, ...fixture.clear });
    return { protocolId: fixture.protocolId, fixtureSha256, patientIdSha256: sha256(id), taxCodeSha256: sha256(taxCode),
        createdVersion: before.version, updatedVersion: after.version, clearedVersion: cleared.version,
        createdProjectionSha256: before.projectionSha256, updatedProjectionSha256: after.projectionSha256,
        clearedProjectionSha256: cleared.projectionSha256, sparsePreserved: true, clearPreserved: true,
        staleStatus: conflict.response.status, stalePreserved: true, readback: true };
}

let report;
try {
    const loginStart = performance.now();
    const session = await login();
    const loginMs = performance.now() - loginStart;
    const loginRequestCount = requests.length;
    let data = null;
    let snapshotMs = null;
    let snapshotRequestCount = 0;
    if (!config.exercisePatientProfileWrites) {
        const snapshotStart = performance.now();
        data = await snapshot(session);
        snapshotMs = performance.now() - snapshotStart;
        snapshotRequestCount = requests.length - loginRequestCount;
    }
    const unauthorized = await request('GET', `/api/v1/network/patients/${config.patientId}`, { statuses: [401] });
    report = {
        schemaVersion: 1, protocolId: comparisonProtocolId,
        result: 'pass', synthetic: true, client: 'javascript',
        implementation: releaseWeb ? 'Released Web auth-control login and production WebCrypto; reference paired HTTP reads'
            : 'JavaScript production edit session and WebCrypto; reference paired HTTP transport',
        baseUrl: baseUrl.origin, archiveGeneration: session.archiveGeneration, corpusSha256: config.corpusSha256,
        source: { editorSha256: sha256(fs.readFileSync(editorPath)), securitySha256: sha256(fs.readFileSync(securityPath)) },
        snapshot: data, snapshotCanonicalSha256: data === null ? null : sha256(canonicalJson(data)),
        timingsMs: { login: loginMs, snapshot: snapshotMs },
        requestCounts: { login: loginRequestCount, snapshot: snapshotRequestCount },
        missingSessionStatus: unauthorized.response.status,
        ...(config.exerciseWrites ? { writes: await exerciseWrites(session) } : {}),
        ...(config.exerciseResourceWrites ? { resourceWrites: await exerciseResourceWrites(session) } : {}),
        ...(config.exercisePatientProfileWrites ? { patientProfileWrites: await exercisePatientProfileWrites(session) } : {}),
    };
} finally {
    const cleanupErrors = [];
    for (const session of sessions) {
        try {
            await request('POST', session.channel === 'web' ? '/api/auth/logout' : '/api/auth/native/logout', {
                session, scope: null, statuses: [204],
                ...(session.channel === 'web' ? { headers: { 'If-Match': session.controlEtag,
                    'Idempotency-Key': randomUUID(), Origin: baseUrl.origin, 'Sec-Fetch-Site': 'same-origin' } } : {}),
            });
        } catch (error) {
            cleanupErrors.push(error);
        } finally {
            session.cookie = '';
            session.key = null;
        }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'One or more owned sessions could not be retired');
}
console.log(JSON.stringify(report));
