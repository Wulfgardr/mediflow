#!/usr/bin/env node
// @Codex: rigenera la dashboard pubblica usando solo aggregati dei log locali.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');
const SVG = path.join(ROOT, 'screenshots/token-models.svg');
const CODEX_DIR = process.env.CODEX_SESSIONS_DIR || path.join(homedir(), '.codex/sessions');
const CLAUDE_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(homedir(), '.claude/projects');
const START = '<!-- usage-dashboard:start -->';
const END = '<!-- usage-dashboard:end -->';
const CUTOFF_SOURCE = process.env.USAGE_DASHBOARD_CUTOFF || '';
const CUTOFF = CUTOFF_SOURCE ? Date.parse(CUTOFF_SOURCE) : Number.POSITIVE_INFINITY;
if (CUTOFF_SOURCE && !Number.isFinite(CUTOFF)) throw new Error('USAGE_DASHBOARD_CUTOFF non valido.');
const CODEX_FAMILIES = [
  ['sol', 'GPT-5.6 Sol', '#5f50b7', (model) => model === 'gpt-5.6-sol'],
  ['gpt55', 'GPT-5.5', '#312968', (model) => model === 'gpt-5.5'],
  ['gpt54', 'GPT-5.4 + mini', '#4b3f97', (model) => model.startsWith('gpt-5.4')],
  ['terra', 'GPT-5.6 Terra', '#887bcf', (model) => model === 'gpt-5.6-terra'],
  ['gpt53', 'GPT-5.3 Codex + Spark', '#a99fdd', (model) => model.startsWith('gpt-5.3')],
  ['other', 'Altri e non registrati', '#d6d1ed', () => true],
];
const CLAUDE_FAMILIES = [
  ['opus', 'Opus 4.8', '#a64e32', (model) => model.includes('opus-4-8')],
  ['fable', 'Fable 5', '#cf7450', (model) => model.includes('fable-5')],
  ['sonnet', 'Sonnet 5', '#e5a17e', (model) => model.includes('sonnet-5')],
  ['haiku', 'Haiku 4.5 storico', '#f2c7b3', (model) => model.includes('haiku-4-5')],
  ['other', 'Altri modelli Claude', '#f4d5c7', () => true],
];

if (!existsSync(CODEX_DIR) || !existsSync(CLAUDE_DIR)) {
  throw new Error('Log locali Codex o Claude Code non disponibili. Dashboard non modificata.');
}

let latestTimestamp = 0;
const codex = collectCodex();
const claude = collectClaude();
const total = sumUsage(codex, claude);
const snapshot = snapshotDate(Number.isFinite(CUTOFF) ? CUTOFF : latestTimestamp || Date.now());
const families = {
  codex: groupFamilies(codex.models, CODEX_FAMILIES),
  claude: groupFamilies(claude.models, CLAUDE_FAMILIES),
};

const readme = readFileSync(README, 'utf8');
const startAt = readme.indexOf(START);
const endAt = readme.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  throw new Error('Marcatori usage-dashboard mancanti o non validi. Dashboard non modificata.');
}

const block = buildReadmeBlock({ codex, claude, total, snapshot, families });
const nextReadme = readme.slice(0, startAt) + block + readme.slice(endAt + END.length);
writeFileSync(SVG, buildSvg({ codex, claude, total, snapshot, families }));
writeFileSync(README, nextReadme);

console.log(`Snapshot ${snapshot.iso}`);
console.log(`Totale ${formatInteger(total.total_tokens)} token`);
console.log(`Codex ${formatInteger(codex.total_tokens)} token`);
console.log(`Claude Code ${formatInteger(claude.total_tokens)} token`);
console.log(`Cache letta ${formatInteger(total.cached_input_tokens)} token (${formatPct(total.cached_input_tokens, total.total_tokens)})`);
console.log(`Effort Codex ${formatEfforts(codex.efforts)}`);

function walkJsonl(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJsonl(target, files);
    else if (entry.name.endsWith('.jsonl')) files.push(target);
  }
  return files;
}

