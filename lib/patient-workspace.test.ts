import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCheckupsForKree8, type Kree8CheckupSource, type Kree8Patient } from './patient-workspace';

/* @Codex The agenda keyed its rows on `time + title`, and the row type did not
   carry the checkup id at all. Two patients seen at the same hour for the same
   reason — an ordinary morning in a clinic — produced one key, and React's
   documented behaviour for duplicate keys is that children may be duplicated or
   omitted. An appointment silently missing from a clinical agenda is not a
   rendering detail, so identity is asserted here rather than left to review. */

const inTwoHours = () => {
    const date = new Date();
    date.setHours(date.getHours() + 2, 0, 0, 0);
    return date;
};

function patient(id: string, name: string): Kree8Patient {
    return { id, name, code: `CF-${id}` } as Kree8Patient;
}

function checkup(id: string, patientId: string, date: Date): Kree8CheckupSource {
    return { id, patientId, date, title: 'Controllo', status: 'pending' };
}

test('due appuntamenti identici per ora e titolo restano due righe distinte', () => {
    const when = inTwoHours();
    const rows = mapCheckupsForKree8(
        [checkup('checkup-a', 'p1', when), checkup('checkup-b', 'p2', when)],
        [patient('p1', 'Anna Rossi'), patient('p2', 'Marco Bianchi')],
    );

    assert.equal(rows.length, 2, 'nessuna riga deve sparire');
    assert.deepEqual(rows.map((row) => row.id), ['checkup-a', 'checkup-b']);

    // The property that matters: the keys the list renders with are distinct.
    assert.equal(new Set(rows.map((row) => row.id)).size, 2);
    // And the old key would not have been. This is what the test is guarding.
    assert.equal(new Set(rows.map((row) => row.time + row.title)).size, 1);
});

test("l'identificatore della riga e quello del controllo, non un indice", () => {
    const rows = mapCheckupsForKree8(
        [checkup('checkup-xyz', 'p1', inTwoHours())],
        [patient('p1', 'Anna Rossi')],
    );
    assert.equal(rows[0].id, 'checkup-xyz');
});
