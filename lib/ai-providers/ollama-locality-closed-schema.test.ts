import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { ollamaLocalityErrorResponse } from './ollama-locality-response';
import { attestLocalOllamaModel, OllamaLocalityError, ollamaLocalityRule, SUPPORTED_OLLAMA_LOCALITY_VERSIONS } from './ollama-locality.ts';
import type { OllamaSchemaEndpoint } from './ollama-response-schema.ts';

type Json = Record<string, unknown>;
type Recorded = Readonly<Record<OllamaSchemaEndpoint, Json>>;
const MODEL = 'qwen3.5:35b-a3b';
const recorded = (version: string): Recorded => Object.freeze(Object.fromEntries((['tags', 'show', 'ps'] as const).map((endpoint) => [endpoint,
    JSON.parse(readFileSync(new URL(`./fixtures/ollama/${version}/${endpoint}.json`, import.meta.url), 'utf8')) as Json])) as Recorded);
const REAL = { '0.40.16': recorded('0.40.16'), '0.40.18': recorded('0.40.18') } as const;
const clone = (responses: Recorded): Record<OllamaSchemaEndpoint, Json> => structuredClone(responses) as Record<OllamaSchemaEndpoint, Json>;

function serve(t: TestContext, serverVersion: string, responses: Recorded) {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = String(input); calls.push(url);
        if (url.endsWith('/api/version')) return Response.json({ version: serverVersion });
        if (url.endsWith('/api/tags')) return Response.json(responses.tags);
        if (url.endsWith('/api/show')) return Response.json(responses.show);
        if (url.endsWith('/api/generate')) return Response.json({ model: MODEL, created_at: '2026-11-26T09:51:17.890189Z', response: '', done: true, done_reason: 'load' });
        if (url.endsWith('/api/ps')) return Response.json(responses.ps);
        throw new Error(`unexpected ${url}`);
    });
    return calls;
}

const deniedFor = (serverVersion: string, endpoint: OllamaSchemaEndpoint, field: string) => (error: unknown) => {
    assert.ok(error instanceof OllamaLocalityError);
    assert.equal(error.code, 'provider_field_unknown');
    assert.equal(error.versionMismatch, undefined);
    assert.deepEqual(error.unknownField, { serverVersion, endpoint, field });
    return true;
};

for (const [version, responses] of Object.entries(REAL)) test(`le risposte reali registrate di Ollama ${version} attestano il modello locale`, async (t) => {
    const calls = serve(t, version, responses);
    const attestation = await attestLocalOllamaModel('http://127.0.0.1:11434', MODEL);
    assert.equal(attestation.serverVersion, version);
    assert.equal(attestation.digest, '26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a');
    assert.equal(calls.length, 5);
    assert.equal(ollamaLocalityRule(version), 'closed_schema');
});

type Injection = Readonly<{ endpoint: OllamaSchemaEndpoint; field: string; inject(responses: Record<OllamaSchemaEndpoint, Json>): void }>;
const first = (value: unknown) => (value as Json[])[0];
const INJECTIONS: readonly Injection[] = [
    { endpoint: 'tags', field: '""', inject: (r) => { r.tags[''] = 'remote'; } },
    { endpoint: 'tags', field: 'models[].name:non_scalar', inject: (r) => { first(r.tags.models).name = { routing: 'remote' }; } },
    { endpoint: 'tags', field: 'routing', inject: (r) => { r.tags.routing = 'remote'; } },
    { endpoint: 'tags', field: 'models[].routing', inject: (r) => { first(r.tags.models).routing = 'remote'; } },
    { endpoint: 'tags', field: 'models[].details.routing', inject: (r) => { (first(r.tags.models).details as Json).routing = 'remote'; } },
    { endpoint: 'tags', field: 'models[].capabilities[]=cloud', inject: (r) => { (first(r.tags.models).capabilities as string[]).push('cloud'); } },
    { endpoint: 'tags', field: 'models[].details:non_object', inject: (r) => { first(r.tags.models).details = 'remote'; } },
    { endpoint: 'show', field: 'routing', inject: (r) => { r.show.routing = 'remote'; } },
    { endpoint: 'show', field: 'details.routing', inject: (r) => { (r.show.details as Json).routing = 'remote'; } },
    { endpoint: 'show', field: 'thinking.routing', inject: (r) => { (r.show.thinking as Json).routing = 'remote'; } },
    { endpoint: 'show', field: 'capabilities[]=cloud', inject: (r) => { (r.show.capabilities as string[]).push('cloud'); } },
    { endpoint: 'show', field: 'messages[].routing', inject: (r) => { r.show.messages = [{ role: 'system', content: 'synthetic', routing: 'remote' }]; } },
    { endpoint: 'show', field: 'thinking.values[]:non_scalar', inject: (r) => { (r.show.thinking as Json).values = [{ routing: 'remote' }]; } },
    { endpoint: 'show', field: 'capabilities[]:non_string', inject: (r) => { r.show.capabilities = [{ toString: 'remote' }]; } },
    { endpoint: 'show', field: 'messages[].tool_calls[].routing', inject: (r) => { r.show.messages = [{ tool_calls: [{ routing: 'remote' }] }]; } },
    { endpoint: 'show', field: 'messages[].tool_calls[].function.routing', inject: (r) => { r.show.messages = [{ tool_calls: [{ function: { routing: 'remote' } }] }]; } },
    { endpoint: 'show', field: 'tensors[].routing', inject: (r) => { r.show.tensors = [{ name: 'synthetic', type: 'F16', shape: [1], routing: 'remote' }]; } },
    { endpoint: 'show', field: 'manifests[].routing', inject: (r) => { r.show.manifests = [{ digest: 'sha256:synthetic', runner: 'mlx', routing: 'remote' }]; } },
    { endpoint: 'show', field: 'messages:non_array', inject: (r) => { r.show.messages = { role: 'system' }; } },
    { endpoint: 'ps', field: 'routing', inject: (r) => { r.ps.routing = 'remote'; } },
    { endpoint: 'ps', field: 'models[].routing', inject: (r) => { first(r.ps.models).routing = 'remote'; } },
    { endpoint: 'ps', field: 'models[].details.routing', inject: (r) => { (first(r.ps.models).details as Json).routing = 'remote'; } },
];

