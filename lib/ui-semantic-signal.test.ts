/* @Codex */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agendaFilterMatches,
  catalogMatchStatusSignal,
  catalogFreshnessSignal,
  resolveSemanticSignal,
  sharedKillSwitchSignal,
  smartImportReviewStateSignal,
  therapySuggestionStateSignal,
} from './ui-semantic-signal.ts';

test('preserva i segnali clinici della freshness', () => {
  assert.equal(catalogFreshnessSignal('fresh'), 'success');
  assert.equal(catalogFreshnessSignal('stale'), 'warning');
  assert.equal(catalogFreshnessSignal('broken'), 'critical');
  assert.equal(catalogFreshnessSignal('off'), 'neutral');
  assert.equal(catalogFreshnessSignal('n-a'), 'neutral');
});

test('separa incertezza epistemica e transizione operativa', () => {
  assert.equal(therapySuggestionStateSignal('uncertain'), 'neutral');
  assert.equal(therapySuggestionStateSignal('transition'), 'warning');
  assert.equal(smartImportReviewStateSignal('uncertain'), 'neutral');
  assert.equal(smartImportReviewStateSignal('new'), 'neutral');
  assert.equal(smartImportReviewStateSignal('update'), 'warning');
});

test('rende critico un kill-switch che blocca la funzione', () => {
  assert.equal(sharedKillSwitchSignal(false), 'critical');
  assert.equal(sharedKillSwitchSignal(true), 'success');
});

test('mantiene da codificare in warning anche senza corrispondenza di catalogo', () => {
  assert.equal(catalogMatchStatusSignal('matched'), 'success');
  assert.equal(catalogMatchStatusSignal('unmatched'), 'warning');
  assert.equal(catalogMatchStatusSignal('not_found'), 'warning');
  assert.equal(catalogMatchStatusSignal('candidate'), 'neutral');
  assert.equal(catalogMatchStatusSignal('manual'), 'neutral');
});

test('mantiene gli alias legacy senza neutralizzare i segnali', () => {
  assert.equal(resolveSemanticSignal('blue'), 'neutral');
  assert.equal(resolveSemanticSignal('green'), 'success');
  assert.equal(resolveSemanticSignal('yellow'), 'warning');
  assert.equal(resolveSemanticSignal('coral'), 'critical');
  assert.equal(resolveSemanticSignal('violet'), 'plum');
});

test('filtra l agenda per categoria operativa e non per tono visivo', () => {
  assert.equal(agendaFilterMatches('urgent', 'urgent'), true);
  assert.equal(agendaFilterMatches('urgent', 'manual'), false);
  assert.equal(agendaFilterMatches('ai', 'ai'), true);
  assert.equal(agendaFilterMatches('manual', 'manual'), true);
  assert.equal(agendaFilterMatches('all', 'ai'), true);
});
