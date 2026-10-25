const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const f = require('../security/native-ordinary-host.test-support.cjs');
const pairing = require('../network-pairing-model.ts');
const native = require('../security/native-inference-lifecycle.ts');
const { handleNativeAuthorityRetirementHttp: handle } = require('./native-authority-retirement-http.ts');
const token = 'synthetic-retirement-token-'.repeat(3), tokenHash = pairing.hashNetworkPairedClientToken(token);
const binding = { tokenHash, clientPlatform: 'ios' };
const reference = session => createHash('sha256').update(session.id).digest('hex');
const headers = () => ({ 'Content-Type': 'application/json',
    [pairing.NETWORK_PAIRED_CLIENT_ID_HEADER]: f.binding.clientId,
    [pairing.NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: token });
function request(ref, extra = {}, header = headers()) {
    return new Request('http://localhost/api/v1/network/ai/authority-retirement', {
        method: 'POST', headers: header, body: JSON.stringify({ previousAuthorityRef: ref, ...extra }) });
}
function admitted(user = {}, pair = binding) { const s = f.issue(user, pair); f.setSessionCookie(s.id); return s; }
function retain(session) { const port = native.mintResourcePort(session); assert.ok(port); return port; }
beforeEach(() => { f.reset(); f.pair(binding); });
test('real paired admission: S1 revoked, cancel denied, S2 attests retirement even if disposer failed; no physical cleanup claim', async () => {
    const s1 = admitted(), port = retain(s1), use = native.beginResourceUse(port);
    assert.ok(use); let disposed = 0;
    assert.ok(native.registerPrivateResource(port, () => { disposed++; throw Error('synthetic cleanup failure'); }));
    f.owner.serverSessions.deleteSession(s1.id);
    assert.equal(native.beginResourceUse(port), null); assert.equal(native.commitResourceUse(use), false);
    assert.equal(disposed, 1);
    const old = await handle(request(reference(s1))); assert.equal(old.status, 401);
    const s2 = admitted(); const response = await handle(request(reference(s1)));
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { schema: 'mediflow.native-authority-retirement.v1',
        previousAuthorityRef: reference(s1), currentAuthorityRef: reference(s2), authorityRetired: true, physicalCleanup: 'not_attested' });
    assert.equal(disposed, 1, 'attestation must not retry or erase cleanup');
    assert.equal(native.beginResourceUse(port), null); assert.equal(f.counters.clinicalWrites, 0);
});
test('same session, still active previous session and unknown reference never get a receipt', async () => {
    const s1 = admitted(), port = retain(s1);
    assert.equal((await handle(request(reference(s1)))).status, 409);
    admitted(); assert.equal((await handle(request(reference(s1)))).status, 409);
    assert.equal((await handle(request('a'.repeat(64)))).status, 409);
    assert.ok(native.beginResourceUse(port), 'verification must not revoke an active previous authority');
    native.releaseResourcePort(port);
});
test('generic 401 due to admission failure does not retire S1 or produce a receipt', async () => {
    const s1 = admitted(), port = retain(s1);
    f.setSetting('network.mode', 'local-only');
    assert.equal((await handle(request(reference(s1)))).status, 401);
    f.setSetting('network.mode', 'network-home-base');
    assert.ok(f.owner.serverSessions.mintNativeSessionResourcePort(s1), 'admission failure alone is not irreversible retirement');
    const select = f.db.dbServer.select;
    try {
        f.db.dbServer.select = () => { throw Error('synthetic temporary admission failure'); };
        assert.equal((await handle(request(reference(s1)))).status, 401);
    } finally { f.db.dbServer.select = select; }
    assert.ok(f.owner.serverSessions.mintNativeSessionResourcePort(s1));
    admitted(); assert.equal((await handle(request(reference(s1)))).status, 409);
    native.releaseResourcePort(port);
});
for (const mismatch of ['principal', 'pair', 'platform', 'token', 'role']) test('different ' + mismatch + ' cannot acquire previous authority', async () => {
    const s1 = admitted(); retain(s1); f.owner.serverSessions.deleteSession(s1.id);
    const pair = { ...binding }, user = {};
    if (mismatch === 'principal') { user.id = 'synthetic-other-principal'; f.rows.users.push({ ...f.user, ...user }); }
    if (mismatch === 'pair') { pair.clientId = 'synthetic-other-pair'; f.pair(pair); }
    if (mismatch === 'platform') { pair.clientPlatform = 'ipados'; f.pair(pair); }
    if (mismatch === 'token') { pair.tokenHash = pairing.hashNetworkPairedClientToken(token + 'other'); f.pair(pair); }
    if (mismatch === 'role') { user.role = 'admin'; f.rows.users[0].role = 'admin'; }
    admitted(user, pair);
    const h = headers();
    if (mismatch === 'pair') h[pairing.NETWORK_PAIRED_CLIENT_ID_HEADER] = pair.clientId;
    if (mismatch === 'token') h[pairing.NETWORK_PAIRED_CLIENT_TOKEN_HEADER] = token + 'other';
    assert.equal((await handle(request(reference(s1), {}, h))).status, 409);
});
test('extra authority, clinical and runtime fields are rejected before any proof', async () => {
    const s1 = admitted(); retain(s1); f.owner.serverSessions.deleteSession(s1.id); admitted();
    for (const key of ['session', 'principal', 'provider', 'model', 'patientId', 'revoke', 'cleanupConfirmed'])
        assert.equal((await handle(request(reference(s1), { [key]: true }))).status, 400, key);
    assert.equal((await handle(request('invalid'))).status, 400);
    f.setSessionCookie(null); assert.equal((await handle(request(reference(s1)))).status, 401);
});

test('named thin route and supplemental contract expose only retirement verification', () => {
    const fs = require('node:fs');
    const spec = JSON.parse(fs.readFileSync('docs/openapi/native-authority-retirement-v1.json'));
    const [endpoint] = Object.keys(spec.paths); assert.equal(endpoint, '/api/v1/network/ai/authority-retirement');
    assert.deepEqual(Object.keys(spec.paths[endpoint]), ['post']);
    const operation = spec.paths[endpoint].post;
    assert.deepEqual(operation.requestBody.content['application/json'].schema.required, ['previousAuthorityRef']);
    assert.equal(operation.requestBody.content['application/json'].schema.additionalProperties, false);
    assert.deepEqual(operation.responses['200'].content['application/json'].schema.properties.authorityRetired, { const: true });
    assert.deepEqual(operation.responses['200'].content['application/json'].schema.properties.physicalCleanup, { const: 'not_attested' });
    const route = fs.readFileSync('app' + endpoint + '/route.ts', 'utf8');
    assert.match(route, /return handleNativeAuthorityRetirementHttp\(request\)/);
    assert.doesNotMatch(route, /dbServer|deleteSession|revoke|provider|model|writer/);
});

test('current session revoked during body suspension cannot publish a retirement receipt', async () => {
    const s1 = admitted(); retain(s1); f.owner.serverSessions.deleteSession(s1.id);
    const s2 = admitted(); let sent = false;
    const body = new ReadableStream({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(JSON.stringify({ previousAuthorityRef: reference(s1) }))); }
        else { f.owner.serverSessions.deleteSession(s2.id); controller.close(); }
    } });
    const response = await handle(new Request('http://localhost/api/v1/network/ai/authority-retirement',
        { method: 'POST', headers: headers(), body, duplex: 'half' }));
    assert.equal(response.status, 401); assert.equal((await response.json()).authorityRetired, undefined);
});
