/* @Codex */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
    buildLocalChatTargetKey,
    generateLocalChatCompletion,
    listInstalledLocalChatModels,
    normalizeMlxBaseUrl,
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

test('resolveLocalChatBaseUrls keeps Ollama root and MLX root contract stable', () => {
    assert.equal(resolveLocalChatBaseUrls({
        baseUrl: 'http://127.0.0.1:11434/v1',
        mlxBaseUrl: 'http://127.0.0.1:8080/v1',
    }).ollama, 'http://127.0.0.1:11434');
    assert.equal(normalizeMlxBaseUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080');
});

test('buildLocalChatTargetKey distinguishes runtime and model id', () => {
    assert.equal(
        buildLocalChatTargetKey({ runtime: 'ollama_chat', model: 'qwen3.5:35b-a3b' }),
        'ollama_chat:qwen3.5:35b-a3b',
    );
    assert.equal(
        buildLocalChatTargetKey({ runtime: 'mlx_chat', model: 'Jackrong/model' }),
        'mlx_chat:Jackrong/model',
    );
});

test('listInstalledLocalChatModels reads Ollama and MLX model listings', async () => {
    await withServer((request, response) => {
        if (request.url === '/api/tags') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ models: [{ name: 'qwen3.5:35b-a3b' }] }));
            return;
        }

        if (request.url === '/v1/models') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'Jackrong/MLX-Qwen3.5-9B' }] }));
            return;
        }

        response.writeHead(404).end();
    }, async (baseUrl) => {
        assert.deepEqual(await listInstalledLocalChatModels('ollama_chat', baseUrl), ['qwen3.5:35b-a3b']);
        assert.deepEqual(await listInstalledLocalChatModels('mlx_chat', baseUrl), ['Jackrong/MLX-Qwen3.5-9B']);
    });
});

test('generateLocalChatCompletion speaks both Ollama and MLX transports', async () => {
    await withServer((request, response) => {
        if (request.url === '/api/chat' && request.method === 'POST') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ message: { content: '{"ok":"ollama"}' } }));
            return;
        }

        if (request.url === '/v1/chat/completions' && request.method === 'POST') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":"mlx"}' } }] }));
            return;
        }

        response.writeHead(404).end();
    }, async (baseUrl) => {
        const baseUrls = resolveLocalChatBaseUrls({
            baseUrl,
            mlxBaseUrl: baseUrl,
        });
        const ollama = await generateLocalChatCompletion({
            model: 'qwen3.5:35b-a3b',
            runtime: 'ollama_chat',
        }, baseUrls, 'ciao', 32, 0);
        assert.equal(ollama.content, '{"ok":"ollama"}');
        assert.ok(ollama.latencyMs >= 0);

        const mlx = await generateLocalChatCompletion({
            model: 'Jackrong/MLX-Qwen3.5-9B',
            runtime: 'mlx_chat',
        }, baseUrls, 'ciao', 32, 0);
        assert.equal(mlx.content, '{"ok":"mlx"}');
        assert.ok(mlx.latencyMs >= 0);
    });
});
