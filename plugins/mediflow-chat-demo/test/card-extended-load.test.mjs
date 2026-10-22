import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extendedCardLoad } from './card-extended-load.mjs';
test('extended ADR load fixture is ready, never a substitute broker result', () => {
  const load = extendedCardLoad();
  assert.equal(load.history.length, 100); assert.equal(load.therapies.length, 30); assert.equal(load.documents.length, 10);
});
test.todo('Extended broker workload: admit 100 events / 30 therapies / 10 documents, then run the same reference budgets; NOT QUALIFIED');
