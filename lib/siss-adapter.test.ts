/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SissAdapterError,
    SISS_PORTAL_URLS,
    calculateSissRetryDelayMs,
    createSissPortalHandoffTransport,
    executeSissAdapterRequest,
} from './siss-adapter';

test('portal handoff transport returns canonical URL and PHI-safe audit metadata', async () => {
    const result = await executeSissAdapterRequest(
        {
            action: 'prescription.create',
            fiscalCode: 'RSSMRA85T10A562S',
        },
        {
            transport: createSissPortalHandoffTransport(),
            createCorrelationId: () => 'siss-corr-1',
            sleep: async () => undefined,
        },
    );

    assert.equal(result.mode, 'portal-handoff');
    assert.equal(result.handoffUrl, SISS_PORTAL_URLS['prescription.create']);
    assert.equal(result.correlationId, 'siss-corr-1');
    assert.equal(result.attempts, 1);
    assert.equal(result.auditMetadata?.reasonCode, undefined);
    assert.equal(result.auditMetadata?.counts, 1);
    assert.ok(result.auditMetadata?.flags?.includes('integration:siss'));
    assert.ok(result.auditMetadata?.flags?.includes('action:prescription.create'));
    assert.ok(result.auditMetadata?.flags?.includes('mode:portal-handoff'));
    assert.ok(result.auditMetadata?.flags?.includes('transport:portal'));
});

test('invalid fiscal code fails before transport invocation', async () => {
    let calls = 0;

    await assert.rejects(
        executeSissAdapterRequest(
            {
                action: 'fse.lookup',
                fiscalCode: 'invalid',
            },
            {
                transport: async () => {
                    calls += 1;
                    return {
                        ok: true,
                        status: 202,
                        mode: 'portal-handoff',
                    };
                },
                createCorrelationId: () => 'siss-corr-2',
                sleep: async () => undefined,
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof SissAdapterError);
            assert.equal(error.code, 'SISS_INVALID_INPUT');
            assert.equal(error.retryable, false);
            assert.equal(error.attempts, 0);
            assert.equal(error.correlationId, 'siss-corr-2');
            assert.equal(error.auditMetadata?.reasonCode, 'SISS_INVALID_INPUT');
            assert.ok(error.auditMetadata?.flags?.includes('retryable:no'));
            return true;
        },
    );

    assert.equal(calls, 0);
});

test('transient transport errors retry once and then succeed', async () => {
    const delays: number[] = [];
    let calls = 0;

    const result = await executeSissAdapterRequest(
        {
            action: 'fse.lookup',
            fiscalCode: '12345678901',
        },
        {
            transport: async () => {
                calls += 1;
                if (calls === 1) {
                    throw new Error('socket hang up');
                }

                return {
                    ok: true,
                    status: 200,
                    mode: 'certified-api',
                    externalRequestId: 'REQ-1',
                    flags: ['transport:api'],
                };
            },
            createCorrelationId: () => 'siss-corr-3',
            sleep: async (ms) => {
                delays.push(ms);
            },
        },
    );

    assert.equal(calls, 2);
    assert.deepEqual(delays, [calculateSissRetryDelayMs(1)]);
    assert.equal(result.mode, 'certified-api');
    assert.equal(result.externalRequestId, 'REQ-1');
    assert.equal(result.attempts, 2);
    assert.ok(result.auditMetadata?.flags?.includes('retry:yes'));
    assert.ok(result.auditMetadata?.flags?.includes('transport:api'));
});

test('auth failures are surfaced without retry', async () => {
    let calls = 0;

    await assert.rejects(
        executeSissAdapterRequest(
            {
                action: 'prescription.create',
                fiscalCode: 'RSSMRA85T10A562S',
            },
            {
                transport: async () => {
                    calls += 1;
                    return {
                        ok: false,
                        status: 401,
                    };
                },
                createCorrelationId: () => 'siss-corr-4',
                sleep: async () => undefined,
            },
        ),
        (error: unknown) => {
            assert.ok(error instanceof SissAdapterError);
            assert.equal(error.code, 'SISS_AUTH_REQUIRED');
            assert.equal(error.retryable, false);
            assert.equal(error.attempts, 1);
            assert.equal(error.status, 401);
            assert.ok(error.auditMetadata?.flags?.includes('retry:no'));
            assert.ok(error.auditMetadata?.flags?.includes('retryable:no'));
            return true;
        },
    );

    assert.equal(calls, 1);
});
