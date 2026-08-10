#!/usr/bin/env node
// @Codex: rigenera la dashboard pubblica da aggregati locali CodexBar.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');
const SVG = path.join(ROOT, 'screenshots/token-models.svg');
const CODEXBAR = process.env.CODEXBAR_BIN || resolveCodexBar();
const HISTORY_DAYS = Number.parseInt(process.env.USAGE_DASHBOARD_DAYS || '365', 10);
const START = '<!-- usage-dashboard:start -->';
const END = '<!-- usage-dashboard:end -->';

const CODEX_FAMILIES = [
  ['sol', 'GPT-5.6 Sol', '#5f50b7', (model) => model === 'gpt-5.6-sol'],
  ['gpt54', 'GPT-5.4 + mini', '#4b3f97', (model) => model.startsWith('gpt-5.4')],
  ['terra', 'GPT-5.6 Terra', '#887bcf', (model) => model === 'gpt-5.6-terra'],
  ['gpt55', 'GPT-5.5 storico', '#312968', (model) => model === 'gpt-5.5'],
  ['gpt53', 'GPT-5.3 Codex + Spark', '#9b90d3', (model) => model.startsWith('gpt-5.3')],
  ['unknown', 'Modello non registrato', '#b8b1d8', (model) => model === 'unknown'],
  ['luna', 'GPT-5.6 Luna', '#a99fdd', (model) => model === 'gpt-5.6-luna'],
  ['review', 'Codex Auto Review', '#cbc5e7', (model) => model === 'codex-auto-review'],
  ['other', 'Altri modelli Codex', '#ddd9ec', () => true],
];

const CLAUDE_FAMILIES = [
  ['opus48', 'Opus 4.8', '#9f4b31', (model) => model.includes('opus-4-8')],
  ['fable', 'Fable 5', '#cf7450', (model) => model.includes('fable-5')],
  ['opus47', 'Opus 4.7 storico', '#8d412d', (model) => model.includes('opus-4-7')],
  ['opus5', 'Opus 5', '#b95f3e', (model) => model.includes('opus-5')],
  ['sonnet', 'Sonnet 5', '#e5a17e', (model) => model.includes('sonnet-5')],
  ['delegated', 'OpenAI via Claude Code', '#7568c7', (model) => /^(gpt-|codex-)/.test(model)],
  ['haiku', 'Haiku storico', '#edb99f', (model) => model.includes('haiku')],
  ['local', 'Modelli locali e residui', '#f2d2c2', (model) => /(?:mlx|gguf|qwen|devstral)/.test(model)],
  ['other', 'Altri modelli Claude', '#f4ded3', () => true],
];

if (!Number.isInteger(HISTORY_DAYS) || HISTORY_DAYS < 1 || HISTORY_DAYS > 365) {
  throw new Error('USAGE_DASHBOARD_DAYS deve essere un intero tra 1 e 365.');
}

const version = readCodexBarVersion();
const codex = readProvider('codex');
const claude = readProvider('claude');
const total = {
  totalTokens: addTokens(codex.totalTokens, claude.totalTokens, 'Totale combinato'),
  cacheReadTokens: addTokens(codex.cacheReadTokens, claude.cacheReadTokens, 'Cache combinata'),
};
const snapshot = snapshotDate(Math.max(codex.updatedAt, claude.updatedAt));
const period = {
  first: [codex.firstDate, claude.firstDate].sort()[0],
  last: [codex.lastDate, claude.lastDate].sort().at(-1),
};
const families = {
  codex: groupFamilies(codex.models, CODEX_FAMILIES, codex.totalTokens),
  claude: groupFamilies(claude.models, CLAUDE_FAMILIES, claude.totalTokens),
};

const readme = readFileSync(README, 'utf8');
const startAt = readme.indexOf(START);
const endAt = readme.indexOf(END);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  throw new Error('Marcatori usage-dashboard mancanti o non validi. Dashboard non modificata.');
}

const block = buildReadmeBlock({ codex, claude, total, snapshot, period, version });
const nextReadme = readme.slice(0, startAt) + block + readme.slice(endAt + END.length);
const nextSvg = buildSvg({ codex, claude, total, snapshot, period, version, families });
writeSnapshot(nextReadme, nextSvg);

