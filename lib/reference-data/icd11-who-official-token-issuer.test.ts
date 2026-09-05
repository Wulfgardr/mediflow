/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL,
    ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES,
    ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES,
    Icd11WhoOfficialTokenIssuerError,
    createIcd11WhoOfficialTokenIssuer,
    type Icd11WhoOfficialHttpsClientRequest,
} from './icd11-who-official-token-issuer.ts';
import {
    ICD11_WHO_TOKEN_TARGET,
    createIcd11WhoCredentialLeaseManager,
} from './icd11-who-credential-lease.ts';

const CLIENT_ID = 'synthetic-client-id-085';
const CLIENT_SECRET = 'SYNTHETIC_WHO_SECRET_085_0123456789';
const ACCESS_TOKEN = 'SYNTHETIC_WHO_TOKEN_085_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TOKEN_BODY = JSON.stringify({
    access_token: ACCESS_TOKEN, expires_in: 3_600, token_type: 'Bearer', scope: 'icdapi_access',
});

function issueRequest(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        target: ICD11_WHO_TOKEN_TARGET,
        generation: 7,
        presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
            sink.set(CLIENT_ID, CLIENT_SECRET);
        },
        signal: new AbortController().signal,
        ...overrides,
    });
}

function okEnvelope(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        status: 200, finalUrl: ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL, redirected: false, body: TOKEN_BODY, ...overrides,
    });
}

test('emette la request OAuth WHO host-owned e ritira le facciate secret dopo il settle', async () => {
    let captured: Icd11WhoOfficialHttpsClientRequest | null = null;
    const issuer = createIcd11WhoOfficialTokenIssuer({ client: async (request: Icd11WhoOfficialHttpsClientRequest) => {
        captured = request;
        assert.equal(request.target, ICD11_WHO_TOKEN_TARGET);
        assert.equal(request.protocol, 'https:');
        assert.equal(request.hostname, 'icdaccessmanagement.who.int');
        assert.equal(request.path, '/connect/token');
        assert.equal(request.method, 'POST');
        assert.equal(request.redirect, 'error');
        assert.deepEqual(Reflect.ownKeys(request), [
            'target', 'protocol', 'hostname', 'path', 'method', 'redirect', 'headers', 'form', 'signal',
            'maxRequestBytes', 'maxResponseBytes',
        ]);
        assert.equal(Object.hasOwn(request, 'url'), false);
        assert.equal(Object.hasOwn(request, 'proxy'), false);
        assert.equal(Object.hasOwn(request, 'retry'), false);
        assert.equal(request.maxRequestBytes, ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES);
        assert.equal(request.maxResponseBytes, ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES);
        assert.equal(request.headers.get('content-type'), 'application/x-www-form-urlencoded');
        assert.equal(request.headers.get('accept'), 'application/json');
        const authorization = request.headers.get('authorization');
        assert.equal(authorization?.startsWith('Basic '), true);
        assert.equal(Buffer.from(authorization!.slice(6), 'base64').toString('utf8'), `${CLIENT_ID}:${CLIENT_SECRET}`);
        assert.equal(request.form.get('grant_type'), 'client_credentials');
        assert.equal(request.form.get('scope'), 'icdapi_access');
        const serialized = JSON.stringify(request);
        assert.equal(serialized.includes(CLIENT_ID), false);
        assert.equal(serialized.includes(CLIENT_SECRET), false);
        return okEnvelope();
    } });

    const result = await issuer(issueRequest());
    assert.deepEqual(result, {
        schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
        tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000,
    });
    const settledRequest = captured as unknown as Icd11WhoOfficialHttpsClientRequest;
    assert.equal(settledRequest.headers.get('authorization'), null);
    assert.equal(settledRequest.form.get('scope'), null);
});

test('si compone con il credential manager e consegna soltanto una lease bearer opaca', async () => {
    const issuer = createIcd11WhoOfficialTokenIssuer({
        client: async () => okEnvelope(),
    });
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: issuer,
    });
    manager.configure({
        schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1', generation: 7, enabled: true,
        secretRef: { scheme: 'host_secret', name: 'mediflow.who.icd-api.oauth-client.v1' },
    });
    const lease = await manager.acquire();
    const headers: Record<string, string> = {};
    const outcome = await manager.consume(lease, (inject) => {
        inject({ set(name, value) { headers[name] = value; } });
        return 'synthetic-ready';
    });
    assert.equal(outcome, 'synthetic-ready');
    assert.equal(headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.deepEqual(Reflect.ownKeys(lease), []);
    assert.equal(JSON.stringify({ manager, lease }).includes(ACCESS_TOKEN), false);
});