function rows(file) {
  let source;
  try { source = readFileSync(file, 'utf8'); } catch { return []; }
  return source.split('\n').filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line);
      const timestamp = Date.parse(row.timestamp);
      if (Number.isFinite(timestamp) && timestamp > CUTOFF) return [];
      if (Number.isFinite(timestamp)) latestTimestamp = Math.max(latestTimestamp, timestamp);
      return [row];
    } catch { return []; }
  });
}

function collectCodex() {
  const aggregate = usageResult();
  for (const file of walkJsonl(CODEX_DIR)) {
    let meta;
    let ownStarted = false;
    let previous;
    let model = 'not-recorded';
    let effort = 'not-recorded';
    let sessionTokens = 0;
    const fallbackId = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i)?.[1];
    for (const row of rows(file)) {
      if (row.type === 'session_meta' && !meta) meta = row.payload || {};
      const sessionId = meta?.id || meta?.session_id || fallbackId;
      if (row.type === 'event_msg' && row.payload?.type === 'task_started'
          && isOwnTurn(row.payload.turn_id, sessionId, meta)) ownStarted = true;
      if (row.type === 'turn_context' && isOwnTurn(row.payload?.turn_id, sessionId, meta)) {
        model = row.payload?.model || model;
        effort = row.payload?.effort === 'ultra' ? 'not-recorded-ultra' : row.payload?.effort || effort;
      }
      if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
      const current = normalizeCodex(row.payload?.info?.total_token_usage);
      if (ownStarted) {
        const delta = previous ? subtractUsage(current, previous) : current;
        addUsage(aggregate, delta);
        addMapUsage(aggregate.models, model, delta);
        aggregate.efforts.set(effort, (aggregate.efforts.get(effort) || 0) + delta.total_tokens);
        sessionTokens += delta.total_tokens;
      }
      previous = current;
    }
    if (sessionTokens > 0) aggregate.sessions += 1;
  }
  return aggregate;
}

function isOwnTurn(turnId, sessionId, meta) {
  if (!turnId) return false;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return !meta?.source?.subagent;
  return String(turnId).localeCompare(String(sessionId)) >= 0;
}

function collectClaude() {
  const aggregate = usageResult();
  const calls = new Map();
  let fallback = 0;
  for (const file of walkJsonl(CLAUDE_DIR)) {
    let used = false;
    for (const row of rows(file)) {
      const usage = row.message?.usage;
      const model = row.message?.model;
      if (!usage || !model || model === '<synthetic>') continue;
      const input = number(usage.input_tokens) + number(usage.cache_creation_input_tokens)
        + number(usage.cache_read_input_tokens);
      const output = number(usage.output_tokens);
      if (input + output === 0) continue;
      const key = row.requestId || row.uuid || `fallback-${fallback++}`;
      const previous = calls.get(key);
      if (previous && previous.output >= output) continue;
      calls.set(key, { model, input, output, cached: number(usage.cache_read_input_tokens), used });
      used = true;
    }
    if (used) aggregate.sessions += 1;
  }
  for (const call of calls.values()) {
    const usage = {
      input_tokens: call.input,
      cached_input_tokens: call.cached,
      output_tokens: call.output,
      total_tokens: call.input + call.output,
    };
    addUsage(aggregate, usage);
    addMapUsage(aggregate.models, call.model, usage);
  }
  return aggregate;
}

function usageResult() {
  return { sessions: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, models: new Map(), efforts: new Map() };
}

function normalizeCodex(usage = {}) {
  return {
    input_tokens: number(usage.input_tokens),
    cached_input_tokens: number(usage.cached_input_tokens),
    output_tokens: number(usage.output_tokens),
    total_tokens: number(usage.total_tokens),
  };
}

function subtractUsage(current, previous) {
  return Object.fromEntries(Object.keys(current).map((key) => [key, Math.max(0, current[key] - previous[key])]));
}

function addUsage(target, usage) {
  for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens']) target[key] += number(usage[key]);
  return target;
}

function addMapUsage(map, key, usage) {
  const value = map.get(key) || usageResult();
  addUsage(value, usage);
  map.set(key, value);
}

function sumUsage(a, b) {
  const result = usageResult();
  addUsage(result, a);
  addUsage(result, b);
  return result;
}

