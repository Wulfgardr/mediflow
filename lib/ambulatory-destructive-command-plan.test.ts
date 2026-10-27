import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { initializeSqliteSchema } from './sqlite-schema';
import { ambulatories, auditEvents, patients, patientsToAmbulatories } from './schema';
import { inspectAmbulatoryDestructivePlan, type AmbulatoryPlanBinding } from './ambulatory-destructive-command-plan';
import { AMBULATORY_COMMAND_PROTOCOL, parseAmbulatoryCommandMarker, parseAmbulatoryCommandReceipt } from './ambulatory-destructive-command-contract';

function fixture(operation: AmbulatoryPlanBinding['operation'] = 'ambulatory.clear-test.v1') {
    const sql = new Database(':memory:'); initializeSqliteSchema(sql);
    const db = drizzle(sql);
    db.insert(ambulatories).values([
        { id: 'test', name: 'Ambiente inventato', type: 'test', version: 2, isDefault: false, createdAt: new Date(1000) },
        { id: 'live', name: 'Sede inventata', type: 'live', version: 4, isDefault: true, createdAt: new Date(2000) },
    ]).run();
    const binding: AmbulatoryPlanBinding = { protocol: AMBULATORY_COMMAND_PROTOCOL, commandId: randomUUID(), originalArchiveGeneration: randomUUID(),
        originalScopeId: 'live', ambulatoryId: 'test', expectedVersion: 2, operation, actorRef: 'synthetic-admin',
        deviceId: 'synthetic-device', devicePlatform: 'macos', deviceTokenHash: 'synthetic-hash' };
    const patient = (id: string) => db.insert(patients).values({ id, firstName: 'DO-NOT-EXPORT-FIRST-NAME', lastName: 'DO-NOT-EXPORT-LAST-NAME',
        taxCode: `synthetic-${id}`, version: 3, diagnoses: 'DO-NOT-EXPORT-DIAGNOSIS', notes: 'DO-NOT-EXPORT-NOTE' }).run();
    const link = (id: string, scope = 'test') => db.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: scope, assignedAt: new Date(3000) }).run();
    const inspect = () => inspectAmbulatoryDestructivePlan(db, binding);
    return { sql, db, binding, patient, link, inspect };
}

test('clear preview distinguishes Cestino, unlink, preserved live and existing tombstones without patient text', () => {
    const f = fixture();
    try {
        for (const id of ['only-test', 'also-live', 'deleted']) { f.patient(id); f.link(id); }
        f.link('also-live', 'live');
        f.db.update(patients).set({ deletedAt: new Date(1000), deletionReason: 'prior-reason' }).where(eq(patients.id, 'deleted')).run();
        const plan = f.inspect();
        assert.equal(plan.reason, null);
        assert.deepEqual(plan.counts, { tombstonedPatients: 1, unlinkedPatients: 2, preservedLivePatients: 1, removedMembershipRows: 3 });
        assert.doesNotMatch(JSON.stringify(plan), /DO-NOT-EXPORT/);
        assert.equal(f.sql.prepare<[string], { version: number }>('SELECT version FROM ambulatories WHERE id=?').get('test')!.version, 2);
    } finally { f.sql.close(); }
});

for (const change of ['different-patient', 'membership', 'other-type', 'lifecycle', 'version'] as const) {
    test(`clear snapshot changes for ${change} without a target version change`, () => {
        const f = fixture();
        try {
            f.patient('a'); f.patient('b'); f.link('a'); f.link('a', 'live');
            const before = f.inspect();
            if (change === 'different-patient') { f.db.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.ambulatoryId, 'test')).run(); f.link('b'); }
            if (change === 'membership') f.db.delete(patientsToAmbulatories).where(eq(patientsToAmbulatories.ambulatoryId, 'live')).run();
            if (change === 'other-type') f.db.update(ambulatories).set({ type: 'test' }).where(eq(ambulatories.id, 'live')).run();
            if (change === 'lifecycle') f.db.update(patients).set({ deletedAt: new Date(1000), deletionReason: 'synthetic' }).where(eq(patients.id, 'a')).run();
            if (change === 'version') f.db.update(patients).set({ version: 4 }).where(eq(patients.id, 'a')).run();
            assert.notEqual(f.inspect().planDigest, before.planDigest);
            assert.equal(f.sql.prepare<[string], { version: number }>('SELECT version FROM ambulatories WHERE id=?').get('test')!.version, 2);
            if (change === 'different-patient') assert.equal(f.inspect().counts!.removedMembershipRows, before.counts!.removedMembershipRows);
        } finally { f.sql.close(); }
    });
}

