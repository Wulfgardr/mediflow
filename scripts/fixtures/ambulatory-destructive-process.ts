import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from '../../lib/network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from '../../lib/network-pairing-model';
import { currentArchiveGeneration } from '../../lib/security/archive-session-generation';
import { clearAllSessions } from '../../lib/security/server-session';
import { beginWebAuthControl, issueWebAuthControl } from '../../lib/security/web-auth-control-transport';
import { resolve as resolveWebSession } from '../../lib/security/web-auth-lifecycle-owner-adapter';
import type { AmbulatoryCommandMarker } from '../../lib/ambulatory-destructive-command-contract';

const input = JSON.parse(process.argv[2]) as { action: 'clear' | 'delete' | 'close' | 'read' | 'assign' | 'child' | 'default'; marker?: AmbulatoryCommandMarker; gate?: string; crash?: string };
const load = createRequire(import.meta.url), cookieState = { cookies: new Map<string, string>() };
const cleanup = installNetworkPatientCookieFixture(process.env.MEDIFLOW_DATA_DIR!, cookieState);
const { dbServer, openDbServer } = load('../../lib/db-server.ts') as typeof import('../../lib/db-server'); openDbServer();
const { settings } = load('../../lib/schema.ts') as typeof import('../../lib/schema');
const { createAmbulatoryDestructiveService, AMBULATORY_COMMAND_REFERENCE_HEADER } = load('../../lib/security/ambulatory-destructive-service.ts') as typeof import('../../lib/security/ambulatory-destructive-service');
const { createAmbulatory, updateAmbulatory } = load('../../lib/ambulatory-write.ts') as typeof import('../../lib/ambulatory-write');
const native = syntheticNetworkPatientAuthority(dbServer, 'scope');
native.pairedClient.grantedCapabilities.push('network.ambulatories.write');
dbServer.update(settings).set({ value: JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ clients: [native.pairedClient], intents: [] })), archiveGeneration: currentArchiveGeneration() }) })
    .where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
