void import.meta.url;
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mockOrdinaryModule } from '../chatgpt-execution/ordinary-module.test-support.ts';
import { emissionPlan, emissionUnit } from './emission-plan';
mockOrdinaryModule(import.meta.url, '../gliner-redaction-runner', { namedExports: {
    readGlinerRuntimeObservation: () => null,
    createGlinerRedactionRunner: () => ({
        async extract(text: string) { return [{ type: 'person', start: 0, end: text.length, text, confidence: 1 }]; },
        async close() {},
    }),
} });
const { createContentPreparation, readPreparedContent, isPreparedContentCurrent, closePreparedContent } = await import('./preparation-core');
const { readPreparedOrdinaryProfile, isPreparedOrdinaryProfileCurrent } = await import('../chatgpt-execution/ordinary-preparation');
const configuration = { pythonExecutable: '/synthetic/python', workerPath: '/synthetic/worker', modelDirectory: '/synthetic/model' };
for (const retirement of ['close', 'abort'] as const) test(`core freezes a provider-independent envelope and rejects foreign/retired handles on ${retirement}`, async () => {
    const controller = new AbortController();
    const extra = { label: 'synthetic', values: ['fixed'] };
    const job = createContentPreparation(emissionPlan([emissionUnit('Bea Riva')]), configuration, text => ({ text, extra }), controller.signal);
    const handle = await job.ready;
    try {
        const read = readPreparedContent(handle);
        assert.throws(() => readPreparedOrdinaryProfile(handle), /ordinary_preparation_invalid/);
        assert.equal(isPreparedOrdinaryProfileCurrent(handle), false);
        const text = read.content.text as string;
        assert.equal(read.restoreText(text), 'Bea Riva');
        assert.equal(read.payloadSha256, createHash('sha256').update(read.payload).digest('hex'));
        extra.values.push('changed');
        assert.equal(JSON.stringify(read.content), read.payload);
        assert.ok(Object.isFrozen(read.content.extra));
        assert.ok(Object.isFrozen((read.content.extra as typeof extra).values));
        for (const forged of [{}, { ...handle }, new Proxy(handle, {}), null]) {
            assert.throws(() => readPreparedContent(forged), /ai_preparation_invalid/);
            assert.equal(isPreparedContentCurrent(forged), false);
        }
        if (retirement === 'abort') controller.abort();
        else await closePreparedContent(handle);
        assert.equal(isPreparedContentCurrent(handle), false);
        assert.throws(() => readPreparedContent(handle), /ai_preparation_invalid/);
        assert.throws(() => read.restoreText(text), /ai_preparation_invalid/);
    } finally { await job.close(); }
});
