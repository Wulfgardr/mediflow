/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
    createCanonicalClinicalContextResolver,
    ServerSessionClinicalContextError,
} from './server-session-clinical-context.ts';
import { clearAllSessions, createSession, deleteSession } from './server-session.ts';

const USER = {
    id: ['synthetic', 'context-user'].join('-'),
    username: ['synthetic', 'context-clinician'].join('-'),
    role: 'clinician',
};

afterEach(() => clearAllSessions());

function fixture() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE patients (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE ambulatories (id TEXT PRIMARY KEY NOT NULL);
        CREATE TABLE patients_to_ambulatories (
            patient_id TEXT NOT NULL,
            ambulatory_id TEXT NOT NULL,
            PRIMARY KEY (patient_id, ambulatory_id)
        );
        INSERT INTO patients (id) VALUES ('patient.synthetic.01'), ('patient.synthetic.02');
        INSERT INTO ambulatories (id) VALUES ('ambulatory.synthetic.01'), ('ambulatory.synthetic.02');
        INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES
            ('patient.synthetic.01', 'ambulatory.synthetic.01'),
            ('patient.synthetic.01', 'ambulatory.synthetic.02'),
            ('patient.synthetic.02', 'ambulatory.synthetic.02');
    `);
    return { sqlite, resolve: createCanonicalClinicalContextResolver(drizzle(sqlite)) };
}

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionClinicalContextError && error.code === code;
}

test('resolves only the requested canonical M2M pair across multiple memberships', (context) => {
    const { sqlite, resolve } = fixture();
    context.after(() => sqlite.close());
    const session = createSession(USER);

    assert.deepEqual(resolve(session, {
        patientId: 'patient.synthetic.01',
        ambulatoryId: 'ambulatory.synthetic.01',
    }), { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
    assert.deepEqual(resolve(session, {
        patientId: 'patient.synthetic.01',
        ambulatoryId: 'ambulatory.synthetic.02',
    }), { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.02' });
    assert.throws(() => resolve(session, {
        patientId: 'patient.synthetic.02',
        ambulatoryId: 'ambulatory.synthetic.01',
    }), rejects('membership_missing'));
});

test('rejects missing canonical patient and ambulatory rows distinctly', (context) => {
    const { sqlite, resolve } = fixture();
    context.after(() => sqlite.close());
    const session = createSession(USER);

    assert.throws(() => resolve(session, {
        patientId: 'patient.synthetic.missing',
        ambulatoryId: 'ambulatory.synthetic.01',
    }), rejects('patient_missing'));
    assert.throws(() => resolve(session, {
        patientId: 'patient.synthetic.01',
        ambulatoryId: 'ambulatory.synthetic.missing',
    }), rejects('ambulatory_missing'));
});

test('rejects native, system, local-api, and unavailable sessions', (context) => {
    const { sqlite, resolve } = fixture();
    context.after(() => sqlite.close());
    const web = createSession(USER);
    const request = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

    for (const session of [
        createSession(USER, 'native'),
        createSession(USER, 'system'),
        { ...web, id: 'local-api' },
    ]) assert.throws(() => resolve(session, request), rejects('session_ineligible'));

    deleteSession(web.id);
    assert.throws(() => resolve(web, request), rejects('session_ineligible'));
});

test('rejects extra keys, custom prototypes, accessors, and malformed identifiers', (context) => {
    const { sqlite, resolve } = fixture();
    context.after(() => sqlite.close());
    const session = createSession(USER);
    const valid = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };
    let accessorReads = 0;
    const accessor = Object.defineProperty({ patientId: valid.patientId }, 'ambulatoryId', {
        enumerable: true,
        get() { accessorReads += 1; return valid.ambulatoryId; },
    });

    for (const input of [
        { ...valid, selectionEpoch: 1 },
        Object.assign(Object.create({}), valid),
        accessor,
        { ...valid, patientId: ' patient.synthetic.01' },
        { ...valid, ambulatoryId: '' },
    ]) assert.throws(() => resolve(session, input), rejects('input_invalid'));
    assert.equal(accessorReads, 0);
});

test('production resolver has no provider, apply, Smart Import, or owner-install reachability', () => {
    const resolverSource = readFileSync(new URL('./server-session-clinical-context.ts', import.meta.url), 'utf8');
    const productionSource = readFileSync(
        new URL('./server-session-clinical-context-production.ts', import.meta.url),
        'utf8',
    );
    const source = `${resolverSource}\n${productionSource}`;

    assert.doesNotMatch(source, /from ['"][^'"]*(?:provider|apply|patient-smart-import|projection-owner)[^'"]*['"]/u);
    assert.doesNotMatch(source, /\.install\s*\(/u);
});
