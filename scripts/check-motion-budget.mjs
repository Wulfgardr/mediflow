#!/usr/bin/env node
// @Codex: Lume motion budget guard. Dependency-free and fail-closed.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['app', 'components'];
const SOURCE_EXTENSIONS = new Set(['.css', '.tsx']);

// An exception is deliberately narrower than a file: exact path, rule and
// declaration are all required. Add one only for a transient operation spinner.
export const ALLOWLIST = [
  {
    path: 'components/kree8/kree8-lock-screen.module.css',
    rule: 'animazione infinita',
    snippet: 'animation: spin 900ms linear infinite',
    reason: 'Spinner visibile solo durante lo sblocco in corso.',
  },
  {
    path: 'components/ai-patient-insight.tsx',
    rule: 'animazione infinita',
    snippet: 'animate-[spin_3s_linear_infinite]',
    reason: 'Spinner visibile solo durante la generazione esplicita del riepilogo.',
  },
];

const RULES = [
  ['animazione infinita', /\banimation(?:-name)?\s*:\s*[^;{}]*\binfinite\b/gi],
  ['animazione infinita', /\banimate-\[[^\]\n]*infinite[^\]\n]*\]/gi],
  ['animazione ambientale shimmer o pulse', /\banimate-pulse\b/gi],
  ['transizione generica', /\btransition\s*:\s*all\b/gi],
  ['transizione generica', /\btransition-all\b/gi],
  ['ombra animata', /\btransition(?:-property)?\s*:\s*[^;{}]*(?:\bbox-shadow\b|\ball\b)/gi],
  ['ombra animata', /\btransition-\[[^\]\n]*\bbox-shadow\b[^\]\n]*\]/gi],
  ['filo usato come bordo', /\bborder-(?:left|inline-start)\s*:\s*[^;{}]*--(?:lume-)?filo\b/gi],
];

