import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalUiDocumentLease } from './local-ui-document-lease';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('back-forward restoration resumes the UI with a fresh lease, independent of the old goodbye', async () => {
    const page = new EventTarget(), calls: { tab: string; action: string }[] = [];
    const dispose = startLocalUiDocumentLease(page, async (tab, action) => { calls.push({ tab, action }); return { status: 204 }; });
    try {
        await flush(); page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow')); await flush();
        assert.deepEqual(calls.map(call => call.action), ['renew', 'release', 'renew']);
        assert.equal(calls[0].tab, calls[1].tab); assert.notEqual(calls[1].tab, calls[2].tab);
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
        assert.deepEqual(calls.map(call => call.action), ['renew', 'release', 'renew']);
        assert.notEqual(calls[0].tab, calls[2].tab);
    } finally { dispose(); }
});