console.log(`Snapshot ${snapshot.iso}`);
console.log(`Periodo ${period.first} / ${period.last}`);
console.log(`Totale ${formatInteger(total.totalTokens)} token`);
console.log(`Codex ${formatInteger(codex.totalTokens)} token`);
console.log(`Claude Code ${formatInteger(claude.totalTokens)} token`);
console.log(`Cache letta ${formatInteger(total.cacheReadTokens)} token (${formatPct(total.cacheReadTokens, total.totalTokens)})`);
console.log(`Copertura Codex ${coverageLabel(codex)}, Claude Code ${coverageLabel(claude)}`);
console.log(`Fonte ${version}, finestra richiesta ${HISTORY_DAYS} giorni`);

function readCodexBarVersion() {
  const output = execFileSync(CODEXBAR, ['--version'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).trim();
  if (!/^CodexBar \d+\.\d+\.\d+$/.test(output)) {
    throw new Error(`Versione CodexBar non interpretabile: ${output}`);
  }
  return output;
}

function resolveCodexBar() {
  const executable = execFileSync('/usr/bin/which', ['codexbar'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).trim();
  if (!path.isAbsolute(executable)) {
    throw new Error('Eseguibile CodexBar non trovato nel PATH.');
  }
  return executable;
}

function readProvider(provider) {
  const output = execFileSync(CODEXBAR, [
    'cost',
    '--provider', provider,
    '--days', String(HISTORY_DAYS),
    '--refresh',
    '--json',
  ], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = JSON.parse(output);
  if (!Array.isArray(rows)) {
    throw new Error(`Risposta CodexBar non valida per ${provider}.`);
  }
  const record = rows.find((row) => row?.provider === provider);
  if (!record || record.source !== 'local' || !record.totals || !Array.isArray(record.daily)) {
    throw new Error(`Aggregato CodexBar locale non disponibile per ${provider}.`);
  }
  if (record.daily.length === 0) {
    throw new Error(`Aggregato CodexBar senza giorni disponibili per ${provider}.`);
  }

  const models = new Map();
  let dailyTotal = 0;
  const dates = new Set();
  for (const day of record.daily) {
    const date = isoDate(day.date, `Data CodexBar non valida per ${provider}`);
    if (dates.has(date)) {
      throw new Error(`Data CodexBar duplicata per ${provider}: ${date}.`);
    }
    dates.add(date);
    if (!Array.isArray(day.modelBreakdowns)) {
      throw new Error(`Breakdown CodexBar mancante per ${provider} il ${date}.`);
    }
    const dayTotal = tokenInteger(day.totalTokens, `Totale giornaliero ${provider} ${date}`);
    const breakdownTotal = day.modelBreakdowns.reduce(
      (sum, item) => addTokens(
        sum,
        tokenInteger(item.totalTokens, `Totale modello ${provider} ${date}`),
        `Breakdown ${provider} ${date}`,
      ),
      0,
    );
    if (breakdownTotal !== dayTotal) {
      throw new Error(`Breakdown CodexBar non riconciliato per ${provider} il ${date}.`);
    }
    dailyTotal = addTokens(dailyTotal, dayTotal, `Totale giornaliero cumulativo ${provider}`);
    for (const item of day.modelBreakdowns) {
      const model = typeof item.modelName === 'string' && item.modelName.trim()
        ? item.modelName.trim()
        : 'unknown';
      models.set(
        model,
        addTokens(
          models.get(model) || 0,
          tokenInteger(item.totalTokens, `Totale modello ${provider} ${date}`),
          `Totale modello cumulativo ${provider} ${model}`,
        ),
      );
    }
  }

  const totalTokens = tokenInteger(record.totals.totalTokens, `Totale ${provider}`);
  const cacheReadTokens = tokenInteger(record.totals.cacheReadTokens, `Cache letta ${provider}`);
  if (cacheReadTokens > totalTokens) {
    throw new Error(`Cache letta superiore al totale per ${provider}.`);
  }
  const modelTotal = [...models.values()].reduce(
    (sum, value) => addTokens(sum, value, `Totale modelli ${provider}`),
    0,
  );
  if (dailyTotal !== totalTokens || modelTotal !== totalTokens) {
    throw new Error(`Totale CodexBar non riconciliato per ${provider}.`);
  }

  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    throw new Error(`Timestamp CodexBar non interpretabile per ${provider}.`);
  }
  if (typeof record.historyCoverageIsEstablished !== 'boolean') {
    throw new Error(`Copertura storica CodexBar non dichiarata per ${provider}.`);
  }

  return {
    provider,
    updatedAt,
    historyCoverageIsEstablished: record.historyCoverageIsEstablished,
    totalTokens,
    cacheReadTokens,
    models,
    firstDate: [...dates].sort()[0],
    lastDate: [...dates].sort().at(-1),
  };
}

function writeSnapshot(nextReadme, nextSvg) {
  const svgTemp = `${SVG}.tmp-${process.pid}`;
  const readmeTemp = `${README}.tmp-${process.pid}`;
  const previousSvg = readFileSync(SVG, 'utf8');
  let svgPromoted = false;

  try {
    writeFileSync(svgTemp, nextSvg);
    writeFileSync(readmeTemp, nextReadme);
    renameSync(svgTemp, SVG);
    svgPromoted = true;
    renameSync(readmeTemp, README);
  } catch (error) {
    if (svgPromoted) writeFileSync(SVG, previousSvg);
    throw error;
  } finally {
    if (existsSync(svgTemp)) unlinkSync(svgTemp);
    if (existsSync(readmeTemp)) unlinkSync(readmeTemp);
  }
}

function groupFamilies(models, definitions, expectedTotal) {
  const groups = definitions.map(([key, label, color]) => ({ key, label, color, tokens: 0 }));
  for (const [model, tokens] of models) {
    const index = definitions.findIndex(([, , , match]) => match(model));
    groups[index].tokens = addTokens(groups[index].tokens, tokens, `Famiglia modello ${groups[index].label}`);
  }
  const result = groups.filter((group) => group.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const total = result.reduce(
    (sum, group) => addTokens(sum, group.tokens, 'Totale famiglie modello'),
    0,
  );
  if (total !== expectedTotal) throw new Error('Raggruppamento modelli non riconciliato.');
  return result;
}

function buildReadmeBlock({ codex, claude, total, snapshot, period, version }) {
  const alt = `Snapshot ${snapshot.label}: ${formatCompact(total.totalTokens)} token di sessione, ${formatCompact(codex.totalTokens)} in Codex e ${formatCompact(claude.totalTokens)} in Claude Code; ${formatCompact(total.cacheReadTokens)} da cache letta.`;
  return `${START}\n\n` +
    `| Snapshot | Periodo dei log disponibili | Token di sessione | Ripartizione | Cache letta | Copertura storica |\n` +
    `| :-- | :-- | --: | :-- | --: | :-- |\n` +
    `| **${snapshot.label}** | ${period.first} → ${period.last} | **${formatInteger(total.totalTokens)}** | Codex ${formatInteger(codex.totalTokens)} · Claude Code ${formatInteger(claude.totalTokens)} | ${formatInteger(total.cacheReadTokens)} (${formatPct(total.cacheReadTokens, total.totalTokens)}) | Codex ${coverageLabel(codex)} · Claude Code ${coverageLabel(claude)} |\n\n` +
    `<img src="./screenshots/token-models.svg" alt="${alt}" width="720" loading="lazy"/>\n\n` +
    `La fonte è **${version}**, comando locale \`cost --refresh\`, con una finestra massima di ${HISTORY_DAYS} giorni. Il conteggio usa gli aggregati disponibili per Codex e Claude Code e non è filtrato per repository. CodexBar attribuisce ogni token al processo che lo registra. Un worker OpenAI avviato da Claude Code compare quindi nel totale Claude Code. Il grafico indica lo strumento che registra i token, non il fornitore del modello.\n\n` +
    `**ATTESTATO:** i valori sono le somme esatte dei log disponibili nel periodo indicato. **STIMATO:** nessun valore. **UNKNOWN:** la completezza storica resta sconosciuta quando CodexBar non la attesta. L'attribuzione a MediFlow, a una release, a una PR o a un commit è sempre sconosciuta.\n\n` +
    `Rigenera il grafico con \`npm run build:usage-dashboard\`. Usa \`CODEXBAR_BIN\` per scegliere un eseguibile diverso e \`USAGE_DASHBOARD_DAYS\` per impostare una finestra da 1 a 365 giorni.\n\n` +
    `Le barre sono divise per modello e usano la stessa scala. La cache letta è una parte dell'input Codex, mentre CodexBar la espone come categoria separata per Claude Code: per questo il grafico non impila categorie di token con semantiche diverse. Sono pubblicati soltanto aggregati. Nessun prompt, contenuto di sessione, costo o percorso locale entra nel README o nell'SVG.\n\n` +
    `Il dato misura contesto elaborato. Non misura righe di codice, costo o qualità.\n\n` +
    `La responsabilità del progetto resta mia.\n\n${END}`;
}

function buildSvg({ codex, claude, total, snapshot, period, version, families }) {
  const width = 824;
  const max = Math.max(codex.totalTokens, claude.totalTokens, 1);
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 720" width="920" height="720" role="img" aria-label="Dashboard token di sessione del ${snapshot.label}: totale ${formatInteger(total.totalTokens)}, Codex ${formatInteger(codex.totalTokens)}, Claude Code ${formatInteger(claude.totalTokens)}.">
  <style>
    .frame{fill:#fbfaf7;stroke:#d9d7d1}.panel,.track{fill:#f0eee8}.rule{stroke:#e1ded8}.ink{fill:#181a1d}.muted{fill:#66707b}.body{fill:#31363d}.guide{stroke:#c9c6bf}
  </style>
  <defs><clipPath id="codex-bar"><rect x="48" y="168" width="824" height="38" rx="19"/></clipPath><clipPath id="claude-bar"><rect x="48" y="407" width="824" height="38" rx="19"/></clipPath></defs>
  <rect class="frame" x="6" y="6" width="908" height="708" rx="28" stroke-width="1.5"/>
  <text class="ink" x="48" y="62" font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="25" font-weight="720">Il lavoro assistito per ambiente</text>
  <text class="muted" x="48" y="92" font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${version} · log ${period.first}–${period.last} · snapshot ${snapshot.label}</text>
  <rect class="panel" x="692" y="40" width="180" height="64" rx="16"/><text class="muted" x="712" y="62" font-family="Inter,sans-serif" font-size="10.5" font-weight="700" letter-spacing="0.8">TOTALE</text><text class="ink" x="712" y="90" font-family="Inter,sans-serif" font-size="23" font-weight="760">${formatCompact(total.totalTokens)}</text>
  <line class="rule" x1="48" y1="126" x2="872" y2="126"/>
  <text class="ink" x="48" y="153" font-family="Inter,sans-serif" font-size="15" font-weight="700">Codex</text><text x="872" y="153" text-anchor="end" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="15" font-weight="650" fill="#7568c7">${formatCompact(codex.totalTokens)}</text>
  <rect class="track" x="48" y="168" width="824" height="38" rx="19"/><g clip-path="url(#codex-bar)">${segments(families.codex, 168)}</g>
  <g font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10.5">${legend(families.codex, 237, 2)}</g>
  <line class="rule" x1="48" y1="365" x2="872" y2="365"/>
  <text class="ink" x="48" y="392" font-family="Inter,sans-serif" font-size="15" font-weight="700">Claude Code</text><text x="872" y="392" text-anchor="end" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="15" font-weight="650" fill="#cf7450">${formatCompact(claude.totalTokens)}</text>
  <rect class="track" x="48" y="407" width="824" height="38" rx="19"/><g clip-path="url(#claude-bar)">${segments(families.claude, 407)}</g><line class="guide" x1="872" y1="164" x2="872" y2="449" stroke-dasharray="3 5"/>
  <g font-family="Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10.5">${legend(families.claude, 476, 2)}</g>
  <rect class="panel" x="48" y="594" width="824" height="60" rx="18"/><text class="muted" x="68" y="617" font-family="Inter,sans-serif" font-size="11" font-weight="700" letter-spacing="0.45">LETTURA DEL DATO</text><text class="ink" x="68" y="641" font-family="IBM Plex Mono,ui-monospace,monospace" font-size="13" font-weight="600">Cache letta: ${formatCompact(total.cacheReadTokens)} token (${formatPct(total.cacheReadTokens, total.totalTokens)} del contesto).</text>
  <text class="muted" x="48" y="691" font-family="Inter,sans-serif" font-size="10">Copertura: Codex ${coverageLabel(codex)} · Claude Code ${coverageLabel(claude)}</text><text class="muted" x="872" y="691" text-anchor="end" font-family="Inter,sans-serif" font-size="10">Stessa scala per entrambe le barre · valori arrotondati</text>
</svg>\n`;
}

function snapshotDate(timestamp) {
  const date = new Date(timestamp);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Rome',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    label: new Intl.DateTimeFormat('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Rome',
    }).format(date),
  };
}

function formatInteger(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value);
}

function formatCompact(value) {
  return new Intl.NumberFormat('it-IT', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(part, whole) {
  if (!whole) return '0%';
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(part * 100 / whole)}%`;
}

function coverageLabel(provider) {
  return provider.historyCoverageIsEstablished ? 'attestata' : 'UNKNOWN';
}

function tokenInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label}: valore token CodexBar non valido.`);
  }
  return result;
}

function addTokens(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label}: somma token CodexBar non valida.`);
  }
  return result;
}

function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}: ${String(value)}.`);
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: ${value}.`);
  }
  return value;
}
