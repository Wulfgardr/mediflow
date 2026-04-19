import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { deriveNetworkIdentitySummary } from './network-identity-model.ts';

test('deriveNetworkIdentitySummary requires node credentials when only device pairing exists', () => {
    const summary = deriveNetworkIdentitySummary({
        session: null,
        operator: null,
        activeAmbulatory: null,
        defaultAmbulatory: { id: 'amb-default', name: 'Studio Centrale' },
        userCount: 1,
        loginHint: { username: 'solo-user', displayName: 'Dr. Rossi' },
    });

    assert.equal(summary.credentialState, 'node-credentials-required');
    assert.equal(summary.loginMode, 'single-local-user-default');
    assert.equal(summary.usernameHint, 'solo-user');
    assert.equal(summary.scope.source, 'node-default');
    assert.equal(summary.scope.effectiveAmbulatoryId, 'amb-default');
    assert.equal(summary.audit.actorBinding, 'token-only');
});

test('deriveNetworkIdentitySummary binds operator and scope when a session context exists', () => {
    const summary = deriveNetworkIdentitySummary({
        session: {
            id: 'session-1',
            userId: 'user-1',
            username: 'paired-user',
            role: 'admin',
            authChannel: 'web',
            createdAt: 0,
            expiresAt: 1,
        },
        operator: {
            id: 'user-1',
            username: 'paired-user',
            displayName: 'Dr. Rossi',
            role: 'admin',
        },
        activeAmbulatory: { id: 'amb-2', name: 'Ambulatorio Nord' },
        defaultAmbulatory: { id: 'amb-1', name: 'Studio Centrale' },
        userCount: 2,
        loginHint: null,
    });

    assert.equal(summary.credentialState, 'session-bound');
    assert.equal(summary.loginMode, 'explicit-username-required');
    assert.equal(summary.operator.userId, 'user-1');
    assert.equal(summary.scope.source, 'session-context');
    assert.equal(summary.scope.effectiveAmbulatoryId, 'amb-2');
    assert.equal(summary.audit.actorBinding, 'session-user');
});
