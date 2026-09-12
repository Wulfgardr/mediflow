/* @Codex — genuine owner 0.8.7; no public IDs used as capabilities. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
const { createProductSessionRegistry } = await import('./product-session.ts');
const { createProductService } = await import('./product-service.ts');
const { createProductionExecutionPlatform } = await import('../chatgpt-execution/execution-platform.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../security/web-auth-lifecycle-owner-test-fixture.ts');
const { ProductError } = await import('./product-contract.ts');
const expired = (error: unknown) => error instanceof ProductError && error.code === 'session_expired';
test('registry identity, retirement and response commit use the actual owner', async t => {
    const context = issueSyntheticWebSessionContext({ id: 'session-test', username: 'synthetic', role: 'doctor' }, 'session-registry');
    const session = context.session as WebSessionProjection;
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: createProductionExecutionPlatform() }));
    t.after(() => { registry.dispose(); retireSyntheticWebSession(context.session); });
    assert.throws(() => registry.acquire({ ...session }), expired);
    const handle = registry.acquire(session); assert.equal(handle.current(), true);
    assert.throws(() => registry.acquire({ ...session }), expired);
    assert.equal((await handle.respond('status', {}, value => Response.json(value))).status, 200);
    retireSyntheticWebSession(context.session); assert.equal(handle.current(), false); assert.equal(handle.signal.aborted, true);
    let rendered = 0; await assert.rejects(handle.respond('status', {}, () => { rendered++; return new Response(); }), expired);
    assert.equal(rendered, 0); assert.throws(() => registry.acquire(session), expired);
});
test('request abort inside publication suppresses returned response, without owner re-entry', async t => {
    const context = issueSyntheticWebSessionContext({ id: 'publication-test', username: 'synthetic', role: 'doctor' }, 'publication');
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: createProductionExecutionPlatform() }));
    t.after(() => { registry.dispose(); retireSyntheticWebSession(context.session); });
    const handle = registry.acquire(context.session as WebSessionProjection), abort = new AbortController(); let rendered = 0;
    await assert.rejects(handle.respond('status', {}, () => { rendered++; abort.abort(); return new Response('must-not-publish'); }, abort.signal), expired);
    assert.equal(rendered, 1);
});
test('bounded registry rejects a seventeenth live session; disposal releases capacity', async t => {
    const contexts = Array.from({ length: 17 }, (_, i) => issueSyntheticWebSessionContext({ id: `capacity-${i}`, username: 'synthetic', role: 'doctor' }, `capacity-${i}`));
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: createProductionExecutionPlatform() }));
    t.after(() => { registry.dispose(); for (const context of contexts) retireSyntheticWebSession(context.session); });
    for (const context of contexts.slice(0, 16)) registry.acquire(context.session as WebSessionProjection);
    assert.throws(() => registry.acquire(contexts[16].session as WebSessionProjection), error => error instanceof ProductError && error.code === 'busy');
    retireSyntheticWebSession(contexts[0].session);
    assert.equal(registry.acquire(contexts[16].session as WebSessionProjection).current(), true);
});

test('synchronous retirement before resource registration disposes once, without an uninitialized expiry timer', t => {
    const context = issueSyntheticWebSessionContext({ id: 'registration-retire', username: 'synthetic', role: 'doctor' }, 'registration-retire');
    let disposals = 0;
    const registry = createProductSessionRegistry((session, isCurrent) => {
        const service = createProductService({ session, isCurrent, platform: createProductionExecutionPlatform() });
        retireSyntheticWebSession(context.session);
        return { ...service, dispose() { disposals++; service.dispose(); } };
    }); t.after(() => { registry.dispose(); retireSyntheticWebSession(context.session); });
    assert.throws(() => registry.acquire(context.session as WebSessionProjection), expired);
    assert.equal(disposals, 1);
});
