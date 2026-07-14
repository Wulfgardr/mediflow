#!/usr/bin/env node
// @Codex: Lume motion budget guard. Dependency-free and fail-closed.

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

export function scanMotionBudget({ rootDir = ROOT_DIR, allowlist = ALLOWLIST } = {}) {
  const files = SOURCE_DIRS.flatMap((directory) => walk(path.join(rootDir, directory)));
  const violations = [];
  let allowed = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relativePath = path.relative(rootDir, file).split(path.sep).join('/');
    for (const [rule, expression] of RULES) {
      expression.lastIndex = 0;
      for (let match = expression.exec(source); match; match = expression.exec(source)) {
        const violation = {
          path: relativePath,
          line: lineAt(source, match.index),
          rule,
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
        snippet: match.snippet,
      };
      if (isAllowed(violation, allowlist)) allowed += 1;
      else violations.push(violation);
    }
  }
  return { files: files.length, allowed, violations };
}

export function formatReport(result) {
  if (result.violations.length === 0) {
    return `Budget di movimento Lume: OK (${result.files} file, ${result.allowed} eccezioni esplicite).`;
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
    const result = scanMotionBudget();
    console.log(formatReport(result));
    process.exitCode = result.violations.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Budget di movimento Lume: controllo non eseguibile: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
