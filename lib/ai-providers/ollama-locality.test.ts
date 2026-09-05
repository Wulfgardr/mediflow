import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertLocalOllamaModelReference,
    assertLocalOllamaResponse,
    attestLocalOllamaModel,
    isLocalOllamaModelDescriptor,
    OllamaLocalityError,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality.ts';

/* @Codex */
const LOCAL_MODEL = {
    name: 'qwen-local:latest',
    model: 'qwen-local:latest',
    size: 1024,
    digest: 'sha256:synthetic',
    details: { format: 'gguf' },
};

test('accetta solo endpoint loopback e riferimenti modello non cloud', () => {
    assert.equal(
        strictOllamaLoopbackBaseUrl('http://localhost:11434/v1/'),
        'http://127.0.0.1:11434',
    );
    assert.doesNotThrow(() => assertLocalOllamaModelReference('team/qwen-local:latest'));
    assert.throws(
        () => strictOllamaLoopbackBaseUrl('http://host.docker.internal:11434'),
        (error) => error instanceof OllamaLocalityError && error.code === 'endpoint_not_loopback',
    );
    assert.throws(
        () => assertLocalOllamaModelReference('qwen:cloud'),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_cloud_reference',
    );
});

test('limita il riferimento modello locale a 674 byte UTF-8 dopo trim senza ripararlo', () => {
    const ascii = 'a'.repeat(674); const multibyte = `${'€'.repeat(224)}aa`;
    assert.doesNotThrow(() => assertLocalOllamaModelReference(`  ${ascii}  `));
    assert.doesNotThrow(() => assertLocalOllamaModelReference(multibyte));
    for (const value of ['a'.repeat(675), `${multibyte}a`]) assert.throws(
        () => assertLocalOllamaModelReference(value),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_not_local',
    );
    assert.throws(() => assertLocalOllamaModelReference('qwen:cloud'),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_cloud_reference');
    for (const value of [`${'a'.repeat(670)}:cloud`, `${'a'.repeat(670)}-cloud`, ['https:', '//', 'a'.repeat(670)].join(''), `ollama.com/${'a'.repeat(670)}`]) assert.throws(
        () => assertLocalOllamaModelReference(value),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_cloud_reference',
    );
});

test('attesta il modello locale senza inviare un prompt', async (t) => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/api/version')) return Response.json({ version: '0.32.5' });
        if (url.endsWith('/api/tags')) return Response.json({ models: [LOCAL_MODEL] });
        if (url.endsWith('/api/show')) return Response.json({ details: LOCAL_MODEL.details });
        if (url.endsWith('/api/generate')) return Response.json({ model: LOCAL_MODEL.model });
        if (url.endsWith('/api/ps')) return Response.json({ models: [LOCAL_MODEL] });
        return new Response(null, { status: 404 });
    }) as typeof fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const attestation = await attestLocalOllamaModel(
        'http://localhost:11434/v1',
        'qwen-local',
    );

    assert.equal(attestation.executionMode, 'local');
    assert.equal(attestation.canonicalModel, LOCAL_MODEL.name);
    assert.equal(calls.length, 5);
    assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { model: LOCAL_MODEL.model });
    assert.equal(calls.some(({ init }) => String(init?.body).includes('messages')), false);
    assert.equal(calls.some(({ init }) => String(init?.body).includes('fixture')), false);
    assert.equal(calls.every(({ url }) => url.startsWith('http://127.0.0.1:11434/')), true);
    assert.equal(calls.every(({ init }) => init?.redirect === 'error'), true);
});

test('rifiuta un modello remoto prima della chiamata show', async (t) => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith('/api/version')) return Response.json({ version: '0.32.5' });
        if (url.endsWith('/api/tags')) {
            return Response.json({
                models: [{ ...LOCAL_MODEL, remote_host: 'remote.invalid' }],
            });
        }
        throw new Error('unreachable');
    }) as typeof fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    await assert.rejects(
        () => attestLocalOllamaModel('http://127.0.0.1:11434', 'qwen-local'),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_not_local',
    );
    assert.equal(urls.some((url) => url.endsWith('/api/show')), false);
});

test('richiede una versione Ollama qualificata per il contratto locality', async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ version: '0.33.0' })) as typeof fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    await assert.rejects(
        () => attestLocalOllamaModel('http://127.0.0.1:11434', 'qwen-local'),
        (error) => error instanceof OllamaLocalityError && error.code === 'provider_unready',
    );
});

test('filtra descrittori remoti e rifiuta risposte non attestate', () => {
    assert.equal(isLocalOllamaModelDescriptor(LOCAL_MODEL), true);
    assert.equal(isLocalOllamaModelDescriptor({ ...LOCAL_MODEL, remote_model: 'remote' }), false);
    assert.equal(isLocalOllamaModelDescriptor({ ...LOCAL_MODEL, remote_host: {} }), false);
    assert.throws(
        () => assertLocalOllamaResponse(
            { model: 'qwen-local:latest', remote_host: 'remote.invalid' },
            {
                authorityPlane: 'clinical_application',
                provider: 'ollama',
                executionMode: 'local',
                endpointClass: 'loopback',
                requestedModel: 'qwen-local',
                canonicalModel: 'qwen-local:latest',
                digest: 'sha256:synthetic',
                serverVersion: '0.32.5',
                checkedAt: '2026-07-28T00:00:00.000Z',
            },
        ),
        (error) => error instanceof OllamaLocalityError && error.code === 'response_not_local',
    );
});
