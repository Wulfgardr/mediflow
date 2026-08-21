#!/usr/bin/env node
// Lume token contract checker (WUL-55, L1a). Dependency-free ESM.
// Verifies WCAG 2.x relative-luminance contrast for the declared Lume
// text/background pairs across the three registers giorno/grafite/guardia.
// Pure functions are exported for tests; running the file measures the
// committed docs/design/lume/tokens/lume.tokens.json and prints a report.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TOKENS_PATH = path.join(ROOT_DIR, 'docs/design/lume/tokens/lume.tokens.json');
export const DEFAULT_CSS_MIRROR_PATH = path.join(ROOT_DIR, 'app/lume-tokens.css');
export const DEFAULT_GLOBAL_CSS_PATH = path.join(ROOT_DIR, 'app/globals.css');

// @Codex: fail-closed repository scan for literal colors outside Lume.
const PALETTE_SOURCE_DIRS = ['app', 'components'];
const PALETTE_SOURCE_EXTENSIONS = new Set(['.css', '.tsx']);
const TAILWIND_PALETTE = '(?:blue|sky|indigo|violet|purple|emerald|green|lime|amber|yellow|orange|rose|pink|red|teal|cyan|fuchsia|slate|gray|zinc|neutral|stone)';
const TAILWIND_COLOR_UTILITY = new RegExp(
  '(?<![\\w-])(?:bg|text|border|ring|from|to|via|divide|outline|fill|stroke)-(?:' + TAILWIND_PALETTE + '-\\d+|white|black)(?:/\\d+)?(?![\\w-])',
  'gi',
);
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTION_COLOR = /\b(?:rgba?|hsla?)\((?:[^()]*)\)/gi;

