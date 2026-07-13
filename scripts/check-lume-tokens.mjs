#!/usr/bin/env node
// Lume token contract checker (WUL-55, L1a). Dependency-free ESM.
// Verifies WCAG 2.x relative-luminance contrast for the declared Lume
// text/background pairs across the three registers giorno/grafite/guardia.
// Pure functions are exported for tests; running the file measures the
// committed docs/design/lume/tokens/lume.tokens.json and prints a report.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TOKENS_PATH = path.join(ROOT_DIR, 'docs/design/lume/tokens/lume.tokens.json');
export const DEFAULT_CSS_MIRROR_PATH = path.join(ROOT_DIR, 'app/lume-tokens.css');

export const REGISTERS = ['giorno', 'grafite', 'guardia'];
export const SURFACES = ['canvas', 'field', 'focal', 'chrome'];
export const SIGNALS = ['warning', 'critical', 'success', 'plum'];
// Normal-size text must clear WCAG AA 4.5:1. accent.minerale is documented as
// interactive text (links, minerale admin queue), so it uses the text threshold
// on the work surfaces (field = penombra, focal = fuoco) where it carries text.
export const TEXT_MIN_RATIO = 4.5;
const ACCENT_TEXT_SURFACES = ['field', 'focal'];

// Parse "#rrggbb" (case-insensitive). Fails closed: throws on anything else.
export function parseHexColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`malformed color: ${JSON.stringify(value)}`);
  }
  const n = Number.parseInt(value.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of a "#rrggbb" color.
export function relativeLuminance(hex) {
  const { r, g, b } = parseHexColor(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

// WCAG contrast ratio between two colors, in [1, 21].
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Resolve a dotted token path to its "#rrggbb" value. Fails closed: throws if
// the path is missing or the leaf is not a DTCG color token.
export function resolveColor(tokens, dottedPath) {
  let node = tokens;
  for (const key of dottedPath.split('.')) {
    if (!node || typeof node !== 'object' || !(key in node)) {
      throw new Error(`missing token: ${dottedPath}`);
    }
    node = node[key];
  }
  if (!node || typeof node !== 'object' || !('$value' in node)) {
    throw new Error(`missing token value: ${dottedPath}`);
  }
  parseHexColor(node.$value); // throws on malformed
  return node.$value;
}

// Deterministic ordered contract: primary + muted text on every surface, then
// accent text on the work surfaces, for each register.
export function buildContract() {
  const checks = [];
  for (const register of REGISTERS) {
    for (const ink of ['primary', 'muted']) {
      for (const surface of SURFACES) {
        checks.push({
          register,
          label: `ink.${ink} on surface.${surface}`,
          text: `register.${register}.ink.${ink}`,
          background: `register.${register}.surface.${surface}`,
          minRatio: TEXT_MIN_RATIO,
        });
      }
    }
    for (const surface of ACCENT_TEXT_SURFACES) {
      checks.push({
        register,
        label: `accent.minerale on surface.${surface}`,
        text: `register.${register}.accent.minerale`,
        background: `register.${register}.surface.${surface}`,
        minRatio: TEXT_MIN_RATIO,
      });
    }
  }
  return checks;
}

// Pure evaluation: given parsed tokens, measure every contract pair. Fails
// closed by throwing (via resolveColor) on any missing/malformed required token.
export function evaluateContract(tokens, contract = buildContract()) {
  for (const signal of SIGNALS) resolveColor(tokens, `signal.${signal}`);
  const checks = contract.map((c) => {
    const ratio = contrastRatio(resolveColor(tokens, c.text), resolveColor(tokens, c.background));
    return { ...c, ratio, pass: ratio >= c.minRatio };
  });
  return { checks, pass: checks.every((c) => c.pass) };
}

// Concise deterministic report grouped by register.
export function formatReport(result) {
  const lines = ['Lume token contract: WCAG contrast (measured)'];
  for (const register of REGISTERS) {
    lines.push(`register ${register}`);
    for (const c of result.checks.filter((x) => x.register === register)) {
      const ratio = `${c.ratio.toFixed(3)}:1`.padStart(9);
      lines.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${ratio}  (min ${c.minRatio}:1)  ${c.label}`);
    }
  }
  const failed = result.checks.filter((c) => !c.pass).length;
  lines.push(`${result.checks.length} pairs measured, ${failed} below threshold: ${result.pass ? 'OK' : 'CONTRACT VIOLATED'}`);
  return lines.join('\n');
}

export function loadTokens(tokensPath = DEFAULT_TOKENS_PATH) {
  return JSON.parse(readFileSync(tokensPath, 'utf8'));
}

export function loadCssMirror(cssPath = DEFAULT_CSS_MIRROR_PATH) {
  return readFileSync(cssPath, 'utf8');
}

// Active aliases resolve at runtime to a register-scoped variable.
export const ACTIVE_ALIASES = [
  { alias: '--lume-surface-canvas', suffix: 'surface-canvas' },
  { alias: '--lume-surface-field', suffix: 'surface-field' },
  { alias: '--lume-surface-focal', suffix: 'surface-focal' },
  { alias: '--lume-surface-chrome', suffix: 'surface-chrome' },
  { alias: '--lume-ink', suffix: 'ink-primary' },
  { alias: '--lume-ink-muted', suffix: 'ink-muted' },
  { alias: '--lume-accent', suffix: 'accent-minerale' },
];

export function expectedMirror(tokens) {
  const map = new Map();
  for (const register of REGISTERS) {
    for (const surface of SURFACES) {
      map.set(`--lume-${register}-surface-${surface}`, resolveColor(tokens, `register.${register}.surface.${surface}`));
    }
    map.set(`--lume-${register}-ink-primary`, resolveColor(tokens, `register.${register}.ink.primary`));
    map.set(`--lume-${register}-ink-muted`, resolveColor(tokens, `register.${register}.ink.muted`));
    map.set(`--lume-${register}-accent-minerale`, resolveColor(tokens, `register.${register}.accent.minerale`));
  }
  for (const signal of SIGNALS) {
    map.set(`--lume-signal-${signal}`, resolveColor(tokens, `signal.${signal}`));
  }
  return map;
}

const NAMESPACED_TOKEN = /^--lume-(?:giorno|grafite|guardia)-|^--lume-signal-/;

export function parseCssBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rule;
  while ((rule = ruleRe.exec(clean)) !== null) {
    const decls = new Map();
    const declRe = /(--[\w-]+)\s*:\s*([^;]+?)(?:;|$)/g;
    let decl;
    while ((decl = declRe.exec(rule[2])) !== null) {
      const name = decl[1].trim();
      if (decls.has(name)) throw new Error(`mirror duplicate declaration: ${name}`);
      decls.set(name, decl[2].trim());
    }
    blocks.push({ selector: rule[1].trim(), decls });
  }
  return blocks;
}

function normalizeHex(value) {
  const trimmed = value.trim();
  parseHexColor(trimmed); // fail closed on a malformed mirror value
  return trimmed.toLowerCase();
}

export function verifyCssMirror(tokens, css) {
  const blocks = parseCssBlocks(css);
  const flat = new Map();
  for (const block of blocks) {
    for (const [name, value] of block.decls) {
      if (NAMESPACED_TOKEN.test(name) && flat.has(name)) throw new Error(`mirror duplicate token: ${name}`);
      if (!flat.has(name)) flat.set(name, value);
    }
  }
  const expected = expectedMirror(tokens);
  for (const [name, hex] of expected) {
    const got = flat.get(name);
    if (got === undefined) throw new Error(`mirror missing token: ${name}`);
    if (normalizeHex(got) !== normalizeHex(hex)) throw new Error(`mirror drift: ${name} is ${got}, expected ${hex}`);
  }
  for (const name of flat.keys()) {
    if (NAMESPACED_TOKEN.test(name) && !expected.has(name)) throw new Error(`mirror unknown token: ${name}`);
  }
  const roots = blocks.filter((block) => block.selector.split(',').some((s) => s.trim() === ':root'));
  const darks = blocks.filter((block) => block.selector.split(',').some((s) => s.trim() === '.dark'));
  if (roots.length !== 1) throw new Error('mirror requires exactly one :root block');
  if (darks.length !== 1) throw new Error('mirror requires exactly one .dark block');
  const [root] = roots;
  const [dark] = darks;
  const aliasNames = new Set(ACTIVE_ALIASES.map(({ alias }) => alias));
  for (const block of blocks) {
    if (block !== root && block !== dark && [...block.decls.keys()].some((name) => aliasNames.has(name))) {
      throw new Error(`mirror active alias outside theme block: ${block.selector}`);
    }
  }
  for (const { alias, suffix } of ACTIVE_ALIASES) {
    assertAlias(root.decls, alias, `var(--lume-giorno-${suffix})`, ':root/giorno');
    assertAlias(dark.decls, alias, `var(--lume-grafite-${suffix})`, '.dark/grafite');
  }
  return { tokens: expected.size, aliases: ACTIVE_ALIASES.length };
}

function assertAlias(decls, alias, expectedValue, where) {
  const got = decls.get(alias);
  if (got === undefined) throw new Error(`mirror missing active alias ${alias} in ${where}`);
  if (got.replace(/\s+/g, '') !== expectedValue.replace(/\s+/g, '')) {
    throw new Error(`mirror alias ${alias} in ${where} is ${got}, expected ${expectedValue}`);
  }
}

function main() {
  let result;
  let mirror;
  try {
    const tokens = loadTokens();
    result = evaluateContract(tokens);
    mirror = verifyCssMirror(tokens, loadCssMirror());
  } catch (error) {
    console.error(`lume token check failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatReport(result));
  console.log(`CSS mirror app/lume-tokens.css: ${mirror.tokens} namespaced tokens matched, ${mirror.aliases} active aliases per theme OK`);
  process.exitCode = result.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
