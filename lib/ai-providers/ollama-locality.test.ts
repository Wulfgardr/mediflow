import assert from 'node:assert/strict';
import test from 'node:test';
import { ollamaLocalityErrorResponse } from './ollama-locality-response';
import {
    assertLocalOllamaModelReference,
    assertLocalOllamaResponse,
    attestLocalOllamaModel,
    isLocalOllamaModelDescriptor,
    OllamaLocalityError,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality.ts';

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

for (const serverVersion of ['0.32.5', '0.33.3', '0.34.2', '0.40.4', '0.40.5', '0.40.6']) test(`attesta ${serverVersion} senza inviare un prompt`, async (t) => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/api/version')) return Response.json({ version: serverVersion });
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

    assert.equal(attestation.serverVersion, serverVersion);
    assert.equal(attestation.executionMode, 'local');
    assert.doesNotThrow(() => assertLocalOllamaResponse({ model: LOCAL_MODEL.model, message: { content: 'synthetic' } }, attestation));
    assert.throws(() => assertLocalOllamaResponse({ model: LOCAL_MODEL.model, remote_model: 'remote' }, attestation), /response_not_local/);
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

for (const unqualified of ['0.33.0', '0.33.4', '0.34.0', '0.34.1', '0.34.3', '0.33.3-preview', '0.34.2-preview', '0.40.3', '0.40.7', '0.40.60', '0.40.6-rc0', '0.40.6+build', '0.40.50', '0.40.5-rc0', '0.40.5+build', '0.40.4-preview', '0.40.4+build', '0.41.0', 'unknown']) test(`nega versione non qualificata ${unqualified}`, async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ version: unqualified })) as typeof fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    await assert.rejects(
        () => attestLocalOllamaModel('http://127.0.0.1:11434', 'qwen-local'),
        (error) => {
            assert.ok(error instanceof OllamaLocalityError);
            assert.equal(error.code, 'provider_version_unsupported');
            assert.deepEqual(error.versionMismatch, { serverVersion: unqualified, supportedVersions: '0.32.x, 0.33.3, 0.34.2, 0.40.4, 0.40.5, 0.40.6' });
            return true;
        },
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

for (const body of [{}, { version: null }, null, []]) test('risposta versione incompleta indica servizio non pronto', async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', 'qwen-local'),
        error => error instanceof OllamaLocalityError && error.code === 'provider_unready');
});

test('la risposta condivisa conserva HTTP 409 e dettagli solo per la versione non ammessa', async () => {
    const versionMismatch = { serverVersion: '0.41.0', supportedVersions: '0.32.x, 0.33.3, 0.34.2, 0.40.4, 0.40.5, 0.40.6' };
    const response = ollamaLocalityErrorResponse(new OllamaLocalityError('provider_version_unsupported', versionMismatch))!;
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Ollama local-only policy blocked the request',
        code: 'provider_version_unsupported', versionMismatch });
    assert.equal(ollamaLocalityErrorResponse(new OllamaLocalityError('provider_unready'))!.status, 503);
    assert.equal(ollamaLocalityErrorResponse(new OllamaLocalityError('model_not_local'))!.status, 400);
    assert.equal(ollamaLocalityErrorResponse(new Error('private detail')), null);
});

for (const serverVersion of ['0.40.5', '0.40.6']) for (const stage of ['tags', 'show', 'preload', 'running', 'digest'] as const) test(`${serverVersion} nega la localita non attestata in ${stage}`, async t => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = String(input); calls.push(url);
        if (url.endsWith('/api/version')) return Response.json({ version: serverVersion });
        if (url.endsWith('/api/tags')) return Response.json({ models: [{ ...LOCAL_MODEL, ...(stage === 'tags' ? { remote_host: 'remote.invalid' } : {}) }] });
        if (url.endsWith('/api/show')) return Response.json({ details: LOCAL_MODEL.details, ...(stage === 'show' ? { remote_model: 'remote' } : {}) });
        if (url.endsWith('/api/generate')) return Response.json({ model: LOCAL_MODEL.model, ...(stage === 'preload' ? { remote_host: 'remote.invalid' } : {}) });
        if (url.endsWith('/api/ps')) return Response.json({ models: [{ ...LOCAL_MODEL, ...(stage === 'running' ? { remote_model: 'remote' } : {}), ...(stage === 'digest' ? { digest: 'sha256:changed' } : {}) }] });
        throw new Error('Unexpected local attestation call');
    });
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', 'qwen-local'),
        error => error instanceof OllamaLocalityError && error.code === 'model_not_local');
    assert.equal(calls.length, stage === 'tags' ? 2 : stage === 'show' ? 3 : stage === 'preload' ? 4 : 5);
});
