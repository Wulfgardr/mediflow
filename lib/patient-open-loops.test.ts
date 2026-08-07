/* @Codex */
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
