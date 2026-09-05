/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createIcd11WhoCredentialLeaseManager,
    ICD11_WHO_SECRET_RESOLVE_TIMEOUT_MS,
    ICD11_WHO_TOKEN_ISSUE_TIMEOUT_MS,
    Icd11WhoCredentialLeaseError,
} from './icd11-who-credential-lease.ts';

const CLIENT_ID = 'synthetic-who-client-id-0001';
const CLIENT_SECRET = 'synthetic-who-client-secret-0001';
const ACCESS_TOKEN = 'synthetic-who-bearer-token-0001';
type CredentialPresenter = (sink: { set(clientId: string, clientSecret: string): unknown }) => void;
const SECRET_REF = Object.freeze({
    scheme: 'host_secret',
    name: 'mediflow.who.icd-api.oauth-client.v1',
});

function configure(manager: ReturnType<typeof createIcd11WhoCredentialLeaseManager>, generation = 1): void {
    manager.configure({ schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
        generation, enabled: true, secretRef: SECRET_REF });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolveValue, rejectValue) => {
        resolve = resolveValue; reject = rejectValue;
    });
    return { promise, resolve, reject };
}

test('emette e consuma una lease token opaca senza esporre credenziali', async () => {
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async (request: Record<string, unknown>) => {
            assert.deepEqual(Reflect.ownKeys(request), ['target', 'secretRef', 'generation', 'signal']);
            assert.equal(request.target, 'who.icd-api.oauth-client-credentials.host-owned');
            assert.equal(Object.isFrozen(request), true);
            assert.equal(JSON.stringify(request).includes('http'), false);
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
                presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                    sink.set(CLIENT_ID, CLIENT_SECRET);
                },
            });
        },
        issueToken: async (request: Record<string, unknown> & {
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void;
        }) => {
            assert.deepEqual(Reflect.ownKeys(request), ['target', 'generation', 'presentCredentials', 'signal']);
            assert.equal(request.target, 'who.icd-api.oauth-client-credentials.official');
            assert.equal(Object.isFrozen(request), true);
            assert.equal(JSON.stringify(request).includes('http'), false);
            request.presentCredentials({ set(clientId, clientSecret) {
                assert.deepEqual([clientId, clientSecret], [CLIENT_ID, CLIENT_SECRET]);
            } });
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000,
            });
        },
    });
    configure(manager);

    const lease = await manager.acquire();
    assert.deepEqual(Reflect.ownKeys(lease), []);
    const headers: Record<string, string> = {};
    const value = await manager.consume(lease, (inject) => {
        inject({ set(name, headerValue) { headers[name] = headerValue; } });
        return 'ready';
    });
    assert.equal(value, 'ready');
    assert.equal(headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.equal(JSON.stringify({ manager, lease }).includes(ACCESS_TOKEN), false);
    assert.equal(JSON.stringify({ manager, lease }).includes(CLIENT_SECRET), false);
});

test('condivide un solo flight e riusa il token RAM entro la generation', async () => {
    const gate = deferred<void>();
    const started = deferred<void>();
    let resolveCalls = 0; let issueCalls = 0;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => {
            resolveCalls += 1;
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
                presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                    sink.set(CLIENT_ID, CLIENT_SECRET);
                },
            });
        },
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            issueCalls += 1;
            started.resolve();
            await gate.promise;
            request.presentCredentials({ set() {} });
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000,
            });
        },
    });
    configure(manager);
    const first = manager.acquire();
    const second = manager.acquire();
    await started.promise;
    assert.deepEqual([resolveCalls, issueCalls], [1, 1]);
    gate.resolve();
    const [firstLease, secondLease] = await Promise.all([first, second]);
    const thirdLease = await manager.acquire();
    assert.notEqual(firstLease, secondLease);
    assert.notEqual(secondLease, thirdLease);
    assert.deepEqual([resolveCalls, issueCalls], [1, 1]);
});

test('disable, restart, revoke e dispose invalidano token e lease', async () => {
    let issueCalls = 0;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            issueCalls += 1;
            request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: `${ACCESS_TOKEN}-${issueCalls}`, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    const disabledLease = await manager.acquire();
    assert.equal(manager.disable(), true);
    await assert.rejects(manager.consume(disabledLease, () => undefined), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'lease_revoked'
    ));
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'credential_disabled'
    ));

    configure(manager, 2);
    const restartedLease = await manager.acquire();
    assert.equal(manager.restart(), true);
    await assert.rejects(manager.consume(restartedLease, () => undefined), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'lease_revoked'
    ));
    await manager.acquire();
    assert.equal(issueCalls, 3);

    assert.equal(manager.revoke(), true);
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'credential_revoked'
    ));
    configure(manager, 3);
    const disposedLease = await manager.acquire();
    assert.equal(manager.dispose(), true);
    await assert.rejects(manager.consume(disposedLease, () => undefined), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'manager_disposed'
    ));
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'manager_disposed'
    ));
});

