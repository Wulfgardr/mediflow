import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOpenLoopProjection, deriveOpenLoops, MIN_TYPICAL_INTERVAL_DAYS } from './patient-open-loops';

const now = new Date('2026-07-01T12:00:00.000Z');

function observation(overrides: Record<string, unknown> = {}) {
    return {
        patientId: 'patient-1',
        codeSystem: 'LOINC',
        code: '2339-0',
        display: 'Glicemia',
        observedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function item(overrides: Record<string, unknown> = {}) {
    return {
        id: 'item-1',
        patientId: 'patient-1',
        prescriptionId: 'prescription-1',
        status: 'prescribed',
        serviceName: 'Glicemia',
        createdAt: '2026-06-01T00:00:00.000Z',
        ...overrides,
    };
}

test('signals a pending result after the waiting window', () => {
    const loops = deriveOpenLoops({ items: [item()], observations: [], now });
    assert.equal(loops.length, 1);
    assert.equal(loops[0].kind, 'results_pending');
    assert.equal(loops[0].suggestedAction, 'insert_results');
    assert.equal(loops[0].sourceRef.id, 'item-1');
    assert.equal(loops[0].label, 'Glicemia');
    assert.deepEqual(loops[0].status, {
        sinceDate: new Date('2026-06-01T00:00:00.000Z'),
        elapsedDays: 30,
    });
    assert.equal(loops[0].sourceRef.prescriptionId, 'prescription-1');
    assert.equal(loops[0].sourceRef.serviceName, 'Glicemia');
});

test('a booked exam never performed is a missing report once past the window from its date', () => {
    const loops = deriveOpenLoops({
        items: [item({ status: 'booked', scheduledAt: '2026-06-10T09:00:00.000Z' })],
        observations: [],
        now,
    });
    assert.equal(loops.length, 1);
    assert.equal(loops[0].kind, 'results_pending');
    assert.deepEqual(loops[0].status, {
        sinceDate: new Date('2026-06-10T09:00:00.000Z'),
        elapsedDays: 21,
    });
});

test('a booked exam with a future date or still inside the window is not signalled', () => {
    for (const scheduledAt of ['2026-07-20T09:00:00.000Z', '2026-06-25T09:00:00.000Z']) {
        assert.deepEqual(
            deriveOpenLoops({ items: [item({ status: 'booked', scheduledAt })], observations: [], now }),
            [],
        );
    }
});

test('cancelled items and received reports never signal a missing report', () => {
    for (const status of ['cancelled', 'report_received']) {
        assert.deepEqual(deriveOpenLoops({ items: [item({ status })], observations: [], now }), []);
    }
});

test('closes a pending result with a linked observation or a received report', () => {
    assert.deepEqual(
        deriveOpenLoops({
            items: [item()],
            observations: [observation({ servicePrescriptionItemId: 'item-1' })],
            now,
        }),
        [],
    );
    assert.deepEqual(
        deriveOpenLoops({
            items: [item({ reportReceivedAt: '2026-06-10T00:00:00.000Z' })],
            observations: [],
            now,
        }),
        [],
    );
});

test('does not signal a regular measurement series', () => {
    const loops = deriveOpenLoops({
        items: [],
        observations: [
            observation({ observedAt: '2026-04-01T00:00:00.000Z' }),
            observation({ observedAt: '2026-05-01T00:00:00.000Z' }),
            observation({ observedAt: '2026-06-01T00:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(loops, []);
});

test('signals a stalled series from its observed cadence', () => {
    const loops = deriveOpenLoops({
        items: [],
        observations: [
            observation({ observedAt: '2026-01-01T00:00:00.000Z' }),
            observation({ observedAt: '2026-02-01T00:00:00.000Z' }),
            observation({ observedAt: '2026-03-01T00:00:00.000Z' }),
        ],
        now,
    });
    assert.equal(loops.length, 1);
    assert.equal(loops[0].kind, 'series_stalled');
    assert.equal(loops[0].label, 'Glicemia');
    assert.deepEqual(loops[0].status, {
        sinceDate: new Date('2026-03-01T00:00:00.000Z'),
        elapsedDays: 122,
        typicalIntervalDays: 29.5,
    });
});

test('does not treat zero or sub-day median intervals as an observation cadence', () => {
    assert.equal(MIN_TYPICAL_INTERVAL_DAYS, 1);

    const identicalTimestamps = deriveOpenLoops({
        items: [],
        observations: [
            observation({ code: 'same-time', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'same-time', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'same-time', observedAt: '2026-01-01T08:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(identicalTimestamps, []);

    const sameDayMeasurements = deriveOpenLoops({
        items: [],
        observations: [
            observation({ code: 'same-day', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'same-day', observedAt: '2026-01-01T12:00:00.000Z' }),
            observation({ code: 'same-day', observedAt: '2026-01-01T16:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(sameDayMeasurements, []);
});

test('requires three distinct observation dates before deriving a cadence', () => {
    const duplicateTimestampMixedWithOneLaterDate = deriveOpenLoops({
        items: [],
        observations: [
            observation({ code: 'duplicate-date', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'duplicate-date', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'duplicate-date', observedAt: '2026-02-01T08:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(duplicateTimestampMixedWithOneLaterDate, []);

    const multipleMeasurementsOnOneDayPlusOneLaterDate = deriveOpenLoops({
        items: [],
        observations: [
            observation({ code: 'same-day-mixed', observedAt: '2026-01-01T08:00:00.000Z' }),
            observation({ code: 'same-day-mixed', observedAt: '2026-01-01T16:00:00.000Z' }),
            observation({ code: 'same-day-mixed', observedAt: '2026-02-01T08:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(multipleMeasurementsOnOneDayPlusOneLaterDate, []);
});

test('ignores series with only two points or a typical interval over the cap', () => {
    const loops = deriveOpenLoops({
        items: [],
        observations: [
            observation({ code: 'two-points', observedAt: '2026-01-01T00:00:00.000Z' }),
            observation({ code: 'two-points', observedAt: '2026-02-01T00:00:00.000Z' }),
            observation({ code: 'slow-series', observedAt: '2024-01-01T00:00:00.000Z' }),
            observation({ code: 'slow-series', observedAt: '2024-09-01T00:00:00.000Z' }),
            observation({ code: 'slow-series', observedAt: '2025-05-01T00:00:00.000Z' }),
        ],
        now,
    });
    assert.deepEqual(loops, []);
});

test('orders open loops by the date on which the wait became open', () => {
    const loops = deriveOpenLoops({
        items: [item({ id: 'late', createdAt: '2026-06-10T00:00:00.000Z' }), item({ id: 'early', createdAt: '2026-05-01T00:00:00.000Z' })],
        observations: [],
        now,
    });
    assert.deepEqual(
        loops.map((loop) => loop.kind === 'results_pending' ? loop.sourceRef.id : null),
        ['early', 'late'],
    );
});

test('resolves a known LOINC display and groups pending results by prescription', () => {
    const projection = deriveOpenLoopProjection({
        items: [
            item({ id: 'item-2', serviceName: 'Creatinine', codeSystem: 'LOINC', serviceCode: '2160-0' }),
            item({ id: 'item-1', serviceName: 'Glicemia' }),
        ],
        prescriptions: [{ id: 'prescription-1', prescribedAt: '2026-05-30T00:00:00.000Z' }],
        observations: [],
        now,
    });

    assert.equal(projection.groups.length, 1);
    assert.equal(projection.groups[0].prescriptionId, 'prescription-1');
    assert.deepEqual(projection.groups[0].prescribedAt, new Date('2026-05-30T00:00:00.000Z'));
    assert.deepEqual(projection.groups[0].loops.map((loop) => loop.label), ['Creatinina', 'Glicemia']);
    assert.deepEqual(projection.standaloneLoops, []);
});

test('the native open-loop transport preserves Web groups, sources and a read-only receipt', async () => {
    const { readPatientOpenLoopProjection } = await import('./patient-open-loops-read');
    const input = { patientId: 'patient-1', ambulatoryId: 'scope-a', now,
        prescriptions: [{ id: 'prescription-1', prescribedAt: '2026-06-01T00:00:00.000Z' }],
        items: [item()], observations: [observation(), observation({ observedAt: '2026-01-11T00:00:00.000Z' }),
            observation({ observedAt: '2026-01-21T00:00:00.000Z' })] };
    const read = readPatientOpenLoopProjection(input);
    const web = deriveOpenLoopProjection(input);
    assert.equal(read.groups[0].loops[0].label, web.groups[0].loops[0].label);
    assert.equal(read.standaloneLoops[0].label, web.standaloneLoops[0].label);
    assert.deepEqual(read.groups[0].loops[0].source, { type: 'service_prescription_item', id: 'item-1', prescriptionId: 'prescription-1' });
    assert.deepEqual(read.standaloneLoops[0].source, { type: 'observation_series', codeSystem: 'LOINC', code: '2339-0' });
    assert.equal(read.receipt.itemCount, 2);
    assert.equal(read.receipt.outcome, 'read');
    assert.equal(read.receipt.readAt, now.toISOString());
    assert.match(read.receipt.snapshotHash, /^[a-f0-9]{64}$/u);
    assert.deepEqual(input.items[0], item(), 'reading leaves clinical source rows untouched');
    assert.throws(() => readPatientOpenLoopProjection({ ...input, patientId: 'patient-2' }), /scope mismatch/u);
});

test('the paired open-loop route denies either missing read grant before accessing the projection', async () => {
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const ts = await import('typescript');
    const source = readFileSync(new URL('../app/api/v1/network/patients/[id]/open-loops/route.ts', import.meta.url), 'utf8');
    let allowed = true;
    let observationsAllowed = true;
    let reads = 0;
    let found = true;
    const dependencies: Record<string, unknown> = {
        'next/server': { NextResponse: { json: Response.json } },
        '@/lib/network-write-context': { requireNetworkCapabilityContext: async (_request: Request, capability: string) => {
            assert.equal(capability, 'read-prescriptions');
            return allowed ? { ok: true, context: { scopeAmbulatoryId: 'scope-a', pairedClient: {
                grantedCapabilities: observationsAllowed ? ['read-observations'] : [] } } }
                : { ok: false, response: Response.json({}, { status: 403 }) };
        } },

        '@/lib/network-observation-read': { NETWORK_OBSERVATION_READ_CAPABILITY: 'read-observations' },
        '@/lib/service-prescription-write': { NETWORK_SERVICE_PRESCRIPTION_READ_CAPABILITY: 'read-prescriptions', readNetworkPatientOpenLoops: (patient: string, scope: string) => {
            reads++; assert.equal(patient, 'patient-a'); assert.equal(scope, 'scope-a');
            return found ? { patientId: patient, receipt: { outcome: 'read' } } : null;
        } },
    };
    const exports: { GET?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(compiled, { exports, Request, Response, URL, require: (name: string) => {
        assert.ok(name in dependencies, name); return dependencies[name];
    } });
    const request = () => exports.GET!(new Request('http://127.0.0.1/synthetic'), { params: Promise.resolve({ id: 'patient-a' }) });
    allowed = false;
    assert.equal((await request()).status, 403);
    allowed = true; observationsAllowed = false;
    assert.equal((await request()).status, 403);
    assert.equal(reads, 0);
    observationsAllowed = true;
    const success = await request();
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('Cache-Control'), 'no-store');
    found = false;
    assert.equal((await request()).status, 404);
    const cancelled = new AbortController(); cancelled.abort();
    const before = reads;
    assert.equal((await exports.GET!(new Request('http://127.0.0.1/synthetic', { signal: cancelled.signal }), { params: Promise.resolve({ id: 'patient-a' }) })).status, 409);
    assert.equal(reads, before);
});
