import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_CLINICAL_ALERTS,
    selectMostUrgentAlerts,
    type ClinicalAlert,
} from './use-clinical-alerts';

function makeAlert(id: string, severity: ClinicalAlert['severity']): ClinicalAlert {
    return {
        id,
        patientId: `patient-${id}`,
        patientName: `Paziente ${id}`,
        type: 'inactive',
        message: `Alert sintetico ${id}`,
        severity,
    };
}

test('a high alert generated last survives the cap over earlier medium alerts', () => {
    const alerts: ClinicalAlert[] = [
        makeAlert('m1', 'medium'),
        makeAlert('m2', 'medium'),
        makeAlert('m3', 'medium'),
        makeAlert('m4', 'medium'),
        makeAlert('m5', 'medium'),
        makeAlert('m6', 'medium'),
        makeAlert('h1', 'high'),
    ];

    const selected = selectMostUrgentAlerts(alerts);

    assert.equal(selected.length, MAX_CLINICAL_ALERTS);
    assert.equal(selected[0]?.id, 'h1');
    assert.ok(
        selected.some(alert => alert.id === 'h1'),
        'the high alert must never be dropped in favour of a medium one',
    );
});

test('every high alert outranks every medium alert regardless of generation order', () => {
    const alerts: ClinicalAlert[] = [
        makeAlert('m1', 'medium'),
        makeAlert('m2', 'medium'),
        makeAlert('h1', 'high'),
        makeAlert('m3', 'medium'),
        makeAlert('m4', 'medium'),
        makeAlert('h2', 'high'),
        makeAlert('m5', 'medium'),
        makeAlert('h3', 'high'),
    ];

    const selected = selectMostUrgentAlerts(alerts);

    assert.deepEqual(
        selected.map(alert => alert.id),
        ['h1', 'h2', 'h3', 'm1', 'm2'],
    );
});

test('alerts of equal severity keep the order in which they were generated', () => {
    const alerts = ['a', 'b', 'c', 'd'].map(id => makeAlert(id, 'medium'));

    assert.deepEqual(
        selectMostUrgentAlerts(alerts).map(alert => alert.id),
        ['a', 'b', 'c', 'd'],
    );
});

test('the selection is capped and leaves the input list untouched', () => {
    const alerts: ClinicalAlert[] = [
        makeAlert('m1', 'medium'),
        makeAlert('m2', 'medium'),
        makeAlert('h1', 'high'),
        makeAlert('m3', 'medium'),
        makeAlert('m4', 'medium'),
        makeAlert('m5', 'medium'),
    ];
    const originalOrder = alerts.map(alert => alert.id);

    const selected = selectMostUrgentAlerts(alerts);

    assert.equal(selected.length, MAX_CLINICAL_ALERTS);
    assert.deepEqual(alerts.map(alert => alert.id), originalOrder);
});

test('a list shorter than the cap is returned whole', () => {
    const alerts: ClinicalAlert[] = [makeAlert('m1', 'medium'), makeAlert('h1', 'high')];

    assert.deepEqual(
        selectMostUrgentAlerts(alerts).map(alert => alert.id),
        ['h1', 'm1'],
    );
});

/**
 * The ordering contract must hold for every shape of input, not just for the
 * hand-picked ones above: the previous comparator ignored its second argument,
 * so the outcome was decided by the sort algorithm rather than by severity.
 */
test('the ordering contract holds for every arrangement of severities', () => {
    for (let size = 1; size <= 12; size += 1) {
        for (let mask = 0; mask < (1 << size); mask += 1) {
            const alerts = Array.from({ length: size }, (_unused, index) =>
                makeAlert(String(index), ((mask >> index) & 1) === 1 ? 'high' : 'medium'));
            const shape = alerts.map(alert => alert.severity).join(',');

            const selected = selectMostUrgentAlerts(alerts);
            const expected = [
                ...alerts.filter(alert => alert.severity === 'high'),
                ...alerts.filter(alert => alert.severity === 'medium'),
            ].slice(0, MAX_CLINICAL_ALERTS);

            assert.deepEqual(
                selected.map(alert => alert.id),
                expected.map(alert => alert.id),
                `wrong order for [${shape}]`,
            );
            assert.equal(
                selected.filter(alert => alert.severity === 'high').length,
                Math.min(alerts.filter(alert => alert.severity === 'high').length, MAX_CLINICAL_ALERTS),
                `a high alert was dropped for [${shape}]`,
            );
        }
    }
});
