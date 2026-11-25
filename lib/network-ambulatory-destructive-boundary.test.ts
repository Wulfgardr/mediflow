import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState } from './network-pairing-model';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { clearAllSessions } from './security/server-session';
import { beginWebAuthControl, issueWebAuthControl } from './security/web-auth-control-transport';
import { syntheticWebClientRequest as localRequest } from './security/loopback-ingress-test-fixture';
import { allowsNetworkIngress } from './security/network-ingress-policy.mjs';
import type { AmbulatoryCommandMarker } from './ambulatory-destructive-command-contract';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-wul946-destructive-boundary-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const cookieState = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(dataDir, cookieState);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const detailRoute = load('../app/api/v1/network/ambulatories/[id]/route.ts') as Record<string, unknown>;
const networkWrite = load('./network-ambulatory-write.ts') as Record<string, unknown>;
const { createAmbulatoryDestructiveService, AMBULATORY_COMMAND_REFERENCE_HEADER } = load('./security/ambulatory-destructive-service.ts') as typeof import('./security/ambulatory-destructive-service');
const sql = dbServer.$client;
const origin = 'http://127.0.0.1:31997';

test.after(() => {
    clearAllSessions();
    cleanupCookies();
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function seed() {
    clearAllSessions();
    cookieState.cookies.clear();
    sql.exec('DELETE FROM entries; DELETE FROM patients_to_ambulatories; DELETE FROM patients; DELETE FROM ambulatories; DELETE FROM ambulatory_destructive_commands;');
    dbServer.update(users).set({ role: 'admin' }).run();
    dbServer.insert(ambulatories).values([
        { id: 'scope', name: 'Sede operativa', type: 'live', isDefault: true, version: 1, createdAt: new Date(1000) },
        { id: 'other-test', name: 'Sede test esterna', type: 'test', isDefault: false, version: 1, createdAt: new Date(2000) },
        { id: 'other-live', name: 'Sede vuota esterna', type: 'live', isDefault: false, version: 1, createdAt: new Date(3000) },
    ]).run();
    dbServer.insert(patients).values({
        id: 'synthetic-test-patient', firstName: 'Mario', lastName: 'Sintetico',
        taxCode: 'SNTMRA80A01F205X', version: 1, notes: 'ENC:synthetic:note',
    }).run();
    dbServer.insert(patientsToAmbulatories).values({
        patientId: 'synthetic-test-patient', ambulatoryId: 'other-test',
    }).run();
    const native = syntheticNetworkPatientAuthority(dbServer, 'scope');
    native.pairedClient.grantedCapabilities.push('network.ambulatories.write');
    dbServer.update(settings).set({
        value: JSON.stringify({
            ...JSON.parse(serializeNetworkPairingState({ clients: [native.pairedClient], intents: [] })),
            archiveGeneration: currentArchiveGeneration(),
        }),
    }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    cookieState.cookies.set('mediflow_session', native.session.id);
    cookieState.cookies.set('ambulatory_id', 'scope');
    return native;
}

function snapshot() {
    return {
        ambulatories: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(),
        patients: sql.prepare('SELECT id, version, deleted_at FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        auditCount: (sql.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    };
}

function commandRequest(headers: Record<string, string> = {}) {
    return localRequest(`${origin}/api/auth/ambulatory-commands`, {
        method: 'POST',
        headers: {
            origin,
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            'x-mediflow-archive-generation': currentArchiveGeneration(),
            ...headers,
        },
    });
}

test('WUL-946: a paired device with ambulatory write capability and operator session reaches no legacy delete or clear', async () => {
    const native = seed();
    const renamed = await (detailRoute.PUT as (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>)(
        new Request('http://127.0.0.1/api/v1/network/ambulatories/scope', {
            method: 'PUT', headers: native.request.headers, body: JSON.stringify({ name: 'Sede rinominata', version: 1 }),
        }),
        { params: Promise.resolve({ id: 'scope' }) },
    );
    assert.equal(renamed.status, 200, await renamed.clone().text());
    const before = snapshot();
    assert.equal('DELETE' in detailRoute, false);
    assert.equal(existsSync(resolve('app/api/v1/network/ambulatories/clear/route.ts')), false);
    assert.equal('deleteNetworkAmbulatory' in networkWrite, false);
    assert.equal('clearNetworkAmbulatory' in networkWrite, false);
    assert.equal(allowsNetworkIngress('PUT', '/api/v1/network/ambulatories/other-test'), true);
    assert.equal(allowsNetworkIngress('DELETE', '/api/v1/network/ambulatories/other-test'), false);
    assert.equal(allowsNetworkIngress('POST', '/api/v1/network/ambulatories/clear'), false);
    assert.deepEqual(snapshot(), before);
});

test('WUL-946: the same paired device deletes and clears only through the confirmed ADR 0169 command', async () => {
    const native = seed();
    const before = snapshot();

    const service = createAmbulatoryDestructiveService();
    for (const step of [
        { operation: 'ambulatory.clear-test.v1' as const, ambulatoryId: 'other-test', confirmation: 'SVUOTA' },
        { operation: 'ambulatory.delete.v1' as const, ambulatoryId: 'other-live', confirmation: 'ELIMINA' },
    ]) {
        const initial = commandRequest({
            ...Object.fromEntries(native.request.headers),
            'x-mediflow-expected-ambulatory-id': 'scope',
        });
        const opened = service.begin(
            initial,
            native.session,
            native.pairedClient,
            {
                purpose: 'execute',
                command: {
                    operation: step.operation,
                    originalScopeId: 'scope',
                    ambulatoryId: step.ambulatoryId,
                    expectedVersion: 1,
                },
            },
            'scope',
        );
        assert.equal(opened.status, 200, JSON.stringify(opened.value));
        assert.ok(opened.control);
        const attempt = beginWebAuthControl(
            'login',
            Object.freeze({
                controlId: opened.control.controlId,
                ifMatch: opened.control.etag,
                idempotencyKey: randomUUID(),
            }),
            commandRequest(),
        );
        assert.ok(attempt);
        const webSession = issueWebAuthControl(attempt, {
            id: native.session.userId,
            username: native.session.username,
            role: native.session.role,
        });
        assert.ok(webSession);
        const headers = {
            'x-mediflow-archive-generation': initial.headers.get('x-mediflow-archive-generation')!,
            [AMBULATORY_COMMAND_REFERENCE_HEADER]: String(opened.value.reference),
            cookie: `mediflow_session=${webSession.sessionId}; mediflow_auth_control=${opened.control.controlId}`,
        };
        const preview = service.preview(commandRequest(headers));
        assert.equal(preview.status, 200, JSON.stringify(preview.value));
        const marker = preview.value.marker as AmbulatoryCommandMarker;
        const executed = service.execute(commandRequest(headers), {
            operation: marker.operation,
            planDigest: marker.planDigest,
            confirmation: step.confirmation,
        });
        assert.equal(executed.status, 200, JSON.stringify(executed.value));
        assert.equal(executed.value.outcome, 'terminal');
        assert.equal((executed.value.receipt as Record<string, unknown>).outcome, 'applied');
    }

    const after = snapshot();
    assert.equal((after.ambulatories as Array<{ id: string }>).some(row => row.id === 'other-live'), false);
    assert.equal((after.ambulatories as Array<{ id: string; version: number }>).find(row => row.id === 'other-test')?.version, 2);
    assert.equal(after.memberships.length, 0);
    assert.ok((after.patients as Array<{ id: string; deleted_at: number | null }>)[0].deleted_at);
    assert.ok(after.auditCount > before.auditCount);
});
