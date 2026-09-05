/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ICD11_WHO_BINDING,
    ICD11_WHO_TRANSPORT_TARGET,
    Icd11WhoServiceError,
    createIcd11WhoReferenceDataService,
    type Icd11WhoTransportRequest,
} from './icd11-who-service.ts';
import {
    createIcd11WhoCredentialLeaseManager,
} from './icd11-who-credential-lease.ts';
import {
    ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX,
    Icd11WhoOfficialSearchTransportError,
    createIcd11WhoOfficialSearchTransport,
} from './icd11-who-official-search-transport.ts';
import type {
    Icd11WhoOfficialHttpsClientRequest,
} from './icd11-who-official-https-client.ts';

const ACCESS_TOKEN = 'SYNTHETIC_WHO_SEARCH_TOKEN_085_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FINAL_URL = `${ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX}hypertension`
    + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false';

function createCredentials() {
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
                sink.set('synthetic-client-id-085', 'SYNTHETIC_WHO_SECRET_085_0123456789');
            },
        }),
        issueToken: async (request: { presentCredentials(
            sink: { set(clientId: string, clientSecret: string): unknown },
        ): unknown }) => {
            request.presentCredentials({ set() { return undefined; } });
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000,
            });
        },
    });
    manager.configure({
        schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
        generation: 7, enabled: true,
        secretRef: { scheme: 'host_secret', name: 'mediflow.who.icd-api.oauth-client.v1' },
    });
    return manager;
}

function transportRequest(overrides: Record<string, unknown> = {}): Icd11WhoTransportRequest {
    return Object.freeze({
        target: ICD11_WHO_TRANSPORT_TARGET,
        releaseId: ICD11_WHO_BINDING.releaseId,
        linearization: ICD11_WHO_BINDING.linearization,
        language: ICD11_WHO_BINDING.language,
        query: 'hypertension',
        limit: ICD11_WHO_BINDING.resultLimit,
        maxResponseBytes: ICD11_WHO_BINDING.maxResponseBytes,
        signal: new AbortController().signal,
        ...overrides,
    }) as Icd11WhoTransportRequest;
}

function bodyWith(entries: unknown[] = [{ theCode: 'BA00', title: 'Essential hypertension' }],
    overrides: Record<string, unknown> = {}) {
    return JSON.stringify({ destinationEntities: entries, error: false, errorMessage: null,
        resultChopped: false, ...overrides });
}

function envelope(body = bodyWith(), overrides: Record<string, unknown> = {}) {
    return Object.freeze({ status: 200, finalUrl: FINAL_URL, redirected: false, body, ...overrides });
}

function transportWith(client: (request: Icd11WhoOfficialHttpsClientRequest) => Promise<unknown>,
    credentials: unknown = createCredentials()) {
    return createIcd11WhoOfficialSearchTransport({ credentials, client });
}

