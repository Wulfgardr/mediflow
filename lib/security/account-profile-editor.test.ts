import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountProfileEditor, type AccountProfile } from './account-profile-editor';
import { captureClientAccountAuthority, checkAuthHealthRequest, subscribeClientAccountAuthority } from './client-auth-api';

const initial: AccountProfile = { userId: 'synthetic-user', username: ['synthetic', 'profile'].join('-'), displayName: 'Nome corrente',
    ambulatoryName: 'Studio corrente', profileVersion: 'opaque-initial', archiveGeneration: 'synthetic-generation' };
const read = (profile = initial) => Response.json({ ...profile, operation: 'account-profile.read.v1', contractVersion: 1 });
function fixture() {
    const requests: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    let next: () => Promise<Response> = async () => read();
    let current = true;
    const applied: AccountProfile[] = [];
    const editor = new AccountProfileEditor(initial.userId, () => current, () => {}, profile => applied.push(profile),
        (async (input, init) => { requests.push({ input, init }); return next(); }) as typeof fetch);
    return { editor, requests, applied, respond: (handler: () => Promise<Response>) => { next = handler; }, expire: () => { current = false; } };
}

test('opens from GET, saves the opaque version without id and uses normalized host values; no-op stays successful', async () => {
    const f = fixture();
    await f.editor.read();
    assert.equal(f.requests[0]!.init?.cache, 'no-store');
    assert.equal(f.editor.state.draft.doctorName, initial.displayName);
    f.editor.edit({ doctorName: ' Nome inviato ', clinicName: ' Studio ' });
    const updated = { ...initial, profileVersion: 'opaque-updated', displayName: 'Nome inviato', ambulatoryName: 'Studio' };
    f.respond(async () => Response.json({ ...updated, changed: true }));
    await f.editor.save();
    assert.deepEqual(JSON.parse(f.requests[1]!.init!.body as string), {
        expectedVersion: 'opaque-initial', displayName: ' Nome inviato ', ambulatoryName: ' Studio ',
    });
    assert.equal(new Headers(f.requests[1]!.init!.headers).get('x-mediflow-archive-generation'), initial.archiveGeneration);
    assert.equal(f.applied.at(-1)?.displayName, 'Nome inviato');
    assert.equal(f.editor.state.draft.doctorName, 'Nome inviato');
    f.respond(async () => read(updated));
    await f.editor.read();
    f.respond(async () => Response.json({ ...updated, changed: false }));
    await f.editor.save();
    assert.equal(f.editor.state.message, 'Il profilo è già aggiornato.');
});

test('conflict preserves draft, shows current values and blocks PUT until an explicit read and gesture', async () => {
    const f = fixture();
    await f.editor.read();
    const draft = { doctorName: 'La mia bozza', clinicName: 'Il mio studio' };
    f.editor.edit(draft);
    const other = { ...initial, displayName: 'Altro client', profileVersion: 'opaque-other' };
    f.respond(async () => Response.json({ ...other, code: 'PROFILE_VERSION_CONFLICT' }, { status: 409 }));
    await f.editor.save();
    assert.deepEqual(f.editor.state.draft, draft);
    assert.equal(f.editor.state.current?.displayName, 'Altro client');
    assert.equal(f.applied.length, 1);
    await f.editor.save();
    assert.equal(f.requests.length, 2);
    f.respond(async () => read(other));
    await f.editor.read();
    assert.deepEqual(f.editor.state.draft, draft);
    assert.equal(f.editor.state.requiresRead, false);
    assert.equal(f.requests.length, 3);
});

for (const failure of ['transport', '401', '403', 'archive', 'invalid', 'foreign-user'] as const) {
    test(`${failure}: no optimistic update, no retry and draft survives`, async () => {
        const f = fixture();
        await f.editor.read();
        f.editor.edit({ doctorName: 'Bozza', clinicName: 'Studio' });
        f.respond(async () => {
            if (failure === 'transport') throw new TypeError('lost response');
            if (failure === 'invalid') return Response.json({ success: true });
            if (failure === 'foreign-user') return Response.json({ ...initial, userId: 'another', changed: true });
            return Response.json({ code: failure === 'archive' ? 'ARCHIVE_REPLACED' : 'denied' }, { status: failure === 'archive' ? 409 : Number(failure) });
        });
        await f.editor.save();
        assert.equal(f.editor.state.draft.doctorName, 'Bozza');
        assert.equal(f.editor.state.requiresRead, true);
        assert.equal(f.applied.length, 1);
        await f.editor.save();
        assert.equal(f.requests.length, 2);
    });
}