test('revoca un flight attivo e scarta il completamento tardivo', async () => {
    const issuerStarted = deferred<void>();
    const late = deferred<Readonly<Record<string, unknown>>>();
    let signal: AbortSignal | null = null;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: (request: { signal: AbortSignal; presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            signal = request.signal;
            request.presentCredentials({ set() {} });
            issuerStarted.resolve();
            return late.promise;
        },
    });
    configure(manager);
    const pending = manager.acquire();
    await issuerStarted.promise;
    manager.revoke();
    const outcome = await Promise.race([
        pending.then(() => 'resolved', (error: unknown) => error instanceof Icd11WhoCredentialLeaseError ? error.code : 'foreign'),
        new Promise<string>((resolve) => setImmediate(() => resolve('still_pending'))),
    ]);
    assert.equal((signal as AbortSignal | null)?.aborted, true);
    assert.equal(outcome, 'credential_revoked');
    late.resolve(Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
        tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 }));
    await pending.catch(() => undefined);
    configure(manager, 2);
    await manager.acquire();
});

test('applica timeout host-owned distinti a resolver e issuer', async () => {
    const secretLate = deferred<Readonly<Record<string, unknown>>>();
    let secretSignal: AbortSignal | null = null;
    const secretManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: (request: { signal: AbortSignal }) => {
            secretSignal = request.signal; return secretLate.promise;
        },
        issueToken: async () => { throw new Error('must not issue'); },
    });
    configure(secretManager);
    const secretStartedAt = Date.now();
    await assert.rejects(secretManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'secret_resolve_timeout'
    ));
    assert.equal((secretSignal as AbortSignal | null)?.aborted, true);
    assert.ok(Date.now() - secretStartedAt >= ICD11_WHO_SECRET_RESOLVE_TIMEOUT_MS);
    secretLate.resolve(Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
        presentCredentials: () => undefined }));

    const tokenLate = deferred<Readonly<Record<string, unknown>>>();
    const tokenStarted = deferred<void>();
    let tokenSignal: AbortSignal | null = null;
    const tokenManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: (request: { signal: AbortSignal; presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            tokenSignal = request.signal;
            request.presentCredentials({ set() {} }); tokenStarted.resolve(); return tokenLate.promise;
        },
    });
    configure(tokenManager);
    const pendingToken = tokenManager.acquire();
    await tokenStarted.promise;
    const tokenStartedAt = Date.now();
    await assert.rejects(pendingToken, (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_issue_timeout'
    ));
    assert.equal((tokenSignal as AbortSignal | null)?.aborted, true);
    assert.ok(Date.now() - tokenStartedAt >= ICD11_WHO_TOKEN_ISSUE_TIMEOUT_MS);
    tokenLate.resolve(Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
        tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 }));
});

test('nega Proxy, revoked Proxy, accessor e thenable senza leggerne dettagli', async () => {
    const revokedSources = Proxy.revocable({
        now: () => 1_000, resolveSecretReference: async () => undefined, issueToken: async () => undefined,
    }, {});
    revokedSources.revoke();
    assert.throws(() => createIcd11WhoCredentialLeaseManager(revokedSources.proxy), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'input_invalid'
    ));

    let thenReads = 0;
    const thenable = Object.defineProperty({}, 'then', {
        get() { thenReads += 1; throw new Error(CLIENT_SECRET); },
    });
    const thenableManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000, resolveSecretReference: () => thenable, issueToken: async () => undefined,
    });
    configure(thenableManager);
    await assert.rejects(thenableManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'secret_unavailable'
            && !error.message.includes(CLIENT_SECRET)
    ));
    assert.equal(thenReads, 0);

    const hostileResult = Proxy.revocable({
        schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
        presentCredentials: () => undefined,
    }, {});
    hostileResult.revoke();
    const proxyManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000, resolveSecretReference: async () => hostileResult.proxy, issueToken: async () => undefined,
    });
    configure(proxyManager);
    await assert.rejects(proxyManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'secret_unavailable'
    ));

    let tokenReads = 0;
    const tokenAccessor = Object.defineProperties({}, {
        schemaVersion: { enumerable: true, value: 'mediflow.reference-data.icd11-who-token-result.v1' },
        tokenType: { enumerable: true, value: 'Bearer' },
        accessToken: { enumerable: true, get() { tokenReads += 1; return ACCESS_TOKEN; } },
        expiresInMs: { enumerable: true, value: 3_600_000 },
    });
    const accessorManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            request.presentCredentials({ set() {} }); return tokenAccessor;
        },
    });
    configure(accessorManager);
    await assert.rejects(accessorManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_invalid'
    ));
    assert.equal(tokenReads, 0);
});

