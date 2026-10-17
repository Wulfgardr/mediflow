#!/usr/bin/env node
// Administrative preparer for a fresh, owned, synthetic loopback runtime. The
// resulting client configuration deliberately contains no local API bearer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, deriveUnlock, openPinWrapping, recoveryWrapping, seal, sha256, unwrapKey, wrapKey } from './crypto.mjs';

const [mode, privatePath, workspace] = process.argv.slice(2);
if (!['release', 'candidate'].includes(mode) || !privatePath || !workspace || process.argv.length !== 5) {
    throw new Error('Usage: node prepare-runtime.mjs release|candidate /tmp/owned/private.json /tmp/owned/workspace');
}
const stat = fs.statSync(privatePath);
if ((stat.mode & 0o077) !== 0) throw new Error('The private runtime configuration must have mode 600');
const runtime = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
const baseUrl = new URL(runtime.E2E_BASE_URL);
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1' || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/') {
    throw new Error('Preparation is restricted to an explicit HTTP IPv4 loopback runtime');
}
if (runtime.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1' || !path.resolve(runtime.MEDIFLOW_DATA_DIR).startsWith('/tmp/mediflow-transition-')) {
    throw new Error('Preparation requires an owned synthetic archive with legacy copying disabled');
}
if (runtime.MEDIFLOW_PROVIDER_V2_ENABLED !== '0' || runtime.MEDIFLOW_PROVIDER_V2_NETWORK !== '0') {
    throw new Error('Provider execution must be disabled in the comparison runtime');
}
const runDirectory = path.dirname(privatePath);
const receiptPath = path.join(runDirectory, `${mode}-seed-receipt.json`);
if (fs.existsSync(receiptPath)) throw new Error('This runtime already has a seed receipt; create a fresh runtime for another comparison');
const corpusPath = fileURLToPath(new URL('./corpus.json', import.meta.url));
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
assert.equal(corpus.synthetic, true);
const corpusSha256 = sha256(canonicalJson(corpus));
const ids = Object.fromEntries(corpus.patients.map((patient) => [patient.key, patient.id]));
const adminHeaders = { Authorization: `Bearer ${runtime.MEDIFLOW_LOCAL_API_TOKEN}` };
const operations = [];
const timedFetch = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45_000) });
const { loginWithWebAuthControl } = await import(pathToFileURL(path.resolve(workspace, 'scripts/web-auth-control-test-client.mjs')));