for (const operation of ['read', 'save'] as const) for (const invalidation of ['session', 'dispose'] as const) {
    test(`late ${operation} response after ${invalidation} is ignored`, async () => {
        const f = fixture();
        await f.editor.read();
        let release!: (response: Response) => void;
        f.respond(() => new Promise(resolve => { release = resolve; }));
        const pending = f.editor[operation]();
        const before = f.editor.state;
        if (invalidation === 'session') f.expire(); else f.editor.dispose();
        release(operation === 'read' ? read({ ...initial, displayName: 'Risposta tardiva' })
            : Response.json({ ...initial, changed: true, displayName: 'Risposta tardiva' }));
        await pending;
        assert.equal(f.editor.state, before);
        assert.equal(f.applied.length, 1);
    });
}

test('a response from another archive is rejected before cache or draft changes', async () => {
    const f = fixture();
    await f.editor.read();
    f.respond(async () => read({ ...initial, archiveGeneration: 'replacement' }));
    await f.editor.read();
    assert.equal(f.editor.state.current?.archiveGeneration, initial.archiveGeneration);
    assert.equal(f.editor.state.requiresRead, true);
    assert.equal(f.applied.length, 1);
});

test('the session cache can recheck a queued application after session replacement', async () => {
    let authority = true;
    let mayApply: (() => boolean) | undefined;
    const editor = new AccountProfileEditor(initial.userId, () => authority, () => {},
        (_profile, isCurrent) => { mayApply = isCurrent; }, (async () => read()) as typeof fetch);
    await editor.read();
    assert.equal(mayApply?.(), true);
    authority = false;
    assert.equal(mayApply?.(), false);
});

for (const pendingOperation of [null, 'read', 'save'] as const) {
    test(`same-account auth replacement preserves draft, unblocks read and rejects late ${pendingOperation}`, async () => {
        const originalFetch = globalThis.fetch;
        const generation = 'a1234567-1234-4234-8234-123456789abc';
        let etag = '"synthetic-session-first"';
        globalThis.fetch = (async () => Response.json({ status: 'ok', hasSession: true, archiveGeneration: generation },
            { headers: { ETag: etag } })) as typeof fetch;
        let unsubscribe = () => {};
        try {
            await checkAuthHealthRequest();
            let next: () => Promise<Response> = async () => read({ ...initial, archiveGeneration: generation });
            const applied: AccountProfile[] = [];
            const editor = new AccountProfileEditor(initial.userId, captureClientAccountAuthority(), () => {},
                profile => applied.push(profile), (async () => next()) as typeof fetch);
            const notifications: unknown[][] = [];
            unsubscribe = subscribeClientAccountAuthority((...args) => {
                notifications.push(args);
                editor.replaceAuthority(captureClientAccountAuthority());
            });
            await editor.read();
            const draft = { doctorName: 'Bozza stessa persona', clinicName: 'Studio bozza' };
            editor.edit(draft);
            let release!: (response: Response) => void;
            next = () => new Promise(resolve => { release = resolve; });
            const pending = pendingOperation ? editor[pendingOperation]() : undefined;
            etag = '"synthetic-session-replacement"';
            await checkAuthHealthRequest();
            assert.deepEqual(notifications, [[]], 'notification exposes no credential or ETag');
            assert.equal(editor.state.busy, false);
            assert.equal(editor.state.requiresRead, true);
            assert.match(editor.state.message, /sessione.*Rileggi/);
            assert.deepEqual(editor.state.draft, draft);
            if (pendingOperation) {
                release(Response.json({ ...initial, archiveGeneration: generation, displayName: 'Tardivo',
                    operation: 'account-profile.read.v1', contractVersion: 1, changed: true }));
                await pending;
            }
            assert.equal(applied.length, 1);
            let reads = 0;
            next = async () => { reads++; return read({ ...initial, archiveGeneration: generation, profileVersion: 'fresh' }); };
            await editor.save();
            assert.equal(reads, 0);
            await editor.read();
            assert.equal(reads, 1);
            assert.equal(editor.state.requiresRead, false);
            assert.deepEqual(editor.state.draft, draft);
            await checkAuthHealthRequest();
            assert.equal(notifications.length, 1, 'unchanged authority does not invalidate the editor');
        } finally { unsubscribe(); globalThis.fetch = originalFetch; }
    });
}