function groupFamilies(models, definitions) {
  const groups = definitions.map(([key, label, color]) => ({ key, label, color, tokens: 0 }));
  for (const [model, usage] of models) {
    const index = definitions.findIndex(([, , , match]) => match(model));
    groups[index].tokens += usage.total_tokens;
  }
  return groups.filter((group) => group.tokens > 0).sort((a, b) => b.tokens - a.tokens);
}

function buildReadmeBlock({ codex, claude, total, snapshot, families }) {
  const alt = `Snapshot ${snapshot.label}: ${formatCompact(total.total_tokens)} token di sessione, ${formatCompact(codex.total_tokens)} in Codex e ${formatCompact(claude.total_tokens)} in Claude Code; ${formatCompact(total.cached_input_tokens)} da cache letta.`;
  return `${START}\n\n` +
    `| Snapshot | Token di sessione | Ripartizione | Cache letta |\n` +
    `| :-- | --: | :-- | --: |\n` +
    `| **${snapshot.label}** | **${formatInteger(total.total_tokens)}** | Codex ${formatInteger(codex.total_tokens)} · Claude Code ${formatInteger(claude.total_tokens)} | ${formatInteger(total.cached_input_tokens)} (${formatPct(total.cached_input_tokens, total.total_tokens)}) |\n\n` +
    `<img src="./screenshots/token-models.svg" alt="${alt}" width="720" loading="lazy"/>\n\n` +
    `**Effort Codex:** ${formatEfforts(codex.efforts)}. Le sessioni senza effort registrato restano separate; possono includere fan-out \`Ultra\`, che non è un livello di ragionamento. Nei transcript Claude Code l'effort non è esposto in modo uniforme.\n\n` +
    `Il conteggio usa i contatori di tutti i log locali dei due ambienti e non è filtrato per repository. Per Codex somma i delta dei totali cumulativi e conserva modello, effort e cache letta; per Claude Code deduplica le richieste e somma input diretto, cache creata, cache letta e output. Sono pubblicati soltanto aggregati: nessun prompt, contenuto di sessione o percorso locale entra nel README o nell'SVG.\n\n` +
    `Ogni colore corrisponde a un modello o a una famiglia vicina. Le due barre usano la stessa scala: mostrano il peso dei due ambienti e la composizione interna. Il dato misura contesto elaborato, non righe di codice, costo o qualità. [CodexBar](https://github.com/steipete/CodexBar) resta il pannello locale complementare per limiti e uso corrente.\n\n` +
    `La responsabilità del progetto resta mia.\n\n${END}`;
}

