#!/usr/bin/env node
/* @Codex */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includePublication = process.argv.includes('--include-publication');
const roots = [
  'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'docs/README.md', 'docs/markdown-index.md', 'docs/FAQ.md', 'docs/ROADMAP.md',
  'docs/STATE_OF_THE_SYSTEM.md', 'docs/walkthrough.md', 'docs/system_architecture.md',
  'docs/ARCHITETTURA.md', 'docs/COMPLIANCE.md', 'docs/MANUALE.md', 'docs/NATIVE.md',
  'docs/FSE2-terminology-roadmap.md', 'docs/product_roadmap.md',
  'docs/topologia-dati-flussi.md', 'docs/design',
  'docs/adr/0006-terminology-plugin-and-fse-profiles.md',
  'docs/adr/0065-intended-purpose-and-claims-guard.md',
  'app', 'components', 'native', 'oss-assets',
];
const publicationRoots = ['whitepaper'];
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
  ['CLAIM-FULL-DB-ENCRYPTION', 'encryption / at rest',
    'Field-level encryption must not be presented as whole-database encryption or zero knowledge.',
    /(?:\b(?:(?:inter[oa]\s+)?database|file SQLite|SQLite|dati clinici sul disco|tutto)\b.{0,112}\b(?:cifrat[oaie]|illeggibil[ei]|non (?:e|è) leggibil[ei]|non si (?:legge|leggono)|zero[- ]knowledge|zero conoscenza)\b|\b(?:zero[- ]knowledge|zero conoscenza)\b.{0,80}\b(?:a riposo|database|SQLite|attiv[oa]|non negoziabil\w*)\b|\b(?:se\s+)?perdi il PIN\b.{0,48}\bperdi (?:(?:tutti )?i )?dati\b|\b(?:se\s+)?perdi il PIN\b.{0,48}\bperdi tutto\b)/iu],
  ['CLAIM-FHIR-CONFORMANCE', 'FHIR / interoperability',
    'FHIR export must not imply conformance, portability, or third-party ingestion without evidence.',
    /(?:\bFHIR(?: R4)?\b.{0,120}\b(?:compatibil[ei]|conform(?:e|ita|ità)|interoperabil(?:e|ita|ità)|portabilit[aà]|leggibil[ei] da altr[io] sistem\w*|riusabil[ei]|lock-in)|\b(?:compatibil[ei]|conform(?:e|ita|ità)|interoperabil(?:e|ita|ità)|portabilit[aà]|leggibil[ei] da altr[io] sistem\w*|riusabil[ei]|lock-in)\b.{0,120}\bFHIR(?: R4)?\b)/iu],
  ['CLAIM-GDPR-GUARANTEE', 'GDPR / roles / rights',
    'Product features must not certify GDPR compliance, assign roles categorically, or guarantee rights.',
    /(?:\b(?:MediFlow|software|prodotto|feature|funzionalit[aà])\b.{0,120}\b(?:garantisce|certifica|assicura|(?:e|è|risulta)\s+conforme)\b.{0,120}\b(?:GDPR|conformit[aà]|art(?:icolo|\.)?\s*(?:17|20|32))\b|\b(?:medico|professionista)\b.{0,80}\b(?:resta|e|è)\b.{0,24}\btitolare del trattamento\b|\btitolare del trattamento\b.{0,48}\bresta\b.{0,32}\b(?:medico|professionista)\b|\b(?:diritt[io]|GDPR|art(?:icolo|\.)?\s*(?:17|20|32))\b.{0,96}\b(?:garantit[ioe]|conform[ei]|certificat[oaie]|assicurat[ioe])\b)/iu],
  ['CLAIM-ONE-DEVICE-ABSOLUTE', 'local-first / topology',
    'Local-first claims must name home-base and explicit paired, cache, export, or backup paths.',
    /\b(?:i\s+|tutti i\s+)?dati(?: clinici| paziente)?\b.{0,56}\b(?:non (?:escono|lasciano)(?: mai)?|restano|rimangono|sono nel|stanno sul)\b.{0,64}\b(?:Mac|computer|dispositivo)\b/iu],
  ['CLAIM-ICD-GUARANTEE', 'ICD / terminology',
    'Optional terminology support must not imply that every diagnosis is coded or validated.',
    /(?:\b(?:ogni|tutte le)\s+diagnos[ie]\b.{0,80}\b(?:codic|ICD-11|validat)\w*\b|\bdiagnos[ie]\b.{0,80}\b(?:usano|usa|sempre|solo)\b.{0,40}\bICD-11\b|\bdiagnos[ie]\b.{0,64}\bnon (?:restano|sono)\b.{0,24}\btesto libero\b)/iu],
].map(([id, category, description, pattern]) => ({ id, category, description, pattern }));

