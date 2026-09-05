/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProviderDisclosureSnapshot,
    type ProviderDisclosureSources,
} from './provider-disclosure.ts';

function lifecycle(
    provider: 'ollama' | 'athena_mlx',
    status: 'available_unqualified' | 'degraded' | 'revoked',
) {
    return {
        status: 'available',
        record: {
            lifecycle: {
                schemaVersion: 'mediflow.ai.provider-lifecycle.v1',
                provider,
                credentialClass: 'local_model',
                status,
            },
        },
    };
}

function sources(
    ollama: () => unknown = () => lifecycle('ollama', 'available_unqualified'),
    athena: () => unknown = () => lifecycle('athena_mlx', 'available_unqualified'),
): ProviderDisclosureSources {
    return { ollama, athena };
}

test('separa dichiarazione provider e stato effettivo senza inventare osservazioni runtime', () => {
    let ollamaReads = 0;
    let athenaReads = 0;
    const snapshot = buildProviderDisclosureSnapshot(sources(
        () => { ollamaReads += 1; return lifecycle('ollama', 'available_unqualified'); },
        () => { athenaReads += 1; return lifecycle('athena_mlx', 'degraded'); },
    ));

    assert.equal(snapshot.schemaVersion, 'mediflow.ai.provider-disclosure.v1');
    assert.deepEqual(snapshot.providers.map(({ id }) => id), [
        'ollama',
        'athena_mlx',
        'openai',
        'anthropic',
    ]);
    assert.deepEqual([ollamaReads, athenaReads], [1, 1]);

    assert.deepEqual(snapshot.providers[0], {
        id: 'ollama',
        label: 'Ollama',
        declared: {
            lifecycle: 'host_managed',
            runtimeObservation: 'operation_receipt_required',
            venue: 'local_process',
            egress: 'none',
            credentialClass: 'local_model',
            executionDisposition: 'proposal_only_candidate',
            accessBoundary: 'not_applicable',
        },
        effective: {
            lifecycle: 'available_unqualified',
            runtimeObservation: 'not_observed',
            venue: null,
            egress: null,
            credentialClass: 'local_model',
            executionDisposition: 'not_observed',
        },
    });
    assert.equal(snapshot.providers[1].effective.lifecycle, 'degraded');
    assert.equal(snapshot.providers[1].effective.executionDisposition, 'denied_by_contract');
    assert.equal(snapshot.providers[1].effective.runtimeObservation, 'not_observed');
    assert.equal(snapshot.providers[1].effective.venue, null);
    assert.equal(snapshot.providers[1].effective.egress, null);
});

test('missing, corrupt, unavailable, degraded, revoked e malformed falliscono chiusi', () => {
    const cases: ReadonlyArray<readonly [string, () => unknown, string]> = [
        ['missing', () => ({ status: 'denied', reason: 'missing' }), 'missing'],
        ['corrupt', () => ({ status: 'denied', reason: 'corrupt' }), 'corrupt'],
        ['unavailable', () => ({ status: 'denied', reason: 'unavailable' }), 'unavailable'],
        ['degraded', () => lifecycle('ollama', 'degraded'), 'degraded'],
        ['revoked', () => lifecycle('ollama', 'revoked'), 'revoked'],
        ['throwing', () => { throw new Error('synthetic'); }, 'unavailable'],
        ['provider mismatch', () => lifecycle('athena_mlx', 'available_unqualified'), 'invalid'],
        ['credential mismatch', () => ({
            ...lifecycle('ollama', 'available_unqualified'),
            record: {
                lifecycle: {
                    ...lifecycle('ollama', 'available_unqualified').record.lifecycle,
                    credentialClass: 'api_key',
                },
            },
        }), 'invalid'],
    ];

    for (const [name, read, expectedLifecycle] of cases) {
        const provider = buildProviderDisclosureSnapshot(sources(read)).providers[0];
        assert.equal(provider.effective.lifecycle, expectedLifecycle, name);
        assert.equal(provider.effective.runtimeObservation, 'not_observed', name);
        assert.equal(provider.effective.executionDisposition, 'denied_by_contract', name);
        if (expectedLifecycle === 'degraded' || expectedLifecycle === 'revoked') {
            assert.equal(provider.effective.credentialClass, 'local_model', name);
        } else {
            assert.equal(provider.effective.credentialClass, null, name);
        }
    }
});

test('OpenAI e Anthropic restano righe informative senza accesso o esecuzione', () => {
    const cloud = buildProviderDisclosureSnapshot(sources()).providers.slice(2);
    for (const provider of cloud) {
        assert.deepEqual(provider.declared, {
            lifecycle: 'informational_only',
            runtimeObservation: 'disabled',
            venue: 'cloud',
            egress: 'disabled',
            credentialClass: 'separate_api_access_required',
            executionDisposition: 'execution_disabled',
            accessBoundary: 'consumer_subscription_is_not_api_access',
        });
        assert.deepEqual(provider.effective, {
            lifecycle: 'not_applicable',
            runtimeObservation: 'not_observed',
            venue: null,
            egress: null,
            credentialClass: null,
            executionDisposition: 'execution_disabled',
        });
    }
});

test('lo snapshot e minimale, congelato e privo di dettagli sensibili o operativi', () => {
    const snapshot = buildProviderDisclosureSnapshot(sources());
    const serialized = JSON.stringify(snapshot).toLowerCase();
    for (const forbidden of [
        'actorref', 'receiptref', 'hosttimestamp', 'endpoint', 'baseurl', 'http',
        'token', 'secret', 'password', 'patient', 'ocr',
    ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.providers), true);
    for (const provider of snapshot.providers) {
        assert.equal(Object.isFrozen(provider), true);
        assert.equal(Object.isFrozen(provider.declared), true);
        assert.equal(Object.isFrozen(provider.effective), true);
    }
});
