void import.meta.url;
// Golden captured before extraction on e076ea44af9db4352211496c7d2db9e054068529.
/* synthetic content, mock local NER only; no authority or runtime proof. */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
import { mockOrdinaryModule } from './ordinary-module.test-support.ts';
import { profiles, outputs, configuration, tokenFrom } from './ordinary-content.test-support.ts';
import { REDACTION_RUNTIME_SCHEMA, REDACTION_RUNTIME_ADAPTER, REDACTION_RUNTIME_MODEL, REDACTION_RUNTIME_REVISION,
    REDACTION_RUNTIME_FILES, REDACTION_RUNTIME_PACKAGES } from '../redaction-runtime-identity';
const identity = Object.freeze({ schema: REDACTION_RUNTIME_SCHEMA, adapter: REDACTION_RUNTIME_ADAPTER,
    model: REDACTION_RUNTIME_MODEL, revision: REDACTION_RUNTIME_REVISION, workerSha256: 'a'.repeat(64), pythonSha256: 'b'.repeat(64),
    files: REDACTION_RUNTIME_FILES, packages: REDACTION_RUNTIME_PACKAGES });
mockOrdinaryModule(import.meta.url, '../gliner-redaction-runner', { namedExports: {
    readGlinerRuntimeObservation: () => identity,
    createGlinerRedactionRunner: () => ({
        async extract(text: string) {
            return [...text.matchAll(/Bea Riva/gu)].map(match => ({ type: 'person', start: match.index, end: match.index + match[0].length, text: match[0], confidence: 1 }));
        }, async close() {},
    }),
} });
const { createRedactionSession } = await import('../ai-redaction-session');
let mappings: Array<(value: string) => string> = [];
mockOrdinaryModule(import.meta.url, '../ai-redaction-session', { namedExports: {
    createRedactionSession: () => {
        const session = createRedactionSession();
        return { close: () => session.close(), prepare: (input: Parameters<typeof session.prepare>[0]) => {
            const prepared = session.prepare(input); mappings.push(prepared.rehydrate); return prepared;
        } };
    },
} });
mock.method(crypto, 'randomBytes', () => Buffer.alloc(16, 0x42));
syncBuiltinESMExports();
const { createOrdinaryPreparation, readPreparedOrdinaryProfile, isPreparedOrdinaryProfileCurrent } = await import('./ordinary-preparation');

for (const retirement of ['close', 'abort'] as const) test(`four ordinary profiles retain golden bytes/results and retire RAM mappings on ${retirement}`, async () => {
    const snapshots = [];
    for (const [index, profile] of profiles().entries()) {
        mappings = [];
        const controller = new AbortController();
        const job = createOrdinaryPreparation(profile, configuration, controller.signal);
        const handle = await job.ready, read = readPreparedOrdinaryProfile(handle);
        const token = tokenFrom(read.payload);
        const wire = JSON.stringify(outputs()[index]).replaceAll('Bea Riva', token);
        try {
            const { parseOutput, ...metadata } = read;
            snapshots.push({ ...metadata, result: parseOutput(wire) });
            assert.ok(mappings.length > 0);
            assert.equal(mappings[0](token), 'Bea Riva');
            for (const forged of [{}, { ...handle }, new Proxy(handle, {})]) {
                assert.throws(() => readPreparedOrdinaryProfile(forged));
                assert.equal(isPreparedOrdinaryProfileCurrent(forged), false);
            }
            assert.throws(() => createOrdinaryPreparation({}, configuration));
        } finally {
            if (retirement === 'abort') controller.abort();
            else await job.close();
            assert.equal(isPreparedOrdinaryProfileCurrent(handle), false);
            assert.throws(() => readPreparedOrdinaryProfile(handle));
            assert.throws(() => read.parseOutput(wire));
            for (const rehydrate of mappings) assert.throws(() => rehydrate(token), /closed/);
            await job.close();
        }
    }
    assert.equal(JSON.stringify(snapshots), JSON.stringify(JSON.parse(readFileSync(new URL('./ordinary-preparation.golden.json', import.meta.url), 'utf8'))));
});
