/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
    createProviderLifecycleStore,
    getProviderLifecycleStorePaths,
    ProviderLifecycleStoreError,
} from './provider-lifecycle-store.ts';
const roots: string[] = [];
const lifecycle = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-lifecycle.v1' as const,
    provider: 'ollama', credentialClass: 'local_model' as const,
    status: 'available_unqualified' as const,
});
function root(): string {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fabric-lifecycle-'));
    roots.push(value); return value;
}
function expectCode(code: ProviderLifecycleStoreError['code'], run: () => unknown): void {
    assert.throws(run, (error) => error instanceof ProviderLifecycleStoreError && error.code === code); }
afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });
test('persists an exact PHI-safe snapshot across restart', () => {
    const appDataDir = root();
    const paths = getProviderLifecycleStorePaths(appDataDir);
    fs.mkdirSync(paths.directory, { recursive: true, mode: 0o777 });
    if (process.platform !== 'win32') fs.chmodSync(paths.directory, 0o777);
    const first = createProviderLifecycleStore(appDataDir, () => new Date('2026-08-22T10:00:00.000Z'));
    const saved = first.save({
        kind: 'admit', expectedVersion: 0, lifecycle,
        actorClass: 'host_service', actorRef: 'actor_12345678123456781234567812345678', receiptRef: 'receipt_12345678123456781234567812345678',
    });
    assert.equal(saved.version, 1);
    assert.equal(saved.hostTimestamp, '2026-08-22T10:00:00.000Z');
    assert.throws(() => ((saved.lifecycle as { status: string }).status = 'revoked'));
    const restarted = createProviderLifecycleStore(appDataDir, () => new Date('2026-08-22T10:01:00.000Z'));
    assert.deepEqual(restarted.load(), saved);
    if (process.platform !== 'win32') assert.deepEqual(
        [fs.statSync(paths.directory).mode & 0o777, fs.statSync(paths.recordPath).mode & 0o777], [0o700, 0o600]);
    const raw = fs.readFileSync(paths.recordPath, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
        'actorClass', 'actorRef', 'hostTimestamp', 'lifecycle', 'receiptRef', 'schemaVersion', 'version',
    ]);
    assert.doesNotMatch(raw, /patient|clinical|prompt|token|endpoint|response/i);
});
test('enforces expectedVersion and terminal revocation after restart', () => {
    const appDataDir = root();
    const store = createProviderLifecycleStore(appDataDir, () => new Date('2026-08-22T10:00:00.000Z'));
    store.save({
        kind: 'admit', expectedVersion: 0, lifecycle,
        actorClass: 'physician', actorRef: 'actor_abcdef0123456789abcdef0123456789', receiptRef: 'receipt_abcdef0123456789abcdef0123456789',
    });
    const degraded = store.save({
        kind: 'transition', expectedVersion: 1, event: 'degrade',
        actorClass: 'host_service', actorRef: 'actor_87654321876543218765432187654321', receiptRef: 'receipt_87654321876543218765432187654321',
    });
    expectCode('version_conflict', () => store.save({
        kind: 'transition', expectedVersion: 1, event: 'recover',
        actorClass: 'host_service', actorRef: 'actor_87654321876543218765432187654321', receiptRef: 'receipt_87654321876543218765432187654321',
    }));
    assert.equal(degraded.version, 2);
    store.save({
        kind: 'transition', expectedVersion: 2, event: 'revoke',
        actorClass: 'physician', actorRef: 'actor_abcdef0123456789abcdef0123456789', receiptRef: 'receipt_deadbeef01234567deadbeef01234567',
    });
    const restarted = createProviderLifecycleStore(appDataDir, () => new Date('2026-08-22T10:02:00.000Z'));
    assert.equal(restarted.load().lifecycle.status, 'revoked');
    expectCode('transition_invalid', () => restarted.save({
        kind: 'transition', expectedVersion: 3, event: 'recover',
        actorClass: 'physician', actorRef: 'actor_abcdef0123456789abcdef0123456789', receiptRef: 'receipt_cafebabe01234567cafebabe01234567',
    }));
});
test('fails closed on missing, corrupt, truncated, and unreadable state', () => {
    const appDataDir = root();
    const paths = getProviderLifecycleStorePaths(appDataDir);
    const store = createProviderLifecycleStore(appDataDir, () => new Date());
    expectCode('missing', () => store.load());
    fs.mkdirSync(path.dirname(paths.recordPath), { recursive: true });
    for (const raw of ['{', '{"schemaVersion":"wrong"}']) {
        fs.writeFileSync(paths.recordPath, raw);
        expectCode('corrupt', () => store.load());
    }
    fs.rmSync(paths.recordPath);
    fs.mkdirSync(paths.recordPath);
    expectCode('unreadable', () => store.load());
});
test('rejects secret or clinical fields and an occupied writer lock', () => {
    const appDataDir = root();
    const paths = getProviderLifecycleStorePaths(appDataDir);
    const store = createProviderLifecycleStore(appDataDir, () => new Date('2026-08-22T10:00:00.000Z'));
    expectCode('command_invalid', () => store.save({
        kind: 'admit', expectedVersion: 0, lifecycle,
        actorClass: 'host_service', actorRef: 'actor_1234567812345678', receiptRef: 'receipt_12345678123456781234567812345678',
    }));
    expectCode('command_invalid', () => store.save({
        kind: 'admit', expectedVersion: 0, lifecycle,
        token: 'synthetic-secret', patientContext: 'synthetic-clinical-ref',
        actorClass: 'host_service', actorRef: 'actor_12345678123456781234567812345678', receiptRef: 'receipt_12345678123456781234567812345678',
    }));
    assert.equal(fs.existsSync(paths.recordPath), false);
    fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
    fs.writeFileSync(paths.lockPath, 'occupied');
    expectCode('busy', () => store.save({
        kind: 'admit', expectedVersion: 0, lifecycle,
        actorClass: 'host_service', actorRef: 'actor_12345678123456781234567812345678', receiptRef: 'receipt_12345678123456781234567812345678',
    }));
});
