/* Synthetic SQLite conformance for the common host profile port. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { eq } from 'drizzle-orm';
import { ambulatories, patients, patientsToAmbulatories } from './schema';
import type { RequiredAuditContext } from './security/audit';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-port-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const { readPatientProfile, updatePatientProfile } = load('./patient-profile-service.ts') as typeof import('./patient-profile-service');
const sql = dbServer.$client;
const patientId = 'profile-port-synthetic-patient';
const sealedNotes = 'ENC:YWJj:bm90ZXM=';

test.after(() => {
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
});

function reset() {
    dbServer.delete(patientsToAmbulatories).run();
    dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run();
    dbServer.insert(ambulatories).values([
        { id: 'profile-a', name: 'Ambulatorio sintetico A', type: 'live' },
        { id: 'profile-b', name: 'Ambulatorio sintetico B', type: 'live' },
    ]).run();
    dbServer.insert(patients).values({
        id: patientId, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'PROFILE-SYNTHETIC',
        birthDate: new Date(0), createdAt: new Date(0), updatedAt: new Date(0),
        notes: sealedNotes, address: 'ENC:YWJj:YWRkcmVzcw==', phone: null,
        ambulatoryId: 'profile-a', version: 4, isArchived: false,
    }).run();
    dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId: 'profile-a' }).run();
}

function snapshot() {
    return {
        patients: sql.prepare('SELECT * FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all() as Record<string, unknown>[],
    };
}

function audit(): RequiredAuditContext {
    const row = sql.prepare('SELECT generation FROM archive_generation WHERE id=1').get() as { generation: string };
    return { archiveGeneration: row.generation, actorType: 'user', actorRef: 'profile-host-user',
        sourceSurface: 'web', requestId: 'profile-host-request', flags: ['auth:session'] };
}

test('three projections preserve ciphertext, nulls and epoch dates without read effects', async () => {
    reset();
    const before = snapshot();
    const web = await readPatientProfile({ patientId, projection: 'web' });
    const v1 = await readPatientProfile({ patientId, projection: 'api-v1' });
    const network = await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' });
    assert.ok(web && v1 && network);
    assert.ok(web.birthDate instanceof Date);
    assert.equal(web.birthDate.getTime(), 0);
    assert.equal(v1.birthDate, '1970-01-01T00:00:00.000Z');
    assert.equal(v1.createdAt, '1970-01-01T00:00:00.000Z');
    assert.equal(v1.notes, sealedNotes);
    assert.equal(v1.phone, null);
    assert.equal(Object.hasOwn(v1, 'deletedAt'), false);
    assert.equal(Object.hasOwn(v1, 'deletionReason'), false);
    assert.deepEqual(network, { ...v1, deletedAt: null, deletionReason: null });
    assert.deepEqual(JSON.parse(JSON.stringify(web)), { ...v1, deletedAt: null, deletionReason: null });
    assert.deepEqual(snapshot(), before);
});

test('archived profiles remain readable while scope mismatch and tombstones stay absent', async () => {
    reset();
    dbServer.update(patients).set({ isArchived: true }).where(eq(patients.id, patientId)).run();
    assert.equal((await readPatientProfile({ patientId, projection: 'api-v1' }))?.isArchived, true);
    assert.equal((await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' }))?.isArchived, true);
    assert.equal(await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-b' }), null);
    dbServer.update(patients).set({ deletedAt: new Date(), deletionReason: 'synthetic' }).where(eq(patients.id, patientId)).run();
    assert.equal(await readPatientProfile({ patientId, projection: 'web' }), null);
    assert.equal(await readPatientProfile({ patientId, projection: 'api-v1' }), null);
    assert.equal(await readPatientProfile({ patientId, projection: 'network', scopeAmbulatoryId: 'profile-a' }), null);
});

test('body cannot spoof host patient, scope, expected version, actor, role, audit or receipt', async () => {
    reset();
    const before = snapshot();
    const body = {
        notes: 'ENC:YWJj:bmV3', id: 'forged-patient', patientId: 'forged-patient',
        version: 999, expectedVersion: 999, scopeAmbulatoryId: 'profile-b',
        actorRef: 'forged-actor', actorType: 'system', role: 'admin',
        sourceSurface: 'job', audit: { actorRef: 'forged-audit' },
        receipt: { success: true, idempotencyKey: 'forged-receipt' },
    };
    const result = await updatePatientProfile({ patientId, expectedVersion: 4, audit }, body);
    assert.equal(result.status, 200);
    const after = snapshot();
    assert.equal(after.patients.length, 1);
    const previous = before.patients[0] as Record<string, unknown>;
    const current = after.patients[0] as Record<string, unknown>;
    assert.equal(current.notes, body.notes);
    assert.equal(current.version, 5);
    for (const key of Object.keys(previous)) {
        if (!['notes', 'version', 'updated_at'].includes(key)) assert.deepEqual(current[key], previous[key], key);
    }
    assert.deepEqual(after.memberships, before.memberships);
    assert.equal(after.audit.length, before.audit.length + 1);
    const event = after.audit.at(-1)!;
    assert.equal(event.actor_ref, 'profile-host-user');
    assert.equal(event.subject_ref, patientId);
    assert.equal(event.source_surface, 'web');
    assert.equal(event.request_id, 'profile-host-request');
    const metadata = JSON.parse(event.redacted_metadata as string);
    assert.deepEqual(metadata.changedFields, ['notes']);
    assert.equal(metadata.resourceVersion, 5);
    assert.ok(!JSON.stringify(event).includes('forged'));
    assert.ok(!JSON.stringify(event).includes(body.notes));
    const retry = await updatePatientProfile({ patientId, expectedVersion: 4, audit }, body);
    assert.equal(retry.status, 409);
    assert.deepEqual(snapshot(), after);
});

test('unscoped profile preserves omitted notes, explicit null and empty string semantics', async () => {
    reset();
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 4, audit }, { phone: null })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, sealedNotes);
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 5, audit }, { notes: null })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, null);
    assert.equal((await updatePatientProfile({ patientId, expectedVersion: 6, audit }, { notes: '' })).status, 200);
    assert.equal((await readPatientProfile({ patientId, projection: 'web' }))?.notes, '');
});

test('missing-before-invalid precedence does not acquire an audit context for invalid input', async () => {
    reset();
    let auditCalls = 0;
    const context = { patientId, expectedVersion: 4, audit: () => { auditCalls += 1; return audit(); } };
    const before = snapshot();
    assert.equal((await updatePatientProfile({ ...context, patientId: 'missing' }, { birthDate: 'invalid' })).status, 404);
    assert.equal((await updatePatientProfile(context, { birthDate: 'invalid' })).status, 400);
    assert.equal((await updatePatientProfile(context, {})).status, 400);
    assert.equal(auditCalls, 0);
    assert.deepEqual(snapshot(), before);
});

test('profile routes do not import database, schema or ORM directly', () => {
    for (const file of ['app/api/patients/[id]/route.ts', 'app/api/v1/patients/[id]/route.ts', 'app/api/v1/network/patients/[id]/route.ts']) {
        const source = ts.createSourceFile(file, readFileSync(join(import.meta.dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
        const inspect = (node: ts.Node) => {
            let specifier: ts.Expression | undefined;
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
            if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
                || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0];
            if (specifier && ts.isStringLiteral(specifier)) {
                assert.ok(!/(^|\/)(db-server|schema)(\.[cm]?ts)?$|^drizzle-orm($|\/)/.test(specifier.text), `${file}: ${specifier.text}`);
            }
            ts.forEachChild(node, inspect);
        };
        inspect(source);
    }
});
