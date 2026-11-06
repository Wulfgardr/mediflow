import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
    buildLocalChatTargetKey,
    generateLocalChatCompletion,
    listInstalledLocalChatModels,
    resolveLocalChatBaseUrls,
} from './local-chat-runtime.ts';

async function withServer(
    handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
    run: (baseUrl: string) => Promise<void>,
) {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
        const address = server.address() as AddressInfo;
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
}

test('resolveLocalChatBaseUrls keeps Ollama root contract stable', () => {
    assert.equal(resolveLocalChatBaseUrls({
        baseUrl: 'http://127.0.0.1:11434/v1',
    }).ollama, 'http://127.0.0.1:11434');
});

test('buildLocalChatTargetKey distinguishes runtime and model id', () => {
    assert.equal(
        buildLocalChatTargetKey({ runtime: 'ollama_chat', model: 'qwen3.5:35b-a3b' }),
        'ollama_chat:qwen3.5:35b-a3b',
    );
});

test('listInstalledLocalChatModels reads Ollama model listing', async () => {
    await withServer((request, response) => {
        if (request.url === '/api/tags') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ models: [{ name: 'qwen3.5:35b-a3b' }] }));
            return;
        }


        response.writeHead(404).end();
    }, async (baseUrl) => {
        assert.deepEqual(await listInstalledLocalChatModels('ollama_chat', baseUrl), ['qwen3.5:35b-a3b']);
    });
});

test('generateLocalChatCompletion speaks the Ollama transport', async () => {
    await withServer((request, response) => {
        if (request.url === '/api/chat' && request.method === 'POST') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: { content: '{"ok":"ollama"}' } }));
            return;
        }


        response.writeHead(404).end();
    }, async (baseUrl) => {
        const baseUrls = resolveLocalChatBaseUrls({
            baseUrl,
        });
        const ollama = await generateLocalChatCompletion({
            model: 'qwen3.5:35b-a3b',
            runtime: 'ollama_chat',
        }, baseUrls, 'ciao', 32, 0);
        assert.equal(ollama.content, '{"ok":"ollama"}');
        assert.ok(ollama.latencyMs >= 0);


    });
});
