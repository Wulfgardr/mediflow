/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    SmartImportContextProposalBrowserAdapterError,
    createSmartImportContextProposalBrowserAdapter,
} from './smart-import-context-proposal-browser-adapter.ts';

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function directJson(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as Response;
}
function rejects(code: string) {
    return (error: unknown) => error instanceof SmartImportContextProposalBrowserAdapterError && error.code === code;
}

test('reads one exact frozen ambulatory proposal without granting authority', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const adapter = createSmartImportContextProposalBrowserAdapter({ fetch: async (url, init) => {
        calls.push([url, init]); return response({ ambulatoryId: 'ambulatory.synthetic.01' });
    } });

    const proposal = await adapter.read();
    assert.deepEqual(proposal, { ambulatoryId: 'ambulatory.synthetic.01' });
    assert.equal(Object.isFrozen(proposal), true);
    assert.deepEqual(calls, [['/api/context', { method: 'GET', cache: 'no-store' }]]);
});

test('classifies missing, session, received, and fetch context failures without retry', async () => {
    const cases: readonly [Response | null, string][] = [
        [response({ ambulatoryId: null }), 'context_missing'],
        [response({}, 401), 'session_unavailable'],
        [response({}, 500), 'context_unavailable'],
        [null, 'context_unavailable'],
    ];
    for (const [value, code] of cases) {
        let calls = 0;
        const adapter = createSmartImportContextProposalBrowserAdapter({ fetch: async () => {
            calls += 1;
            if (value === null) throw new Error('synthetic fetch fault');
            return value;
        } });
        await assert.rejects(() => adapter.read(), rejects(code));
        assert.equal(calls, 1);
    }
});

test('rejects hostile response bodies and invalid ambulatory identifiers fail closed', async () => {
    let getterReads = 0; const accessor = {} as { ambulatoryId?: string };
    Object.defineProperty(accessor, 'ambulatoryId', { enumerable: true, get() { getterReads += 1; return 'ambulatory.synthetic.01'; } });
    const inherited = Object.create({ ambulatoryId: 'ambulatory.synthetic.01' });
    const symbol = { ambulatoryId: 'ambulatory.synthetic.01', [Symbol('synthetic')]: true };
    const proxy = new Proxy({ ambulatoryId: 'ambulatory.synthetic.01' }, { getPrototypeOf() { throw new Error('proxy rejected'); } });
    const values: unknown[] = [
        { ambulatoryId: 'ambulatory.synthetic.01', extra: true }, [], inherited, accessor, symbol, proxy,
        { ambulatoryId: '' }, { ambulatoryId: ' ambulatory.synthetic.01' }, { ambulatoryId: 'ambulatory\u0000synthetic' },
        { ambulatoryId: 'a'.repeat(161) }, { ambulatoryId: 'bad/id' },
    ];
    for (const value of values) {
        const adapter = createSmartImportContextProposalBrowserAdapter({ fetch: async () => directJson(value) });
        await assert.rejects(() => adapter.read(), rejects('response_invalid'));
    }
    assert.equal(getterReads, 0);
    const malformed = createSmartImportContextProposalBrowserAdapter({ fetch: async () => ({ ok: true, status: 200,
        json: async () => { throw new Error('synthetic malformed JSON'); } }) as unknown as Response });
    await assert.rejects(() => malformed.read(), rejects('response_invalid'));
});

test('remains a browser-only proposal boundary without cookie, storage, or Smart Import authority imports', () => {
    const source = readFileSync(new URL('./smart-import-context-proposal-browser-adapter.ts', import.meta.url), 'utf8');
    assert.match(source, /^\/\* @Codex \*\/\n'use client';/u);
    assert.doesNotMatch(source, /server-only|node:|document\.cookie|cookies\(|localStorage|sessionStorage|selection|epoch|normalizer|orchestrator|(?:ingest|preview|apply)|db-server|globalThis\.(?:document|localStorage|sessionStorage)/u);
    assert.match(source, /proposal only/u);
});
