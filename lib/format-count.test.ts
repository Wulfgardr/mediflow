import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCountLabel } from './format-count';

test('i conteggi usano il singolare solo per uno e concordano gli aggettivi', () => {
  const cases = [
    ['voce', 'voci'],
    ['modello presente', 'modelli presenti'],
    ['risultato', 'risultati'],
    ['scheda', 'schede'],
    ['documento recente', 'documenti recenti'],
    ['farmaco', 'farmaci'],
    ['codice applicato', 'codici applicati'],
    ['fonte pronta', 'fonti pronte'],
    ['sintesi locale', 'sintesi locali'],
  ];
  for (const [singular, plural] of cases) {
    assert.equal(formatCountLabel(0, singular, plural), `0 ${plural}`);
    assert.equal(formatCountLabel(1, singular, plural), `1 ${singular}`);
    assert.equal(formatCountLabel(2, singular, plural), `2 ${plural}`);
  }
});

test('i conteggi mantengono la separazione delle migliaia italiana dei repertori', () => {
  assert.equal(formatCountLabel(12345, 'codice', 'codici'), '12.345 codici');
});
