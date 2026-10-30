import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { ambulatories, patients, therapies, patientsToAmbulatories, settings, users } from './schema';
import { bindSessionToArchive, currentArchiveGeneration } from './security/archive-session-generation';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { captureNativeLoginSessionFence, createNativeServerSession, retireServerSessionForLogout } from './security/server-session';

const data = mkdtempSync(join(tmpdir(), 'mediflow-chat-therapy-'));
process.env.MEDIFLOW_DATA_DIR = data;
const load = createRequire(import.meta.url);
const cookies = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server'); openDbServer();
const { nativeProfileSelectionOwner } = load('./security/native-profile-selection-owner.ts') as typeof import('./security/native-profile-selection-owner');
const { createChatTherapyStatusService } = load('./chat-therapy-status.ts') as typeof import('./chat-therapy-status');
const { executeTherapyStatusCommand } = load('./therapy-status-command-service.ts') as typeof import('./therapy-status-command-service');
const { issueSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture');
const pin = ['2','4','6','8'].join('');
const passwordHash = bcrypt.hashSync(pin, 4);
let tick = Date.now();
async function fixture() {
    const scope = randomUUID(), patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(ambulatories).values({ id: scope, name: 'Synthetic', isDefault: true }).run();
    const context = syntheticNetworkPatientAuthority(dbServer, scope);
    context.pairedClient.grantedCapabilities.push('network.replica.readonly-therapies', 'network.replica.write-therapies', 'network.replica.readonly-patients');
    dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [context.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration() }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    dbServer.update(users).set({ passwordHash, failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, context.session.userId)).run();
    cookies.cookies.set('ambulatory_id', scope);
    cookies.cookies.set('mediflow_session', context.session.id);
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: scope }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 1, startDate: new Date() }).run();
    const owner = nativeProfileSelectionOwner.registry.acquire(context.session);
    owner.issueSelection({ expectedEpoch: 0, patientId, ambulatoryId: scope });
    const epoch = owner.snapshotSelectionEpoch(context.session);
    const command = { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: currentArchiveGeneration(), patientId, therapyId, expectedVersion: 1, target: 'suspended' as const };
    const service = createChatTherapyStatusService(() => tick);
    const { viewId } = await service.open(context, patientId, epoch);
    return { context, command, epoch, service, owner, viewId };
}
function effects(id: string) {
    const db = dbServer.$client;
    return { therapy: db.prepare('SELECT version,status FROM therapies WHERE id=?').get(id), audits: (db.prepare('SELECT count(*) n FROM audit_events WHERE subject_ref=?').get(id) as {n:number}).n };
}
test('native preview, real PIN, shared writer, audit, reread and one consumption', async () => {
    const f = await fixture();
    await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const receipt = await f.service.execute(f.context, f.command.commandId, pin);
    assert.equal(receipt.outcome, 'applied'); assert.equal(receipt.resultVersion, 2);
    assert.deepEqual(effects(f.command.therapyId), { therapy: { version: 2, status: 'suspended' }, audits: 1 });
    await assert.rejects(f.service.execute(f.context, f.command.commandId, pin));
    const fresh = createChatTherapyStatusService(() => tick);
    const recovered = await fresh.receipt(f.context, f.command.commandId);
    assert.equal(recovered.outcome, 'terminal');
    if (recovered.outcome === 'terminal') { assert.equal(recovered.receipt.auditEventId, receipt.auditEventId); assert.deepEqual(recovered.current, { version: 2, status: 'suspended' }); }
});
for (const scenario of ['expired', 'wrong-pin', 'revoked', 'selection-aba', 'capability', 'version'] as const) test(`valid preview positive control then ${scenario} cannot write`, async () => {
    const control = await fixture(); await control.service.preview(control.context, control.command, control.epoch, control.viewId);
    assert.equal((await control.service.execute(control.context, control.command.commandId, pin)).outcome, 'applied');
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    if (scenario === 'expired') tick += 30_000;
    if (scenario === 'revoked') retireServerSessionForLogout(f.context.session.id);
    if (scenario === 'selection-aba') { f.owner.issueSelection({ expectedEpoch: f.epoch, patientId: f.command.patientId, ambulatoryId: f.context.scopeAmbulatoryId }); }
    if (scenario === 'capability') dbServer.update(settings).set({ value: serializeNetworkPairingState({ clients: [], intents: [] }) }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    if (scenario === 'version') dbServer.update(therapies).set({ version: 2, status: 'completed' }).where(eq(therapies.id, f.command.therapyId)).run();
    const before = effects(f.command.therapyId);
    if (scenario === 'version') assert.equal((await f.service.execute(f.context, f.command.commandId, pin)).outcome, 'rejected');
    else await assert.rejects(f.service.execute(f.context, f.command.commandId, scenario === 'wrong-pin' ? '0000' : pin));
    assert.deepEqual(effects(f.command.therapyId), before);
});
test('lost authorization on restart has unknown receipt and cannot execute or renew the old authorization', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const restarted = createChatTherapyStatusService(() => tick);
    assert.deepEqual(await restarted.receipt(f.context, f.command.commandId), { outcome: 'unknown' });
    await assert.rejects(restarted.execute(f.context, f.command.commandId, pin));
    assert.deepEqual(effects(f.command.therapyId), { therapy: { version: 1, status: 'active' }, audits: 0 });
});
for (const winner of ['web', 'claude', 'codex']) test(`${winner} wins the same CAS race against the other two clients, one audited effect`, async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const session = createNativeServerSession({ id: f.context.session.userId, username: f.context.session.username, role: 'admin' }, { clientId: f.context.pairedClient.clientId, clientPlatform: f.context.pairedClient.clientPlatform, tokenHash: f.context.pairedClient.tokenHash }, captureNativeLoginSessionFence())!;
    bindSessionToArchive(session, currentArchiveGeneration());
    const context = { ...f.context, session };
    const owner = nativeProfileSelectionOwner.registry.acquire(session);
    owner.issueSelection({ expectedEpoch: 0, patientId: f.command.patientId, ambulatoryId: context.scopeAmbulatoryId });
    const other = { ...f.command, commandId: randomUUID(), target: 'completed' as const };
    const view = await f.service.open(context, f.command.patientId, owner.snapshotSelectionEpoch(session));
    await f.service.preview(context, other, owner.snapshotSelectionEpoch(session), view.viewId);
    const web = issueSyntheticWebSession({ id: f.context.session.userId, username: f.context.session.username, role: 'admin' }, randomUUID());
    const requests = {
        web: () => executeTherapyStatusCommand(web, { ...f.command, commandId: randomUUID(), target: 'completed' }),
        claude: () => f.service.execute(f.context, f.command.commandId, pin),
        codex: () => f.service.execute(context, other.commandId, pin),
    };
    const first = await requests[winner as keyof typeof requests]();
    const rest = await Promise.all(Object.entries(requests).filter(([key]) => key !== winner).map(([, run]) => run()));
    assert.equal(first.outcome, 'applied'); assert.deepEqual(rest.map(r => r.outcome), ['rejected', 'rejected']);
    assert.deepEqual(Object.keys(first).sort(), Object.keys(rest[0]).sort());
    assert.equal(effects(f.command.therapyId).audits, 1);
});
test('invalid payload, changed identity, foreign session and duplicate preview fail closed', async () => {
    const f = await fixture();
    await assert.rejects(f.service.preview(f.context, { ...f.command, approved: true }, f.epoch, f.viewId));
    await assert.rejects(f.service.preview(f.context, { ...f.command, patientId: randomUUID() }, f.epoch, f.viewId));
    await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    await assert.rejects(f.service.preview(f.context, { ...f.command, target: 'completed' }, f.epoch, f.viewId));
    await assert.rejects(f.service.execute({ ...f.context, session: { ...f.context.session } }, f.command.commandId, pin));
    assert.equal((await f.service.execute(f.context, f.command.commandId, pin)).outcome, 'applied');
});
test.after(() => { cleanup(); dbServer.$client.close(); });