function buildSvg({ codex, claude, total, snapshot, families }) {
  const width = 824;
  const max = Math.max(codex.total_tokens, claude.total_tokens, 1);
  const segments = (groups, y) => {
    let x = 48;
    return groups.map((group) => {
      const segmentWidth = width * group.tokens / max;
      const rect = `<rect x="${x.toFixed(2)}" y="${y}" width="${segmentWidth.toFixed(2)}" height="38" fill="${group.color}"/>`;
      x += segmentWidth;
      return rect;
    }).join('\n    ');
  };
  const legend = (groups, y, columns) => groups.map((group, index) => {
    const x = 48 + (index % columns) * (824 / columns);
    const rowY = y + Math.floor(index / columns) * 25;
    return `<rect x="${x.toFixed(0)}" y="${rowY - 9}" width="10" height="10" rx="3" fill="${group.color}"/><text class="body" x="${(x + 17).toFixed(0)}" y="${rowY}">${group.label} · ${formatCompact(group.tokens)}</text>`;
  }).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 560" width="920" height="560" role="img" aria-label="Dashboard token di sessione del ${snapshot.label}: totale ${formatInteger(total.total_tokens)}, Codex ${formatInteger(codex.total_tokens)}, Claude Code ${formatInteger(claude.total_tokens)}.">
  <style>
    .frame{fill:#fbfaf7;stroke:#d9d7d1}.panel,.track{fill:#f0eee8}.rule{stroke:#e1ded8}.ink{fill:#181a1d}.muted{fill:#66707b}.body{fill:#31363d}.guide{stroke:#c9c6bf}
  </style>
  <defs><clipPath id="codex-bar"><rect x="48" y="168" width="824" height="38" rx="19"/></clipPath><clipPath id="claude-bar"><rect x="48" y="334" width="824" height="38" rx="19"/></clipPath></defs>
  <rect class="frame" x="6" y="6" width="908" height="548" rx="28" stroke-width="1.5"/>
  <circle cx="56" cy="54" r="8" fill="#d8673f"/><text class="ink" x="76" y="62" font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="25" font-weight="720">Il lavoro assistito, modello per modello</text>
  <text class="muted" x="48" y="92" font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">Token di sessione dai log locali · snapshot ${snapshot.label}</text>
  <rect class="panel" x="692" y="40" width="180" height="64" rx="16"/><text class="muted" x="712" y="62" font-family="Inter,sans-serif" font-size="10.5" font-weight="700" letter-spacing="0.8">TOTALE MISURATO</text><text class="ink" x="712" y="90" font-family="Inter,sans-serif" font-size="23" font-weight="760">${formatCompact(total.total_tokens)}</text>
  <line class="rule" x1="48" y1="126" x2="872" y2="126"/>
  <text class="ink" x="48" y="153" font-family="Inter,sans-serif" font-size="15" font-weight="700">Codex · OpenAI</text><text x="872" y="153" text-anchor="end" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="15" font-weight="650" fill="#7568c7">${formatCompact(codex.total_tokens)}</text>
  <rect class="track" x="48" y="168" width="824" height="38" rx="19"/><g clip-path="url(#codex-bar)">${segments(families.codex, 168)}</g>
  <g font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10.5">${legend(families.codex, 237, 3)}</g>
  <line class="rule" x1="48" y1="292" x2="872" y2="292"/>
  <text class="ink" x="48" y="319" font-family="Inter,sans-serif" font-size="15" font-weight="700">Claude Code · Anthropic</text><text x="872" y="319" text-anchor="end" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="15" font-weight="650" fill="#cf7450">${formatCompact(claude.total_tokens)}</text>
  <rect class="track" x="48" y="334" width="824" height="38" rx="19"/><g clip-path="url(#claude-bar)">${segments(families.claude, 334)}</g><line class="guide" x1="872" y1="164" x2="872" y2="376" stroke-dasharray="3 5"/>
  <g font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10.5">${legend(families.claude, 403, 4)}</g>
  <rect class="panel" x="48" y="446" width="824" height="72" rx="18"/><text class="muted" x="68" y="470" font-family="Inter,sans-serif" font-size="11" font-weight="700" letter-spacing="0.45">COME LEGGERE IL DATO</text><text class="ink" x="68" y="493" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="13" font-weight="600">${formatCompact(total.cached_input_tokens)} cache letta · ${formatCompact(total.input_tokens - total.cached_input_tokens)} input non cached · ${formatCompact(total.output_tokens)} output</text><text class="muted" x="68" y="510" font-family="Inter,sans-serif" font-size="10.5">Volume di contesto elaborato, non righe di codice, costo o qualità.</text>
  <text class="muted" x="872" y="540" text-anchor="end" font-family="Inter,sans-serif" font-size="10">Stessa scala per entrambe le barre · valori arrotondati</text>
</svg>\n`;
}

function snapshotDate(timestamp) {
  const date = new Date(timestamp);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date).map((part) => [part.type, part.value]));
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return { iso, label: `${parts.day} ${parts.month} ${parts.year}` };
}

function formatEfforts(efforts) {
  const labels = { xhigh: 'xhigh', high: 'high', medium: 'medium', low: 'low', 'not-recorded-ultra': 'non registrato / Ultra', 'not-recorded': 'non registrato' };
  return [...efforts].sort((a, b) => b[1] - a[1]).map(([key, tokens]) => `${labels[key] || key} ${formatInteger(tokens)}`).join(' · ');
}

function formatInteger(value) { return Math.round(number(value)).toLocaleString('it-IT'); }
function formatPct(value, whole) { return `${(whole ? value / whole * 100 : 0).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function formatCompact(value) { return `${(number(value) / 1e9).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mld`; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
