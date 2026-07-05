import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebAdminSession } from './server-auth-policy';
import type { ServerSession } from './server-session';

function session(overrides: Partial<ServerSession>): ServerSession {
    const username = ['policy', 'user'].join('-');

    return {
        id: 'session-id',
        userId: 'user-id',
        username,
        role: 'admin',
        authChannel: 'web',
        createdAt: 0,
        expiresAt: 1,
        ...overrides,
    };
}

test('isWebAdminSession accepts only interactive web admin sessions', () => {
    assert.equal(isWebAdminSession(session({ role: 'admin', authChannel: 'web' })), true);
    assert.equal(isWebAdminSession(session({ role: 'admin', authChannel: 'system' })), false);
    assert.equal(isWebAdminSession(session({ role: 'admin', authChannel: 'native' })), false);
    assert.equal(isWebAdminSession(session({ role: 'doctor', authChannel: 'web' })), false);
    assert.equal(isWebAdminSession(null), false);
    assert.equal(isWebAdminSession(undefined), false);
});
