// D2 security hardening: coverage for the settings write allowlist matrix.
// Run with: node scripts/run-strip-types.mjs --test lib/security/settings-write-policy.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SETTINGS_WRITE_REGISTRY,
    evaluateSettingsWrite,
    settingsWriteChannelForSession,
} from './settings-write-policy.ts';
import type { ServerSession } from './server-session.ts';

function session(overrides: Partial<ServerSession>): ServerSession {
    return {
        id: 'session-id',
        userId: 'user-id',
        username: 'policy-user',
        role: 'doctor',
        authChannel: 'web',
        createdAt: 0,
        expiresAt: 1,
        ...overrides,
    };
}

const webSession = session({ role: 'doctor', authChannel: 'web' });
const webAdminSession = session({ role: 'admin', authChannel: 'web' });
const nativeSession = session({ role: 'doctor', authChannel: 'native' });
const localTokenSession = session({ role: 'admin', authChannel: 'system' });

test('channel derivation maps sessions to write channels', () => {
    assert.equal(settingsWriteChannelForSession(webSession), 'web-session');
    assert.equal(settingsWriteChannelForSession(webAdminSession), 'web-admin');
    assert.equal(settingsWriteChannelForSession(nativeSession), 'web-session');
    assert.equal(settingsWriteChannelForSession(localTokenSession), 'local-token');
});

test('local token can write only the enumerated bootstrap keys', () => {
    // Allowed bootstrap keys.
    assert.equal(evaluateSettingsWrite('network.mode', localTokenSession).allowed, true);
    assert.equal(evaluateSettingsWrite('clinicName', localTokenSession).allowed, true);

    // Operator/AI keys: denied for the local token.
    for (const key of ['aiUrl', 'aiProvider', 'aiModel_clinical', 'aiPatientInsightKillSwitch', 'uiStyleMode']) {
        const decision = evaluateSettingsWrite(key, localTokenSession);
        assert.equal(decision.allowed, false, `${key} must be denied for local-token`);
        assert.equal(decision.allowed === false && decision.status, 403);
    }
});

test('local token cannot write an unknown key (400) but web session can (allowed, unregistered)', () => {
    const localDecision = evaluateSettingsWrite('brandNewFlag', localTokenSession);
    assert.equal(localDecision.allowed, false);
    assert.equal(localDecision.allowed === false && localDecision.status, 400);

    const webDecision = evaluateSettingsWrite('brandNewFlag', webSession);
    assert.equal(webDecision.allowed, true);
    assert.equal(webDecision.allowed === true && webDecision.unregistered, true);
});

test('server-managed keys are denied on every HTTP channel', () => {
    for (const key of ['network.nodeId', 'network.pairing.state', 'backupScheduler']) {
        assert.equal(evaluateSettingsWrite(key, webAdminSession).allowed, false, `${key} denied for web-admin`);
        assert.equal(evaluateSettingsWrite(key, webSession).allowed, false, `${key} denied for web-session`);
        assert.equal(evaluateSettingsWrite(key, localTokenSession).allowed, false, `${key} denied for local-token`);
    }
});

test('web-admin satisfies web-session keys', () => {
    assert.equal(evaluateSettingsWrite('aiProvider', webAdminSession).allowed, true);
    assert.equal(evaluateSettingsWrite('uiReduceMotion', webAdminSession).allowed, true);
});

test('web session can write all web-session registry keys (current UI writers keep working)', () => {
    for (const [key, policy] of Object.entries(SETTINGS_WRITE_REGISTRY)) {
        if (policy.write.includes('web-session')) {
            assert.equal(
                evaluateSettingsWrite(key, webSession).allowed,
                true,
                `${key} should stay writable by the web session`,
            );
        }
    }
});

// Prove every key a current writer uses keeps working for its documented channel.
test('current key/writer pairs still resolve to allowed', () => {
    const webWritten = [
        'aiProvider', 'aiUrl', 'ollamaUrl', 'aiModel', 'aiModel_clinical',
        'aiModel_reasoning', 'aiModel_ocr', 'aiModelDefaultVersion', 'hardwareProfile',
        'aiInsightMode', 'aiInsightManualConfig', 'aiPatientInsightKillSwitch',
        'aiDocumentSynthesisKillSwitch', 'aiSmartImportKillSwitch', 'uiReduceMotion',
        'uiReduceTransparency', 'uiStyleMode', 'terminologyRegistry', 'clinicName', 'network.mode',
    ];
    for (const key of webWritten) {
        assert.equal(evaluateSettingsWrite(key, webSession).allowed, true, `${key} allowed for web session`);
    }

    // Paired/native bootstrap over the local token.
    for (const key of ['network.mode', 'clinicName']) {
        assert.equal(evaluateSettingsWrite(key, localTokenSession).allowed, true, `${key} allowed for local-token bootstrap`);
    }
});
