#!/usr/bin/env node
/* @Codex */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'docs/README.md', 'docs/markdown-index.md', 'docs/FAQ.md', 'docs/ROADMAP.md',
  'docs/STATE_OF_THE_SYSTEM.md', 'docs/walkthrough.md', 'docs/system_architecture.md',
  'docs/ARCHITETTURA.md', 'docs/COMPLIANCE.md', 'docs/MANUALE.md', 'docs/NATIVE.md',
  'docs/topologia-dati-flussi.md', 'docs/design',
  'docs/adr/0065-intended-purpose-and-claims-guard.md',
  'app', 'components', 'oss-assets',
];
const extensions = new Set(['.md', '.mdx', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.swift']);
const skipped = ['.git', '.next', 'node_modules', 'e2e', 'coverage', 'dist', 'out']
  .map((item) => `${path.sep}${item.replaceAll('/', path.sep)}${path.sep}`);

const rules = [
  ['CLAIM-AI-AUTONOMY', 'AI / diagnosis / triage / prescribing',
    'AI or MediFlow must not be described as making autonomous clinical decisions.',
    /\b(?:MediFlow|AI|IA|modello|sistema|workbench)\b.{0,96}\b(?:diagnostic[ao] autonom[ao]|diagnosi automatic[ao]|decide autonomamente|decisione clinica autonoma|triage automatic[ao]|prescrive autonomamente|prescrizione automatica)\b/iu],
  ['CLAIM-AUTO-APPLY', 'automation / review',
    'Generated clinical content must not be described as silently accepted or applied.',
    /\b(?:auto[- ]?import|auto[- ]?apply|applica automaticamente|scrive automaticamente|accetta automaticamente|import silenzios[ao])\b.{0,96}\b(?:clinic|scheda|record|diagnos|terapi|prescrizion|strutturat)/iu],
  ['CLAIM-SISS-FSE-INTEGRATION', 'SISS/FSE',
    'Regional systems must not be described as integrated, synced, written back, or certified without qualification.',
    /\b(?:SISS|FSE)\b.{0,96}\b(?:integrat[aoie]|sync|sincronizzat[aoie]|writeback|scrittura ufficiale|invio ufficiale|accesso diretto|integrazione certificata|certificata)\b/iu],
  ['CLAIM-REGIONAL-PRESCRIPTION', 'prescribing / regional workflow',
    'MediFlow must not be described as issuing official regional prescriptions or NRE.',
    /\b(?:MediFlow|workbench|app)\b.{0,96}\b(?:emette|invia|genera|produce)\b.{0,96}\b(?:NRE|ricett[ae]|prescrizion[ei] regional[ei]|promemoria regional[ei])/iu],
  ['CLAIM-CLOUD-DEFAULT', 'cloud / privacy',
    'Cloud processing or sync must not be described as default for clinical data.',
    /\b(?:cloud|telemetry|telemetria|AI remot[ao])\b.{0,96}\b(?:default|automatic[ao]|obbligatori[ao]|sempre attiv[ao]|dati clinici|PHI|PII|prompt clinici)/iu],
].map(([id, category, description, pattern]) => ({ id, category, description, pattern }));

const allowlist = [
  ['CLAIM-AI-AUTONOMY', 'diagnosi automatica'],
  ['CLAIM-AUTO-APPLY', 'auto-import clinico'],
  ['CLAIM-SISS-FSE-INTEGRATION', 'SISS integrato'],
  ['CLAIM-REGIONAL-PRESCRIPTION', 'NRE'],
  ['CLAIM-CLOUD-DEFAULT', 'cloud AI'],
].map(([ruleId, snippet]) => ({
  file: 'docs/adr/0065-intended-purpose-and-claims-guard.md',
  ruleId,
  snippet,
  rationale: 'This ADR enumerates banned claims as policy text.',
}));

if (process.argv.includes('--self-test')) runSelfTest();
else runRepositoryScan();

function runRepositoryScan() {
  const files = roots.flatMap(collectFiles).sort();
  const findings = [];

  for (const file of files) {
    const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const context = lines.slice(Math.max(0, index - 5), index + 2).join(' ');
      for (const rule of matchingRules(line, context)) {
        const match = rule.pattern.exec(line)?.[0] ?? line;
        if (!isAllowlisted(file, rule.id, line, match)) {
          findings.push({ rule, file, line: index + 1, snippet: compact(match) });
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log(`Claims guard passed: scanned ${files.length} file(s), 0 high-risk claim(s).`);
    return;
  }
  console.error(`Claims guard failed: ${findings.length} high-risk claim(s) need review.`);
  for (const item of findings) {
    console.error(`- ${item.rule.id} [${item.rule.category}] ${item.file}:${item.line}`);
    console.error(`  ${item.rule.description}`);
    console.error(`  ${item.snippet}`);
  }
  process.exit(1);
}

function runSelfTest() {
  const required = [
    ['autonomous diagnosis claim', 'MediFlow offre diagnosi automatica e decide autonomamente la priorita clinica.', 'CLAIM-AI-AUTONOMY'],
    ['silent auto apply claim', 'Il sistema applica automaticamente suggerimenti clinici nella scheda senza revisione.', 'CLAIM-AUTO-APPLY'],
    ['regional sync claim', 'Il modulo SISS integrato consente writeback e sync certificato.', 'CLAIM-SISS-FSE-INTEGRATION'],
    ['official prescription claim', 'MediFlow genera NRE e invia ricette regionali direttamente.', 'CLAIM-REGIONAL-PRESCRIPTION'],
    ['cloud default claim', 'La cloud AI e attiva di default per prompt clinici e dati PHI.', 'CLAIM-CLOUD-DEFAULT'],
  ];
  const failures = [];
  for (const [name, line, expected] of required) {
    const matched = matchingRules(line).map((rule) => rule.id);
    if (!matched.includes(expected)) failures.push(`${name}: expected ${expected}, got ${matched.join(', ') || 'none'}`);
  }

  const allowed = [
    'MediFlow usa handoff webapp-assisted SISS/FSE e non dichiara integrazione certificata.',
    'MediFlow non genera NRE e non invia ricette regionali direttamente.',
  ];
  for (const line of allowed) {
    const matched = matchingRules(line).map((rule) => rule.id);
    if (matched.length > 0) failures.push(`allowed boundary phrase matched ${matched.join(', ')}`);
  }

  const unrelatedContext = 'Non e solo un database locale.\nMediFlow genera NRE e invia ricette regionali direttamente.';
  const unrelated = matchingRules('MediFlow genera NRE e invia ricette regionali direttamente.', unrelatedContext);
  if (!unrelated.some((rule) => rule.id === 'CLAIM-REGIONAL-PRESCRIPTION')) {
    failures.push('unrelated negation suppressed CLAIM-REGIONAL-PRESCRIPTION');
  }

  if (failures.length === 0) {
    console.log(`Claims guard self-test passed: ${required.length} synthetic violation(s) detected and allowed boundary wording accepted.`);
    return;
  }
  console.error('Claims guard self-test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

function matchingRules(line, context = line) {
  return rules.filter((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(line) && !isContextAllowed(rule.id, line, context);
  });
}

function isContextAllowed(ruleId, line, context) {
  if (ruleId === 'CLAIM-AUTO-APPLY') return false;
  const text = context.toLocaleLowerCase('it-IT');
  if (hasBoundaryNegation(text)) return true;
  if (ruleId !== 'CLAIM-SISS-FSE-INTEGRATION') return false;
  return /\b(corpus|documental[ei]|sorgent[ei]|manifest|mcp|fetch\/sync|source sync|siss-corpus:sync|gia sincronizzato|già sincronizzato)\b/iu.test(line);
}

function hasBoundaryNegation(text) {
  return /\bnon (?:sono|e|è) ammessi\b/u.test(text)
    || /\bfallisce se trova\b/u.test(text)
    || /\bnon (?:dichiara|introduce|usa|invia|genera|automatizza|prescrive|sostituisce|promuove|applica|accetta)\b/u.test(text)
    || /\bnessun[ao]?\b.{0,64}\b(?:cloud|egress|sync|telemetry|telemetria|writeback|invio|accesso diretto)\b/u.test(text)
    || /\bno\b.{0,64}\b(?:cloud|egress|sync|telemetry|telemetria|writeback|invio|accesso diretto)\b/u.test(text)
    || /\bsenza\b.{0,64}\b(?:cloud|egress|telemetry|telemetria|sync|writeback|adr|canale qualificato|review|conferma|integrazione|auto-write|scritture)\b/u.test(text)
    || /\b(fuori|fuori scope|vieta|vietato|vietata|vietati|vietate|esclude|escluso|esclusa|not)\b/u.test(text)
    || text.includes('local-first')
    || text.includes('solo se scelto')
    || text.includes('solo opt-in')
    || text.includes('opt-in');
}

function collectFiles(root) {
  const fullPath = path.join(repoRoot, root);
  if (!fs.existsSync(fullPath)) return [];
  if (fs.statSync(fullPath).isFile()) return shouldScan(fullPath) ? [toRelative(fullPath)] : [];
  return fs.readdirSync(fullPath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(fullPath, entry.name);
    if (entry.isDirectory()) return shouldSkip(child + path.sep) ? [] : collectFiles(toRelative(child));
    return entry.isFile() && shouldScan(child) ? [toRelative(child)] : [];
  });
}

function shouldScan(file) {
  return !shouldSkip(file) && extensions.has(path.extname(file));
}

function shouldSkip(file) {
  return skipped.some((fragment) => file.includes(fragment));
}

function isAllowlisted(file, ruleId, line, match) {
  return allowlist.some((entry) => entry.file === file
    && entry.ruleId === ruleId
    && (line.includes(entry.snippet) || match.includes(entry.snippet)));
}

function toRelative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function compact(text) {
  return text.replace(/\s+/g, ' ').trim();
}
