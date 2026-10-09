import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs';
import { db } from './db';
import { nukeTestData, seedDatabase, SeederIncompleteError } from './seeder';

async function fixture(t: TestContext) {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    db.setKey(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    t.after(() => db.setKey(null));
}
const patient = { id: 'synthetic', taxCode: 'TEST-synthetic', version: 1 };
const attachment = { id: 'synthetic-attachment', patientId: patient.id, name: 'synthetic', path: 'synthetic',
    type: 'text/plain', size: 1, currentness: { sourceRef: 'a'.repeat(64), revision: 1, freshnessEpoch: 1 } };

test('cleanup rejects a child-list failure after confirmed patient deletion and waits for pending cleanup', async t => {
    await fixture(t);
    const deleted: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
            if (url.includes('attachments')) {
                await new Promise(resolve => setTimeout(resolve, 10));
                assert.deepEqual(JSON.parse(init.body as string), { patientId: patient.id, expected: attachment.currentness });
            } else assert.equal(JSON.parse(init.body as string).version, 1);
            deleted.push(url);
            return Response.json({ success: true });
        }
        if (url === '/api/patients') return Response.json([patient]);
        if (url === '/api/entries') return Response.json({ error: 'synthetic failure' }, { status: 500 });
        if (url === '/api/attachments') return Response.json([attachment]);
        return Response.json([]);
    });
    await assert.rejects(nukeTestData(false), error => {
        assert.ok(error instanceof SeederIncompleteError);
        assert.equal(error.outcome.confirmedPatients, 1);
        assert.equal(error.outcome.confirmedRelatedRecords, 1);
        assert.deepEqual(deleted, ['/api/patients/synthetic', '/api/attachments/synthetic-attachment']);
        return true;
    });
});

test('cleanup success reports patients, excludes other patients and preserves delete version', async t => {
    await fixture(t);
    const deletes: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
            deletes.push(url);
            assert.equal(JSON.parse(init.body as string).version, 1);
            return Response.json({ success: true });
        }
        return Response.json(url === '/api/patients' ? [patient, { id: 'synthetic-control', taxCode: 'CONTROL' }] : []);
    });
    assert.deepEqual(await nukeTestData(false), { deleted: 1 });
    assert.deepEqual(deletes, ['/api/patients/synthetic']);
});

test('cleanup first rejected deletion reports zero confirmations and does not retry or start child cleanup', async t => {
    await fixture(t);
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
        calls.push(url);
        return init?.method === 'DELETE' ? Response.json({}, { status: 409 }) : Response.json([patient]);
    });
    await assert.rejects(nukeTestData(false), error => {
        assert.ok(error instanceof SeederIncompleteError);
        assert.equal(error.outcome.confirmedPatients, 0);
        assert.match(error.message, /senza conferma/);
        return true;
    });
    assert.deepEqual(calls, ['/api/patients', '/api/patients/synthetic']);
});

test('cleanup unavailable authenticated list cannot be mistaken for an empty successful cleanup', async t => {
    await fixture(t);
    t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 401 }));
    await assert.rejects(nukeTestData(false), SeederIncompleteError);
});

for (const scenario of ['success', 'partial', 'first failure'] as const) {
    test(`seed ${scenario} counts acknowledged patient and child writes without rollback or retry`, async t => {
        await fixture(t);
        t.mock.method(Math, 'random', () => 0); // five visit entries per patient; no PDFs
        let patients = 0; let entries = 0;
        const progress: number[] = [];
        t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
            assert.equal(init.method, 'POST');
            if (url === '/api/patients') patients++;
            else { assert.equal(url, '/api/entries'); entries++; }
            if (scenario === 'first failure' || (scenario === 'partial' && patients === 2 && url === '/api/entries')) {
                return Response.json({ error: 'synthetic failure' }, { status: 500 });
            }
            return Response.json({ id: JSON.parse(init.body as string).id });
        });
        const run = seedDatabase({ patientCount: 2, includeEntries: true, includeTherapies: false, includeConditions: false,
            onProgress: current => { progress.push(current); } });
        if (scenario === 'success') {
            const result = await run;
            assert.equal(result.count, 2);
            assert.deepEqual(result.outcome, { operation: 'seed', confirmedPatients: 2, completedPatients: 2, confirmedRelatedRecords: 10 });
            assert.deepEqual(progress, [1, 2]);
        } else {
            await assert.rejects(run, error => {
                assert.ok(error instanceof SeederIncompleteError);
                assert.deepEqual(error.outcome, { operation: 'seed', confirmedPatients: scenario === 'partial' ? 2 : 0,
                    completedPatients: scenario === 'partial' ? 1 : 0, confirmedRelatedRecords: scenario === 'partial' ? 5 : 0 });
                assert.match(error.message, /I dati già salvati restano presenti/);
                return true;
            });
            assert.equal(patients, scenario === 'partial' ? 2 : 1);
            assert.equal(entries, scenario === 'partial' ? 6 : 0);
            assert.deepEqual(progress, scenario === 'partial' ? [1] : []);
        }
    });
}

test('UI uses confirmed results and incomplete messages; errors never reload or expose stacks', () => {
    const source = fs.readFileSync('components/data-seeder.tsx', 'utf8');
    assert.match(source, /Generati \$\{result.count\} pazienti/);
    assert.match(source, /Eliminati \$\{result.deleted\} pazienti/);
    const catches = [...source.matchAll(/catch \(e\) \{([\s\S]*?)\} finally/g)];
    assert.equal(catches.length, 2);
    for (const [, handler] of catches) {
        assert.match(handler, /e instanceof SeederIncompleteError \? e.message/);
        assert.match(handler, /tone: 'error'/);
        assert.doesNotMatch(handler, /location.reload|setTimeout|\.stack/);
    }
});
