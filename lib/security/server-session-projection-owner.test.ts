/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, getSession, type ServerSession } from './server-session.ts';

const USER = {
    id: ['synthetic', 'user'].join('-'),
    username: ['synthetic', 'clinician'].join('-'),
    role: 'clinician',
};
const LEASE_A = 'lease.synthetic.0001';
const LEASE_B = 'lease.synthetic.0002';

afterEach(() => clearAllSessions());

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
}

function control(label: string, events: string[]) {
    return {
        lock() {},
        revoke() { events.push(label); },
        changeSelection(_value: Readonly<{ patientRef: string; selectionEpoch: number }>) {},
    };
}

function rejects(code: string) {
    return (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === code;
}

test('registry isolates sessions, rejects duplicate owners, and fresh lookup stays unavailable', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const first = session();
    const second = session();
    const firstOwner = registry.create(first);
    const secondOwner = registry.create(second);
    const events: string[] = [];
    firstOwner.install({ leaseRef: LEASE_A, selectionEpoch: 1, control: control('first', events) });
    secondOwner.install({ leaseRef: LEASE_B, selectionEpoch: 1, control: control('second', events) });

    assert.equal(registry.lookup(first.id), firstOwner);
    assert.equal(registry.lookup(second.id), secondOwner);
    assert.notEqual(firstOwner, secondOwner);
    assert.throws(() => registry.create(first), rejects('owner_exists'));
    deleteSession(first.id);
    assert.deepEqual(events, ['first']);
    secondOwner.dispose();
    assert.deepEqual(events, ['first', 'second']);
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.id), null);
});

test('higher epoch revokes before replacing the single broker; equal and lower fail stable', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const owner = registry.create(session());
    const events: string[] = [];

    owner.install({ leaseRef: LEASE_A, selectionEpoch: 2, control: control('old', events) });
    assert.throws(
        () => owner.install({ leaseRef: LEASE_B, selectionEpoch: 2, control: control('equal', events) }),
        rejects('epoch_not_advanced'),
    );
    assert.throws(
        () => owner.install({ leaseRef: LEASE_B, selectionEpoch: 1, control: control('lower', events) }),
        rejects('epoch_not_advanced'),
    );
    assert.deepEqual(events, []);

    owner.install({ leaseRef: LEASE_B, selectionEpoch: 3, control: control('new', events) });
    assert.deepEqual(events, ['old']);
    owner.dispose();
    assert.deepEqual(events, ['old', 'new']);
});

test('install accepts only an opaque lease, trusted positive epoch, and broker control', () => {
    const owner = createServerSessionProjectionOwnerRegistry().create(session());
    const valid = { leaseRef: LEASE_A, selectionEpoch: 1, control: control('valid', []) };
    const extra = { ...valid, patientRef: 'patient.synthetic' };

    assert.throws(() => owner.install({ ...valid, leaseRef: 'short' }), rejects('input_invalid'));
    assert.throws(() => owner.install({ ...valid, selectionEpoch: 0 }), rejects('input_invalid'));
    assert.throws(() => owner.install(extra), rejects('input_invalid'));
});

test('delete, expiry, reset, and explicit disposal are terminal and idempotent', () => {
    const scenarios = [
        (value: ServerSession) => deleteSession(value.id),
        (value: ServerSession) => { value.expiresAt = 0; assert.equal(getSession(value.id), null); },
        () => clearAllSessions(),
        (_value: ServerSession, owner: { dispose(): void }) => owner.dispose(),
    ];

    for (const terminate of scenarios) {
        const registry = createServerSessionProjectionOwnerRegistry();
        const value = session();
        const owner = registry.create(value);
        const events: string[] = [];
        owner.install({ leaseRef: LEASE_A, selectionEpoch: 1, control: control('revoked', events) });

        terminate(value, owner);
        owner.dispose();
        owner.dispose();

        assert.equal(registry.lookup(value.id), null);
        assert.deepEqual(events, ['revoked']);
        assert.throws(
            () => owner.install({ leaseRef: LEASE_B, selectionEpoch: 2, control: control('late', events) }),
            rejects('owner_disposed'),
        );
    }
});

test('native, system, and local-api identities cannot create an owner', () => {
    const registry = createServerSessionProjectionOwnerRegistry();
    const web = session();

    for (const value of [session('native'), session('system'), { ...web, id: 'local-api' }]) {
        assert.throws(() => registry.create(value), rejects('session_ineligible'));
    }
    assert.equal(registry.lookup(web.id), null);
});

test('production composition authenticates directly and has no provider or apply reachability', () => {
    const ownerSource = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    const authSource = readFileSync(new URL('./server-auth.ts', import.meta.url), 'utf8');
    const productionSource = `${ownerSource}\n${authSource}`;

    assert.match(
        authSource,
        /const session = await requireSession\(\);[\s\S]*serverSessionProjectionOwnerRegistry\.create\(session\)/u,
    );
    assert.doesNotMatch(
        productionSource,
        /from ['"][^'"]*(?:provider|apply|patient-smart-import)[^'"]*['"]/u,
    );
});
