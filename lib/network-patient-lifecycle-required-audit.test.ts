/* @Codex: WUL-720 required network lifecycle audit on real synthetic SQLite. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ambulatories, entries, patients, patientsToAmbulatories } from './schema';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-c05-network-lifecycle-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const lifecycle = load('./network-patient-lifecycle.ts') as typeof import('./network-patient-lifecycle.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const sealed = 'ENC:aQ==:ZGF0YQ==';

test.after(() => {
    sql.close();
    dbServer.$client.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function context(patientId: string) {
    return {
        request: new Request(`http://127.0.0.1/api/v1/network/patients/${patientId}`, {
            headers: { 'x-request-id': 'c05-network-synthetic-request' },
        }),
        patientId,
        scopeAmbulatoryId: 'c05-network-a',
        pairedClient: { clientId: 'c05-network-client' },
        session: { id: 'c05-network-session', userId: 'c05-network-user' },
    } as unknown as Parameters<typeof lifecycle.deleteNetworkScopedPatient>[0];
}

function setup(id: string, state: 'absent' | 'active' | 'deleted') {
    dbServer.insert(ambulatories).values({ id: 'c05-network-a', name: 'Ambulatorio sintetico', type: 'live' })
        .onConflictDoNothing().run();
    if (state === 'absent') return;
    dbServer.insert(patients).values({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYNTH-${id}`,
        version: 3, ambulatoryId: 'c05-network-a', address: sealed, isArchived: true,
        ...(state === 'deleted' ? { deletedAt: new Date('2026-01-02'), deletionReason: sealed } : {}),
    }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'c05-network-a' }).run();
    dbServer.insert(entries).values({ id: `entry-${id}`, patientId: id, type: 'note',
        title: 'Voce sintetica', date: new Date('2026-01-01'), content: 'Segnaposto sintetico' }).run();
}

function readBack(id: string) {
    const reopened = new Database(join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT * FROM patients WHERE id=?')
                .get(id) as Record<string, unknown> | undefined,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id')
                .all(id) as Array<Record<string, unknown>>,
            children: reopened.prepare('SELECT * FROM entries WHERE patient_id=? ORDER BY id')
                .all(id) as Array<Record<string, unknown>>,
            audit: reopened.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid')
                .all(id) as Array<Record<string, unknown>>,
        };
    } finally { reopened.close(); }
}

for (const fault of ['FAIL', 'IGNORE'] as const) {
    for (const operation of ['create', 'delete', 'restore'] as const) {
        test(`${operation} with audit ${fault}: full rollback`, async () => {
            const id = `c05-network-${operation}-${fault.toLowerCase()}`;
            setup(id, operation === 'create' ? 'absent' : operation === 'restore' ? 'deleted' : 'active');
            const before = readBack(id);
            const trigger = `c05_network_audit_${operation}_${fault.toLowerCase()}`;
            sql.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit failure'" : ''}); END`);
            try {
                const ctx = context(id);
                await assert.rejects(() => operation === 'create'
                    ? lifecycle.createNetworkScopedPatient(ctx, {
                        id, firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYNTH-${id}`, address: sealed,
                    })
                    : operation === 'delete'
                        ? lifecycle.deleteNetworkScopedPatient(ctx, { version: 3, deletionReason: sealed })
                        : lifecycle.restoreNetworkScopedPatient(ctx, { version: 3 }));
                const after = readBack(id);
                assert.deepEqual(after, before);
            } finally { sql.exec(`DROP TRIGGER ${trigger}`); }
        });
    }
}

for (const operation of ['create', 'delete', 'restore'] as const) {
    test(`${operation}: one committed event, host attribution and no replay`, async () => {
        const id = `c05-network-success-${operation}`;
        setup(id, operation === 'create' ? 'absent' : operation === 'restore' ? 'deleted' : 'active');
        const before = readBack(id);
        const ctx = context(id);
        const result = operation === 'create'
            ? await lifecycle.createNetworkScopedPatient(ctx, { id, firstName: 'Ada', lastName: 'Sintetica',
                taxCode: `SYNTH-${id}`, address: sealed, actorRef: 'forged', sourceSurface: 'job',
                clinicalSentinel: 'SECRET_SYNTHETIC' })
            : operation === 'delete'
                ? await lifecycle.deleteNetworkScopedPatient(ctx, { version: 3, deletionReason: sealed,
                    actorRef: 'forged', clinicalSentinel: 'SECRET_SYNTHETIC' })
                : await lifecycle.restoreNetworkScopedPatient(ctx, { version: 3,
                    actorRef: 'forged', clinicalSentinel: 'SECRET_SYNTHETIC' });
        assert.equal(result.status, operation === 'create' ? 201 : 200);
        const after = readBack(id);
        assert.equal(after.patient?.version, operation === 'create' ? 1 : 4);
        assert.equal(after.patient?.deleted_at !== null, operation === 'delete');
        assert.equal(after.patient?.deletion_reason, operation === 'delete' ? sealed : null);
        assert.equal(after.patient?.address, sealed);
        if (operation === 'create') {
            assert.equal(after.memberships.length, 1);
            assert.equal(after.memberships[0].ambulatory_id, 'c05-network-a');
        } else assert.deepEqual(after.memberships, before.memberships);
        assert.deepEqual(after.children, before.children);
        if (operation !== 'create') assert.equal(after.patient?.is_archived, before.patient?.is_archived);
        assert.equal(after.audit.length, before.audit.length + 1);
        const event = after.audit.at(-1)!;
        assert.equal(event.event_type, `patient.${operation === 'create' ? 'created' : operation === 'delete' ? 'deleted' : 'restored'}`);
        assert.equal(event.actor_type, 'user');
        assert.equal(event.actor_ref, 'c05-network-user');
        assert.equal(event.subject_ref, id);
        assert.equal(event.source_surface, 'native');
        assert.equal(event.request_id, 'c05-network-synthetic-request');
        assert.deepEqual(JSON.parse(String(event.redacted_metadata)), {
            resourceVersion: operation === 'create' ? 1 : 4,
            flags: ['auth:paired-client', 'paired-client:c05-network-client', 'scope:ambulatory'],
        });
        assert.doesNotMatch(JSON.stringify(event), /SECRET_SYNTHETIC|forged|ENC:aQ==:ZGF0YQ==/);

        if (operation === 'create') {
            await assert.rejects(() => lifecycle.createNetworkScopedPatient(ctx, {
                id, firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYNTH-${id}`,
            }));
        } else if (operation === 'delete') {
            const repeated = await lifecycle.deleteNetworkScopedPatient(ctx, { version: 3, deletionReason: sealed });
            assert.equal(repeated.status, 404);
        } else {
            const repeated = await lifecycle.restoreNetworkScopedPatient(ctx, { version: 3 });
            assert.equal(repeated.status, 404);
        }
        assert.deepEqual(readBack(id), after);
    });
}

test('wrong scope, stale version and invalid sealed boundary do not write patient or audit', async () => {
    const activeId = 'c05-network-denied-active';
    const deletedId = 'c05-network-denied-deleted';
    const createId = 'c05-network-denied-create';
    setup(activeId, 'active'); setup(deletedId, 'deleted'); setup(createId, 'absent');
    for (const [id, operation] of [[activeId, 'delete'], [deletedId, 'restore']] as const) {
        const before = readBack(id);
        const wrongScope = { ...context(id), scopeAmbulatoryId: 'other-scope' };
        const denied = operation === 'delete'
            ? await lifecycle.deleteNetworkScopedPatient(wrongScope, { version: 3 })
            : await lifecycle.restoreNetworkScopedPatient(wrongScope, { version: 3 });
        assert.equal(denied.status, 404);
        const stale = operation === 'delete'
            ? await lifecycle.deleteNetworkScopedPatient(context(id), { version: 2 })
            : await lifecycle.restoreNetworkScopedPatient(context(id), { version: 2 });
        assert.equal(stale.status, 409);
        assert.equal(stale.value.code, 'VERSION_CONFLICT');
        assert.deepEqual(readBack(id), before);
    }
    const beforeCreate = readBack(createId);
    const wrongCreate = await lifecycle.createNetworkScopedPatient(context(createId), {
        id: createId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTH-CREATE',
        ambulatoryId: 'other-scope',
    });
    assert.equal(wrongCreate.status, 403);
    const plaintextCreate = await lifecycle.createNetworkScopedPatient(context(createId), {
        id: createId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTH-CREATE', address: 'plaintext',
    });
    assert.equal(plaintextCreate.status, 400);
    const plaintextDelete = await lifecycle.deleteNetworkScopedPatient(context(activeId), {
        version: 3, deletionReason: 'plaintext',
    });
    assert.equal(plaintextDelete.status, 400);
    assert.deepEqual(readBack(createId), beforeCreate);
    assert.equal(readBack(activeId).audit.length, 0);
});