async function rejectsCode(operation: Promise<unknown>, code: string): Promise<unknown> {
    let captured: unknown;
    await assert.rejects(operation, (error: unknown) => {
        captured = error;
        return error instanceof Icd11WhoOfficialSearchTransportError && error.code === code;
    });
    return captured;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise; reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('compone lease e binding Search WHO host-owned nel transport-result esistente', async () => {
    let captured: Icd11WhoOfficialHttpsClientRequest | null = null;
    const transport = createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(),
        client: async (request: Icd11WhoOfficialHttpsClientRequest) => {
            captured = request;
            assert.equal(request.target, ICD11_WHO_TRANSPORT_TARGET);
            if (request.target !== ICD11_WHO_TRANSPORT_TARGET) assert.fail('expected search request');
            assert.equal(request.protocol, 'https:');
            assert.equal(request.hostname, 'id.who.int');
            assert.equal(request.path, '/icd/release/11/2026-01/mms/search');
            assert.equal(request.method, 'GET');
            assert.equal(request.redirect, 'error');
            assert.deepEqual(Reflect.ownKeys(request), [
                'target', 'protocol', 'hostname', 'path', 'method', 'redirect',
                'headers', 'query', 'signal', 'maxResponseBytes',
            ]);
            for (const key of ['url', 'proxy', 'retry', 'fallback', 'body', 'form', 'timeout']) {
                assert.equal(Object.hasOwn(request, key), false);
            }
            assert.equal(request.headers.get('API-Version'), 'v2');
            assert.equal(request.headers.get('Accept'), 'application/json');
            assert.equal(request.headers.get('Accept-Language'), 'en');
            assert.equal(request.headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
            assert.equal(request.query.get('q'), 'hypertension');
            assert.equal(request.query.get('flatResults'), 'true');
            assert.equal(request.query.get('highlightingEnabled'), 'false');
            assert.equal(request.query.get('medicalCodingMode'), 'true');
            assert.equal(request.query.get('includeKeywordResult'), 'false');
            assert.equal(request.query.get('limit'), null);
            assert.equal(request.maxResponseBytes, ICD11_WHO_BINDING.maxResponseBytes);
            assert.equal(JSON.stringify(request).includes(ACCESS_TOKEN), false);
            assert.equal(JSON.stringify(request).includes('hypertension'), false);
            return Object.freeze({
                status: 200,
                finalUrl: `${ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX}hypertension`
                    + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false',
                redirected: false,
                body: JSON.stringify({
                    destinationEntities: [{ theCode: 'BA00', title: 'Essential hypertension' }],
                    error: false, errorMessage: null, resultChopped: false,
                }),
            });
        },
    });

    assert.deepEqual(await transport(transportRequest()), {
        schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
        releaseId: '2026-01', language: 'en',
        entries: [{ code: 'BA00', description: 'Essential hypertension' }],
    });
    const settled = captured as unknown as Icd11WhoOfficialHttpsClientRequest;
    assert.equal(settled.target, ICD11_WHO_TRANSPORT_TARGET);
    if (settled.target !== ICD11_WHO_TRANSPORT_TARGET) assert.fail('expected search request');
    assert.equal(settled.headers.get('Authorization'), null);
    assert.equal(settled.query.get('q'), null);
});

test('accetta i soli campi opzionali data-only documentati dallo Swagger WHO', async () => {
    const body = JSON.stringify({
        destinationEntities: [{
            id: 'urn:synthetic:who:mms:108368987',
            title: 'Essential hypertension', stemId: null, isLeaf: true,
            postcoordinationAvailability: 0, hasCodingNote: false,
            hasMaternalChapterLink: false, hasPerinatalChapterLink: false,
            matchingPVs: [{ propertyId: 'Title', label: 'Essential hypertension', score: 1,
                important: true, foundationUri: null, propertyValueType: 0 }],
            propertiesTruncated: false, isResidualOther: false, isResidualUnspecified: false,
            chapter: '11', theCode: 'BA00', score: 1, titleIsASearchResult: true,
            titleIsTopScore: true, entityType: 0, important: true, descendants: [],
        }],
        error: false, errorMessage: null, resultChopped: false,
        wordSuggestionsChopped: false, guessType: 0,
        uniqueSearchId: '123e4567-e89b-12d3-a456-426614174000', words: [],
    });
    const transport = createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(),
        client: async () => Object.freeze({
            status: 200,
            finalUrl: `${ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX}hypertension`
                + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false',
            redirected: false, body,
        }),
    });

    assert.deepEqual((await transport(transportRequest())).entries,
        [{ code: 'BA00', description: 'Essential hypertension' }]);
});

test('accetta errorMessage omesso quando i campi semantici dichiarano successo', async () => {
    const transport = createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(),
        client: async () => Object.freeze({
            status: 200,
            finalUrl: `${ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX}hypertension`
                + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false',
            redirected: false,
            body: JSON.stringify({ destinationEntities: [], error: false, resultChopped: false }),
        }),
    });

    assert.deepEqual((await transport(transportRequest())).entries, []);
});