const allowlist = [
  ['CLAIM-AI-AUTONOMY', 'diagnosi automatica'],
  ['CLAIM-AUTO-APPLY', 'auto-import clinico'],
  ['CLAIM-SISS-FSE-INTEGRATION', 'SISS integrato'],
  ['CLAIM-REGIONAL-PRESCRIPTION', 'NRE'],
  ['CLAIM-CLOUD-DEFAULT', 'cloud AI'],
  ['CLAIM-FULL-DB-ENCRYPTION', 'cifratura integrale del file SQLite'],
  ['CLAIM-FULL-DB-ENCRYPTION', 'zero-knowledge whole-database'],
  ['CLAIM-FULL-DB-ENCRYPTION', "zero-knowledge sull'intero database"],
  ['CLAIM-FHIR-CONFORMANCE', 'compatibilita, conformita, interoperabilita'],
  ['CLAIM-GDPR-GUARANTEE', 'conformita GDPR certificata'],
  ['CLAIM-GDPR-GUARANTEE', 'diritti dichiarati garantiti'],
  ['CLAIM-ONE-DEVICE-ABSOLUTE', 'confinati a un solo dispositivo'],
  ['CLAIM-ICD-GUARANTEE', 'ogni diagnosi dichiarata obbligatoriamente'],
].map(([ruleId, snippet]) => ({
  file: 'docs/adr/0065-intended-purpose-and-claims-guard.md',
  ruleId,
  snippet,
  rationale: 'This ADR enumerates banned claims as policy text.',
}));

if (process.argv.includes('--self-test')) runSelfTest();
else runRepositoryScan();

