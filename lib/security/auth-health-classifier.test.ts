import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAuthHealthError } from './auth-health-classifier';

test('classifies better-sqlite3 NODE_MODULE_VERSION mismatch as native dependency invalid', () => {
    const error = new Error(
        "The module '/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node' " +
        'was compiled against a different Node.js version using NODE_MODULE_VERSION 141. ' +
        'This version of Node.js requires NODE_MODULE_VERSION 115.'
    );
    const result = classifyAuthHealthError(error);

    assert.equal(result.code, 'DB_NATIVE_DEPENDENCY_INVALID');
    assert.equal(result.category, 'native-dependency-invalid');
    assert.equal(result.dbState, 'unavailable');
    assert.equal(result.message, 'Modulo nativo SQLite incompatibile con il runtime Node corrente.');
    assert.equal(result.remediationCommand, 'npm ci');
    assert.match(result.nextAction ?? '', /riavvia/i);
});

test('classifies ERR_DLOPEN_FAILED code as native dependency invalid', () => {
    const error = Object.assign(new Error('dlopen failed'), { code: 'ERR_DLOPEN_FAILED' });
    const result = classifyAuthHealthError(error);

    assert.equal(result.code, 'DB_NATIVE_DEPENDENCY_INVALID');
    assert.equal(result.dbState, 'unavailable');
});

test('classifies missing better-sqlite3 module as native dependency missing', () => {
    const error = Object.assign(
        new Error("Cannot find module 'better-sqlite3'"),
        { code: 'MODULE_NOT_FOUND' }
    );
    const result = classifyAuthHealthError(error);

    assert.equal(result.code, 'DB_NATIVE_DEPENDENCY_MISSING');
    assert.equal(result.category, 'native-dependency-missing');
    assert.equal(result.dbState, 'unavailable');
    assert.equal(result.remediationCommand, 'npm install');
});

test('classifies "no such table" as schema missing', () => {
    const error = new Error('SQLITE_ERROR: no such table: users');
    const result = classifyAuthHealthError(error);

    assert.equal(result.code, 'DB_SCHEMA_MISSING');
    assert.equal(result.category, 'schema-missing');
    assert.equal(result.dbState, 'schema-missing');
    assert.equal(result.remediationCommand, undefined);
});

test('falls back to generic query failure', () => {
    const error = new Error('database is locked');
    const result = classifyAuthHealthError(error);

    assert.equal(result.code, 'DB_QUERY_FAILED');
    assert.equal(result.category, 'query-failed');
    assert.equal(result.dbState, 'unavailable');
});

test('handles non-Error inputs without throwing', () => {
    const result = classifyAuthHealthError('boom');
    assert.equal(result.code, 'DB_QUERY_FAILED');
    assert.equal(result.message, 'Impossibile leggere il database locale.');
});