test('nega input extra, accessor e Proxy prima di presenter e client', async () => {
    let presenterCalls = 0; let clientCalls = 0; let getterReads = 0; let proxyTraps = 0;
    const issuer = createIcd11WhoOfficialTokenIssuer({ client: async () => {
        clientCalls += 1; return okEnvelope();
    } });
    const base = issueRequest({
        presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
            presenterCalls += 1; sink.set(CLIENT_ID, CLIENT_SECRET);
        },
    });
    await assert.rejects(issuer({ ...base, url: ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL } as never),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'input_invalid');
    const accessor = Object.defineProperties({}, {
        target: { enumerable: true, value: ICD11_WHO_TOKEN_TARGET }, generation: { enumerable: true, value: 7 },
        presentCredentials: { enumerable: true, get() { getterReads += 1; return base.presentCredentials; } },
        signal: { enumerable: true, value: base.signal },
    });
    await assert.rejects(issuer(accessor as never),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'input_invalid');
    const proxy = new Proxy(base, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    await assert.rejects(issuer(proxy),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'input_invalid');
    assert.deepEqual([presenterCalls, clientCalls, getterReads, proxyTraps], [0, 0, 0, 0]);
});

test('nega factory ostile e callback non native senza invocare trap', async () => {
    let getterReads = 0; let proxyTraps = 0;
    const accessor = Object.defineProperty({}, 'client', {
        enumerable: true, get() { getterReads += 1; return async () => okEnvelope(); },
    });
    assert.throws(() => createIcd11WhoOfficialTokenIssuer(accessor as never),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'input_invalid');
    const client = async () => okEnvelope();
    const proxy = new Proxy({ client }, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    assert.throws(() => createIcd11WhoOfficialTokenIssuer(proxy as never),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'input_invalid');
    assert.deepEqual([getterReads, proxyTraps], [0, 0]);
});

test('presenta le credenziali una volta e nega setter multiplo o presenter incompleto', async () => {
    let clientCalls = 0;
    const issuer = createIcd11WhoOfficialTokenIssuer({ client: async () => {
        clientCalls += 1; return okEnvelope();
    } });
    await assert.rejects(issuer(issueRequest({ presentCredentials(sink: { set(id: string, secret: string): unknown }) {
        sink.set(CLIENT_ID, CLIENT_SECRET); sink.set(CLIENT_ID, CLIENT_SECRET);
    } })), (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'credential_invalid');
    await assert.rejects(issuer(issueRequest({ presentCredentials() { /* no credential write */ } })),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'credential_invalid');
    assert.equal(clientCalls, 0);
});

test('nega redirect, final URL diversa e status 3xx', async () => {
    const execute = (envelope: unknown) => createIcd11WhoOfficialTokenIssuer({ client: async () => envelope })(issueRequest());
    for (const envelope of [
        okEnvelope({ redirected: true }),
        okEnvelope({ finalUrl: 'https://id.who.int/connect/token' }),
        okEnvelope({ finalUrl: 'http://icdaccessmanagement.who.int/connect/token' }),
        okEnvelope({ status: 302 }),
    ]) await assert.rejects(execute(envelope),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'redirect_rejected');
});

test('mappa status e failure senza propagare secret, token o body vendor', async () => {
    const run = async (client: () => Promise<unknown>) => {
        try {
            await createIcd11WhoOfficialTokenIssuer({ client })(issueRequest());
            assert.fail('expected sanitized failure');
        } catch (error) {
            assert.equal(error instanceof Icd11WhoOfficialTokenIssuerError, true);
            const serialized = `${String(error)} ${JSON.stringify(error)}`;
            for (const sentinel of [CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN, 'SYNTHETIC_VENDOR_BODY']) {
                assert.equal(serialized.includes(sentinel), false);
            }
            return (error as Icd11WhoOfficialTokenIssuerError).code;
        }
    };
    for (const [status, code] of [[401, 'auth_rejected'], [403, 'auth_rejected'], [408, 'request_timeout'],
        [429, 'rate_limited'], [503, 'upstream_unavailable'], [201, 'response_invalid'],
        [400, 'response_invalid']] as const) {
        assert.equal(await run(async () => okEnvelope({ status, body: `SYNTHETIC_VENDOR_BODY_${ACCESS_TOKEN}` })), code);
    }
    assert.equal(await run(async () => { throw new Error(`${CLIENT_SECRET} SYNTHETIC_VENDOR_BODY`); }), 'upstream_unavailable');
});

test('nega body oversized o token response non stretta', async () => {
    const execute = (body: string) => createIcd11WhoOfficialTokenIssuer({
        client: async () => okEnvelope({ body }),
    })(issueRequest());
    await assert.rejects(execute('x'.repeat(ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES + 1)),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'response_too_large');
    for (const body of [
        'not-json',
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3_600, token_type: 'Bearer' }),
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3_600, token_type: 'Bearer', scope: 'wrong' }),
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3_600, token_type: 'bearer', scope: 'icdapi_access' }),
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 0, token_type: 'Bearer', scope: 'icdapi_access' }),
        JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3_600, token_type: 'Bearer', scope: 'icdapi_access', admin: true }),
    ]) await assert.rejects(execute(body),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'response_invalid');
});

