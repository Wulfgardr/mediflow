import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import Database from 'better-sqlite3';
import { apiInternalError } from './api-error-response';
import { logServerError, logServerWarning } from './server-error-log';

test('a synthetic database exception becomes a technical log and keeps the public response', async t => {
    const log = t.mock.method(console, 'error', () => {});
    const error = new DrizzleQueryError('synthetic-query', ['synthetic-parameter'], new Error('synthetic-cause'));
    Object.assign(error, { name: 'synthetic-name', stack: 'synthetic-stack', body: 'synthetic-body' });

    const result = apiInternalError('POST /api/synthetic', error, { code: 'synthetic_public_code' });

    assert.equal(result.status, 500);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await result.json(), { code: 'synthetic_public_code', error: 'Errore interno del server.' });
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [[JSON.stringify({
        event: 'server.failure', level: 'error', operation: 'POST /api/synthetic', kind: 'database_query',
    })]]);
});

test('SQLite warnings retain the technical category', t => {
    const log = t.mock.method(console, 'warn', () => {});
    logServerWarning('Synthetic migration', new Database.SqliteError('synthetic database detail', 'SQLITE_ERROR'));
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [[JSON.stringify({
        event: 'server.failure', level: 'warn', operation: 'Synthetic migration', kind: 'sqlite',
    })]]);
});

test('a thrown object is classified without inspecting its properties', t => {
    const log = t.mock.method(console, 'error', () => {});
    const read = t.mock.fn(() => { throw new Error('properties must stay unread'); });
    const thrown = new Proxy({}, { get: read, getOwnPropertyDescriptor: read, getPrototypeOf: read });

    logServerError('Synthetic operation', thrown, 503);

    assert.equal(read.mock.callCount(), 0);
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [[JSON.stringify({
        event: 'server.failure', level: 'error', operation: 'Synthetic operation', kind: 'unexpected_value', upstreamStatus: 503,
    })]]);
});

test('redirected process streams append a safe line beside pre-existing content', t => {
    const directory = mkdtempSync(join(tmpdir(), 'mediflow-server-log-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'backend.log');
    writeFileSync(path, 'synthetic previous line\n', { mode: 0o600 });
    const destination = openSync(path, 'a');
    const moduleUrl = new URL('./server-error-log.ts', import.meta.url).href;
    const loader = new URL('../scripts/register-strip-types-loader.mjs', import.meta.url).href;
    try {
        const result = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '--eval', `
            import { logServerError } from ${JSON.stringify(moduleUrl)};
            logServerError('Synthetic operation', new Error('synthetic omitted message'));
        `], { stdio: ['ignore', destination, destination] });
        assert.equal(result.status, 0);
    } finally {
        closeSync(destination);
    }
    assert.equal(readFileSync(path, 'utf8'), 'synthetic previous line\n' + JSON.stringify({
        event: 'server.failure', level: 'error', operation: 'Synthetic operation', kind: 'error',
    }) + '\n');
});