async function request(method, pathname, { body, headers = {}, statuses = [200] } = {}) {
    const response = await timedFetch(new URL(pathname, baseUrl), {
        method,
        headers: { 'Cache-Control': 'no-store', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`${method} ${pathname}: non-JSON response (${response.status})`); }
    operations.push({ method, path: pathname, status: response.status });
    if (!statuses.includes(response.status)) throw new Error(`${method} ${pathname}: HTTP ${response.status}; expected ${statuses.join('/')}`);
    return { response, json };
}

const advertisedUnlock = (await request('GET', '/api/auth/check')).json.unlock;
let webHeaders;
let masterKey;
if (advertisedUnlock?.credential === 'passphrase') {
    assert.equal(mode, 'candidate', 'Release comparison must retain its own released credential protocol');
    const material = deriveUnlock(runtime.E2E_PASSPHRASE, advertisedUnlock.salt);
    const resumed = await loginWithWebAuthControl(baseUrl, { username: runtime.E2E_USERNAME, verifier: material.verifier }, timedFetch);
    assert.equal(resumed.response.status, 200, 'Resuming an adopted synthetic account must authenticate normally');
    assert.ok(resumed.json.encryptedMasterKey.startsWith('v3:'));
    masterKey = unwrapKey(resumed.json.encryptedMasterKey.slice(3), material.kek);
    webHeaders = resumed.webHeaders;
} else {
    const initial = await loginWithWebAuthControl(baseUrl, { username: runtime.E2E_USERNAME, password: runtime.E2E_PIN }, timedFetch);
    assert.equal(initial.response.status, 200, 'Fresh archive PIN login must succeed');
    webHeaders = initial.webHeaders;
    masterKey = openPinWrapping(initial.json.encryptedMasterKey, initial.json.salt, runtime.E2E_PIN);
}
if (mode === 'candidate' && advertisedUnlock?.credential !== 'passphrase') {
    const salt = randomBytes(16).toString('base64');
    const material = deriveUnlock(runtime.E2E_PASSPHRASE, salt);
    const recovery = recoveryWrapping(masterKey);
    const encryptedMasterKey = `v3:${wrapKey(masterKey, material.kek)}`;
    await request('POST', '/api/auth/passphrase', {
        headers: { ...webHeaders, Origin: baseUrl.origin, 'Sec-Fetch-Site': 'same-origin' },
        body: {
            currentPin: runtime.E2E_PIN, encryptedMasterKey, salt, verifier: material.verifier,
            recovery: { wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt, verifier: recovery.verifier },
        },
    });
    fs.writeFileSync(path.join(runDirectory, 'candidate-recovery-private.json'), JSON.stringify(recovery, null, 2) + '\n', { mode: 0o600 });
    const login = await loginWithWebAuthControl(baseUrl, { username: runtime.E2E_USERNAME, verifier: material.verifier }, timedFetch);
    assert.equal(login.response.status, 200, 'Adopted passphrase login must succeed');
    assert.equal(login.json.encryptedMasterKey, encryptedMasterKey);
    assert.deepEqual(unwrapKey(login.json.encryptedMasterKey.slice(3), material.kek), masterKey);
    webHeaders = login.webHeaders;
}
assert.ok(webHeaders, 'Seeding attachments requires an actual operator session');
const ambulatories = (await request('GET', '/api/v1/ambulatories', { headers: adminHeaders })).json;
const ambulatory = ambulatories.find((item) => item.isDefault) ?? ambulatories[0];
assert.ok(ambulatory?.id, 'Fresh archive must have a default ambulatory');
await request('PUT', '/api/settings/network.mode', { headers: adminHeaders, body: { value: 'network-home-base' } });
await request('PUT', '/api/settings/clinicName', { headers: adminHeaders, body: { value: corpus.clinicName } });

const encryptedFields = {
    patients: ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'notes'],
    entries: ['title', 'content', 'metadata', 'attachments'],
    therapies: ['motivation'], observations: ['notes'], checkups: ['notes'],
};
function payloadFor(item, domain) {
    const { key: _key, patient: _patient, ...payload } = item;
    for (const field of encryptedFields[domain]) {
        if (Object.hasOwn(payload, field)) payload[field] = seal(payload[field], masterKey);
    }
    return payload;
}

// Resuming a partial seed only skips IDs from this public synthetic corpus. A
// finished receipt is never reset or silently reused for a new test run.
async function createIfAbsent(listPath, detailPath, body, headers = adminHeaders) {
    const existing = await request('GET', detailPath, { headers, statuses: [200, 404] });
    if (existing.response.status === 200) {
        assert.equal(existing.json.id, body.id, 'Synthetic resume must resolve the exact fixture identity');
        return;
    }
    const created = await request('POST', listPath, { headers, body, statuses: [201] });
    assert.equal(created.json.id, body.id, 'Server must preserve the requested fixture identity');
}

for (const patient of corpus.patients) {
    await createIfAbsent('/api/v1/patients', `/api/v1/patients/${patient.id}`, {
        ...payloadFor(patient, 'patients'), ambulatoryId: ambulatory.id,
    });
}
for (const domain of ['entries', 'therapies', 'observations', 'checkups']) {
    for (const item of corpus[domain]) {
        const listPath = `/api/v1/patients/${ids[item.patient]}/${domain}`;
        await createIfAbsent(listPath, `${listPath}/${item.id}`, payloadFor(item, domain));
    }
}
for (const item of corpus.attachments) {
    const bytes = Buffer.from(item.text, 'utf8');
    await createIfAbsent('/api/attachments', `/api/attachments/${item.id}`, {
        id: item.id, patientId: ids[item.patient], type: item.type, size: bytes.length,
        name: seal(item.name, masterKey), path: seal(item.name, masterKey),
        data: seal(`data:${item.type};base64,${bytes.toString('base64')}`, masterKey),
    }, { ...webHeaders, Origin: baseUrl.origin, 'Sec-Fetch-Site': 'same-origin' });
}

