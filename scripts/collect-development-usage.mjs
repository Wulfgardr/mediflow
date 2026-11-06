#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { providerFor, validate } from './build-usage-dashboard.mjs';

export function repositoryMatches(url) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)Wulfgardr\/mediflow(?:_private)?(?:\.git)?\/?$/i.test(url ?? '');
}
export function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export function attribution(primary) {
  const roots = repositoryMatches(git(primary, ['remote', 'get-url', 'origin']))
    ? git(primary, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9)) : [];
  const cache = new Map();
  return (cwd, meta = {}) => {
    if (!cwd || !path.isAbsolute(cwd)) return false;
    if (fs.existsSync(cwd)) {
      if (!cache.has(cwd)) {
        let ok = false;
        try {
          const real = fs.realpathSync(cwd);
          ok = roots.some(root => fs.existsSync(root) && inside(real, fs.realpathSync(root))) || repositoryMatches(git(real, ['remote', 'get-url', 'origin']));
        } catch { /* A directory without Git provenance is excluded. */ }
        cache.set(cwd, ok);
      }
      return cache.get(cwd);
    }
    return Boolean(meta.cwd && inside(cwd, meta.cwd) && repositoryMatches(meta.git?.repository_url));
  };
}
export async function* files(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}
const day = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
export async function collectRecords(roots, accepts) {
  const records = new Map();
  let malformed = 0;
  for (const [environment, directories] of Object.entries(roots)) for (const directory of directories) for await (const file of files(directory)) {
    let meta = {}, context = {}, previous = 0, previousCache = 0, session;
    const input = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of input) {
      let r;
      if (!line.trim()) continue;
      try { r = JSON.parse(line); } catch { malformed++; continue; }
      const p = r.payload ?? {};
      if (r.type === 'session_meta') { meta = p; session = p.id; }
      if (r.type === 'turn_context') context = p;
      let usage, key, tokens, cache, cwd, model, effort;
      if (environment === 'codex' && r.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage && session) {
        usage = p.info.total_token_usage;
        const current = count(usage.total_tokens);
        tokens = current >= previous ? current - previous : 0;
        previous = current;
        key = `codex:${session}:${current}`;
        cache = Math.min(tokens, Math.max(0, count(usage.cached_input_tokens) - previousCache));
        previousCache = count(usage.cached_input_tokens);
        cwd = context.cwd ?? meta.cwd; model = context.model ?? 'unknown'; effort = context.effort ?? 'unknown';
      } else if (environment === 'claude' && r.type === 'assistant' && r.message?.usage && r.message.id && r.requestId) {
        usage = r.message.usage;
        tokens = count(usage.input_tokens) + count(usage.output_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
        cache = count(usage.cache_read_input_tokens);
        key = `claude:${r.message.id}:${r.requestId}`;
        cwd = r.cwd; model = r.message.model ?? 'unknown'; effort = 'unknown';
      } else continue;
      if (!tokens || !r.timestamp || !accepts(cwd, meta)) continue;
      const record = { date: day(r.timestamp), environment, provider: providerFor(model), model, effort, tokens, cache };
      if (!records.has(key) || records.get(key).tokens < tokens) records.set(key, record);
    }
  }
  return { records: [...records.values()], malformed };
}
export function codexBarFallback(report, records, accepts) {
  const observed = new Set(records.filter(r => r.environment === 'codex').map(r => r.date));
  const result = [], seen = new Set();
  for (const provider of report) for (const project of provider.projects ?? []) for (const source of project.sources ?? []) {
    if (seen.has(source.path) || !accepts(source.path)) continue;
    seen.add(source.path);
    for (const daily of source.daily ?? []) {
      if (observed.has(daily.date)) continue;
      let cache = count(daily.cacheReadTokens);
      for (const model of daily.modelBreakdowns ?? []) {
        const tokens = count(model.totalTokens);
        const cached = Math.min(cache, tokens); cache -= cached;
        result.push({ date: daily.date, environment: 'codex', provider: providerFor(model.modelName), model: model.modelName, effort: 'unknown', tokens, cache: cached, historyOnly: true });
      }
    }
  }
  return result;
}
const sum = rows => rows.reduce((n,r) => n + r.tokens, 0);
export function mergeHistory(baseline, records, snapshotDate) {
  const data = structuredClone(baseline);
  const fresh = records.filter(r => r.date > baseline.snapshotDate && r.date <= snapshotDate);
  data.snapshotDate = snapshotDate;
  for (const name of ['history', 'effort']) {
    const groups = new Map();
    for (const r of fresh.filter(r => name === 'history' || (r.environment === 'codex' && !r.historyOnly))) {
      const row = { date: r.date, environment: r.environment, provider: r.provider, model: r.model, effort: name === 'history' ? 'unknown' : r.effort, tokens: r.tokens };
      const key = [row.date,row.environment,row.model,row.effort].join('|');
      if (groups.has(key)) groups.get(key).tokens += row.tokens; else groups.set(key,row);
    }
    data[name].push(...groups.values());
    data[name].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  for (const e of data.environments) {
    const rows = data.history.filter(r => r.environment === e.environment);
    e.from = rows.map(r=>r.date).sort()[0]; e.to = rows.map(r=>r.date).sort().at(-1); e.totalTokens = sum(rows);
    e.cacheReadTokens += fresh.filter(r=>r.environment === e.environment).reduce((n,r)=>n+r.cache,0);
    if (e.environment === 'codex') e.source = 'Codex local token records + historical CodexBar 0.60.3';
  }
  const e = data.effortSource;
  e.totalTokens = sum(data.effort); e.to = data.effort.map(r=>r.date).sort().at(-1);
  e.responseRecords += fresh.filter(r=>r.environment === 'codex' && !r.historyOnly).length;
  return validate(data);
}
export async function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/development-usage-2026-09-27.json')));
  const result = await collectRecords({ codex: [path.join(os.homedir(), '.codex/sessions'), path.join(os.homedir(), '.codex/archived_sessions')], claude: [path.join(os.homedir(), '.claude/projects')] }, attribution(root));
  console.log(`Excluded malformed lines: ${result.malformed}; coverage remains partial`);
  try {
    const report = JSON.parse(execFileSync('codexbar', ['cost', '--provider', 'codex', '--period', 'all', '--group-by', 'project', '--format', 'json'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }));
    result.records.push(...codexBarFallback(report, result.records, attribution(root)));
  } catch { console.log('CodexBar export unavailable; using local records only'); }
  const data = mergeHistory(baseline, result.records, day(new Date()));
  fs.writeFileSync(path.join(root, 'docs/data/development-usage.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify(data.environments));
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