function normalized(value) {
  return value.replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function contextAt(relativePath, source, index) {
  if (relativePath.endsWith('.css')) {
    const openBrace = source.lastIndexOf('{', index);
    if (openBrace >= 0) {
      const previousClose = source.lastIndexOf('}', openBrace);
      const selector = normalized(source.slice(previousClose + 1, openBrace));
      if (selector) return selector;
    }
  }

  const prefix = source.slice(0, index);
  const scopePattern = /\b(?:export\s+default\s+|export\s+)?function\s+([A-Za-z_$][\w$]*)|\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  let scope = 'module';
  for (let match = scopePattern.exec(prefix); match; match = scopePattern.exec(prefix)) {
    scope = match[1] ?? match[2] ?? scope;
  }

  const lineStart = prefix.lastIndexOf('\n') + 1;
  const beforeStart = source.lastIndexOf('\n', Math.max(0, source.lastIndexOf('\n', lineStart - 2) - 1)) + 1;
  const lineEnd = source.indexOf('\n', index);
  return `${scope}: ${normalized(source.slice(beforeStart, lineEnd < 0 ? source.length : lineEnd))}`;
}

function walk(directory) {
  if (!existsSync(directory)) throw new Error(`directory mancante: ${directory}`);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function isAllowed(violation, allowlist) {
  return allowlist.some((entry) =>
    entry.path === violation.path
    && entry.rule === violation.rule
    && entry.snippet === violation.snippet,
  );
}

function violationKey(violation) {
  return `${violation.path}\u0000${violation.rule}\u0000${violation.context}\u0000${violation.snippet}`;
}

function keyframesWithAnimatedShadow(source) {
  const starts = /@keyframes\s+([\w-]+)\s*\{/gi;
  const matches = [];
  for (let match = starts.exec(source); match; match = starts.exec(source)) {
    let depth = 1;
    let end = starts.lastIndex;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
      end += 1;
    }
    const block = source.slice(match.index, end);
    if (/\bbox-shadow\s*:/i.test(block)) {
      matches.push({ index: match.index, snippet: `@keyframes ${match[1]} contiene box-shadow` });
    }
  }
  return matches;
}

function ambientKeyframes(source) {
  const starts = /@keyframes\s+([\w-]*(?:shimmer|pulse)[\w-]*)\s*\{/gi;
  const matches = [];
  for (let match = starts.exec(source); match; match = starts.exec(source)) {
    const name = match[1];
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cssInfiniteUse = new RegExp(
      `\\banimation(?:-name)?\\s*:[^;{}]*\\b${escapedName}\\b[^;{}]*\\binfinite\\b`,
      'i',
    );
    const tailwindInfiniteUse = [...source.matchAll(/\banimate-\[([^\]\n]+)\]/gi)].some(
      ([, value]) => value.startsWith(`${name}_`) && /infinite/i.test(value),
    );
    if (cssInfiniteUse.test(source) || tailwindInfiniteUse) {
      matches.push({ index: match.index, snippet: `@keyframes ${name}` });
    }
  }
  return matches;
}

function scanSource(relativePath, source, allowlist) {
  const violations = [];
  let allowed = 0;

  for (const [rule, expression] of RULES) {
    expression.lastIndex = 0;
    for (let match = expression.exec(source); match; match = expression.exec(source)) {
      const violation = {
        path: relativePath,
        line: lineAt(source, match.index),
        rule,
        context: contextAt(relativePath, source, match.index),
        snippet: normalized(match[0]),
      };
      if (isAllowed(violation, allowlist)) allowed += 1;
      else violations.push(violation);
    }
  }
  for (const match of keyframesWithAnimatedShadow(source)) {
    const violation = {
      path: relativePath,
      line: lineAt(source, match.index),
      rule: 'ombra animata',
      context: contextAt(relativePath, source, match.index),
      snippet: match.snippet,
    };
    if (isAllowed(violation, allowlist)) allowed += 1;
    else violations.push(violation);
  }
  for (const match of ambientKeyframes(source)) {
    const violation = {
      path: relativePath,
      line: lineAt(source, match.index),
      rule: 'animazione ambientale shimmer o pulse',
      context: contextAt(relativePath, source, match.index),
      snippet: match.snippet,
    };
    if (isAllowed(violation, allowlist)) allowed += 1;
    else violations.push(violation);
  }

  return { allowed, violations };
}

export function scanMotionBudget({ rootDir = ROOT_DIR, allowlist = ALLOWLIST } = {}) {
  const files = SOURCE_DIRS.flatMap((directory) => walk(path.join(rootDir, directory)));
  const violations = [];
  let allowed = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativePath = path.relative(rootDir, file).split(path.sep).join('/');
    const result = scanSource(relativePath, source, allowlist);
    allowed += result.allowed;
    violations.push(...result.violations);
  }
  return { files: files.length, allowed, violations };
}

function sourceAtRef(rootDir, ref, relativePath) {
  try {
    return execFileSync('git', ['show', `${ref}:${relativePath}`], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function resolveBaseRef(rootDir) {
  const explicitBase = process.env.MOTION_BUDGET_BASE_REF;
  if (explicitBase) {
    try {
      execFileSync('git', ['rev-parse', '--verify', explicitBase], {
        cwd: rootDir,
        stdio: 'ignore',
      });
      return explicitBase;
    } catch {
      throw new Error(`MOTION_BUDGET_BASE_REF non risolvibile: ${explicitBase}`);
    }
  }

  if (process.env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const before = typeof event.before === 'string' ? event.before : '';
      if (/^[0-9a-f]{40}$/i.test(before) && !/^0{40}$/.test(before)) {
        execFileSync('git', ['rev-parse', '--verify', `${before}^{commit}`], {
          cwd: rootDir,
          stdio: 'ignore',
        });
        return before;
      }
    } catch {
      // Gli eventi pull_request non hanno `before`; prosegue la risoluzione del branch base.
    }
  }

  const candidates = [];
  if (process.env.GITHUB_BASE_REF) {
    candidates.push(`origin/${process.env.GITHUB_BASE_REF}`, process.env.GITHUB_BASE_REF);
  }
  try {
    candidates.push(execFileSync(
      'git',
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim());
  } catch {
    // Il remote locale puo non dichiarare il branch predefinito.
  }
  candidates.push('origin/main', 'main', 'origin/master', 'master');

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      const mergeBase = execFileSync('git', ['merge-base', 'HEAD', candidate], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (mergeBase && mergeBase !== head) return mergeBase;
    } catch {
      // Prova il prossimo branch base noto.
    }
  }

  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...SOURCE_DIRS], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
  if (dirty) return 'HEAD';
  return 'HEAD^';
}

export function scanMotionBudgetDelta({ rootDir = ROOT_DIR, allowlist = ALLOWLIST, baseRef } = {}) {
  const current = scanMotionBudget({ rootDir, allowlist });
  const resolvedBaseRef = baseRef ?? resolveBaseRef(rootDir);
  const baselineCounts = new Map();
  const paths = new Set(current.violations.map((violation) => violation.path));

  for (const relativePath of paths) {
    const source = sourceAtRef(rootDir, resolvedBaseRef, relativePath);
    if (!source) continue;
    const baseline = scanSource(relativePath, source, allowlist);
    for (const violation of baseline.violations) {
      const key = violationKey(violation);
      baselineCounts.set(key, (baselineCounts.get(key) ?? 0) + 1);
    }
  }

  let existing = 0;
  const violations = current.violations.filter((violation) => {
    const key = violationKey(violation);
    const count = baselineCounts.get(key) ?? 0;
    if (count === 0) return true;
    baselineCounts.set(key, count - 1);
    existing += 1;
    return false;
  });

  return { ...current, baseRef: resolvedBaseRef, existing, violations };
}

export function formatReport(result) {
  if (result.violations.length === 0) {
    const existing = result.existing ? `, ${result.existing} debiti preesistenti invariati` : '';
    return `Budget di movimento Lume: OK (${result.files} file, ${result.allowed} eccezioni esplicite${existing}).`;
  }
  const rows = result.violations.map((item) =>
    `${item.path}:${item.line} [${item.rule}] ${item.snippet}`,
  );
  return [
    `Budget di movimento Lume: CONTRATTO VIOLATO (${result.violations.length} rilevazioni).`,
    ...rows,
    'Sanare la regola nella sorgente. Le eccezioni richiedono path, regola, dichiarazione e motivo espliciti nella allowlist.',
  ].join('\n');
}

function main() {
  try {
    const result = scanMotionBudgetDelta();
    console.log(formatReport(result));
    process.exitCode = result.violations.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Budget di movimento Lume: controllo non eseguibile: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
