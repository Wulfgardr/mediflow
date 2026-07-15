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

// @Codex: fail-closed repository scan for literal colors outside Lume.
const PALETTE_SOURCE_DIRS = ['app', 'components'];
const PALETTE_SOURCE_EXTENSIONS = new Set(['.css', '.tsx']);
const TAILWIND_PALETTE = '(?:blue|sky|indigo|violet|purple|emerald|green|lime|amber|yellow|orange|rose|pink|red|teal|cyan|fuchsia)';
const TAILWIND_COLOR_UTILITY = new RegExp('\\b(?:bg|text|border|ring|from|to|via)-' + TAILWIND_PALETTE + '-\\d+\\b', 'gi');
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTION_COLOR = /\b(?:rgba?|hsla?)\((?:[^()]*)\)/gi;

// Ogni voce e un percorso con impronta e motivo: l'impronta include tutti i
// letterali legacy e le loro ripetizioni, percio una nuova occorrenza fallisce.
export const PALETTE_ALLOWLIST = [
  {"path":"app/analytics/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":12,"fingerprint":"ba3188e0b0a32411ade0d064e4450c195e7db3fdc9da223bd47b564e32a5d2c7"},
  {"path":"app/globals.css","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":83,"fingerprint":"4aebcec989394fe0027ad3ac9b16899a7b9a159831695dfe2c1e6af76534c3f6"},
  {"path":"app/mockups/scheda/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":3,"fingerprint":"d25c74a1018e6e4417b52c09003931bc9c768dd381b2b35ef5950c48e527929c"},
  {"path":"app/patients/[id]/edit/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":2,"fingerprint":"c465f2f78534069d2c5091795196bb3c49d4428b0c2aaa3a488617f7bc16d9a4"},
  {"path":"app/patients/[id]/entries/new/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":37,"fingerprint":"a8a5e231520af0c39e7e19211bcbd5761e517724422746a3c3fdea5d568549bb"},
  {"path":"app/patients/[id]/modules/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":16,"fingerprint":"d44130812fcce459c5e33161de59b2086989474281c4ccff2972622ba2ae7597"},
  {"path":"app/patients/[id]/scales/[scaleId]/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":6,"fingerprint":"55aee2e3a707291d2f8b72f1af9a672b8ff0c64ee60901f016de29d904c20d69"},
  {"path":"app/patients/[id]/scales/page.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":1,"fingerprint":"e6f00034c97e30817001164b0f9369f07e105b2030c61c5bb0fb45d990359726"},
  {"path":"app/settings/accesso/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":2,"fingerprint":"8948be7ef5e5d8fc4cb645ac20e78e2a26515b5678287da82acec38735fd9885"},
  {"path":"app/settings/ai/funzioni/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":60,"fingerprint":"ccb7c352ee933f679a00257a03753ae67e7114a8527b1061eb1eb20aaa984818"},
  {"path":"app/settings/ai/modelli/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":20,"fingerprint":"8b3de9f862e782973d291ee0439ef12bbdeda6f81176d26f2f314e6340ada646"},
  {"path":"app/settings/ambulatories/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":12,"fingerprint":"cca3f7e71b8f040a8fa5d9ef07a6fd0a3e98ddc032e440a55b692f491c97c709"},
  {"path":"app/settings/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":4,"fingerprint":"590af0d5ded8f9bcc8276244c5197ec75f05054c2f7c4da4dacd118a380183fc"},
  {"path":"app/settings/profilo/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":1,"fingerprint":"ca27912f2918f354e5eb122bd8394691b50f6345542cca1a68402906cfa1408a"},
  {"path":"app/settings/repertori/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":2,"fingerprint":"049ac245152030ba12bf24a85769b378cbb2f20733c77a7d4646bf053d678ee5"},
  {"path":"app/settings/sviluppo/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":1,"fingerprint":"ec8b1f7e92f6ad06696229de18e38a2fe2e006b9e87fef48103be7be871cadb9"},
  {"path":"app/settings/zona-pericolo/page.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":30,"fingerprint":"5efad12b669d71867acbeb850f7d3a6327dd62f8950c44983b8efeb64889308d"},
  {"path":"components/ai-patient-insight.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":26,"fingerprint":"1d4f642816ba61fb9e4a3d0187b165b977c2c69dc919fca4220b3dfe31da9b39"},
  {"path":"components/auth-health-screen.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":7,"fingerprint":"14054d0a0c7cd1ee708933f3650d0ea0c9b0b3a304aab68f2a71e539770d9dcc"},
  {"path":"components/backup-restore-ui.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":52,"fingerprint":"6569a3b9c52a3ea60406b6e7931d918ce917705e279f6ed5341456b5de8ddd30"},
  {"path":"components/backup-scheduler-ui.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":33,"fingerprint":"c0bbf7a3c682822a9952caa7e5d80fc960ac937f19dce7ed80c10cd14b7753e3"},
  {"path":"components/clinical-rich-text-editor.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":11,"fingerprint":"fe9e52ccadb28ef7201d53685f7203ffe254ec6b7ea505243d667c1282c6697c"},
  {"path":"components/clinical-river-timeline.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":1,"fingerprint":"74a118a88237cb6edf87c741eb6d15cc5f70d0cd63fb5328c2cb9f9c6f2beb3d"},
  {"path":"components/data-seeder.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":81,"fingerprint":"1fb47b0abd43ec2b70a28cbf91fe74f0ad1574c58f2ba2a8f4ff388809527732"},
  {"path":"components/diagnostic-hub.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":19,"fingerprint":"da49866f580870b04ffa24ada44b5394fc0bd1988c34a7a610ed18a57a7be567"},
  {"path":"components/drug-autocomplete.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":3,"fingerprint":"575a0d7317a8ebb3f89d4bfcc0188263e2908d53e3c179d1ce971944e8fa06c7"},
  {"path":"components/exemption-selector.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":1,"fingerprint":"e3555f1c41730f6eff9cbd0b172671f1e10115dd519b0ddbe54688e5efbf4488"},
  {"path":"components/kree8/kree8-clinical-cockpit.module.css","reason":"Ombre neutre nere pure: profondita Lume, non colore semantico.","occurrences":2,"fingerprint":"c240374dc4e4afd8537d49e6659b93a5a27ff926cf6d899898c7eae4825cd448"},
  {"path":"components/kree8/kree8-workspace-shell.module.css","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":28,"fingerprint":"c17d58ce7400f5082f5153ac4e34f5e2cac07b4db6a6f5281cd022753acdeb5d"},
  {"path":"components/observation-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":7,"fingerprint":"2255dd7fefbf421cafe0991c73aea62c8619bcc0c7fdef7f3e6ad7aeef113422"},
  {"path":"components/patient-clinical-signals.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":5,"fingerprint":"f2bffac797c8287309668d730de5149cddce2b069ad0acd37589ae877a85eeec"},
  {"path":"components/patient-form.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":6,"fingerprint":"d951c75dec7e4f2efc7a68b2c81e7b9a472660d00422e24dbc9c7012f696d22e"},
  {"path":"components/patient-smart-import-panel.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":22,"fingerprint":"30796efd5b813e5d935169fc33110f4da938dbb5dd9ab6938feeda1effa7d4b7"},
  {"path":"components/patient-synoptic-sheet.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":1,"fingerprint":"dbe0858fa5359e644a786361ecf8e2ee1862ff92d9e262dd14157c8f14a772ee"},
  {"path":"components/pdf-importer.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":32,"fingerprint":"b51e43da442c5f2e84df06d0877355ecea8d739708a14e392d884676e524228d"},
  {"path":"components/prosthetic-prescription-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":6,"fingerprint":"2e05cc8555957b19c844428a2463887d66c91025763f05cd981340bb84480523"},
  {"path":"components/scale-engine.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":3,"fingerprint":"81a39fe2423dffcee6aef072f8ad23aa371607578aeab5d494686b8363031e1a"},
  {"path":"components/service-architecture-panel.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":49,"fingerprint":"41b1261f9b35926d294457026e91856882359e0c24d0428e1497b5510f976ecb"},
  {"path":"components/service-prescription-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":11,"fingerprint":"e22e3925d3234cb15b0e702c83b7a67b74a04b95688f5bcbcca308314ceda41a"},
  {"path":"components/settings/ai-model-parliament-panel.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":52,"fingerprint":"d4973091649a296f689629103d979b964c2bcf2c60fd8b81da25818379436e59"},
  {"path":"components/settings/ai-model-selector.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":1,"fingerprint":"df13a493dbddcbcc063e8c184254da292afd6f96485dc9ecfd49b7dd53ad05a1"},
  {"path":"components/settings/ai-rollout-guard-notice.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":24,"fingerprint":"597f82c11a2194d5e03cef90b3d54fb622dd5854e11b5bbf7ad8e0acc8d4feac"},
  {"path":"components/settings/ai-rollout-readiness-panel.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":58,"fingerprint":"561148fc13c23d01a29956c6df5eb100a67160ce289db712bbd97c64e8e2109c"},
  {"path":"components/settings/drug-db-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":23,"fingerprint":"194436394521702b82f1e5cc71613ff7d6a0cf3d47f6e73a0140bc6a545b8ffe"},
  {"path":"components/settings/exemption-db-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":29,"fingerprint":"c5e46bbc1d96280bbe2c206b24e2b15f3dd82bcf536696509dd38e77a6479528"},
  {"path":"components/settings/settings-nav-sidebar.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":4,"fingerprint":"f265176cc32faa228150cb814a3a3a765850bb0615ba1d6d6d29761980478671"},
  {"path":"components/settings/settings-search.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":1,"fingerprint":"30b66e71736711489accadafb52c1196a07501b44cbe3da7eac0cb30824ac0b6"},
  {"path":"components/settings/update-awareness-panel.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":14,"fingerprint":"7cf2c29edc9a599c6a4fc1c9f9590fc7fcf482cccc9282ca3c8968178ba84f76"},
  {"path":"components/siss-handoff-diary.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":11,"fingerprint":"07ca4d6cbe4ab04dcf8c33177865b2455f0f6eecc5dc17dc512ef03a5ad9165d"},
  {"path":"components/siss-patient-context-panel.tsx","reason":"Debito storico su superficie clinico-visibile: migrazione Lume da completare.","occurrences":3,"fingerprint":"0e95e6d7550576bf1b8e1a9ce4e9bac0b72eff6a8d9dfbab48421fa4a1009645"},
  {"path":"components/therapy-manager.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":45,"fingerprint":"56d3dd38e31fc278647321b7472df6d41013217121059ba53929a8acf405dc97"},
  {"path":"components/timeline-entry-card.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":5,"fingerprint":"7fc902fcdfdef89d5960103f1fdccc2c68d52e2e9b2354cd623fda25cd27e701"},
  {"path":"components/treatment-reasoning-panel.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":41,"fingerprint":"cd218c9b1daa08f0317852913c941057684284712a954ba46b4f2e4ad2b3a639"},
  {"path":"components/ui/badge.tsx","reason":"Debito storico fuori dalle superfici cliniche: da migrare a Lume.","occurrences":24,"fingerprint":"2a9b79503f0bc7bab0ce612ca623aa15919471e257439a921d2c348ef6bc3d54"},
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
  return /(?:cockpit|worklist|patient|clinical|diary|document|import|preview|scheda|diario)/i.test(relativePath);
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
    if (!entry.path || !entry.reason || !/^[a-f0-9]{64}$/.test(entry.fingerprint ?? '') || !Number.isInteger(entry.occurrences)) {
      throw new Error('allowlist palette malformata: ' + JSON.stringify(entry));
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
  const allowed = entry && entry.occurrences === legacy.length && entry.fingerprint === paletteFingerprint(legacy);
  return {
    allowed: allowed ? legacy.length : 0,
    clinicalDebt: allowed && clinicalVisiblePath(relativePath) ? legacy : [],
    violations: allowed ? [] : legacy,
  };
}

export function scanPalette({ rootDir = ROOT_DIR, tokens = loadTokens(), allowlist = PALETTE_ALLOWLIST } = {}) {
  const files = PALETTE_SOURCE_DIRS.flatMap((directory) => walkColorSource(path.join(rootDir, directory)));
  const aggregate = { files: files.length, allowed: 0, clinicalDebt: [], violations: [] };
  for (const file of files) {
    const relativePath = path.relative(rootDir, file).split(path.sep).join('/');
    const result = scanPaletteSource({ relativePath, source: readFileSync(file, 'utf8'), tokens, allowlist });
    aggregate.allowed += result.allowed;
    aggregate.clinicalDebt.push(...result.clinicalDebt);
    aggregate.violations.push(...result.violations);
  }
  return aggregate;
}

export function formatPaletteReport(result) {
  const lines = [
    'Lume palette guard: ' + result.files + ' file analizzati, ' + result.allowed + ' occorrenze di debito noto in allowlist.',
    'Debito clinico (ERRORE storico allowlisted): ' + result.clinicalDebt.length + ' occorrenze su superfici clinico-visibili.',
  ];
  for (const finding of result.violations) {
    const severity = clinicalVisiblePath(finding.path) ? 'ERRORE CLINICO' : 'ERRORE';
    lines.push(severity + ' ' + finding.path + ':' + finding.line + ' ' + finding.kind + ' ' + finding.value + '. Usa var(--lume-...) oppure motiva in allowlist.');
  }
  lines.push(result.violations.length === 0 ? 'Palette Lume: OK' : 'Palette Lume: CONTRATTO VIOLATO (' + result.violations.length + ' occorrenze).');
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
  let palette;
  try {
    const tokens = loadTokens();
    result = evaluateContract(tokens);
    mirror = verifyCssMirror(tokens, loadCssMirror());
    palette = scanPalette({ tokens });
  } catch (error) {
    console.error(`lume token check failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatReport(result));
  console.log(`CSS mirror app/lume-tokens.css: ${mirror.tokens} namespaced tokens matched, ${mirror.aliases} active aliases per theme OK`);
  console.log(formatPaletteReport(palette));
  process.exitCode = result.pass && palette.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