test('nega reentrancy da clock e resolver prima di pubblicare token o lease', async () => {
    let issueCalls = 0;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => { manager.restart(); return 1_000; },
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: () => undefined,
        }),
        issueToken: async () => { issueCalls += 1; return undefined; },
    });
    configure(manager);
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'runtime_restarted'
    ));
    assert.equal(issueCalls, 0);

    const resolverManager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: () => {
            resolverManager.restart();
            return Promise.resolve(Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
                presentCredentials: () => undefined,
            }));
        },
        issueToken: async () => { issueCalls += 1; return undefined; },
    });
    configure(resolverManager);
    await assert.rejects(resolverManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'runtime_restarted'
    ));
    assert.equal(issueCalls, 0);

    let resolverCalls = 0;
    const disposeManager = createIcd11WhoCredentialLeaseManager({
        now: () => { disposeManager.dispose(); return 1_000; },
        resolveSecretReference: async () => { resolverCalls += 1; return undefined; },
        issueToken: async () => undefined,
    });
    configure(disposeManager);
    await assert.rejects(disposeManager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'manager_disposed'
    ));
    assert.equal(resolverCalls, 0);
});

test('applica scadenza anticipata, lease breve e revoca il token su clock drift', async () => {
    let current = 1_000; let issueCalls = 0;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => current,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            issueCalls += 1; request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: `${ACCESS_TOKEN}-${issueCalls}`, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    const shortLease = await manager.acquire();
    current = 31_000;
    await assert.rejects(manager.consume(shortLease, () => undefined), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'lease_expired'
    ));
    current = 3_541_000;
    await manager.acquire();
    assert.equal(issueCalls, 2);

    current = 3_540_999;
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'clock_invalid'
    ));
    current = 3_541_001;
    await manager.acquire();
    assert.equal(issueCalls, 3);
});

test('consume e injector sono one-shot, reentrancy e completamenti tardivi negano', async () => {
    const late = deferred<string>();
    const runStarted = deferred<void>();
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    const lease = await manager.acquire();
    let captured: ((sink: { set(name: string, value: string): unknown }) => void) | null = null;
    const pending = manager.consume(lease, (inject) => {
        captured = inject; inject({ set() {} }); runStarted.resolve(); return late.promise;
    });
    await runStarted.promise;
    manager.restart();
    const outcome = await Promise.race([
        pending.then(() => 'resolved', (error: unknown) => error instanceof Icd11WhoCredentialLeaseError ? error.code : 'foreign'),
        new Promise<string>((resolve) => setImmediate(() => resolve('still_pending'))),
    ]);
    assert.equal(outcome, 'lease_revoked');
    late.resolve('late-success');
    await pending.catch(() => undefined);
    assert.throws(() => captured?.({ set() {} }), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'lease_consumed'
    ));
    await assert.rejects(manager.consume(lease, () => undefined), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'lease_revoked'
    ));

    const missing = await manager.acquire();
    await assert.rejects(manager.consume(missing, () => 'no-injection'), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'injection_missing'
    ));
});

test('nega la reentrancy sincrona del presenter credenziali', async () => {
    let writes = 0; let nestedError: unknown;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: async (request: { presentCredentials: CredentialPresenter }) => {
            request.presentCredentials({ set() {
                writes += 1;
                try { request.presentCredentials({ set() { writes += 1; } }); }
                catch (error) { nestedError = error; }
            } });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);

    await manager.acquire();
    assert.equal(writes, 1);
    assert.ok(nestedError instanceof Icd11WhoCredentialLeaseError);
    assert.equal(nestedError.code, 'token_unavailable');
});

test('nega la reentrancy sincrona dell injector bearer', async () => {
    let writes = 0; let nestedError: unknown;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => {
                sink.set(CLIENT_ID, CLIENT_SECRET);
            },
        }),
        issueToken: async (request: { presentCredentials: CredentialPresenter }) => {
            request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    const lease = await manager.acquire();

    await manager.consume(lease, (inject) => {
        inject({ set() {
            writes += 1;
            try { inject({ set() { writes += 1; } }); }
            catch (error) { nestedError = error; }
        } });
    });
    assert.equal(writes, 1);
    assert.ok(nestedError instanceof Icd11WhoCredentialLeaseError);
    assert.equal(nestedError.code, 'lease_consumed');
});

