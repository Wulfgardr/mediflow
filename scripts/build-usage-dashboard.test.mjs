// @Codex
import assert from 'node:assert/strict';
import test from 'node:test';
import { chartSeries, renderSvg, renderTables, replaceBlock, validate } from './build-usage-dashboard.mjs';

function fixture() {
  const row = (date, environment, provider, model, effort, tokens) => ({ date, environment, provider, model, effort, tokens });
  return {
    schemaVersion: 1, snapshotDate: '2026-09-27', scope: 'all-local-projects', historySource: 'CodexBar 0.60.3', historyDaysRequested: 365,
    environments: [
      { environment: 'codex', from: '2026-07-01', to: '2026-09-01', historyCoverageEstablished: false, totalTokens: 900, cacheReadTokens: 800 },
      { environment: 'claude', from: '2026-07-01', to: '2026-07-01', historyCoverageEstablished: true, totalTokens: 100, cacheReadTokens: 70 },
    ],
    effortSource: { method: 'unique-codex-response-usage-with-matching-turn-context', timezone: 'Europe/Rome', from: '2026-09-01', to: '2026-09-01', totalTokens: 80, responseRecords: 1, missingFiles: 2, completeHistory: false },
    history: [
      row('2026-07-01', 'codex', 'OpenAI', 'gpt-6-astra', 'unknown', 600),
      row('2026-09-01', 'codex', 'OpenAI', 'gpt-6-sol', 'unknown', 300),
      row('2026-07-01', 'claude', 'OpenAI', 'gpt-5.6-sol', 'unknown', 100),
    ],
    effort: [row('2026-09-01', 'codex', 'OpenAI', 'gpt-6-astra', 'medium', 80)],
  };
}

test('cross-environment model provider is retained; independent effort is not added to history', () => {
  const d = fixture(); validate(d);
  const svg = renderSvg(d), tables = renderTables(d);
  assert.match(svg, /1\.000 token CodexBar/);
  assert.doesNotMatch(svg, /1\.080 token CodexBar/);
  assert.match(tables, /Serie separata/);
  const s = chartSeries(d.history, 'provider');
  assert.deepEqual(s.categories, ['OpenAI']);
  assert.equal(s.groups.get('2026-07').get('OpenAI'), 700);
});

test('monthly gaps stay visible and top-model remainder retains all tokens', () => {
  const s = chartSeries(fixture().history, 'model', false, 1);
  assert.deepEqual(s.periods, ['2026-07', '2026-08', '2026-09']);
  assert.equal(s.observed.has('2026-08'), false);
  assert.equal(s.groups.get('2026-07').get('gpt-6-astra'), 600);
  assert.equal(s.groups.get('2026-07').get('Altri modelli'), 100);
  assert.equal(s.groups.get('2026-09').get('Altri modelli'), 300);
});

test('public schema rejects private fields and unreviewed model labels', () => {
  for (const mutate of [
    (d) => { d.prompt = 'private'; },
    (d) => { d.history[0].thread_id = 'private'; },
    (d) => { d.environments[0].localPath = '/private'; },
    (d) => { d.history[0].model = 'private-model-label'; },
  ]) {
    const d = fixture(); mutate(d); assert.throws(() => validate(d));
  }
});

test('wrong totals, duplicate rows, impossible dates and inferred effort fail closed', () => {
  for (const mutate of [
    (d) => { d.history[0].tokens += 1; },
    (d) => { d.history.push({ ...d.history[0] }); },
    (d) => { d.history[0].tokens = '600'; },
    (d) => { d.history[0].tokens = -1; },
    (d) => { d.history[0].date = '2026-02-30'; },
    (d) => { d.history[0].effort = 'ultra'; },
    (d) => { d.history[0].provider = 'Anthropic'; },
    (d) => { d.effortSource.totalTokens = 81; },
  ]) {
    const d = fixture(); mutate(d); assert.throws(() => validate(d));
  }
});

test('unknown effort remains distinct from a recorded none value', () => {
  const d = fixture();
  d.effort[0].effort = 'unknown'; validate(d);
  assert.match(renderTables(d), /Non registrato \| 80/);
  d.effort[0].effort = 'none'; validate(d);
  assert.match(renderTables(d), /none \| 80/);
});

test('publication replaces only one explicitly delimited table block', () => {
  const a = '<!-- usage-dashboard:start -->', b = '<!-- usage-dashboard:end -->';
  assert.equal(replaceBlock(`Before\n${a}old${b}\nAfter`, `${a}new${b}`), `Before\n${a}new${b}\nAfter`);
  assert.throws(() => replaceBlock('No markers', 'new'));
  assert.throws(() => replaceBlock(`${a}${a}${b}`, 'new'));
  assert.throws(() => replaceBlock(`${b}${a}`, 'new'));
});
