import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projectWorklistTodos } from './worklist-todo';

const control = (id: string, patientId = 'a', status = 'pending', date = '2026-10-20T09:00:00Z') => ({ id, patientId, status, date, title: `Controllo ${id}` });

test('una lettura non riuscita non dichiara zero e non conserva dati ritirati', () => {
  const data = [control('1')];
  assert.deepEqual(projectWorklistTodos({ loading: true, error: null, data }), { status: 'loading' });
  assert.deepEqual(projectWorklistTodos({ loading: false, error: Error('negative'), data }), { status: 'error' });
  assert.deepEqual(projectWorklistTodos({ loading: false, error: null, data: undefined }), { status: 'unavailable' });
  assert.deepEqual(projectWorklistTodos({ loading: true, error: Error('previous'), data }), { status: 'loading' });
});

test('zero solo dopo successo; controlli aperti raggruppati senza limite o inferenze cliniche', () => {
  const empty = projectWorklistTodos({ loading: false, error: null, data: [] });
  assert.equal(empty.status, 'ready');
  if (empty.status !== 'ready') throw Error('Missing successful read');
  assert.equal(empty.byPatient.size, 0);
  const data = [control('late', 'a', 'pending', '2026-11-02T09:00:00Z'), control('early'),
    control('other', 'b'), control('done', 'c', 'completed'), control('cancel', 'c', 'cancelled'),
    { ...control('deleted', 'c'), deletedAt: '2026-10-21T10:00:00Z' },
    ...Array.from({ length: 8 }, (_, index) => control(`extra-${index}`, 'many'))];
  const result = projectWorklistTodos({ loading: false, error: null, data });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw Error('Missing successful read');
  assert.deepEqual(result.byPatient.get('a'), { count: 2, next: data[1] });
  assert.deepEqual(result.byPatient.get('b'), { count: 1, next: data[2] });
  assert.equal(result.byPatient.has('c'), false);
  assert.equal(result.byPatient.get('many')?.count, 8);
  assert.equal(data[0].id, 'late');
});

test('stato sconosciuto o data invalida non diventano un controllo aperto inventato', () => {
  const result = projectWorklistTodos({ loading: false, error: null, data: [control('unknown', 'a', 'unknown'), control('bad-date', 'b', 'pending', 'invalid')] });
  assert.equal(result.status, 'unavailable');
});
