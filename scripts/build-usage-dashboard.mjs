#!/usr/bin/env node
// @Codex: publication renderer; reads only the sanitized aggregate snapshot.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- usage-dashboard:start -->';
const END = '<!-- usage-dashboard:end -->';
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'unknown'];
const MODELS = new Set([
  'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4',
  'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra',
  'gpt-6-luna', 'gpt-6-sol', 'gpt-daybreak-blue-latest', 'gpt-reserve', 'codex-auto-review',
  'claude-fable-5', 'claude-haiku-4-5', 'claude-opus-4-7', 'claude-opus-4-8',
  'claude-opus-5', 'claude-sonnet-5', 'devstral-gguf', 'qwen25-coder:14b-q4',
  'qwen3-coder:30b-a3b-q4', 'qwen3.6:35b-a3b', 'qwen36-mlx', 'qwen3coder30:latest',
  'chatgpt-web/extra-high', 'chatgpt-web/high', 'chatgpt-web/pro', 'unknown',
]);
const COLORS = ['#315875', '#b75e3d', '#7266a1', '#38867f', '#ab8141', '#657b45', '#9c6583', '#626e86', '#b5b1a8'];
const integer = (n) => new Intl.NumberFormat('it-IT', { useGrouping: 'always' }).format(n);
const compact = (n) => n >= 1e9 ? `${(n / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} mld` : n >= 1e6 ? `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} mln` : integer(n);
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const label = (s) => s === 'unknown' ? 'Non registrato' : s;
const sum = (rows) => rows.reduce((n, r) => {
  const next = n + r.tokens;
  assert(Number.isSafeInteger(next), 'Token total overflow');
  return next;
}, 0);
function keys(value, names) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'Unexpected or missing public field');
}
function token(n) { assert(Number.isSafeInteger(n) && n >= 0, 'Invalid token count'); }
function date(s) {
  assert(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s), 'Invalid date');
  assert.equal(new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10), s, 'Invalid calendar date');
}
export function providerFor(model) {
  if (model.startsWith('gpt-') || model === 'codex-auto-review') return 'OpenAI';
  if (model.startsWith('claude-')) return 'Anthropic';
  return 'Non determinato';
}
export function validate(data) {
  keys(data, ['schemaVersion', 'snapshotDate', 'scope', 'historySource', 'historyDaysRequested', 'environments', 'effortSource', 'history', 'effort']);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.scope, 'all-local-projects');
  assert.match(data.historySource, /^CodexBar \d+\.\d+\.\d+$/);
  assert(Number.isInteger(data.historyDaysRequested) && data.historyDaysRequested > 0 && data.historyDaysRequested <= 365);
  date(data.snapshotDate);
  for (const name of ['history', 'effort']) {
    const seen = new Set();
    assert(Array.isArray(data[name]) && data[name].length, `Missing ${name}`);
    for (const r of data[name]) {
      keys(r, ['date', 'environment', 'provider', 'model', 'effort', 'tokens']);
      date(r.date); assert(r.date <= data.snapshotDate, 'Future data'); token(r.tokens);
      assert(['codex', 'claude'].includes(r.environment), 'Unknown environment');
      assert(MODELS.has(r.model), 'Review new model identifiers before publishing');
      assert.equal(r.provider, providerFor(r.model), 'Inconsistent provider inference');
      assert(EFFORTS.includes(r.effort), 'Unknown effort');
      if (name === 'history') assert.equal(r.effort, 'unknown', 'CodexBar has no effort dimension');
      else assert.equal(r.environment, 'codex', 'Response series covers Codex only');
      const key = [r.date, r.environment, r.model, r.effort].join('|');
      assert(!seen.has(key), 'Duplicate aggregate'); seen.add(key);
    }
  }
  assert(Array.isArray(data.environments) && data.environments.length === 2);
  assert.deepEqual(data.environments.map((x) => x.environment).sort(), ['claude', 'codex']);
  for (const source of data.environments) {
    keys(source, ['environment', 'from', 'to', 'historyCoverageEstablished', 'totalTokens', 'cacheReadTokens']);
    assert.equal(typeof source.historyCoverageEstablished, 'boolean');
    token(source.totalTokens); token(source.cacheReadTokens);
    assert(source.cacheReadTokens <= source.totalTokens);
    const rows = data.history.filter((r) => r.environment === source.environment);
    assert.equal(sum(rows), source.totalTokens, 'History does not reconcile');
    const dates = rows.map((r) => r.date).sort();
    assert.equal(dates[0], source.from); assert.equal(dates.at(-1), source.to);
  }
  const e = data.effortSource;
  keys(e, ['method', 'timezone', 'from', 'to', 'totalTokens', 'responseRecords', 'missingFiles', 'completeHistory']);
  assert.equal(e.method, 'unique-codex-response-usage-with-matching-turn-context');
  assert.equal(e.timezone, 'Europe/Rome'); assert.equal(e.completeHistory, false);
  token(e.totalTokens); token(e.responseRecords); token(e.missingFiles);
  assert.equal(sum(data.effort), e.totalTokens, 'Effort series does not reconcile');
  const dates = data.effort.map((r) => r.date).sort();
  assert.equal(dates[0], e.from); assert.equal(dates.at(-1), e.to);
  return data;
}

