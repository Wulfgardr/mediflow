/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyReconnection,
    derivePairedTrustState,
    NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION,
    REVOCATION_EFFECTS,
    type PairingTrustInput,
} from './network-pairing-lifecycle.ts';

const TRUSTED_INPUT: PairingTrustInput = {
    clientKnown: true,
    tokenValid: true,
    operatingMode: 'network-home-base',
    capabilityGranted: true,
    sessionState: 'active',
    lockedOut: false,
};

test('derivePairedTrustState follows the real data-plane gate order', () => {
    const cases: Array<{
        name: string;
        input: PairingTrustInput;
        discovery: 'granted' | 'denied';
        denial: ReturnType<typeof derivePairedTrustState>['denial'];
    }> = [
        {
            name: 'unknown client',
            input: { ...TRUSTED_INPUT, clientKnown: false, operatingMode: 'local-only' },
            discovery: 'denied',
            denial: 'UNAUTHENTICATED',
        },
        {
            name: 'invalid token',
            input: { ...TRUSTED_INPUT, tokenValid: false },
            discovery: 'denied',
            denial: 'UNAUTHENTICATED',
        },
        {
            name: 'disabled mode',
            input: { ...TRUSTED_INPUT, operatingMode: 'local-only', capabilityGranted: false },
            discovery: 'denied',
            denial: 'NETWORK_MODE_DISABLED',
        },
        {
            name: 'missing capability',
            input: { ...TRUSTED_INPUT, capabilityGranted: false, sessionState: 'absent' },
            discovery: 'granted',
            denial: 'CAPABILITY_NOT_GRANTED',
        },
        {
            name: 'missing session',
            input: { ...TRUSTED_INPUT, sessionState: 'absent' },
            discovery: 'granted',
            denial: 'SESSION_REQUIRED',
        },
        {
            name: 'expired locked session',
            input: { ...TRUSTED_INPUT, sessionState: 'expired', lockedOut: true },
            discovery: 'granted',
            denial: 'AUTH_LOCKED',
        },
    ];

    for (const fixture of cases) {
        const state = derivePairedTrustState(fixture.input);
        assert.equal(state.schemaVersion, NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION, fixture.name);
        assert.equal(state.discovery, fixture.discovery, fixture.name);
        assert.equal(state.dataPlane, 'denied', fixture.name);
        assert.equal(state.denial, fixture.denial, fixture.name);
    }
});

test('derivePairedTrustState grants discovery with an expired session but never grants an invalid token', () => {
    const expired = derivePairedTrustState({ ...TRUSTED_INPUT, sessionState: 'expired' });
    assert.equal(expired.discovery, 'granted');
    assert.equal(expired.dataPlane, 'denied');
    assert.equal(expired.denial, 'SESSION_REQUIRED');

    const invalidToken = derivePairedTrustState({ ...TRUSTED_INPUT, tokenValid: false });
    assert.equal(invalidToken.discovery, 'denied');
    assert.equal(invalidToken.dataPlane, 'denied');
    assert.equal(invalidToken.denial, 'UNAUTHENTICATED');

    const trusted = derivePairedTrustState(TRUSTED_INPUT);
    assert.deepEqual(trusted, {
        schemaVersion: NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION,
        discovery: 'granted',
        dataPlane: 'granted',
        denial: null,
    });
});

test('derivePairedTrustState degrades out-of-contract runtime input to unauthenticated', () => {
    const invalid = {
        ...TRUSTED_INPUT,
        sessionState: 'unknown',
    } as unknown as PairingTrustInput;

    assert.deepEqual(derivePairedTrustState(invalid), {
        schemaVersion: NETWORK_PAIRING_LIFECYCLE_SCHEMA_VERSION,
        discovery: 'denied',
        dataPlane: 'denied',
        denial: 'UNAUTHENTICATED',
    });
});

test('classifyReconnection returns every class and preserves precedence', () => {
    assert.equal(classifyReconnection(TRUSTED_INPUT), 'trusted');
    assert.equal(
        classifyReconnection({ ...TRUSTED_INPUT, sessionState: 'absent' }),
        're_login_required',
    );
    assert.equal(
        classifyReconnection({ ...TRUSTED_INPUT, clientKnown: false }),
        're_pairing_required',
    );
    assert.equal(
        classifyReconnection({ ...TRUSTED_INPUT, operatingMode: 'local-only' }),
        'wait_mode_enabled',
    );
    assert.equal(
        classifyReconnection({ ...TRUSTED_INPUT, sessionState: 'expired', lockedOut: true }),
        'locked_out_wait',
    );

    assert.equal(
        classifyReconnection({
            ...TRUSTED_INPUT,
            clientKnown: false,
            operatingMode: 'local-only',
            sessionState: 'expired',
            lockedOut: true,
        }),
        're_pairing_required',
    );
    assert.equal(
        classifyReconnection({
            ...TRUSTED_INPUT,
            operatingMode: 'local-only',
            sessionState: 'expired',
            lockedOut: true,
        }),
        'wait_mode_enabled',
    );
});

test('classifyReconnection defaults unknown runtime input to re-pairing', () => {
    const invalid = {
        ...TRUSTED_INPUT,
        operatingMode: 'network-mystery',
    } as unknown as PairingTrustInput;

    assert.equal(classifyReconnection(invalid), 're_pairing_required');
    assert.equal(classifyReconnection(null as unknown as PairingTrustInput), 're_pairing_required');
});

test('REVOCATION_EFFECTS is complete, exact, and deeply frozen', () => {
    assert.deepEqual(Object.keys(REVOCATION_EFFECTS), [
        'logout',
        'pin_change',
        'mode_disable',
        'client_dissociate',
        'admin_reset',
        'host_revoke',
    ]);
    assert.deepEqual(REVOCATION_EFFECTS, {
        logout: {
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'current',
            clearsLockout: false,
        },
        pin_change: {
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: true,
        },
        mode_disable: {
            invalidatesPairedToken: false,
            makesPairedTokenInert: true,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        },
        client_dissociate: {
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        },
        admin_reset: {
            invalidatesPairedToken: false,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'all',
            clearsLockout: false,
        },
        host_revoke: {
            invalidatesPairedToken: true,
            makesPairedTokenInert: false,
            invalidatesOperatorSessions: 'none',
            clearsLockout: false,
        },
    });
    assert.equal(Object.isFrozen(REVOCATION_EFFECTS), true);
    for (const effect of Object.values(REVOCATION_EFFECTS)) {
        assert.equal(Object.isFrozen(effect), true);
    }
});

test('derived trust-state objects are frozen', () => {
    assert.equal(Object.isFrozen(derivePairedTrustState(TRUSTED_INPUT)), true);
    assert.equal(
        Object.isFrozen(derivePairedTrustState({ ...TRUSTED_INPUT, tokenValid: false })),
        true,
    );
});