function runRepositoryScan() {
  const activeRoots = includePublication ? [...roots, ...publicationRoots] : roots;
  const files = activeRoots.flatMap(collectFiles).sort();
  const findings = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8').replaceAll('\r\n', '\n');
    for (const item of findRuleMatches(source, file)) {
      if (!isAllowlisted(file, item.rule.id, item.context, item.match)) findings.push(item);
    }
  }

  if (findings.length === 0) {
    console.log(`Claims guard passed: scanned ${files.length} file(s), 0 high-risk claim(s).`);
    if (!includePublication) {
      console.log('Phase B dependency: whitepaper/ is not enforced yet; rerun with --include-publication after its copy converges.');
    }
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
    ['whole database encryption claim', 'Il database SQLite e cifrato e illeggibile senza PIN.', 'CLAIM-FULL-DB-ENCRYPTION'],
    ['zero-knowledge invariant claim', 'Architettura local-first e zero-knowledge non negoziabile.', 'CLAIM-FULL-DB-ENCRYPTION'],
    ['PIN total loss claim', 'Se perdi il PIN, perdi i dati.', 'CLAIM-FULL-DB-ENCRYPTION'],
    ['PIN everything loss claim', 'Ora se perdi il PIN perdi tutto.', 'CLAIM-FULL-DB-ENCRYPTION'],
    ['FHIR conformance claim', 'L export FHIR R4 e compatibile e leggibile da altri sistemi.', 'CLAIM-FHIR-CONFORMANCE'],
    ['FHIR ingestion claim', 'Il bundle FHIR R4 e leggibile da altri sistemi.', 'CLAIM-FHIR-CONFORMANCE'],
    ['reverse FHIR compatibility claim', 'Viene generato un pacchetto JSON compatibile FHIR R4.', 'CLAIM-FHIR-CONFORMANCE'],
    ['reverse FHIR interoperability claim', 'Esporta un formato interoperabile FHIR R4.', 'CLAIM-FHIR-CONFORMANCE'],
    ['GDPR role claim', 'Il professionista resta il titolare del trattamento.', 'CLAIM-GDPR-GUARANTEE'],
    ['GDPR reverse role claim', 'Il titolare del trattamento resta il professionista.', 'CLAIM-GDPR-GUARANTEE'],
    ['GDPR conformity claim', 'MediFlow e conforme al GDPR.', 'CLAIM-GDPR-GUARANTEE'],
    ['single device claim', 'I dati clinici non lasciano mai il dispositivo.', 'CLAIM-ONE-DEVICE-ABSOLUTE'],
    ['ICD guarantee claim', 'Ogni diagnosi ha un codice ICD-11 validato.', 'CLAIM-ICD-GUARANTEE'],
  ];
  const failures = [];
  for (const [name, line, expected] of required) {
    const matched = findRuleMatches(line, 'self-test.md').map((item) => item.rule.id);
    if (!matched.includes(expected)) failures.push(`${name}: expected ${expected}, got ${matched.join(', ') || 'none'}`);
  }

  const allowed = [
    'MediFlow usa handoff webapp-assisted SISS/FSE e non dichiara integrazione certificata.',
    'MediFlow non genera NRE e non invia ricette regionali direttamente.',
    'MediFlow cifra lato client i campi clinici sensibili; il file SQLite non e cifrato integralmente.',
    'Il PIN non viene persistito; questo non equivale a zero-knowledge sull intero database.',
    'MediFlow genera una mappatura FHIR R4 export-only v0 che non attesta conformita completa.',
    'Le misure tecniche possono supportare il GDPR; ruoli e obblighi dipendono dal deployment.',
    'Lo storage autorevole resta sul nodo home-base; client paired, cache ed export sono percorsi espliciti.',
    'Il resolver ICD-11 e opzionale e i problemi free-text restano reviewable.',
    'Niente telemetria, cloud o egress dati e attivo per default.',
  ];
  for (const line of allowed) {
    const matched = findRuleMatches(line, 'self-test.md').map((item) => item.rule.id);
    if (matched.length > 0) failures.push(`allowed boundary phrase matched ${matched.join(', ')}`);
  }

  const unrelatedContext = '- I campi clinici sono cifrati lato client.\n- Il database SQLite e cifrato integralmente.';
  const unrelated = findRuleMatches(unrelatedContext, 'self-test.md');
  if (!unrelated.some((item) => item.rule.id === 'CLAIM-FULL-DB-ENCRYPTION')) {
    failures.push('qualification in a previous list item suppressed CLAIM-FULL-DB-ENCRYPTION');
  }

  const multiline = findRuleMatches('Il database SQLite e\ncifrato integralmente.', 'self-test.md');
  if (!multiline.some((item) => item.rule.id === 'CLAIM-FULL-DB-ENCRYPTION')) {
    failures.push('multiline claim bypassed CLAIM-FULL-DB-ENCRYPTION');
  }

  const linkedTable = findRuleMatches('| [FHIR R4](./spec.md) | formato interoperabile |', 'self-test.md');
  if (!linkedTable.some((item) => item.rule.id === 'CLAIM-FHIR-CONFORMANCE')) {
    failures.push('linked Markdown table bypassed CLAIM-FHIR-CONFORMANCE');
  }

  const uiClaim = findRuleMatches('export const Claim = () => <p>Il database SQLite e cifrato integralmente.</p>;', 'claim.tsx');
  if (!uiClaim.some((item) => item.rule.id === 'CLAIM-FULL-DB-ENCRYPTION')) {
    failures.push('UI source bypassed CLAIM-FULL-DB-ENCRYPTION');
  }

  const unrelatedNegation = findRuleMatches('Non e solo un database locale.\nMediFlow genera NRE e invia ricette regionali direttamente.', 'self-test.md');
  if (!unrelatedNegation.some((item) => item.rule.id === 'CLAIM-REGIONAL-PRESCRIPTION')) {
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

function findRuleMatches(source, file) {
  const scanText = joinWrappedLines(source);
  const matches = [];
  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    for (const match of scanText.matchAll(pattern)) {
      const offset = match.index ?? 0;
      const context = logicalBlockAt(scanText, offset);
      if (!isContextAllowed(rule.id, match[0], context)) {
        matches.push({
          rule,
          file,
          line: lineNumberAt(source, offset),
          match: match[0],
          context,
          snippet: compact(match[0]),
        });
      }
    }
  }
  return matches;
}