test('nega factory e request caller-supplied ostili prima di lease e HTTP', async () => {
    let getterReads = 0; let proxyTraps = 0; let clientCalls = 0;
    const client = async () => { clientCalls += 1; return envelope(); };
    const credentials = createCredentials();
    assert.throws(() => createIcd11WhoOfficialSearchTransport({ credentials, client, url: FINAL_URL } as never),
        (error: unknown) => error instanceof Icd11WhoOfficialSearchTransportError && error.code === 'input_invalid');
    const accessorFactory = Object.defineProperties({}, {
        credentials: { enumerable: true, value: credentials },
        client: { enumerable: true, get() { getterReads += 1; return client; } },
    });
    assert.throws(() => createIcd11WhoOfficialSearchTransport(accessorFactory),
        (error: unknown) => error instanceof Icd11WhoOfficialSearchTransportError && error.code === 'input_invalid');
    const proxyFactory = new Proxy({ credentials, client }, {
        ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); },
    });
    assert.throws(() => createIcd11WhoOfficialSearchTransport(proxyFactory),
        (error: unknown) => error instanceof Icd11WhoOfficialSearchTransportError && error.code === 'input_invalid');

    const transport = transportWith(client);
    for (const request of [
        { ...transportRequest(), url: FINAL_URL },
        transportRequest({ target: 'caller.target' }),
        transportRequest({ releaseId: 'latest' }),
        transportRequest({ linearization: 'foundation' }),
        transportRequest({ language: 'it' }),
        transportRequest({ query: ' hypertension ' }),
        transportRequest({ query: '\ud800' }),
        transportRequest({ query: 'hyper\u200ftension' }),
        transportRequest({ limit: 20 }),
        transportRequest({ maxResponseBytes: 1_000_000 }),
    ]) await rejectsCode(transport(request), 'input_invalid');
    assert.deepEqual([getterReads, proxyTraps, clientCalls], [0, 0, 0]);
});

test('nega redirect e mappa gli status WHO senza propagare dettagli vendor', async () => {
    for (const hostile of [
        envelope(undefined, { redirected: true }),
        envelope(undefined, { finalUrl: FINAL_URL.replace('https:', 'http:') }),
        envelope(undefined, { finalUrl: FINAL_URL.replace('id.who.int', '127.0.0.1') }),
        envelope(undefined, { finalUrl: `${FINAL_URL}&caller=true` }),
        envelope(undefined, { status: 302 }),
    ]) await rejectsCode(transportWith(async () => hostile)(transportRequest()), 'redirect_rejected');

    for (const [status, code] of [[401, 'auth_rejected'], [403, 'auth_rejected'],
        [408, 'request_timeout'], [429, 'rate_limited'], [503, 'upstream_unavailable'],
        [201, 'response_invalid'], [400, 'response_invalid']] as const) {
        const error = await rejectsCode(transportWith(async () => envelope(
            'SYNTHETIC_VENDOR_BODY BA00 Essential hypertension', { status },
        ))(transportRequest()), code);
        const serialized = `${String(error)} ${JSON.stringify(error)}`;
        for (const secret of [ACCESS_TOKEN, 'SYNTHETIC_VENDOR_BODY', 'BA00', 'Essential hypertension', FINAL_URL]) {
            assert.equal(serialized.includes(secret), false);
        }
    }
});