// Ogni voce e un percorso con impronta e motivo: l'impronta include tutti i
// letterali legacy e le loro ripetizioni. La baseline deve combaciare
// esattamente: una voce che copre meno letterali di quelli dichiarati fallisce.
export const PALETTE_ALLOWLIST = [
  {"path":"app/mockups/scheda/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":7,"fingerprint":"a9261e48fe9ddbbcaa3ca087ea795d3f6cce439f8d8c67d20aa3849fce5a16c9"},
  {"path":"app/patients/[id]/edit/page.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":2,"fingerprint":"c465f2f78534069d2c5091795196bb3c49d4428b0c2aaa3a488617f7bc16d9a4"},
  {"path":"app/patients/[id]/scales/[scaleId]/page.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":8,"fingerprint":"2aa3c828cc9648c78578de11157a552e6a94dd15d7437c7e8b86d847a1024582"},
  {"path":"app/patients/[id]/scales/page.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":3,"fingerprint":"d5ff14dc1c75592ec7919d22cb7374120b0c3834bea183ea6fffd36e2e4fa75b"},
  {"path":"app/patients/new/page.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":4,"fingerprint":"0aa269a73f2eb260a9c4dbd49759a327de47595518ab671274424fe5aeb2af8d"},
  {"path":"app/settings/ai/funzioni/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":5,"fingerprint":"9f63101a17e633701731cbc5a283831e8a96df52452becbaeab278c198c93faa"},
  {"path":"app/settings/ai/modelli/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":61,"fingerprint":"493965ddbed94b495df6516fd0f8c6949a4ec0bdd9bb5fddacad59acf71acc5f"},
  {"path":"app/settings/ambulatories/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":3,"fingerprint":"680fb818b76e100c8f0a8f4d4d871e2f7bea91c77ff62fe8298f619428b68523"},
  {"path":"app/settings/repertori/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":33,"fingerprint":"2ab910cec7e2e11d9861bc9632c2b11fd5ae395d93b20b4a4167da18e1cbe3a7"},
  {"path":"app/settings/sviluppo/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"ec8b1f7e92f6ad06696229de18e38a2fe2e006b9e87fef48103be7be871cadb9"},
  {"path":"app/settings/zona-pericolo/page.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":43,"fingerprint":"7cd20b57f5c6e27c14e1ee2bc9078b34ad0f4cc85b57c5ec80fbc58120f56599"},
  {"path":"components/ai-patient-insight.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":127,"fingerprint":"ca7f44d09d259bfd512c7a5700d61688d1970482947ad5cd3d4d69d3c4a62ec4"},
  {"path":"components/auth-health-screen.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":10,"fingerprint":"ba19123282f85afe83d61f6431ef0f883384876d9373a6d5f8f687ed631934d1"},
  {"path":"components/backup-restore-ui.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":59,"fingerprint":"1f8a6e576438732f529a8a6dd7dd1ce7ede6a67ec2f92e5aada4d3ca7e2fe64a"},
  {"path":"components/backup-scheduler-ui.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":40,"fingerprint":"908888e7df27d1917f9a841840220547c63d884c0fb0a4d31c7e17ae44caa68d"},
  {"path":"components/data-seeder.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":107,"fingerprint":"f153fe70c92078aff36baa3e468f168b168b4dd36301f9894dc0bc5a48ed849a"},
  {"path":"components/diagnostic-hub.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":22,"fingerprint":"6fab8be8e6db6e8e6411b7b5d08e5053227ba40a7b7f51f56aec5370a4ed95ae"},
  {"path":"components/exemption-selector.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":3,"fingerprint":"9e174fff7276abf47e4f81a8679d8aef07472a4ded852fb5773aa5698eb64c52"},
  {"path":"components/followup-suggestions.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"a9ea794b338ca05d36f1aeb6c13712161214b7f3a9cedf5b258350d65177799c"},
  {"path":"components/kree8/kree8-workspace-shell.module.css","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":15,"fingerprint":"fa250e7b6f53574872e76a36673a80ee388f84d80626e55d761b82975aeb5dc7"},
  {"path":"components/observation-manager.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":2,"fingerprint":"316c0591b2c775a3511f7e3dfd261710a3cfa928cfe22a488d81aba90bc9ef38"},
  {"path":"components/patient-clinical-signals.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":7,"fingerprint":"16ced9b1b6a637581983755058a65c6dd29d74703fb442d488e1b88f01bbb2c7"},
  {"path":"components/patient-document-import-review.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":4,"fingerprint":"dde9d41cdd6acf1b150e71385a5734c7892bf07682c496287eb136aaf3feb179"},
  {"path":"components/patient-form.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":6,"fingerprint":"d951c75dec7e4f2efc7a68b2c81e7b9a472660d00422e24dbc9c7012f696d22e"},
  {"path":"components/scale-engine.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":3,"fingerprint":"81a39fe2423dffcee6aef072f8ad23aa371607578aeab5d494686b8363031e1a"},
  {"path":"components/service-architecture-panel.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":55,"fingerprint":"8c544348e9f098417d6c6e44839928d4c6c0897c2cbcde1279e9eeca631de15f"},
  {"path":"components/settings/ai-model-parliament-panel.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":142,"fingerprint":"418913b2d5d845cf4298742a705d626c3b756b37ad6a31fc55051abb995ba1ab"},
  {"path":"components/settings/ai-model-selector.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"df13a493dbddcbcc063e8c184254da292afd6f96485dc9ecfd49b7dd53ad05a1"},
  {"path":"components/settings/ai-rollout-guard-notice.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":58,"fingerprint":"e6730ba7ad92f247c44235f36108c9a0253f266df5b441eeeec76eb68d0ca25d"},
  {"path":"components/settings/ai-rollout-readiness-panel.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":164,"fingerprint":"b9e478ca6bf287186726e9eeec945f50335f9fe6e098fda65644a91340879e9b"},
  {"path":"components/settings/drug-db-manager.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":49,"fingerprint":"bde1223c75bcc9eb4db5ceb3b284bf4a03d431c39f1ae9a8bdd0f17c923b590d"},
  {"path":"components/settings/exemption-db-manager.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":43,"fingerprint":"abd7a2dd6152e443664f6882d5fe4cf1009a5509864ecff269c56e838807296e"},
  {"path":"components/settings/network-operating-mode-panel.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":232,"fingerprint":"e7ad7ca7e5b04731b2e1024468b383c4d345082b21c3a8e01dc7c538e408d0d6"},
  {"path":"components/settings/settings-search.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"30b66e71736711489accadafb52c1196a07501b44cbe3da7eac0cb30824ac0b6"},
  {"path":"components/settings/update-awareness-panel.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":14,"fingerprint":"90bf901f29bf2adcbaa9e4642612d6af651bb684d5b8c0c70deee31f4f15b1fa"},
  {"path":"components/siss-patient-context-panel.tsx","reason":"Debito storico su superficie clinica: migrazione Lume da completare.","occurrences":4,"fingerprint":"dc1abc5bf03e92d3a95f90b3d3cea35b86b946c46faa6df73b3fa8e426f5db0b"},
  {"path":"components/ui/button.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"a9ea794b338ca05d36f1aeb6c13712161214b7f3a9cedf5b258350d65177799c"},
  {"path":"components/ui/toast-provider.tsx","reason":"Debito storico su superficie non clinica: migrazione Lume da completare.","occurrences":1,"fingerprint":"7d5a19cd0a4184d467eea48394d1bd77a823ec405266a9858031ba0dac8b3620"},
];

// Classificazione dichiarata: queste superfici mostrano o compongono la
// scheda paziente. Tutto il resto e non clinico finche non viene aggiunto qui.
const CLINICAL_SURFACE_PREFIXES = [
  'app/patients/',
  'app/diary/',
  'components/kree8/',
];
const CLINICAL_COMPONENT_NAMES = new Set([
  'therapy-manager',
  'service-prescription-manager',
  'prosthetic-prescription-manager',
  'observation-manager',
  'drug-autocomplete',
  'icd-autocomplete',
  'exemption-selector',
  'followup-suggestions',
  'scale-engine',
  'ai-patient-insight',
  'treatment-reasoning-panel',
  'pdf-importer',
  'evidence-stack-tile',
]);
const CLINICAL_COMPONENT_PREFIXES = [
  'patient-',
  'document-',
  'clinical-',
  'timeline',
  'siss-',
];
function walkColorSource(directory) {
  if (!existsSync(directory)) throw new Error('directory mancante: ' + directory);
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkColorSource(entryPath);
      return PALETTE_SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
    });
}

function normalizeLiteral(value) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeHexLiteral(value) {
  const literal = normalizeLiteral(value);
  if (/^#[0-9a-f]{3}$/.test(literal)) {
    return '#' + literal.slice(1).split('').map((channel) => channel.repeat(2)).join('');
  }
  return literal;
}

function isPureWhiteOrBlack(value) {
  const normalized = normalizeHexLiteral(value);
  if (normalized === '#ffffff' || normalized === '#000000') return true;
  const hsl = /^(?:hsl|hsla)\(\s*[+-]?(?:\d|\.\d)+(?:deg|rad|turn)?(?:\s*,\s*|\s+)0%(?:\s*,\s*|\s+)(?:0|100)%(?:\s*(?:,|\/)\s*1(?:\.0+)?)?\s*\)$/.exec(normalized);
  if (hsl) return true;
  const match = /^(?:rgb|rgba)\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*1(?:\.0+)?)?\s*\)$/.exec(normalized);
  if (!match) return false;
  const channels = match.slice(1, 4).map(Number);
  return channels.every((channel) => channel === 0) || channels.every((channel) => channel === 255);
}

function collectTokenHexValues(node, values = new Set()) {
  if (!node || typeof node !== 'object') return values;
  if ('$value' in node) {
    values.add(normalizeHexLiteral(node.$value));
    return values;
  }
  for (const value of Object.values(node)) collectTokenHexValues(value, values);
  return values;
}

function isContractColor(value, tokenValues) {
  const normalized = normalizeLiteral(value);
  return tokenValues.has(normalizeHexLiteral(value))
    || isPureWhiteOrBlack(normalized)
    || ['transparent', 'currentcolor', 'inherit'].includes(normalized);
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function isLiteralFunctionalColor(value) {
  return /^(?:rgb|rgba|hsl|hsla)\(\s*[+-]?(?:\d|\.\d)/.test(normalizeLiteral(value));
}

function clinicalVisiblePath(relativePath) {
  if (CLINICAL_SURFACE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return true;
  if (!relativePath.startsWith('components/')) return false;
  const componentName = path.posix.basename(relativePath).replace(/\.(?:tsx|css)$/, '');
  return CLINICAL_COMPONENT_NAMES.has(componentName)
    || CLINICAL_COMPONENT_PREFIXES.some((prefix) => componentName.startsWith(prefix));
}

function literalKey(finding) {
  return finding.kind + '\u0000' + finding.value;
}

export function findPaletteLiterals(relativePath, source) {
  const findings = [];
  for (const expression of [HEX_COLOR, FUNCTION_COLOR, TAILWIND_COLOR_UTILITY]) {
    expression.lastIndex = 0;
    for (let match = expression.exec(source); match; match = expression.exec(source)) {
      const kind = expression === HEX_COLOR
        ? 'hex'
        : expression === FUNCTION_COLOR
          ? 'funzione CSS'
          : 'utility Tailwind';
      if (kind === 'funzione CSS' && !isLiteralFunctionalColor(match[0])) continue;
      findings.push({ path: relativePath, line: lineAt(source, match.index), kind, value: normalizeLiteral(match[0]) });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

export function paletteFingerprint(findings) {
  const multiset = new Map();
  for (const finding of findings) multiset.set(literalKey(finding), (multiset.get(literalKey(finding)) ?? 0) + 1);
  const stable = [...multiset].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function allowlistByPath(allowlist) {
  const entries = new Map();
  for (const entry of allowlist) {
    const displayPath = typeof entry?.path === 'string' && entry.path.trim()
      ? entry.path
      : '<path mancante>';
    const errors = [];
    if (!entry || typeof entry !== 'object') {
      errors.push('la voce deve essere un oggetto');
    } else {
      if (typeof entry.path !== 'string' || !entry.path.trim()) errors.push('path mancante');
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push('reason mancante');
      if (!Number.isInteger(entry.occurrences) || entry.occurrences <= 0) {
        errors.push('occurrences deve essere un intero positivo');
      }
      if (!/^[a-f0-9]{64}$/.test(entry.fingerprint ?? '')) {
        errors.push('fingerprint deve contenere 64 caratteri esadecimali');
      }
    }
    if (errors.length > 0) {
      throw new Error(`voce di allowlist invalida per ${displayPath}: ${errors.join('; ')}. Correggi la voce o rimuovila.`);
    }
    if (entries.has(entry.path)) throw new Error('allowlist palette duplicata: ' + entry.path);
    entries.set(entry.path, entry);
  }
  return entries;
}

export function scanPaletteSource({ relativePath, source, tokens, allowlist = PALETTE_ALLOWLIST }) {
  const tokenValues = collectTokenHexValues(tokens);
  const legacy = findPaletteLiterals(relativePath, source)
    .filter((finding) => finding.kind === 'utility Tailwind' || !isContractColor(finding.value, tokenValues));
  const entry = allowlistByPath(allowlist).get(relativePath);
  const fingerprint = paletteFingerprint(legacy);
  const allowed = entry && entry.occurrences === legacy.length && entry.fingerprint === fingerprint;
  const allowlistIssues = [];
  if (entry && !allowed && legacy.length <= entry.occurrences) {
    const fingerprintNote = legacy.length === entry.occurrences
      ? ' L\'impronta non coincide con la baseline dichiarata.'
      : '';
    allowlistIssues.push({
      kind: 'stale',
      path: relativePath,
      message: `voce di allowlist stale per ${relativePath}: dichiarate ${entry.occurrences}, trovate ${legacy.length}. Aggiorna occurrences+fingerprint o rimuovi la voce.${fingerprintNote}`,
    });
  }
  return {
    allowed: allowed ? legacy.length : 0,
    clinicalDebt: allowed && clinicalVisiblePath(relativePath) ? legacy : [],
    violations: allowed || allowlistIssues.length > 0 ? [] : legacy,
    allowlistIssues,
  };
}

export function scanPalette({ rootDir = ROOT_DIR, tokens = loadTokens(), allowlist = PALETTE_ALLOWLIST } = {}) {
  const entries = allowlistByPath(allowlist);
  const files = PALETTE_SOURCE_DIRS.flatMap((directory) => walkColorSource(path.join(rootDir, directory)));
  const aggregate = { files: files.length, allowed: 0, clinicalDebt: [], violations: [], allowlistIssues: [] };
  const scannedPaths = new Set();
  for (const file of files) {
    const relativePath = path.relative(rootDir, file).split(path.sep).join('/');
    const result = scanPaletteSource({ relativePath, source: readFileSync(file, 'utf8'), tokens, allowlist });
    scannedPaths.add(relativePath);
    aggregate.allowed += result.allowed;
    aggregate.clinicalDebt.push(...result.clinicalDebt);
    aggregate.violations.push(...result.violations);
    aggregate.allowlistIssues.push(...result.allowlistIssues);
  }
  for (const entry of entries.values()) {
    if (!scannedPaths.has(entry.path)) {
      aggregate.allowlistIssues.push({
        kind: 'orphan',
        path: entry.path,
        message: `voce orfana di allowlist per ${entry.path}: il file non esiste piu. Rimuovi la voce.`,
      });
    }
  }
  return aggregate;
}

export function formatPaletteReport(result) {
  const lines = [
    'Lume palette guard: ' + result.files + ' file analizzati, ' + result.allowed + ' occorrenze di debito noto in allowlist.',
    'Debito clinico (ERRORE storico allowlisted): ' + result.clinicalDebt.length + ' occorrenze su superfici clinico-visibili.',
  ];
  for (const issue of result.allowlistIssues) lines.push('ERRORE ALLOWLIST ' + issue.message);
  for (const finding of result.violations) {
    const severity = clinicalVisiblePath(finding.path) ? 'ERRORE CLINICO' : 'ERRORE';
    lines.push(severity + ' ' + finding.path + ':' + finding.line + ' ' + finding.kind + ' ' + finding.value + '. Usa var(--lume-...) oppure motiva in allowlist.');
  }
  const failed = result.violations.length + result.allowlistIssues.length;
  lines.push(failed === 0 ? 'Palette Lume: OK' : 'Palette Lume: CONTRATTO VIOLATO (' + failed + ' problemi).');
  return lines.join('\n');
}


export const REGISTERS = ['giorno', 'grafite', 'guardia'];
export const SURFACES = ['canvas', 'field', 'focal', 'chrome'];
export const SIGNALS = ['warning', 'critical', 'success', 'plum'];
// Normal-size text must clear WCAG AA 4.5:1. accent.minerale is documented as
// interactive text (links, minerale admin queue), so it uses the text threshold
// on the work surfaces (field = penombra, focal = fuoco) where it carries text.
export const TEXT_MIN_RATIO = 4.5;
export const SIGNAL_TEXT_WEIGHT = 0.6;
export const SIGNAL_TINT_WEIGHT = 0.1;
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

export function mixHexColors(hexA, weightA, hexB) {
  if (!Number.isFinite(weightA) || weightA < 0 || weightA > 1) {
    throw new Error(`invalid color-mix weight: ${weightA}`);
  }
  const a = parseHexColor(hexA);
  const b = parseHexColor(hexB);
  const channel = (key) => Math.round(a[key] * weightA + b[key] * (1 - weightA));
  return `#${[channel('r'), channel('g'), channel('b')]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
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
    for (const signal of SIGNALS) {
      checks.push({
        register,
        label: `signal.${signal} text on 10% signal tint`,
        signal: `signal.${signal}`,
        ink: `register.${register}.ink.primary`,
        surface: `register.${register}.surface.field`,
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
    const text = c.signal
      ? mixHexColors(resolveColor(tokens, c.signal), SIGNAL_TEXT_WEIGHT, resolveColor(tokens, c.ink))
      : resolveColor(tokens, c.text);
    const background = c.signal
      ? mixHexColors(resolveColor(tokens, c.signal), SIGNAL_TINT_WEIGHT, resolveColor(tokens, c.surface))
      : resolveColor(tokens, c.background);
    const ratio = contrastRatio(text, background);
    return { ...c, measuredText: text, measuredBackground: background, ratio, pass: ratio >= c.minRatio };
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

export function loadGlobalStyles(cssPath = DEFAULT_GLOBAL_CSS_PATH) {
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

function cssWeight(weight) {
  const percent = weight * 100;
  if (!Number.isInteger(percent)) throw new Error(`CSS weight must be an integer percentage: ${weight}`);
  return `${percent}%`;
}

// @Codex WUL-517: blocca le dichiarazioni sorgente per il sottoinsieme elencato.
// evaluateContract misura testo e tinta; il bordo resta un peso sorgente
// esplicito. Specificità, !important e override esterni non sono una prova della
// cascade effettiva e restano contratti separati.
export const GLOBAL_STYLE_RECIPES = [
  ...['graphite-chip-tone', 'mf-alert'].flatMap((family) =>
    ['success', 'warning', 'critical'].map((signal) => ({
      selector: `.${family}-${signal}`,
      declarations: {
        'border-color': `color-mix(in srgb, var(--lume-signal-${signal}) 30%, transparent)`,
        'background-color': `color-mix(in srgb, var(--lume-signal-${signal}) ${cssWeight(SIGNAL_TINT_WEIGHT)}, var(--lume-surface-field))`,
        color: `color-mix(in srgb, var(--lume-signal-${signal}) ${cssWeight(SIGNAL_TEXT_WEIGHT)}, var(--lume-ink))`,
      },
      kind: 'semantic',
    })),
  ),
  {
    selector: '.siss-blocked-item-reason',
    declarations: {
      color: `color-mix(in srgb, var(--lume-signal-warning) ${cssWeight(SIGNAL_TEXT_WEIGHT)}, var(--lume-ink))`,
    },
    kind: 'semantic',
  },
  {
    selector: '.mf-modal-backdrop',
    declarations: { background: 'color-mix(in srgb, var(--lume-giorno-ink-primary) 62%, transparent)' },
    kind: 'scrim',
    target: '.mf-modal-backdrop',
    allowedSelectors: ['.mf-modal-backdrop', ':root.dark .mf-modal-backdrop'],
  },
  {
    selector: ':root.dark .mf-modal-backdrop',
    declarations: { background: 'color-mix(in srgb, var(--lume-guardia-surface-chrome) 78%, transparent)' },
    kind: 'scrim',
    target: '.mf-modal-backdrop',
    allowedSelectors: ['.mf-modal-backdrop', ':root.dark .mf-modal-backdrop'],
  },
  {
    selector: '.mf-popover',
    declarations: {
      'box-shadow': '0 22px 44px color-mix(in srgb, var(--lume-giorno-ink-primary) 14%, transparent)',
    },
    kind: 'shadow',
    target: '.mf-popover',
    allowedSelectors: ['.mf-popover', ':root.dark .mf-popover'],
  },
  {
    selector: ':root.dark .mf-popover',
    declarations: {
      'box-shadow': '0 26px 52px color-mix(in srgb, var(--lume-guardia-surface-chrome) 70%, transparent)',
    },
    kind: 'shadow',
    target: '.mf-popover',
    allowedSelectors: ['.mf-popover', ':root.dark .mf-popover'],
  },
];

function braceDepthAt(css, end) {
  let depth = 0;
  for (let index = 0; index < end; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
  }
  return depth;
}

function parseStyleRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (let rule = ruleRe.exec(clean); rule; rule = ruleRe.exec(clean)) {
    const declarations = new Map();
    const duplicateDeclarations = new Set();
    const declarationRe = /(?:^|;)\s*([a-zA-Z-]+)\s*:\s*([^;]+?)(?=;|$)/g;
    for (let declaration = declarationRe.exec(rule[2]); declaration; declaration = declarationRe.exec(rule[2])) {
      const rawProperty = declaration[1].trim();
      const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase();
      if (declarations.has(property)) duplicateDeclarations.add(property);
      declarations.set(property, declaration[2].replace(/\s+/g, ' ').trim());
    }
    rules.push({
      selectors: rule[1].split(',').map((selector) => selector.replace(/\s+/g, ' ').trim()),
      declarations,
      duplicateDeclarations,
      depth: braceDepthAt(clean, rule.index),
    });
  }
  return rules;
}

function selectorTargetsRecipe(selector, recipeSelector) {
  if (!recipeSelector.startsWith('.')) return false;
  const className = recipeSelector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_-])\\.${className}(?![a-zA-Z0-9_-])`).test(selector);
}

export function verifyGlobalStyles(css) {
  const rules = parseStyleRules(css);
  for (const recipe of GLOBAL_STYLE_RECIPES) {
    const target = recipe.target ?? recipe.selector;
    const allowedSelectors = recipe.allowedSelectors ?? [recipe.selector];
    const targetedRules = rules.filter((rule) =>
      rule.selectors.some((selector) => selectorTargetsRecipe(selector, target)));
    if (targetedRules.some((rule) => rule.depth > 0)) {
      throw new Error(`global CSS ${recipe.selector} must not be conditional`);
    }
    if (targetedRules.some((rule) => rule.selectors.some((selector) =>
      selectorTargetsRecipe(selector, target) && !allowedSelectors.includes(selector)))) {
      throw new Error(`global CSS ${recipe.selector} has a non-canonical override selector`);
    }
    const matches = rules.filter((rule) => rule.depth === 0 && rule.selectors.includes(recipe.selector));
    if (matches.length !== 1) throw new Error(`global CSS requires exactly one ${recipe.selector} rule`);
    if (matches[0].duplicateDeclarations.size > 0) {
      throw new Error(`global CSS ${recipe.selector} has duplicate declarations`);
    }
    for (const [property, expected] of Object.entries(recipe.declarations)) {
      const got = matches[0].declarations.get(property);
      if (got === undefined) throw new Error(`global CSS ${recipe.selector} missing ${property}`);
      if (got !== expected) throw new Error(`global CSS ${recipe.selector} ${property} is ${got}, expected ${expected}`);
    }
    if (Object.hasOwn(recipe.declarations, 'background-color') && matches[0].declarations.has('background')) {
      throw new Error(`global CSS ${recipe.selector} has an interfering background shorthand`);
    }
    if (Object.hasOwn(recipe.declarations, 'background') && matches[0].declarations.has('background-color')) {
      throw new Error(`global CSS ${recipe.selector} has an interfering background-color declaration`);
    }
    const interferingBorder = [...matches[0].declarations.keys()].find((property) =>
      property === 'border'
      || /^(?:border-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)(?:-(?:color|style|width))?$/.test(property)
      || /^border-(?:style|width)$/.test(property));
    if (Object.keys(recipe.declarations).some((property) => property.startsWith('border-'))
      && interferingBorder !== undefined) {
      throw new Error(`global CSS ${recipe.selector} has an interfering border shorthand`);
    }
    if (matches[0].declarations.has('all')) {
      throw new Error(`global CSS ${recipe.selector} has an interfering all shorthand`);
    }
  }
  return {
    recipes: GLOBAL_STYLE_RECIPES.length,
    semanticRecipes: GLOBAL_STYLE_RECIPES.filter((recipe) => recipe.kind === 'semantic').length,
    scrimRecipes: GLOBAL_STYLE_RECIPES.filter((recipe) => recipe.kind === 'scrim').length,
    shadowRecipes: GLOBAL_STYLE_RECIPES.filter((recipe) => recipe.kind === 'shadow').length,
  };
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
  let globalStyles;
  let palette;
  try {
    const tokens = loadTokens();
    result = evaluateContract(tokens);
    mirror = verifyCssMirror(tokens, loadCssMirror());
    globalStyles = verifyGlobalStyles(loadGlobalStyles());
    palette = scanPalette({ tokens });
  } catch (error) {
    console.error(`lume token check failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatReport(result));
  console.log(`CSS mirror app/lume-tokens.css: ${mirror.tokens} namespaced tokens matched, ${mirror.aliases} active aliases per theme OK`);
  console.log(
    `CSS source app/globals.css: ${globalStyles.semanticRecipes} semantic, `
    + `${globalStyles.scrimRecipes} scrim and ${globalStyles.shadowRecipes} shadow recipes matched`,
  );
  console.log(formatPaletteReport(palette));
  process.exitCode = result.pass && palette.violations.length === 0 && palette.allowlistIssues.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
