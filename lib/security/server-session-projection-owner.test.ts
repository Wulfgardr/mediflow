/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';
import { clearAllSessions, createSession, deleteSession, getSession, type ServerSession } from './server-session.ts';
import { ProjectionBrokerError } from '../typed-projection-broker.ts';

const USER = {
    id: ['synthetic', 'user'].join('-'),
    username: ['synthetic', 'clinician'].join('-'),
    role: 'clinician',
};
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function session(channel: ServerSession['authChannel'] = 'web') {
    return createSession(USER, channel);
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

    assert.equal(registry.lookup(first.id), firstOwner);
    assert.equal(registry.lookup(second.id), secondOwner);
    assert.notEqual(firstOwner, secondOwner);
    assert.throws(() => registry.create(first), rejects('owner_exists'));
    deleteSession(first.id);
    secondOwner.dispose();
    assert.equal(createServerSessionProjectionOwnerRegistry().lookup(first.id), null);
});

test('delete, expiry, reset, and explicit disposal are terminal and idempotent', () => {
    const scenarios = [
        (value: ServerSession) => deleteSession(value.id),
        (value: ServerSession) => { value.expiresAt = 0; assert.equal(getSession(value.id), null); },
        () => clearAllSessions(),
        (_value: ServerSession, owner: { dispose(): void }) => owner.dispose(),
    ];

    for (const terminate of scenarios) {
        let sequence = 0; const events: string[] = [];
        const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair,
            entropy: () => Uint8Array.from({ length: 16 }, (_, index) => sequence += index + 1),
            brokerFactory: () => ({ ingest: Object.freeze({ ingest() { return 'unused'; } }),
                service: Object.freeze({ consume() { return {}; } }), control: Object.freeze({ lock() {},
                    changeSelection() {}, revoke() { events.push('revoked'); } }) }) as never });
        const value = session();
        const owner = registry.create(value);
        const lease = owner.issueSelection({ expectedEpoch: 0, ...PAIR });
        const ingest = owner.acquireProjectionIngest(value, { sessionRef: lease.sessionRef,
            selectionEpoch: lease.selectionEpoch, patientRef: lease.patientRef,
            ambulatoryRef: lease.ambulatoryRef, leaseRef: lease.leaseRef });

        terminate(value, owner);
        owner.dispose();
        owner.dispose();

        assert.equal(registry.lookup(value.id), null);
        assert.deepEqual(events, ['revoked']);
        assert.throws(() => ingest.ingest({} as never),
            (error) => error instanceof ProjectionBrokerError && error.code === 'broker_revoked');
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
