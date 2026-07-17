import test from 'node:test';
import assert from 'node:assert/strict';
import { createDbChangeBus } from './live-query-scope';

/* @Codex */
test('a table notification wakes only matching and unscoped subscribers', () => {
    const bus = createDbChangeBus();
    let patientInvalidations = 0;
    let observationInvalidations = 0;
    let globalInvalidations = 0;

    bus.subscribe(() => { patientInvalidations += 1; }, ['patients']);
    bus.subscribe(() => { observationInvalidations += 1; }, ['observations']);
    bus.subscribe(() => { globalInvalidations += 1; });

    bus.notify('observations');

    assert.equal(patientInvalidations, 0);
    assert.equal(observationInvalidations, 1);
    assert.equal(globalInvalidations, 1);
});

test('an unscoped notification wakes every subscriber', () => {
    const bus = createDbChangeBus();
    let patientInvalidations = 0;
    let observationInvalidations = 0;
    let globalInvalidations = 0;

    bus.subscribe(() => { patientInvalidations += 1; }, ['patients']);
    bus.subscribe(() => { observationInvalidations += 1; }, ['observations']);
    bus.subscribe(() => { globalInvalidations += 1; });

    bus.notify();

    assert.equal(patientInvalidations, 1);
    assert.equal(observationInvalidations, 1);
    assert.equal(globalInvalidations, 1);
});