test('revocation while confirmation is pending retires the server attempt before commit', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const pending = f.service.execute(f.context, f.command.commandId, pin);
    await f.service.revoke(f.context, f.command.commandId);
    await assert.rejects(pending);
    assert.deepEqual(effects(f.command.therapyId), { therapy: { version: 1, status: 'active' }, audits: 0 });
});
test('expiration while PIN confirmation is pending is checked again inside the write transaction', async () => {
    const f = await fixture(); await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    const pending = f.service.execute(f.context, f.command.commandId, pin);
    tick += 30_000;
    await assert.rejects(pending);
    assert.equal(effects(f.command.therapyId).audits, 0);
});

test('native HTTP enforces paired session, closed JSON, PIN and no-store through the actual route', async () => {
    const f = await fixture();
    const route = load('../app/api/auth/native/therapy-status/route.ts') as typeof import('../app/api/auth/native/therapy-status/route');
    function invoke(body: unknown, paired = true) {
        const headers = new Headers(f.context.request.headers);
        headers.set('x-mediflow-expected-ambulatory-id', f.context.scopeAmbulatoryId);
        if (!paired) headers.delete('x-mediflow-paired-client-token');
        return route.POST(new Request('https://127.0.0.1/api/auth/native/therapy-status', { method: 'POST', headers, body: JSON.stringify(body) }));
    }
    const opened = await invoke({ operation: 'open', patientId: f.command.patientId, selectionEpoch: f.epoch });
    assert.equal(opened.status, 200);
    const { viewId } = await opened.json();
    const preview = { operation: 'preview', command: f.command, selectionEpoch: f.epoch, viewId };
    assert.equal((await invoke(preview, false)).status, 401);
    assert.equal((await invoke({ ...preview, approved: true })).status, 400);
    assert.equal((await invoke(preview)).status, 200);
    const execute = { operation: 'execute', commandId: f.command.commandId, pin };
    assert.equal((await invoke({ ...execute, target: 'completed' })).status, 400);
    const response = await invoke(execute); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).outcome, 'applied');
    assert.equal((await invoke(execute)).status, 403);
    assert.equal((await (await invoke({ operation: 'receipt', commandId: f.command.commandId })).json()).outcome, 'terminal');
});

test('five minute view lifetime denies a fresh preview confirmation without renewal', async () => {
    const f = await fixture();
    tick += 299_000;
    await f.service.preview(f.context, f.command, f.epoch, f.viewId);
    tick += 1000;
    await assert.rejects(f.service.execute(f.context, f.command.commandId, pin));
    assert.equal(effects(f.command.therapyId).audits, 0);
});