for (const [version, responses] of Object.entries(REAL)) for (const injection of INJECTIONS) test(`${version} nega il campo sconosciuto ${injection.field} in /api/${injection.endpoint}`, async (t) => {
    const altered = clone(responses); injection.inject(altered);
    const calls = serve(t, version, altered);
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', MODEL), deniedFor(version, injection.endpoint, injection.field));
    assert.equal(calls.length, { tags: 2, show: 3, ps: 5 }[injection.endpoint]);
    assert.equal(calls.some((url) => url.endsWith('/api/generate')), injection.endpoint === 'ps');
});

test('i metadati del modello e i testi del Modelfile restano aperti: non decidono l’instradamento', async (t) => {
    const altered = clone(REAL['0.40.18']);
    (altered.show.model_info as Json)['synthetic.remote_host'] = 'remote.invalid';
    altered.show.modelfile = `${String(altered.show.modelfile)}\n# remote_host remote.invalid`;
    serve(t, '0.40.18', altered);
    assert.equal((await attestLocalOllamaModel('http://127.0.0.1:11434', MODEL)).serverVersion, '0.40.18');
});

test('i marker remoti noti restano negati come modello non locale anche con lo schema chiuso', async (t) => {
    const altered = clone(REAL['0.40.18']); altered.show.remote_host = 'remote.invalid';
    serve(t, '0.40.18', altered);
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', MODEL),
        (error) => error instanceof OllamaLocalityError && error.code === 'model_not_local');
});

for (const version of ['0.40.17', '0.40.19', '0.40.25', '0.40.180', '0.40.16000']) test(`la patch futura ${version} con lo schema noto passa, con un campo nuovo no`, async (t) => {
    serve(t, version, REAL['0.40.18']);
    assert.equal((await attestLocalOllamaModel('http://127.0.0.1:11434', MODEL)).serverVersion, version);
    t.mock.restoreAll();
    const altered = clone(REAL['0.40.18']); altered.show.cloud_route = 'remote';
    serve(t, version, altered);
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', MODEL), deniedFor(version, 'show', 'cloud_route'));
});

for (const version of ['0.40.15', '0.40.7', '0.41.0', '0.40.18-rc0', '0.40.18+build', '0.40.016', '0.40.18\n', '1.40.18', '0.40.']) test(`la versione fuori intervallo ${version} resta negata prima delle risposte`, async (t) => {
    const calls = serve(t, version, REAL['0.40.18']);
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', MODEL), (error) => {
        assert.ok(error instanceof OllamaLocalityError);
        assert.equal(error.code, 'provider_version_unsupported');
        assert.deepEqual(error.versionMismatch, { serverVersion: version, supportedVersions: SUPPORTED_OLLAMA_LOCALITY_VERSIONS });
        assert.equal(error.unknownField, undefined);
        return true;
    });
    assert.equal(calls.length, 1);
});

for (const version of ['0.32.5', '0.33.3', '0.34.2', '0.40.4', '0.40.5', '0.40.6']) test(`la versione osservata ${version} resta ammessa come prima, senza schema chiuso`, async (t) => {
    const altered = clone(REAL['0.40.16']); altered.show.routing = 'synthetic';
    serve(t, version, altered);
    assert.equal(ollamaLocalityRule(version), 'observed_version');
    assert.equal((await attestLocalOllamaModel('http://127.0.0.1:11434', MODEL)).serverVersion, version);
});

test('la risposta condivisa distingue il campo sconosciuto dalla versione non ammessa', async () => {
    const unknownField = { serverVersion: '0.40.25', endpoint: 'show', field: 'cloud_route' } as const;
    const response = ollamaLocalityErrorResponse(new OllamaLocalityError('provider_field_unknown', undefined, unknownField))!;
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Ollama local-only policy blocked the request', code: 'provider_field_unknown', unknownField });
});

test('il nome del campo riportato è ripulito e limitato', async (t) => {
    const altered = clone(REAL['0.40.18']); altered.show[`<img src=x>${'a'.repeat(200)}`] = 1;
    serve(t, '0.40.18', altered);
    await assert.rejects(attestLocalOllamaModel('http://127.0.0.1:11434', MODEL), (error) => {
        assert.ok(error instanceof OllamaLocalityError && error.unknownField);
        assert.equal(error.unknownField.field, `?img?src?x?${'a'.repeat(37)}`);
        return true;
    });
});