function totals(rows, dimension) {
  const groups = new Map();
  for (const r of rows) groups.set(r[dimension], (groups.get(r[dimension]) ?? 0) + r.tokens);
  return [...groups].sort((a, b) => b[1] - a[1]);
}
function periodsBetween(from, to, daily) {
  const result = [];
  const d = new Date(`${from.slice(0, daily ? 10 : 7)}${daily ? '' : '-01'}T00:00:00Z`);
  const last = to.slice(0, daily ? 10 : 7);
  while (d.toISOString().slice(0, daily ? 10 : 7) <= last) {
    result.push(d.toISOString().slice(0, daily ? 10 : 7));
    if (daily) d.setUTCDate(d.getUTCDate() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return result;
}
export function chartSeries(rows, dimension, daily = false, top = Infinity) {
  const ranking = totals(rows, dimension).map(([name]) => name);
  const categories = dimension === 'effort' ? EFFORTS.filter((e) => ranking.includes(e)) : ranking.slice(0, top);
  const other = ranking.length > top;
  if (other) categories.push('Altri modelli');
  const dates = rows.map((r) => r.date).sort();
  const periods = periodsBetween(dates[0], dates.at(-1), daily);
  const groups = new Map(periods.map((p) => [p, new Map(categories.map((c) => [c, 0]))]));
  const observed = new Set();
  for (const r of rows) {
    const period = r.date.slice(0, daily ? 10 : 7);
    const c = categories.includes(r[dimension]) ? r[dimension] : 'Altri modelli';
    const group = groups.get(period);
    group.set(c, group.get(c) + r.tokens); observed.add(period);
  }
  return { categories, periods, groups, observed };
}
function text(x, y, value, cls = 'body', extra = '') {
  return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${escape(value)}</text>`;
}
function panel(y, title, subtitle, rows, dimension, daily = false, top = Infinity) {
  const { categories, periods, groups, observed } = chartSeries(rows, dimension, daily, top);
  const left = 96, width = 838, height = 174, chartTop = y + 88, bottom = chartTop + height;
  const maximum = Math.max(...[...groups.values()].map((g) => [...g.values()].reduce((a, b) => a + b, 0)), 1);
  const slot = width / periods.length, bar = Math.min(slot * 0.66, 68);
  let out = `<rect x="32" y="${y}" width="936" height="386" rx="20" class="panel"/>`;
  out += text(56, y + 32, title, 'section') + text(56, y + 55, subtitle, 'muted');
  for (let i = 0; i <= 4; i++) {
    const gy = bottom - height * i / 4;
    out += `<line x1="${left}" x2="934" y1="${gy}" y2="${gy}" class="grid"/>`;
    out += text(left - 12, gy + 4, i ? compact(maximum * i / 4) : '0', 'axis', 'text-anchor="end"');
  }
  periods.forEach((p, index) => {
    const x = left + slot * index + (slot - bar) / 2;
    let base = bottom;
    if (!observed.has(p)) out += text(x + bar / 2, bottom - 6, 'n.d.', 'axis', 'text-anchor="middle"');
    categories.forEach((c, ci) => {
      const tokens = groups.get(p).get(c), h = tokens * height / maximum;
      if (tokens) out += `<rect x="${x.toFixed(2)}" y="${(base - h).toFixed(2)}" width="${bar.toFixed(2)}" height="${h.toFixed(3)}" fill="${COLORS[ci % COLORS.length]}"><title>${escape(`${p} · ${label(c)}: ${integer(tokens)} token`)}</title></rect>`;
      base -= h;
    });
    if (!daily || index % 4 === 0 || index === periods.length - 1) {
      const display = daily ? p.slice(8) : new Date(`${p}-01T00:00:00Z`).toLocaleDateString('it-IT', { month: 'short', timeZone: 'UTC' });
      out += text(x + bar / 2, bottom + 20, display, 'axis', 'text-anchor="middle"');
    }
  });
  categories.forEach((c, i) => {
    const x = 56 + (i % 3) * 300, cy = y + 317 + Math.floor(i / 3) * 23;
    out += `<rect x="${x}" y="${cy - 10}" width="11" height="11" rx="3" fill="${COLORS[i % COLORS.length]}"/>` + text(x + 18, cy, label(c), 'legend');
  });
  return out;
}
export function renderSvg(data) {
  validate(data);
  const total = sum(data.history);
  const from = data.history.map((r) => r.date).sort()[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400" role="img" aria-labelledby="title desc">
<title id="title">Sviluppo assistito: storico dei token, snapshot ${data.snapshotDate}</title>
<desc id="desc">Aggregati di tutti i progetti locali. ${integer(total)} token CodexBar; provider dedotto dal nome del modello. Il grafico effort usa una serie distinta e parziale di risposte Codex, non sommabile al totale. Tabelle esatte in docs/development-usage.md.</desc>
<style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;fill:#242b31}.title{font-size:27px;font-weight:700}.section{font-size:18px;font-weight:650}.body{font-size:14px}.muted{font-size:13px;fill:#59656b}.axis{font-size:11px;fill:#647078}.legend{font-size:12px}.panel{fill:#fffdfa;stroke:#deded6}.grid{stroke:#e3e4dd;stroke-width:1}</style>
<rect width="1000" height="1400" rx="24" fill="#f3f3ed"/>
${text(42, 49, 'Sviluppo assistito, nel tempo', 'title')}
${text(42, 77, `Snapshot ${data.snapshotDate} · log dal ${from} · tutti i progetti locali`, 'muted')}
${text(958, 49, compact(total) + ' token', 'section', 'text-anchor="end"')}
${text(42, 105, 'Contesto elaborato, cache inclusa. Non è il costo né il consumo esclusivo di MediFlow.', 'body')}
${panel(128, '01  Provider del modello · per mese', 'CodexBar · attribuzione dal nome; ambiente Codex e Claude Code conservato nei dati', data.history, 'provider')}
${panel(530, '02  Modelli · per mese', 'CodexBar · otto identificatori principali; tutti gli altri sono inclusi in «Altri modelli»', data.history, 'model', false, 8)}
${panel(932, '03  Effort registrato · per giorno', `Solo risposte individuali Codex · ${data.effortSource.from} → ${data.effortSource.to} · ${compact(data.effortSource.totalTokens)} token`, data.effort, 'effort', true)}
${text(42, 1352, 'La serie effort è parziale e separata: non si somma allo storico CodexBar. n.d. = nessun record disponibile.', 'muted')}
${text(42, 1376, 'Fonti, copertura, conteggi esatti e matrice modello × effort sono nella pagina di approfondimento.', 'muted')}
</svg>\n`;
}

export function renderTables(data) {
  validate(data);
  const monthly = (rows, dimension) => {
    const s = chartSeries(rows, dimension);
    const header = `| ${dimension === 'provider' ? 'Provider dedotto' : 'Identificatore modello'} | ${s.periods.join(' | ')} | Totale |\n| :-- | ${s.periods.map(() => '--:').join(' | ')} | --: |\n`;
    return header + totals(rows, dimension).map(([name, total]) => `| ${label(name)} | ${s.periods.map((p) => integer(s.groups.get(p).get(name) ?? 0)).join(' | ')} | ${integer(total)} |`).join('\n');
  };
  const pair = new Map();
  for (const r of data.effort) {
    const key = `${r.provider} | ${r.model} | ${label(r.effort)}`;
    pair.set(key, (pair.get(key) ?? 0) + r.tokens);
  }
  return `${START}\n\nSnapshot: **${data.snapshotDate}**. Token storici CodexBar: **${integer(sum(data.history))}**.\n\n` +
    '| Ambiente che registra | Periodo disponibile | Token | Cache letta (inclusa) | Copertura attestata dalla fonte |\n| :-- | :-- | --: | --: | :-- |\n' +
    data.environments.map((e) => `| ${e.environment === 'codex' ? 'Codex' : 'Claude Code'} | ${e.from} → ${e.to} | ${integer(e.totalTokens)} | ${integer(e.cacheReadTokens)} | ${e.historyCoverageEstablished ? 'Sì, per i log disponibili' : 'No: completezza sconosciuta'} |`).join('\n') +
    '\n\n### Storico mensile per provider\n\n' + monthly(data.history, 'provider') +
    '\n\n### Storico mensile completo per modello\n\nValori zero indicano assenza di token registrati, non prova di mancato utilizzo. L’ultimo mese è parziale.\n\n' + monthly(data.history, 'model') +
    `\n\n### Provider, modello ed effort registrato\n\nSerie separata: **${data.effortSource.from} → ${data.effortSource.to}**, **${integer(data.effortSource.totalTokens)} token** in **${integer(data.effortSource.responseRecords)} risposte**. ${integer(data.effortSource.missingFiles)} file indicizzati non erano disponibili: la copertura non è completa.\n\n` +
    '| Provider dedotto | Identificatore modello | Effort registrato | Token |\n| :-- | :-- | :-- | --: |\n' +
    [...pair].sort((a, b) => b[1] - a[1]).map(([name, n]) => `| ${name} | ${integer(n)} |`).join('\n') + `\n\n${END}`;
}
export function replaceBlock(source, replacement) {
  assert.equal(source.split(START).length, 2, 'Expected one start marker');
  assert.equal(source.split(END).length, 2, 'Expected one end marker');
  const first = source.indexOf(START), last = source.indexOf(END);
  assert(last > first, 'Reversed markers');
  return source.slice(0, first) + replacement + source.slice(last + END.length);
}
export function build(root = ROOT, check = false) {
  const data = validate(JSON.parse(readFileSync(path.join(root, 'docs/data/development-usage.json'), 'utf8')));
  const doc = path.join(root, 'docs/development-usage.md');
  const outputs = new Map([
    [path.join(root, 'screenshots/token-models.svg'), renderSvg(data)],
    [doc, replaceBlock(readFileSync(doc, 'utf8'), renderTables(data))],
  ]);
  for (const [file, contents] of outputs) {
    if (check) assert.equal(readFileSync(file, 'utf8'), contents, `Outdated publication: ${path.basename(file)}`);
    else writeFileSync(file, contents);
  }
  console.log(`${check ? 'Verified' : 'Generated'} dashboard ${data.snapshotDate}; ${data.history.length} historical aggregates, ${data.effort.length} effort aggregates.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Only --check is supported');
  build(ROOT, args[0] === '--check');
}