const origin = 'http://127.0.0.1:31997';
const request = (headers: Record<string, string> = {}) => new Request(`${origin}/api/auth/ambulatory-commands`, { method: 'POST', headers: {
    origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-mediflow-archive-generation': currentArchiveGeneration(), ...headers } });
const service = createAmbulatoryDestructiveService();
const recovery = input.action === 'close' || input.action === 'read';
const operation = input.action === 'delete' ? 'ambulatory.delete.v1' : 'ambulatory.clear-test.v1';
const opened = service.begin(request({ ...Object.fromEntries(native.request.headers), 'x-mediflow-expected-ambulatory-id': 'scope' }), native.session, native.pairedClient,
    { purpose: recovery ? 'recover' : 'execute', command: recovery ? input.marker : { operation, originalScopeId: 'scope', ambulatoryId: 'target', expectedVersion: 1 } }, recovery ? null : 'scope');
if (opened.status !== 200 || !opened.control) throw new Error(JSON.stringify(opened.value));
const attempt = beginWebAuthControl('login', Object.freeze({ controlId: opened.control.controlId, ifMatch: opened.control.etag, idempotencyKey: randomUUID() }));
if (!attempt) throw new Error('Synthetic authentication preparation failed');
const issued = issueWebAuthControl(attempt, { id: native.session.userId, username: native.session.username, role: 'admin' });
if (!issued) throw new Error('Synthetic authentication failed');
const headers = { [AMBULATORY_COMMAND_REFERENCE_HEADER]: String(opened.value.reference), cookie: `mediflow_session=${issued.sessionId}; mediflow_auth_control=${opened.control.controlId}` };
const resolved = resolveWebSession(issued.sessionId, opened.control.controlId);
if (resolved.status !== 'active') throw new Error('Synthetic projection missing');
cookieState.cookies.set('mediflow_session', issued.sessionId); cookieState.cookies.set('mediflow_auth_control', opened.control.controlId);
cookieState.cookies.set('ambulatory_id', 'scope');
let marker = input.marker;
if (input.action === 'clear' || input.action === 'delete') {
    const preview = service.preview(request(headers)); if (preview.status !== 200) throw new Error(JSON.stringify(preview.value));
    marker = preview.value.marker as AmbulatoryCommandMarker;
}
const sql = dbServer.$client;
let held = false;
if (input.gate || (input.crash && input.crash !== 'before-begin' && input.crash !== 'after-commit')) {
    if (input.gate && dirname(input.gate) !== resolve(process.env.MEDIFLOW_DATA_DIR!)) throw new Error('Synthetic gate outside owned archive');
    sql.function('synthetic_ambulatory_barrier', () => {
        if (input.crash) process.exit(77);
        held = true; process.stdout.write('HELD\n');
        const deadline = Date.now() + 10_000, wait = new Int32Array(new SharedArrayBuffer(4));
        while (!existsSync(input.gate!)) { if (Date.now() > deadline) throw new Error('Synthetic gate timeout'); Atomics.wait(wait, 0, 0, 5); }
        return 1;
    });
    let clause: string;
    if (input.crash === 'after-audit') clause = `AFTER INSERT ON audit_events WHEN NEW.request_id='${marker!.commandId}'`;
    else if (input.crash === 'after-receipt' || input.action === 'close') clause = `AFTER INSERT ON ambulatory_destructive_commands WHEN NEW.command_id='${marker!.commandId}'`;
    else if (input.action === 'assign') clause = "BEFORE INSERT ON patients_to_ambulatories WHEN NEW.ambulatory_id='scope'";
    else if (input.action === 'child') clause = "BEFORE INSERT ON ambulatories WHEN NEW.id='race-child'";
    else if (input.action === 'default') clause = "BEFORE UPDATE ON ambulatories WHEN OLD.id='fallback' AND NEW.is_default=1";
    else if (input.action === 'delete') clause = "BEFORE DELETE ON ambulatories WHEN OLD.id='target'";
    else clause = `${input.crash === 'after-update' ? 'AFTER' : 'BEFORE'} UPDATE ON ambulatories WHEN OLD.id='target'`;
    sql.exec(`CREATE TEMP TRIGGER synthetic_ambulatory_barrier ${clause} BEGIN SELECT synthetic_ambulatory_barrier(); END`);
}
process.stdout.write(`READY ${JSON.stringify({ marker, pid: process.pid })}\n`);
process.stdin.setEncoding('utf8'); const [go] = await once(process.stdin, 'data'); if (String(go).trim() !== 'GO') throw new Error('Synthetic dispatch denied');
process.stdout.write('ATTEMPT\n'); if (input.crash === 'before-begin') process.exit(77);
let result: unknown;
if (input.action === 'clear' || input.action === 'delete') result = service.execute(request(headers), { operation: marker!.operation, planDigest: marker!.planDigest, confirmation: input.action === 'clear' ? 'SVUOTA' : 'ELIMINA' });
else if (input.action === 'close' || input.action === 'read') result = service.recover(request(headers), input.action === 'close');
else if (input.action === 'child') result = createAmbulatory({ request: request(), session: resolved.projection }, { id: 'race-child', name: 'Figlia inventata', parentId: 'target' });
else if (input.action === 'default') result = updateAmbulatory({ request: request(), session: resolved.projection }, 'fallback', { isDefault: true, version: 1 });
else {
    const route = load('../../app/api/patients/assign/route.ts') as typeof import('../../app/api/patients/assign/route');
    const response = await route.POST(new Request(`${origin}/api/patients/assign`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-mediflow-archive-generation': currentArchiveGeneration() },
        body: JSON.stringify({ patientIds: ['race-patient'], patientVersions: { 'race-patient': 1 }, targetAmbulatoryId: 'scope' }) }));
    result = { status: response.status, value: await response.json() };
}
if (input.crash === 'after-commit') process.exit(77);
clearAllSessions(); cleanup(); sql.close();
process.stdout.write(`RESULT ${JSON.stringify({ result, marker, held, pid: process.pid })}\n`);
