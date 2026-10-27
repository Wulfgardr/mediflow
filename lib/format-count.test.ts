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
    ['diagnosi pronta', 'diagnosi pronte'],
    ['file non inviato', 'file non inviati'],
    ['anno', 'anni'],
  ];
  for (const [singular, plural] of cases) {
    assert.equal(formatCountLabel(0, singular, plural), `0 ${plural}`);
    assert.equal(formatCountLabel(1, singular, plural), `1 ${singular}`);
    assert.equal(formatCountLabel(2, singular, plural), `2 ${plural}`);
    assert.equal(formatCountLabel(21, singular, plural), `21 ${plural}`);
  }
});

test('i conteggi mantengono la separazione delle migliaia italiana dei repertori', () => {
  assert.equal(formatCountLabel(12345, 'codice', 'codici'), '12.345 codici');
});

test('le frasi concordano verbo e nome senza cambiare il conteggio', () => {
  const expected = ['Verranno aggiunte solo 0 righe valide.', 'Verrà aggiunta solo 1 riga valida.',
    'Verranno aggiunte solo 2 righe valide.', 'Verranno aggiunte solo 21 righe valide.'];
  for (const [index, count] of [0, 1, 2, 21].entries()) {
    assert.equal(formatCountLabel(count, 'Verrà aggiunta solo {count} riga valida.',
      'Verranno aggiunte solo {count} righe valide.', { template: true }), expected[index]);
  }
  assert.equal(formatCountLabel(1, 'Un altro file non mostrato.', 'Altri {count} file non mostrati.',
    { template: true }), 'Un altro file non mostrato.');
  assert.equal(formatCountLabel(12345, 'Rimosso {count} file', 'Rimossi {count} file',
    { template: true }), 'Rimossi 12.345 file');
});