test('nega envelope accessor o extra senza eseguire getter', async () => {
    let getterReads = 0;
    const accessor = Object.defineProperties({}, {
        status: { enumerable: true, value: 200 }, finalUrl: { enumerable: true, value: ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL },
        redirected: { enumerable: true, value: false },
        body: { enumerable: true, get() { getterReads += 1; return TOKEN_BODY; } },
    });
    const execute = (value: unknown) => createIcd11WhoOfficialTokenIssuer({ client: async () => value })(issueRequest());
    await assert.rejects(execute(accessor),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'response_invalid');
    await assert.rejects(execute({ ...okEnvelope(), headers: { server: 'hostile' } }),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'response_invalid');
    assert.equal(getterReads, 0);
});

test('nega thenable, Promise subclass e throw sincrono del client', async () => {
    let thenCalls = 0;
    const thenable = Object.freeze({ then(resolve: (value: unknown) => void) {
        thenCalls += 1; resolve(okEnvelope());
    } });
    await assert.rejects(createIcd11WhoOfficialTokenIssuer({ client: (() => thenable) as never })(issueRequest()),
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'response_invalid');
    assert.equal(thenCalls, 0);
    class PromiseSubclass<T> extends Promise<T> {}
    await assert.rejects(createIcd11WhoOfficialTokenIssuer({
        client: (() => PromiseSubclass.resolve(okEnvelope())) as never,
    })(issueRequest()), (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError
        && error.code === 'response_invalid');
    await assert.rejects(createIcd11WhoOfficialTokenIssuer({ client: (() => { throw new Error(CLIENT_SECRET); }) as never })(
        issueRequest()), (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError
        && error.code === 'upstream_unavailable');
});

test('cancella Promise pendente, ignora late completion e ritira le facciate', async () => {
    const controller = new AbortController();
    let captured: Icd11WhoOfficialHttpsClientRequest | null = null;
    let resolveClient!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolveClient = resolve; });
    const operation = createIcd11WhoOfficialTokenIssuer({ client: (request: Icd11WhoOfficialHttpsClientRequest) => {
        captured = request; return pending;
    } })(issueRequest({ signal: controller.signal }));
    controller.abort();
    await assert.rejects(operation,
        (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'request_cancelled');
    const cancelledRequest = captured as unknown as Icd11WhoOfficialHttpsClientRequest;
    assert.equal(cancelledRequest.headers.get('authorization'), null);
    assert.equal(cancelledRequest.form.get('grant_type'), null);
    resolveClient(okEnvelope());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelledRequest.headers.get('authorization'), null);
});

test('nega signal gia cancellato prima di presentare secret o chiamare il client', async () => {
    const controller = new AbortController(); controller.abort();
    let presenterCalls = 0; let clientCalls = 0;
    await assert.rejects(createIcd11WhoOfficialTokenIssuer({ client: async () => {
        clientCalls += 1; return okEnvelope();
    } })(issueRequest({ signal: controller.signal, presentCredentials() { presenterCalls += 1; } })),
    (error: unknown) => error instanceof Icd11WhoOfficialTokenIssuerError && error.code === 'request_cancelled');
    assert.deepEqual([presenterCalls, clientCalls], [0, 0]);
});
