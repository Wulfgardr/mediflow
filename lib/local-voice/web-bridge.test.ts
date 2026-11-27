import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { localVoiceClient } from './client.mjs';
import { startFakeLocalVoice } from './fake-service.test-support.ts';
import { createLocalVoiceBridge } from './web-bridge.ts';

const firstInput = { mode: 'visit', subject: 'paziente:synthetic-first' } as const;
const secondInput = { mode: 'visit', subject: 'paziente:synthetic-second' } as const;

test('a competing start cannot discard a session whose create response is still pending', async (t) => {
    const secret = randomBytes(32).toString('hex');
    const service = await startFakeLocalVoice({ secret });
    t.after(service.close);
    const endpoint = { url: service.url, secret };
    const client = localVoiceClient(endpoint);
    const firstCreated = Promise.withResolvers<void>();
    const deliverFirst = Promise.withResolvers<void>();
    let creates = 0;
    const bridge = createLocalVoiceBridge({
        endpoint: () => endpoint,
        client: () => ({
            ...client,
            async create(input) {
                const isFirst = ++creates === 1;
                const session = await client.create(input);
                if (isFirst) {
                    firstCreated.resolve();
                    await deliverFirst.promise;
                }
                return session;
            },
        }),
    });

    const first = bridge.create('first', firstInput);
    await Promise.race([firstCreated.promise, first.then(reply => assert.fail(JSON.stringify(reply)))]);
    const originalId = service.state.session?.id;
    assert.ok(originalId);
    const second = bridge.create('second', secondInput);
    await setImmediate();
    if (creates > 1) await second;
    deliverFirst.resolve();

    assert.equal((await first).status, 200);
    assert.deepEqual(await second, { status: 409, body: { error: 'session-active' } });
    assert.equal(service.state.session?.id, originalId);
    assert.equal((await bridge.snapshot('first', originalId, firstInput.subject)).status, 200);
    assert.equal((await bridge.snapshot('second', originalId, firstInput.subject)).status, 404);
    assert.equal(service.state.requests.some(request => request.method === 'DELETE'), false);
});

test('a new Web bridge replaces a service session left by the previous bridge', async (t) => {
    const secret = randomBytes(32).toString('hex');
    const service = await startFakeLocalVoice({ secret });
    t.after(service.close);
    const endpoint = () => ({ url: service.url, secret });
    const oldBridge = createLocalVoiceBridge({ endpoint });
    assert.equal((await oldBridge.create('first', firstInput)).status, 200);
    const oldId = service.state.session?.id;
    assert.ok(oldId);

    const newBridge = createLocalVoiceBridge({ endpoint });
    assert.equal((await newBridge.create('second', secondInput)).status, 200);
    assert.notEqual(service.state.session?.id, oldId);
    assert.equal(service.state.session?.subject, secondInput.subject);
    assert.equal((await newBridge.snapshot('first', oldId, firstInput.subject)).status, 404);
    assert.deepEqual(service.state.requests.filter(request => request.method === 'DELETE').map(request => request.path), [`/v1/sessions/${oldId}`]);
});