function joinWrappedLines(source) {
  const lines = source.split('\n');
  let inFence = false;
  return lines.map((line, index) => {
    const isFence = /^\s*```/u.test(line);
    const preserveBreak = inFence || isFence;
    if (isFence) inFence = !inFence;
    if (index === lines.length - 1) return line;
    const next = lines[index + 1];
    return `${line}${!preserveBreak && shouldJoinLine(line, next) ? ' ' : '\n'}`;
  }).join('');
}

function shouldJoinLine(line, next) {
  if (line.trim() === '' || next.trim() === '') return false;
  return !/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<\/?[A-Za-z])/u.test(next);
}

function logicalBlockAt(scanText, offset) {
  const start = scanText.lastIndexOf('\n', offset - 1) + 1;
  const nextBreak = scanText.indexOf('\n', offset);
  const end = nextBreak === -1 ? scanText.length : nextBreak;
  return scanText.slice(start, end);
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function isContextAllowed(ruleId, line, context) {
  const boundaryText = context.toLocaleLowerCase('it-IT');
  if (ruleId === 'CLAIM-FULL-DB-ENCRYPTION') {
    return /\b(?:campi\b.{0,48}\bcifrat\w*|cifratura\b.{0,32}\bper campo|field-level|non presentare|non deve descrivere|non equivale|non rientr\w*|non (?:e|è) cifrat[oa] integralmente|non sono tutti coperti|non ["“]?intero database|senza estendere|non abilita|finche\b.{0,96}\bperimetro)\b/u.test(boundaryText);
  }
  if (ruleId === 'CLAIM-FHIR-CONFORMANCE') {
    return /\b(?:export-only v0|mappatura export-only|senza claim|non (?:attesta|prova|dichiara|garantisce)|nessuna garanzia|quadro (?:compliance|documentale))\b/u.test(boundaryText);
  }
  if (ruleId === 'CLAIM-GDPR-GUARANTEE') {
    return /\b(?:pu[oò] supportare|possono supportare|non (?:certifica|prova|assegna)|dipendono dal deployment|valutazione del caso)\b/u.test(boundaryText);
  }
  if (ruleId === 'CLAIM-ONE-DEVICE-ABSOLUTE') {
    return /\b(?:home-base|client paired|cache|export|backup|storage autorevole)\b/u.test(boundaryText);
  }
  if (ruleId === 'CLAIM-ICD-GUARANTEE') {
    return /\b(?:opzional|possono|free-text|reviewable|non (?:ogni|tutte))\w*\b/u.test(boundaryText);
  }
  const text = context.toLocaleLowerCase('it-IT');
  if (hasBoundaryNegation(text)) return true;
  if (ruleId !== 'CLAIM-SISS-FSE-INTEGRATION') return false;
  return /\b(corpus|documental[ei]|sorgent[ei]|manifest|mcp|fetch\/sync|source sync|siss-corpus:sync|gia sincronizzato|già sincronizzato)\b/iu.test(context);
}

function hasBoundaryNegation(text) {
  return /\bnon (?:sono|e|è) ammessi\b/u.test(text)
    || /\bnon (?:sono|e|è) attiv[io]\b/u.test(text)
    || /\bnon esiste\b/u.test(text)
    || /\bfallisce se trova\b/u.test(text)
    || /\bnon (?:dichiara|introduce|usa|usare|invia|genera|automatizza|prescrive|sostituisce|promuove|applica|accetta)\b/u.test(text)
    || /\bnessun[ao]?\b.{0,64}\b(?:cloud|egress|sync|telemetry|telemetria|writeback|invio|accesso diretto|integrazione)\b/u.test(text)
    || /\bniente\b.{0,64}\b(?:cloud|egress|sync|telemetry|telemetria|writeback|invio|accesso diretto)\b/u.test(text)
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
