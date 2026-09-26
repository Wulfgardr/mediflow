/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const context = vm.createContext({});
for (const file of ['cases.js', 'model.js']) vm.runInContext(readFileSync(resolve(here, file), 'utf8'), context);
const examples = context.MediFlowSyntheticCases;
const model = context.MediFlowReviewModel;

test('two invented cases retain dated, versioned original sources and distinct medication states', () => {
  assert.equal(examples.length, 2);
  for (const example of examples) {
    assert.ok(example.sources.length >= 3);
    assert.ok(example.sources.every((source) => source.date && source.version && source.quote));
    assert.ok(example.medicines.some((medicine) => medicine.status === 'In conflitto'));
    assert.ok(example.medicines.some((medicine) => medicine.status === 'Stato attuale ignoto'
      && /non documenta una sospensione/u.test(medicine.detail)));
  }
});

test('failed preparation preserves edits; selected source creates proposal only', () => {
  let state = model.create(examples[0]);
  state = model.edit(state, 'note', 'Chiarire dose e frequenza prima di aggiornare la scheda.');
  state = model.prepare(state);
  assert.equal(state.phase, 'failed');
  assert.match(state.draft.note, /Chiarire/u);
  state = model.chooseSource(state, 'a-discharge', true);
  state = model.prepare(state);
  assert.equal(state.phase, 'proposed');
  assert.match(state.message, /Nessuna terapia è stata modificata/u);
  assert.equal(state.draft.dose, '');
  assert.equal(state.draft.frequency, '');
  assert.equal(model.edit(state, 'note', 'Nuova verifica').phase, 'idle');
  assert.equal(model.chooseSource(state, 'a-report', true).phase, 'idle');
});

test('stale source and conflict retain draft and source selection without apply', () => {
  let state = model.create(examples[0]);
  state = model.chooseSource(state, 'a-discharge', true);
  state = model.edit(state, 'dose', 'da verificare');
  state = model.edit(state, 'note', 'Confrontare la confezione con le fonti.');
  state = model.prepare(state);
  state = model.changeSource(state);
  assert.equal(state.phase, 'stale');
  assert.equal(state.example.sources[0].version, '3');
  state = model.check(state);
  assert.equal(state.phase, 'conflict');
  assert.equal(state.draft.dose, 'da verificare');
  assert.equal(state.selectedSources[0], 'a-discharge');
  state = model.acknowledgeUpdatedSource(state);
  assert.equal(state.phase, 'idle');
  assert.equal(state.draft.note, 'Confrontare la confezione con le fonti.');
  assert.equal(model.prepare(state).phase, 'proposed');
});

test('cancellation is reversible; a different case has independent initial state', () => {
  let state = model.create(examples[1]);
  state = model.chooseSource(state, 'b-letter', true);
  state = model.edit(state, 'note', 'Dose non confermata.');
  const prior = model.prepare(state);
  const cancelled = model.cancel(prior);
  assert.equal(cancelled.phase, 'cancelled');
  const restored = model.undoCancel(cancelled);
  assert.equal(restored.phase, 'proposed');
  assert.equal(restored.draft.note, 'Dose non confermata.');
  assert.equal(restored.selectedSources[0], 'b-letter');
  const other = model.create(examples[0]);
  assert.equal(other.selectedSources.length, 0);
  assert.equal(other.draft.note, '');
});

test('isolated prototype has no network, storage or clinical write path', () => {
  for (const file of ['app.js', 'model.js', 'cases.js']) {
    const code = readFileSync(resolve(here, file), 'utf8');
    assert.doesNotMatch(code, /\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/u);
  }
  assert.equal(Object.keys(model).some((name) => /commit|apply|write|save/u.test(name)), false);
});
