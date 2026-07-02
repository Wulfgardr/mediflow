import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyObservationRange,
    formatReferenceRange,
    isObservationOutOfRange,
    toNumericValue,
} from './observation-range';

test('toNumericValue never coerces null/undefined/empty to 0', () => {
    assert.equal(toNumericValue(null), null);
    assert.equal(toNumericValue(undefined), null);
    assert.equal(toNumericValue(''), null);
    assert.equal(toNumericValue('  '), null);
    assert.equal(toNumericValue(12), 12);
    assert.equal(toNumericValue('12.5'), 12.5);
    assert.equal(toNumericValue('12,5'), 12.5); // virgola decimale italiana
    assert.equal(toNumericValue('120/80'), null);
    assert.equal(toNumericValue('positivo'), null);
    assert.equal(toNumericValue(Number.NaN), null);
});

test('classifyObservationRange returns null when both bounds are absent', () => {
    assert.equal(classifyObservationRange(150, null, null), null);
    assert.equal(classifyObservationRange(150, undefined, undefined), null);
    assert.equal(classifyObservationRange(150, '', ''), null);
});

test('classifyObservationRange returns null for non-numeric value even with bounds', () => {
    assert.equal(classifyObservationRange('positivo', '10', '20'), null);
    assert.equal(classifyObservationRange('120/80', '10', '20'), null);
});

test('classifyObservationRange flags alto/basso with two numeric bounds', () => {
    assert.equal(classifyObservationRange(25, '10', '20'), 'alto');
    assert.equal(classifyObservationRange(5, '10', '20'), 'basso');
    assert.equal(classifyObservationRange(15, '10', '20'), null); // in range
    assert.equal(classifyObservationRange(10, '10', '20'), null); // sul bound, incluso
    assert.equal(classifyObservationRange(20, '10', '20'), null);
});

test('classifyObservationRange supports unilateral bounds (e.g. < 200)', () => {
    // solo refHigh: flag solo alto, mai basso (refLow null non diventa 0)
    assert.equal(classifyObservationRange(250, null, '200'), 'alto');
    assert.equal(classifyObservationRange(150, null, '200'), null);
    assert.equal(classifyObservationRange(-5, null, '200'), null); // niente falso "basso"
    // solo refLow: flag solo basso
    assert.equal(classifyObservationRange(3, '5', null), 'basso');
    assert.equal(classifyObservationRange(9, '5', null), null);
});

test('isObservationOutOfRange mirrors classify', () => {
    assert.equal(isObservationOutOfRange(25, '10', '20'), true);
    assert.equal(isObservationOutOfRange(15, '10', '20'), false);
    assert.equal(isObservationOutOfRange(15, null, null), false);
});

test('formatReferenceRange is null-safe and never prints null', () => {
    assert.equal(formatReferenceRange('10', '20'), '10-20');
    assert.equal(formatReferenceRange(null, '200'), '< 200');
    assert.equal(formatReferenceRange('5', null), '> 5');
    assert.equal(formatReferenceRange(null, null, 'Negativo'), 'Negativo');
    assert.equal(formatReferenceRange(null, null), '');
    // bound presente vince sul refText
    assert.equal(formatReferenceRange(null, '200', 'qualcosa'), '< 200');
});