test('NULL other type protects and a second test membership does not protect', () => {
    const f = fixture();
    try {
        f.patient('a'); f.link('a'); f.link('a', 'live');
        f.db.update(ambulatories).set({ type: null }).where(eq(ambulatories.id, 'live')).run();
        assert.equal(f.inspect().counts!.tombstonedPatients, 0);
        f.db.update(ambulatories).set({ type: 'test' }).where(eq(ambulatories.id, 'live')).run();
        assert.equal(f.inspect().counts!.tombstonedPatients, 1);
    } finally { f.sql.close(); }
});

for (const blocker of ['child', 'membership', 'active-primary', 'fallback-tie', 'fallback-overflow'] as const) {
    test(`delete preview denies ${blocker} before mutation`, () => {
        const f = fixture('ambulatory.delete.v1');
        try {
            const before = f.inspect(); assert.equal(before.reason, null);
            if (blocker === 'child') f.db.insert(ambulatories).values({ id: 'child', name: 'Figlia inventata', parentId: 'test' }).run();
            if (blocker === 'membership') { f.patient('a'); f.link('a'); f.db.update(patients).set({ deletedAt: new Date(1000) }).run(); }
            if (blocker === 'active-primary') { f.patient('a'); f.db.update(patients).set({ ambulatoryId: 'test', isArchived: true }).run(); }
            if (blocker.startsWith('fallback')) {
                f.db.update(ambulatories).set({ isDefault: true }).where(eq(ambulatories.id, 'test')).run();
                if (blocker === 'fallback-tie') f.db.insert(ambulatories).values({ id: 'other', name: 'Altra inventata', createdAt: new Date(2000) }).run();
                else f.db.update(ambulatories).set({ version: Number.MAX_SAFE_INTEGER }).where(eq(ambulatories.id, 'live')).run();
            }
            assert.equal(f.inspect().reason, { child: 'child_ambulatories', membership: 'linked_patients', 'active-primary': 'linked_patients',
                'fallback-tie': 'fallback_ambiguous', 'fallback-overflow': 'version_exhausted' }[blocker]);
            assert.notEqual(f.inspect().planDigest, before.planDigest);
        } finally { f.sql.close(); }
    });
}

test('legacy empty audit set plus delete/create event identities detects same-row ABA at equal timestamp', () => {
    const f = fixture('ambulatory.delete.v1');
    try {
        const before = f.inspect(); assert.deepEqual(before.snapshot.audit, []);
        for (const eventType of ['ambulatory.deleted', 'ambulatory.created']) f.db.insert(auditEvents).values({ eventId: randomUUID(),
            eventType, occurredAt: new Date(1000), outcome: 'success', actorType: 'user', actorRef: 'synthetic',
            sourceSurface: 'web', subjectType: 'ambulatory', subjectRef: 'test', createdAt: new Date(1000) }).run();
        const after = f.inspect();
        assert.deepEqual(after.snapshot.target, before.snapshot.target);
        assert.notEqual(after.planDigest, before.planDigest);
        assert.equal(after.snapshot.audit.length, 2);
    } finally { f.sql.close(); }
});

test('clear version preflight includes every changed patient and an empty container', () => {
    const f = fixture();
    try {
        assert.equal(f.inspect().reason, null);
        f.db.update(ambulatories).set({ version: Number.MAX_SAFE_INTEGER }).where(eq(ambulatories.id, 'test')).run();
        f.binding.expectedVersion = Number.MAX_SAFE_INTEGER;
        assert.equal(f.inspect().reason, 'version_exhausted');
        f.db.update(ambulatories).set({ version: 2 }).where(eq(ambulatories.id, 'test')).run(); f.binding.expectedVersion = 2;
        f.patient('a'); f.link('a'); f.link('a', 'live'); f.db.update(patients).set({ version: Number.MAX_SAFE_INTEGER }).run();
        assert.equal(f.inspect().reason, 'version_exhausted');
    } finally { f.sql.close(); }
});

test('public receipt contract rejects audit or patient-plan additions and malformed terminal shapes', () => {
    const f = fixture();
    try {
        const { actorRef: _actor, deviceId: _device, devicePlatform: _platform, deviceTokenHash: _hash, ...identity } = f.binding;
        const marker = { ...identity, planDigest: f.inspect().planDigest };
        assert.ok(parseAmbulatoryCommandMarker(marker));
        const closed = { ...marker, outcome: 'closed', reason: null, result: null, committedAt: 1000 };
        assert.ok(parseAmbulatoryCommandReceipt(closed));
        for (const value of [{ ...closed, auditSnapshots: [] }, { ...closed, patients: [] }, { ...closed, result: {} },
            { ...closed, outcome: 'applied' }, { ...closed, reason: 'plan_changed' }, { ...closed, committedAt: -0 }]) assert.equal(parseAmbulatoryCommandReceipt(value), null);
    } finally { f.sql.close(); }
});
