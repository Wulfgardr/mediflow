import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import {
    clearSecuritySession,
    lockSecuritySession,
    restoreSecuritySession,
} from './client-security-session';
import { logoutSecuritySession } from './client-auth-api';

const SESSION_KEY_STORAGE_KEY = 'mediflow_session_key';
const SESSION_USER_STORAGE_KEY = 'mediflow_user';

class MemorySessionStorage {
    private readonly values = new Map<string, string>();

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    key(index: number) {
        return Array.from(this.values.keys())[index] ?? null;
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }

    removeItem(key: string) {
        this.values.delete(key);
    }
}

function installSessionStorage(storage: Storage) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: storage,
    });

    return () => {
        if (descriptor) {
            Object.defineProperty(globalThis, 'sessionStorage', descriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'sessionStorage');
        }
    };
}

function storeSyntheticSession(storage: Storage) {
    storage.setItem(SESSION_KEY_STORAGE_KEY, '{"kty":"oct"}');
    storage.setItem(SESSION_USER_STORAGE_KEY, '{"id":"synthetic-user"}');
}

test('lock clears persisted session data and the active database key before logout', async (t) => {
    const storage = new MemorySessionStorage();
    storeSyntheticSession(storage);
    const restoreStorage = installSessionStorage(storage as unknown as Storage);
    const activeKey = {} as CryptoKey;
    db.setKey(activeKey);

    t.after(() => {
        db.setKey(null);
        restoreStorage();
    });

    lockSecuritySession(
        () => db.setKey(null),
        () => {
            assert.equal(storage.getItem(SESSION_KEY_STORAGE_KEY), null);
            assert.equal(storage.getItem(SESSION_USER_STORAGE_KEY), null);
            assert.equal(db.isKeySet(), false);
        },
    );

    assert.equal(await restoreSecuritySession(), null);
});

test('a logout failure cannot retain the local key or persisted session', (t) => {
    const storage = new MemorySessionStorage();
    storeSyntheticSession(storage);
    const restoreStorage = installSessionStorage(storage as unknown as Storage);
    db.setKey({} as CryptoKey);

    t.after(() => {
        db.setKey(null);
        restoreStorage();
    });

    assert.doesNotThrow(() => lockSecuritySession(
        () => db.setKey(null),
        () => {
            throw new Error('synthetic logout failure');
        },
    ));
    assert.equal(storage.getItem(SESSION_KEY_STORAGE_KEY), null);
    assert.equal(storage.getItem(SESSION_USER_STORAGE_KEY), null);
    assert.equal(db.isKeySet(), false);
});

test('a rejected logout request does not create an unhandled rejection', async (t) => {
    const storage = new MemorySessionStorage();
    storeSyntheticSession(storage);
    const restoreStorage = installSessionStorage(storage as unknown as Storage);
    const originalFetch = globalThis.fetch;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
    };
    db.setKey({} as CryptoKey);
    globalThis.fetch = (() => Promise.reject(new Error('synthetic logout rejection'))) as typeof fetch;
    process.on('unhandledRejection', onUnhandledRejection);

    t.after(() => {
        process.off('unhandledRejection', onUnhandledRejection);
        globalThis.fetch = originalFetch;
        db.setKey(null);
        restoreStorage();
    });

    lockSecuritySession(() => db.setKey(null), logoutSecuritySession);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandledRejections, []);
    assert.equal(storage.getItem(SESSION_KEY_STORAGE_KEY), null);
    assert.equal(storage.getItem(SESSION_USER_STORAGE_KEY), null);
    assert.equal(db.isKeySet(), false);
});

test('a throwing session storage does not prevent clearing the active key', () => {
    const restoreStorage = installSessionStorage({
        removeItem() {
            throw new Error('synthetic storage failure');
        },
    } as unknown as Storage);
    let activeKeyCleared = false;

    try {
        assert.doesNotThrow(() => clearSecuritySession());
        assert.doesNotThrow(() => lockSecuritySession(
            () => {
                activeKeyCleared = true;
            },
            () => undefined,
        ));
        assert.equal(activeKeyCleared, true);
    } finally {
        restoreStorage();
    }
});

test('missing session storage does not prevent clearing the active key', (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
    db.setKey({} as CryptoKey);

    t.after(() => {
        db.setKey(null);
        if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    });

    assert.doesNotThrow(() => lockSecuritySession(
        () => db.setKey(null),
        () => undefined,
    ));
    assert.equal(db.isKeySet(), false);
});
