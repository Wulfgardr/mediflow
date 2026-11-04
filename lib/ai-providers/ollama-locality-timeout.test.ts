import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { attestLocalOllamaModel } from './ollama-locality';

for (const stalled of ['version', 'tags', 'show', 'ps']) {
    test(`attestation bounds stalled ${stalled} metadata independently of generation`, async () => {
        const model = { name: 'synthetic:latest', model: 'synthetic:latest', size: 1024, digest: 'synthetic' };
        const calls: string[] = [];
        const server = createServer((req, res) => {
            const route = req.url!.split('/').at(-1)!;
            calls.push(route);
            if (route === stalled) return;
            const data = route === 'version' ? { version: '0.40.6' }
                : route === 'show' ? { details: { format: 'gguf' } }
                    : route === 'generate' ? { model: model.model } : { models: [model] };
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(data));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const started = performance.now();
        try {
            const address = server.address() as { port: number };
            await assert.rejects(attestLocalOllamaModel(`http://127.0.0.1:${address.port}`, 'synthetic', AbortSignal.timeout(7500)));
            assert.ok(performance.now() - started < 6500, 'metadata must fail within 6.5 s even with a longer generation deadline');
            assert.equal(calls.includes('chat'), false);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
}

test('model preload can exceed the metadata budget and caller cancellation still wins', async () => {
    const model = { model: 'synthetic:latest', size: 1024, digest: 'synthetic' };
    const server = createServer((req, res) => {
        const route = req.url!.split('/').at(-1);
        const data = route === 'version' ? { version: '0.40.6' }
            : route === 'show' ? { details: {} } : route === 'generate' ? model : { models: [model] };
        const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
        if (route === 'generate') setTimeout(send, 5500); else send();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    try {
        const result = await attestLocalOllamaModel(url, 'synthetic', AbortSignal.timeout(10000));
        assert.equal(result.canonicalModel, model.model);
        const controller = new AbortController();
        controller.abort(new Error('caller cancelled'));
        await assert.rejects(attestLocalOllamaModel(url, 'synthetic', controller.signal), /caller cancelled/);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
