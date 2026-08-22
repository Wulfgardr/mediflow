/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    AuthenticatedWebSessionSelectionError,
    createAuthenticatedWebSessionSelectionService,
} from './server-session-authenticated-selection.ts';
import { clearAllSessions, createSession } from './server-session.ts';
import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
} from './server-session-projection-owner.ts';

const USER = { id: 'synthetic-selection-user', username: ['synthetic', 'selection-clinician'].join('-'), role: 'clinician' };
const PAIR = { patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' };

afterEach(() => clearAllSessions());

function rejectsComposition(code: string) {
    return (error: unknown) => error instanceof AuthenticatedWebSessionSelectionError && error.code === code;
}
function rejectsOwner(code: string) {
    return (error: unknown) => error instanceof ServerSessionProjectionOwnerError && error.code === code;
}

test('acquires once, issues once, and returns only the owner opaque lease', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const session = createSession(USER); const owner = registry.acquire(session);
    let acquisitions = 0; let issues = 0;
    const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => {
        acquisitions += 1;
        return Object.freeze({ ...owner, issueSelection(input) { issues += 1; return owner.issueSelection(input); } });
    } });

    const lease = await service.issue({ expectedEpoch: 0, ...PAIR });

    assert.deepEqual({ acquisitions, issues, epoch: lease.selectionEpoch }, { acquisitions: 1, issues: 1, epoch: 1 });
    for (const value of [lease.sessionRef, lease.patientRef, lease.ambulatoryRef, lease.leaseRef]) {
        assert.match(value, /^[a-z]{3}_[0-9a-f]{32}$/u);
        assert.equal(value.includes(PAIR.patientId), false);
    }
});

test('fails closed with one fixed error when authentication cannot acquire an owner', async () => {
    let acquisitions = 0;
    const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => { acquisitions += 1; return null; } });

    await assert.rejects(() => service.issue({ expectedEpoch: 0, ...PAIR }), rejectsComposition('session_unavailable'));
    assert.equal(acquisitions, 1);
});

test('maps hostile caller input to typed errors without exposing raw details', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const session = createSession(USER); const owner = registry.acquire(session);
    const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => owner });
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('synthetic raw detail'); } });
    const accessor = { expectedEpoch: 0, patientId: PAIR.patientId };
    Object.defineProperty(accessor, 'ambulatoryId', { get() { return PAIR.ambulatoryId; } });
    const prototype = Object.create({ expectedEpoch: 0, patientId: PAIR.patientId, ambulatoryId: PAIR.ambulatoryId });

    for (const input of [hostile, { expectedEpoch: 0, ...PAIR, extra: true }, accessor, prototype]) {
        await assert.rejects(() => service.issue(input), (error: unknown) =>
            (rejectsComposition('input_invalid')(error) || rejectsOwner('input_invalid')(error))
            && !/synthetic raw detail/u.test(error instanceof Error ? error.message : ''));
    }
});

test('propagates owner epoch and canonical selection failures without retry', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => {
        if (pair.patientId !== PAIR.patientId || pair.ambulatoryId !== PAIR.ambulatoryId) throw new Error('synthetic mismatch');
        return pair;
    } });
    const session = createSession(USER); const owner = registry.acquire(session);
    let acquisitions = 0;
    const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => { acquisitions += 1; return owner; } });
    await service.issue({ expectedEpoch: 0, ...PAIR });

    await assert.rejects(() => service.issue({ expectedEpoch: 0, ...PAIR }), rejectsOwner('epoch_conflict'));
    await assert.rejects(() => service.issue({ expectedEpoch: 1, patientId: 'patient.synthetic.02', ambulatoryId: PAIR.ambulatoryId }),
        rejectsOwner('selection_unavailable'));
    assert.equal(acquisitions, 3);
});

test('re-acquires the current owner without resetting its selection epoch', async () => {
    const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => pair });
    const session = createSession(USER); const owner = registry.acquire(session);
    const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => registry.acquire(session) });

    const first = await service.issue({ expectedEpoch: 0, ...PAIR });
    const second = await service.issue({ expectedEpoch: first.selectionEpoch, ...PAIR });

    assert.equal(registry.lookup(session.id), owner);
    assert.deepEqual([first.selectionEpoch, second.selectionEpoch], [1, 2]);
});

test('composition remains an internal selection-only source boundary', () => {
    const core = readFileSync(new URL('./server-session-authenticated-selection.ts', import.meta.url), 'utf8');
    const production = readFileSync(new URL('./server-session-authenticated-selection-production.ts', import.meta.url), 'utf8');

    assert.match(production, /acquireAuthenticatedWebSessionProjectionOwner/u);
    assert.doesNotMatch(`${core}\n${production}`, /(?:route|ingest|preview|provider|apply)/u);
});