test('nega envelope non data-only, body oversized e failure HTTP senza assimilare thenable', async () => {
    let getterReads = 0; let proxyTraps = 0; let thenCalls = 0;
    const accessor = Object.defineProperties({}, {
        status: { enumerable: true, value: 200 }, finalUrl: { enumerable: true, value: FINAL_URL },
        redirected: { enumerable: true, value: false },
        body: { enumerable: true, get() { getterReads += 1; return bodyWith(); } },
    });
    await rejectsCode(transportWith(async () => accessor)(transportRequest()), 'response_invalid');
    await rejectsCode(transportWith(async () => ({ ...envelope(), headers: {} }))(transportRequest()), 'response_invalid');
    const proxy = new Proxy(envelope(), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
    await rejectsCode(transportWith(async () => proxy)(transportRequest()), 'response_invalid');
    await rejectsCode(transportWith(async () => envelope('€'.repeat(22_000)))(transportRequest()), 'response_too_large');

    const thenable = Object.freeze({ then(resolve: (value: unknown) => void) {
        thenCalls += 1; resolve(envelope());
    } });
    const thenableTransport = createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(), client: (() => thenable) as never,
    });
    await rejectsCode(thenableTransport(transportRequest()), 'response_invalid');
    class PromiseSubclass<T> extends Promise<T> {}
    const subclassTransport = createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(), client: (() => PromiseSubclass.resolve(envelope())) as never,
    });
    await rejectsCode(subclassTransport(transportRequest()), 'response_invalid');
    const rejected = await rejectsCode(createIcd11WhoOfficialSearchTransport({
        credentials: createCredentials(), client: (() => { throw new Error(`SYNTHETIC_VENDOR ${ACCESS_TOKEN}`); }) as never,
    })(transportRequest()), 'upstream_unavailable');
    assert.equal(`${String(rejected)} ${JSON.stringify(rejected)}`.includes(ACCESS_TOKEN), false);
    assert.deepEqual([getterReads, proxyTraps, thenCalls], [0, 0, 0]);
});