test('non assimila thenable ostili restituiti dal consumer', async () => {
    let thenReads = 0;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    const lease = await manager.acquire();
    const thenable = Object.defineProperty({}, 'then', {
        get() { thenReads += 1; throw new Error(ACCESS_TOKEN); },
    });
    await assert.rejects(manager.consume(lease, (inject) => {
        inject({ set() {} }); return thenable;
    }), (error: unknown) => error instanceof Icd11WhoCredentialLeaseError
        && error.code === 'injection_failed' && !error.message.includes(ACCESS_TOKEN));
    assert.equal(thenReads, 0);
});

test('ritira il presenter credenziali al settlement anche se issuer non lo usa', async () => {
    let captured: CredentialPresenter | null = null;
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            captured = request.presentCredentials;
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 3_600_000 });
        },
    });
    configure(manager);
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_invalid'
    ));
    let writes = 0;
    assert.throws(() => (captured as CredentialPresenter | null)?.({ set() { writes += 1; } }), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_unavailable'
    ));
    assert.equal(writes, 0);

    let thrownPresenter: CredentialPresenter | null = null;
    const throwing = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: (request: { presentCredentials: CredentialPresenter }) => {
            thrownPresenter = request.presentCredentials; throw new Error(CLIENT_SECRET);
        },
    });
    configure(throwing);
    await assert.rejects(throwing.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_unavailable'
            && !error.message.includes(CLIENT_SECRET)
    ));
    assert.throws(() => (thrownPresenter as CredentialPresenter | null)?.({ set() { writes += 1; } }), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_unavailable'
    ));
    assert.equal(writes, 0);
});

test('nega token con durata non bounded e redige gli errori delle porte', async () => {
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
            presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => sink.set(CLIENT_ID, CLIENT_SECRET),
        }),
        issueToken: async (request: { presentCredentials: (sink: { set(clientId: string, clientSecret: string): unknown }) => void }) => {
            request.presentCredentials({ set() {} });
            return Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
                tokenType: 'Bearer', accessToken: ACCESS_TOKEN, expiresInMs: 172_800_000 });
        },
    });
    configure(manager);
    await assert.rejects(manager.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'token_invalid'
            && !error.message.includes(ACCESS_TOKEN) && !error.message.includes(CLIENT_SECRET)
    ));

    const leaking = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => { throw new Error(CLIENT_SECRET); },
        issueToken: async () => { throw new Error(ACCESS_TOKEN); },
    });
    configure(leaking);
    await assert.rejects(leaking.acquire(), (error: unknown) => (
        error instanceof Icd11WhoCredentialLeaseError && error.code === 'secret_unavailable'
            && !error.message.includes(CLIENT_SECRET)
    ));
});

test('accetta soltanto il logical secret reference WHO esatto e record data-only', () => {
    const manager = createIcd11WhoCredentialLeaseManager({
        now: () => 1_000,
        resolveSecretReference: async () => undefined,
        issueToken: async () => undefined,
    });
    for (const secretRef of [
        { scheme: 'env', name: 'WHO_CLIENT_SECRET' },
        { scheme: 'host_secret', name: 'caller.selected' },
        { ...SECRET_REF, clientId: CLIENT_ID },
        { ...SECRET_REF, clientSecret: CLIENT_SECRET },
    ]) {
        assert.throws(() => manager.configure({
            schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
            generation: 1, enabled: true, secretRef,
        }), (error: unknown) => error instanceof Icd11WhoCredentialLeaseError
            && error.code === 'secret_ref_invalid' && !error.message.includes(CLIENT_SECRET));
    }
    let getterReads = 0;
    const accessor = Object.defineProperty({ scheme: 'host_secret' }, 'name', {
        enumerable: true,
        get() { getterReads += 1; return SECRET_REF.name; },
    });
    assert.throws(() => manager.configure({
        schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
        generation: 1, enabled: true, secretRef: accessor,
    }), (error: unknown) => error instanceof Icd11WhoCredentialLeaseError
        && error.code === 'secret_ref_invalid');
    assert.equal(getterReads, 0);

    const revoked = Proxy.revocable(SECRET_REF, {});
    revoked.revoke();
    assert.throws(() => manager.configure({
        schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1',
        generation: 1, enabled: true, secretRef: revoked.proxy,
    }), (error: unknown) => error instanceof Icd11WhoCredentialLeaseError
        && error.code === 'secret_ref_invalid');

    const proxiedPort = new Proxy(async () => undefined, {});
    assert.throws(() => createIcd11WhoCredentialLeaseManager({
        now: () => 1_000, resolveSecretReference: proxiedPort, issueToken: async () => undefined,
    }), (error: unknown) => error instanceof Icd11WhoCredentialLeaseError
        && error.code === 'input_invalid');
});
