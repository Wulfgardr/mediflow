import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalUiDocumentLease } from './local-ui-document-lease';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('back-forward restoration resumes the UI with a fresh lease, without releasing the old lease', async () => {
    const page = new EventTarget(), calls: { tab: string; action: string }[] = [];
    const dispose = startLocalUiDocumentLease(page, async (tab, action) => { calls.push({ tab, action }); return { status: 204 }; });
    try {
        await flush(); page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow')); await flush();
        assert.deepEqual(calls.map(call => call.action), ['renew', 'renew']);
        assert.notEqual(calls[0].tab, calls[1].tab);
    } finally { dispose(); }
    const size = calls.length; page.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(calls.length, size);
});
test('a renewal paused before pagehide cannot suppress renewal after cache restoration', async () => {
    const page = new EventTarget(), calls: { tab: string; action: string }[] = [];
    let complete!: (response: { status: number }) => void;
    const pending = new Promise<{ status: number }>(resolve => { complete = resolve; });
    const dispose = startLocalUiDocumentLease(page, async (tab, action) => {
        calls.push({ tab, action }); return calls.length === 1 ? pending : { status: 204 };
    });
    try {
        page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow'));
        complete({ status: 404 }); await flush();
        assert.deepEqual(calls.map(call => call.action), ['renew', 'renew']);
        assert.notEqual(calls[0].tab, calls[1].tab);
    } finally { dispose(); }
});

test('reload after plugin disconnect hands off the last lease; a closed UI expires', async t => {
    const { createRuntimeLeases, runtimeProcessIdentity } = await import('../scripts/runtime-leases.mjs');
    const { initializeWindowsSystemCommand } = await import('../scripts/windows-system-command.mjs');
    initializeWindowsSystemCommand();
    const { mkdtempSync, realpathSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'mf-document-handoff-')));
    let stopped = false;
    const owner = await createRuntimeLeases({ directory, identity: runtimeProcessIdentity, initialPlugin: true, onIdle: () => { stopped = true; } });
    t.after(async () => { await owner.close(); rmSync(directory, { recursive: true, force: true }); });
    const send = async (tab: string, action: 'renew' | 'release') => ({
        status: owner.uiLease(`${'a'.repeat(64)}:${tab}`, action === 'release' ? null : Date.now() + 1000) ? 204 : 409,
    });
    const oldPage = new EventTarget();
    const disposeOld = startLocalUiDocumentLease(oldPage, send);
    let disposeNew = () => {};
    try {
        await flush(); owner.releaseInitial();
        oldPage.dispatchEvent(new Event('pagehide'));
        await flush(); await flush();
        assert.equal(stopped, false, 'pagehide must leave time for the replacement document');
        const renewals: number[] = [];
        const newPage = new EventTarget();
        disposeNew = startLocalUiDocumentLease(newPage, async (tab, action) => {
            const response = await send(tab, action); renewals.push(response.status); return response;
        });
        await flush();
        assert.deepEqual(renewals, [204], 'the replacement document must acquire a lease');
        assert.equal(owner.active, 2, 'old and new leases overlap only until expiry');
        newPage.dispatchEvent(new Event('pagehide'));
        const closedAt = Date.now();
        while (!stopped && Date.now() - closedAt < 1600) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(stopped, true, 'closing the last UI must stop the runtime within expiry plus one sweep');
        assert.equal(owner.active, 0);
    } finally { disposeOld(); disposeNew(); }
});

test('explicit disposal releases the lease and removes page listeners', async () => {
    const page = new EventTarget(), actions: string[] = [];
    const dispose = startLocalUiDocumentLease(page, async (_tab, action) => { actions.push(action); return { status: 204 }; });
    await flush(); dispose();
    page.dispatchEvent(new Event('pageshow')); await flush();
    assert.deepEqual(actions, ['renew', 'release']);
});