test('nega payload Search con cap superato, duplicati, highlighting, nesting o schema ostile', async () => {
    const many = Array.from({ length: 26 }, (_value, index) => ({
        theCode: `B${String(index).padStart(2, '0')}`, title: `Synthetic title ${index}`,
    }));
    const hostileBodies = [
        bodyWith(many),
        bodyWith([{ theCode: 'BA00', title: 'One' }, { theCode: 'BA00', title: 'Two' }]),
        bodyWith([{ theCode: 'bad code', title: 'Essential hypertension' }]),
        bodyWith([{ theCode: 'BA00', title: '<em>Essential</em> hypertension' }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential\u202ehypertension' }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential\u200fhypertension' }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential \ud800 hypertension' }]),
        bodyWith([{ theCode: 'BA00', title: ' Essential  hypertension ' }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential hypertension',
            descendants: [{ theCode: 'BA01', title: 'Nested' }] }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential hypertension', admin: true }]),
        bodyWith([{ theCode: 'BA00', title: 'Essential hypertension',
            matchingPVs: [{ label: '<em>Essential</em> hypertension' }] }]),
        bodyWith(undefined, { error: true, errorMessage: 'SYNTHETIC_VENDOR_ERROR' }),
        bodyWith(undefined, { words: [{ label: 'suggestion', dontChangeResult: false }] }),
        bodyWith(undefined, { guessType: 3 }),
        bodyWith(undefined, { uniqueSearchId: 'not-a-uuid' }),
        bodyWith(undefined, { wordSuggestionsChopped: 'false' }),
        JSON.stringify({ destinationEntities: [], error: false, errorMessage: null }),
        JSON.stringify({ destinationEntities: [], error: false, errorMessage: null,
            resultChopped: false, vendor: 'SYNTHETIC_VENDOR_ERROR' }),
    ];
    for (const body of hostileBodies) {
        const error = await rejectsCode(transportWith(async () => envelope(body))(transportRequest()), 'response_invalid');
        const serialized = `${String(error)} ${JSON.stringify(error)}`;
        assert.equal(serialized.includes('SYNTHETIC_VENDOR_ERROR'), false);
        assert.equal(serialized.includes('BA00'), false);
        assert.equal(serialized.includes('Essential hypertension'), false);
    }
});

test('cancella il client pending, ritira lease e facciate e ignora il late completion', async () => {
    const controller = new AbortController();
    const started = deferred<Icd11WhoOfficialHttpsClientRequest>();
    const pending = deferred<unknown>();
    const actual = createCredentials();
    let acquiredLease: unknown;
    const credentials = Object.freeze({
        async acquire() { acquiredLease = await actual.acquire(); return acquiredLease; },
        consume(lease: unknown, run: (inject: (
            sink: { set(name: string, value: string): unknown },
        ) => void) => unknown | Promise<unknown>) { return actual.consume(lease, run); },
    });
    const transport = transportWith((request) => {
        started.resolve(request); return pending.promise;
    }, credentials);
    const operation = transport(transportRequest({ signal: controller.signal }));
    const request = await started.promise;
    assert.equal(request.target, ICD11_WHO_TRANSPORT_TARGET);
    if (request.target !== ICD11_WHO_TRANSPORT_TARGET) assert.fail('expected search request');
    controller.abort();
    await rejectsCode(operation, 'request_cancelled');
    assert.equal(request.headers.get('Authorization'), null);
    assert.equal(request.query.get('q'), null);
    pending.resolve(envelope());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(request.headers.get('Authorization'), null);
    await assert.rejects(actual.consume(acquiredLease, () => undefined),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lease_consumed');
});

test('restart del credential manager durante HTTP pending nega la pubblicazione', async () => {
    const pending = deferred<unknown>();
    const started = deferred<Icd11WhoOfficialHttpsClientRequest>();
    const credentials = createCredentials();
    const transport = transportWith((request) => { started.resolve(request); return pending.promise; }, credentials);
    const operation = transport(transportRequest());
    const request = await started.promise;
    credentials.restart();
    await rejectsCode(operation, 'credential_unavailable');
    assert.equal(request.target, ICD11_WHO_TRANSPORT_TARGET);
    if (request.target !== ICD11_WHO_TRANSPORT_TARGET) assert.fail('expected search request');
    assert.equal(request.headers.get('Authorization'), null);
    assert.equal(request.query.get('q'), null);
    pending.resolve(envelope());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(request.headers.get('Authorization'), null);
});

test('abort durante acquire risponde subito e consuma la lease arrivata tardi senza HTTP', async () => {
    const controller = new AbortController();
    const secretStarted = deferred<void>();
    const secret = deferred<Readonly<Record<string, unknown>>>();
    const actual = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: () => { secretStarted.resolve(); return secret.promise; },
        issueToken: async (request: { presentCredentials(
            sink: { set(clientId: string, clientSecret: string): unknown },
        ): unknown }) => {
            request.presentCredentials({ set() { return undefined; } });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    actual.configure({ schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
        generation: 7, enabled: true,
        secretRef: { scheme: 'host_secret', name: 'mediflow.who.icd-api.oauth-client.v1' } });
    let consumeCalls = 0; let clientCalls = 0;
    const credentials = Object.freeze({
        acquire: () => actual.acquire(),
        consume(lease: unknown, run: (inject: (
            sink: { set(name: string, value: string): unknown },
        ) => void) => unknown | Promise<unknown>) {
            consumeCalls += 1; return actual.consume(lease, run);
        },
    });
    const operation = transportWith(async () => { clientCalls += 1; return envelope(); }, credentials)(
        transportRequest({ signal: controller.signal }),
    );
    await secretStarted.promise;
    controller.abort();
    await rejectsCode(operation, 'request_cancelled');
    secret.resolve(Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
        presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
            sink.set('synthetic-client-id-085', 'SYNTHETIC_WHO_SECRET_085_0123456789');
        },
    }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual([consumeCalls, clientCalls], [1, 0]);
});

test('il timeout del servizio abortisce il transport composto senza audit o risultato', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const started = deferred<Icd11WhoOfficialHttpsClientRequest>();
    const transport = transportWith((request) => {
        started.resolve(request); return new Promise(() => undefined);
    });
    let auditCalls = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1',
            network: 'online', egress: 'enabled', credential: 'enabled',
        }),
        now: () => 5_000,
        audit: async () => { auditCalls += 1; },
        transport,
    });
    const operation = service.search({ query: 'hypertension' });
    const request = await started.promise;
    context.mock.timers.tick(ICD11_WHO_BINDING.timeoutMs);
    await assert.rejects(operation,
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'request_timeout');
    await Promise.resolve();
    assert.equal(request.signal.aborted, true);
    assert.equal(auditCalls, 0);
});