const requestedCapabilities = [
    'network.ambulatories.write',
    'network.replica.readonly-patients', 'network.replica.write-patient-profile', 'network.replica.write-patient-lifecycle',
    'network.replica.readonly-clinical-diary', 'network.replica.write-clinical-diary',
    'network.replica.readonly-therapies', 'network.replica.write-therapies',
    'network.replica.readonly-observations', 'network.replica.write-observations',
    'network.replica.readonly-checkups', 'network.replica.write-checkups',
    'network.replica.readonly-documents', 'network.replica.write-documents',
    'network.replica.readonly-agenda', 'network.replica.readonly-clinical-diary-global',
    'network.catalogs.readonly',
];
const intent = await request('POST', '/api/v1/network/pairing-intents', {
    body: {
        deviceName: `Confronto sintetico ${mode}`, clientPlatform: mode === 'candidate' ? 'linux' : 'macos',
        appVersion: '0.9.0-transition', requestedCapabilities,
    }, statuses: [201],
});
const confirmed = await request('POST', `/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, {
    headers: adminHeaders, statuses: [201],
});
assert.ok(confirmed.json.pairedClient?.clientId && confirmed.json.pairedClientToken);
assert.deepEqual([...confirmed.json.pairedClient.grantedCapabilities].sort(), [...requestedCapabilities].sort(),
    'The new pairing must receive exactly the explicitly requested capabilities');
const clientPath = path.join(runDirectory, `${mode}-client-private.json`);
const client = {
    baseUrl: baseUrl.origin, tlsPinSha256: null,
    pairingId: confirmed.json.pairedClient.clientId, pairingToken: confirmed.json.pairedClientToken,
    username: runtime.E2E_USERNAME,
    ...(mode === 'candidate' ? { passphrase: runtime.E2E_PASSPHRASE } : { password: runtime.E2E_PIN }),
    scope: ambulatory.id, patientId: ids[corpus.mainPatient],
    writePatientIds: Object.fromEntries(Object.entries(corpus.writePatients).map(([client, key]) => [client, ids[key]])),
    fixtureIds: ids, corpusSha256, synthetic: true, exerciseWrites: false,
    ...(mode === 'candidate' ? { comparisonProtocolId: 'paired-v3-snapshot-2' } : {}),
    archiveGeneration: webHeaders['x-mediflow-archive-generation'],
    javascriptSourceRoot: path.resolve(workspace),
};
assert.equal(Object.hasOwn(client, 'MEDIFLOW_LOCAL_API_TOKEN'), false);
fs.writeFileSync(clientPath, JSON.stringify(client, null, 2) + '\n', { mode: 0o600 });
const mainDetail = (await request('GET', `/api/v1/patients/${client.patientId}`, { headers: adminHeaders })).json;
const patientList = (await request('GET', '/api/v1/patients', { headers: adminHeaders })).json;
assert.equal(patientList.length, corpus.patients.length, 'Prepared archive must contain exactly the corpus patients');
const receipt = {
    schemaVersion: 1, synthetic: true, mode, baseUrl: baseUrl.origin,
    corpusId: corpus.id, corpusSha256, sourceWorkspace: path.resolve(workspace),
    authCredential: mode === 'candidate' ? 'passphrase-v3' : 'release-pin',
    requestedCapabilities, grantedCapabilities: confirmed.json.pairedClient.grantedCapabilities,
    fixtureIds: ids, scope: ambulatory.id, mainPatientVersion: mainDetail.version,
    counts: Object.fromEntries(['patients', 'entries', 'therapies', 'observations', 'checkups', 'attachments'].map((domain) => [domain, corpus[domain].length])),
    operations, completedAt: new Date().toISOString(),
    qualification: 'Synthetic seed completed through ordinary endpoints; no UI or performance qualification.',
};
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
masterKey.fill(0);
console.log(JSON.stringify({ prepared: true, mode, baseUrl: baseUrl.origin, corpusSha256, counts: receipt.counts, clientPrivatePath: clientPath, receiptPath }));
