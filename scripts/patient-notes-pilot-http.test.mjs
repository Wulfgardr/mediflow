/* WUL-574: characterize the existing encrypted notes operation over real HTTP. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { decryptData, encryptData, unwrapMasterKeyVersioned } from '../lib/security/security.ts';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const dataDir = process.env.MEDIFLOW_DATA_DIR;
const baseUrl = process.env.E2E_BASE_URL;
const token = process.env.MEDIFLOW_LOCAL_API_TOKEN;
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PIN;
assert.ok(dataDir && path.isAbsolute(dataDir), 'An absolute, run-owned synthetic MEDIFLOW_DATA_DIR is required');
assert.equal(process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY, '1', 'Legacy archive copying must be disabled');
assert.ok(baseUrl && token && username && password, 'Use the existing owned HTTP bootstrap with explicit test credentials');
const url = new URL(baseUrl);
assert.equal(url.protocol, 'http:');
assert.equal(url.hostname, '127.0.0.1', 'The synthetic HTTP target must be loopback');
assert.equal(url.username + url.password, '');
const databasePath = path.join(dataDir, 'medical.db');

// Reopen read-only after each HTTP response: observe committed SQLite state,
// without becoming a second writer or replacing any production dependency.
function snapshot() {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        return {
            patients: db.prepare('SELECT * FROM patients ORDER BY id').all(),
            memberships: db.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
            audit: db.prepare('SELECT * FROM audit_events ORDER BY rowid').all(),
        };
    } finally { db.close(); }
}

async function request(method, pathname, headers = {}, body) {
    const response = await fetch(new URL(pathname, baseUrl), {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    return { status: response.status, json: raw ? JSON.parse(raw) : null };
}

test('Web and API v1 preserve encrypted notes, one commit/audit, lifecycle reads and stale replay', async (t) => {
    const apiHeaders = { Authorization: `Bearer ${token}` };
    const ambulatories = await request('GET', '/api/v1/ambulatories', apiHeaders);
    assert.equal(ambulatories.status, 200);
    assert.equal(snapshot().patients.length, 0, 'The harness requires a fresh synthetic archive');
    const ambulatoryId = ambulatories.json[0]?.id;
    assert.ok(ambulatoryId);

    const login = await loginWithWebAuthControl(baseUrl, { username, password });
    assert.equal(login.response.status, 200);
    assert.ok(login.webHeaders && login.json.id);
    const masterKey = await unwrapMasterKeyVersioned(
        login.json.encryptedMasterKey, password, new Uint8Array(Buffer.from(login.json.salt, 'base64')),
    );
    const lanes = [
        { label: 'Web', base: '/api/patients', headers: login.webHeaders, actor: login.json.id, actorType: 'user', surface: 'web' },
        { label: 'API v1', base: '/api/v1/patients', headers: apiHeaders, actor: 'local-api', actorType: 'system', surface: 'api' },
    ];
    const seal = async (plain) => {
        const encrypted = await encryptData(plain, masterKey);
        return `ENC:${encrypted.iv}:${encrypted.data}`;
    };
    const open = async (sealed) => {
        assert.match(sealed, /^ENC:[^:]+:[^:]+$/u);
        const [, iv, ciphertext] = sealed.split(':');
        return decryptData(ciphertext, iv, masterKey);
    };

    async function createFixture(label, isArchived = false) {
        const id = randomUUID();
        const plain = `SYNTHETIC WUL-574 ${label}: nota iniziale, accenti è à; seconda riga\nnessun dato reale.`;
        const notes = await seal(plain);
        const address = await seal(`SYNTHETIC WUL-574 ${label}: campo da conservare`);
        const created = await request('POST', '/api/v1/patients', apiHeaders, {
            id, firstName: 'Synthetic', lastName: label,
            taxCode: `SYN${id.replaceAll('-', '').slice(0, 11)}`,
            ambulatoryId, notes, address, isArchived,
        });
        assert.equal(created.status, 201);
        assert.deepEqual(created.json, { id });
        return { id, plain, notes, address, isArchived, version: 1 };
    }

    const selected = await createFixture('selected');
    const other = await createFixture('other-patient');
    const archived = await createFixture('archived', true);
    const tombstone = await createFixture('tombstone');
    const deleted = await request('DELETE', `/api/v1/patients/${tombstone.id}`, apiHeaders, { version: tombstone.version });
    assert.equal(deleted.status, 200);
    const deletedRow = snapshot().patients.find(row => row.id === tombstone.id);
    assert.ok(deletedRow.deleted_at);
    assert.equal(deletedRow.notes, tombstone.notes);

    async function checkReads(fixture, deleted = false) {
        for (const lane of lanes) {
            const before = snapshot();
            const result = await request('GET', `${lane.base}/${fixture.id}`, lane.headers);
            assert.equal(result.status, deleted ? 404 : 200, `${lane.label}: lifecycle visibility`);
            if (deleted) {
                assert.deepEqual(result.json, { error: 'Not found' });
            } else {
                assert.equal(result.json.id, fixture.id);
                assert.equal(result.json.version, fixture.version);
                assert.equal(result.json.isArchived, fixture.isArchived);
                assert.equal(result.json.ambulatoryId, ambulatoryId);
                assert.equal(result.json.notes, fixture.notes, `${lane.label}: byte-identical ciphertext`);
                assert.equal(result.json.address, fixture.address);
                assert.equal(await open(result.json.notes), fixture.plain, `${lane.label}: readable with the login key`);
            }
            assert.deepEqual(snapshot(), before, `${lane.label}: reads do not mutate patients, memberships or audit`);
        }
    }

    for (const fixture of [selected, other, archived]) await checkReads(fixture);
    await checkReads(tombstone, true);

    for (const lane of lanes) {
        const before = snapshot();
        const previous = before.patients.find(row => row.id === selected.id);
        const plain = `SYNTHETIC WUL-574 ${lane.label}: nota modificata con è, à, \"virgolette\" e\nseconda riga.`;
        const notes = await seal(plain);
        // Exactly the proposed pilot body: no identity, membership or status fields.
        const body = { version: selected.version, notes };
        const result = await request('PUT', `${lane.base}/${selected.id}`, lane.headers, body);
        assert.equal(result.status, 200, `${lane.label}: notes update`);
        assert.deepEqual(result.json, { success: true });
        const after = snapshot();
        const current = after.patients.find(row => row.id === selected.id);
        assert.equal(typeof current.updated_at, 'number');
        assert.ok(current.updated_at >= previous.updated_at);
        assert.deepEqual(after.patients, before.patients.map(row => row.id === selected.id
            ? { ...row, notes, version: previous.version + 1, updated_at: current.updated_at } : row),
        `${lane.label}: only selected notes, version and update time may change`);
        assert.deepEqual(after.memberships, before.memberships, `${lane.label}: memberships remain unchanged`);
        assert.equal(after.audit.length, before.audit.length + 1, `${lane.label}: exactly one new audit event`);
        assert.deepEqual(after.audit.slice(0, -1), before.audit, `${lane.label}: earlier audit remains intact`);
        const event = after.audit.at(-1);
        assert.equal(event.event_type, 'patient.updated');
        assert.equal(event.outcome, 'success');
        assert.equal(event.subject_type, 'patient');
        assert.equal(event.subject_ref, selected.id);
        assert.equal(event.actor_ref, lane.actor);
        assert.equal(event.actor_type, lane.actorType);
        assert.equal(event.source_surface, lane.surface);
        const metadata = JSON.parse(event.redacted_metadata);
        assert.deepEqual(metadata.changedFields, ['notes']);
        assert.equal(metadata.resourceVersion, previous.version + 1);
        assert.equal(event.redacted_metadata.includes(plain), false);
        assert.equal(event.redacted_metadata.includes(notes), false);

        selected.version += 1;
        selected.notes = notes;
        selected.plain = plain;
        await checkReads(selected);
        assert.equal(await open(current.notes), plain, `${lane.label}: committed SQLite ciphertext is readable`);

        for (const replayLane of lanes) {
            const replay = await request('PUT', `${replayLane.base}/${selected.id}`, replayLane.headers, body);
            assert.equal(replay.status, 409, `${replayLane.label}: stale replay after ${lane.label}`);
            assert.equal(replay.json.code, 'VERSION_CONFLICT');
            assert.equal(replay.json.recordId, selected.id);
            assert.equal(replay.json.expectedVersion, body.version);
            assert.equal(replay.json.currentVersion, selected.version);
            assert.deepEqual(snapshot(), after, `${replayLane.label}: stale replay has no clinical or audit effects`);
        }
    }

    for (const lane of lanes) {
        const before = snapshot();
        const result = await request('PUT', `${lane.base}/${tombstone.id}`, lane.headers,
            { version: deletedRow.version, notes: await seal('SYNTHETIC rejected tombstone edit') });
        assert.equal(result.status, 404, `${lane.label}: tombstone cannot be edited`);
        assert.deepEqual(snapshot(), before, `${lane.label}: rejected tombstone write has no effects`);
    }
    for (const fixture of [selected, other, archived]) await checkReads(fixture);
    await checkReads(tombstone, true);
    t.diagnostic('Two encrypted updates, two attributable audit events, four stale replays and two tombstone denials verified on real HTTP/SQLite.');
});
