#!/usr/bin/env node
/* @Codex */

// Ogni tabella dichiarata in lib/schema.ts deve avere almeno un writer specifico:
// un modulo non-infrastrutturale che esegue .insert/.update/.delete su quel simbolo.
//
// Una tabella senza writer è, salvo decisione contraria e documentata, un'affermazione
// di architettura non verificata: lo schema dichiara una struttura dati che nessun
// codice popola. Il caso che ha motivato questo gate è `document_diagnosis_proposals`,
// presente nello schema e inclusa in backup/restore/cascade ma mai scritta — dove però
// l'assenza del writer è **deliberata** e messa a verbale da ADR 0087.
//
// È esattamente la distinzione che il gate serve a rendere visibile: un'assenza decisa
// e un'assenza dimenticata hanno lo stesso aspetto nello schema, e si distinguono solo
// leggendo un ADR. L'allowlist è il posto dove la decisione diventa leggibile in CI.
//
// I moduli infrastrutturali che enumerano *tutte* le tabelle (backup, restore, cascade,
// scheduler) non contano come writer: farebbero risultare popolata qualunque tabella.
//
// L'allowlist è stale-sensitive nelle due direzioni: un'eccezione non più necessaria
// fa fallire il gate tanto quanto una tabella orfana non dichiarata. È il meccanismo
// che costringe a rivedere l'eccezione nel momento in cui il writer viene integrato.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFile = 'lib/schema.ts';
const roots = ['lib', 'app', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.mjs', '.js']);
const skipped = ['.git', '.next', 'node_modules', 'coverage', 'dist', 'out']
  .map((item) => `${path.sep}${item}${path.sep}`);

// Moduli che operano su ogni tabella per costruzione: non provano l'esistenza di un
// percorso di scrittura reale per una tabella specifica.
const infrastructure = new Set([
  'lib/backup-artifact.ts',
  'lib/backup-restore-executor.ts',
  'lib/backup-restore-preflight.ts',
  'lib/patient-cascade.ts',
  'lib/db-server.ts',
  'lib/db.ts',
  'app/api/system/backup-restore/route.ts',
  'scripts/run-scheduled-backup.mjs',
]);

// Tabelle senza writer, accettate consapevolmente. Ogni voce richiede un motivo e un
// riferimento a una decisione scritta. Una voce che non serve più fa fallire il gate:
// va rimossa.
const allowlist = [
  {
    table: 'document_diagnosis_proposals',
    reason: 'assenza deliberata, non dimenticanza: ADR 0087 (Accepted) consegna la sola '
      + 'foundation persistente e rinvia writer, route, UI e transizioni a un packet '
      + 'runtime separato, di cui elenca requisiti e regole di arresto. Integrare un '
      + 'writer senza quel packet viola le regole di arresto dell\'ADR stesso.',
    reference: 'docs/adr/0087-registro-proposte-diagnostiche-documentali.md',
  },
];

function toRelative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function shouldSkip(file) {
  return skipped.some((fragment) => file.includes(fragment));
}

function collectFiles(root) {
  const fullPath = path.join(repoRoot, root);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(fullPath, entry.name);
    if (entry.isDirectory()) return shouldSkip(child + path.sep) ? [] : collectFiles(toRelative(child));
    if (!entry.isFile() || !extensions.has(path.extname(child))) return [];
    return shouldSkip(child) ? [] : [toRelative(child)];
  });
}

export function parseTables(source) {
  return [...source.matchAll(/export const (\w+) = sqliteTable\(\s*['"`]([\w_]+)['"`]/g)]
    .map((match) => ({ symbol: match[1], table: match[2] }));
}

export function writesTable(source, symbol) {
  return new RegExp(`\\.(?:insert|update|delete)\\(\\s*${symbol}\\b`).test(source);
}

function isTestFile(file) {
  return /\.test\.|\.spec\./.test(file);
}

function findWriters(tables, files) {
  const sources = new Map(files.map((file) => [file, fs.readFileSync(path.join(repoRoot, file), 'utf8')]));
  return new Map(tables.map((entry) => {
    const writers = [...sources]
      .filter(([file]) => !isTestFile(file) && !infrastructure.has(file))
      .filter(([, source]) => writesTable(source, entry.symbol))
      .map(([file]) => file);
    return [entry.table, writers];
  }));
}

function main() {
  const source = fs.readFileSync(path.join(repoRoot, schemaFile), 'utf8');
  const tables = parseTables(source);
  if (tables.length === 0) {
    console.error(`Schema writer gate failed: no sqliteTable declaration found in ${schemaFile}.`);
    process.exit(1);
  }

  const files = roots.flatMap(collectFiles);
  const writers = findWriters(tables, files);
  const allowed = new Map(allowlist.map((entry) => [entry.table, entry]));

  const orphans = [];
  const staleExceptions = [];

  for (const { table } of tables) {
    const found = writers.get(table) ?? [];
    if (found.length === 0 && !allowed.has(table)) orphans.push(table);
    if (found.length > 0 && allowed.has(table)) staleExceptions.push({ table, writers: found });
  }

  const unknownExceptions = allowlist
    .filter((entry) => !tables.some(({ table }) => table === entry.table))
    .map((entry) => entry.table);

  if (orphans.length === 0 && staleExceptions.length === 0 && unknownExceptions.length === 0) {
    const covered = tables.length - allowlist.length;
    console.log(`Schema writer gate passed: ${covered}/${tables.length} table(s) with a specific writer, `
      + `${allowlist.length} documented exception(s).`);
    return;
  }

  console.error('Schema writer gate failed.');
  for (const table of orphans) {
    console.error(`- ORPHAN-TABLE ${table} (${schemaFile})`);
    console.error('  Nessun modulo non-infrastrutturale scrive questa tabella.');
    console.error('  Integra un writer, rimuovi la tabella, oppure aggiungi un\'eccezione motivata all\'allowlist.');
  }
  for (const { table, writers: found } of staleExceptions) {
    console.error(`- STALE-EXCEPTION ${table}`);
    console.error(`  La tabella ha ora un writer (${found.join(', ')}): rimuovi la voce dall'allowlist.`);
    const entry = allowed.get(table);
    if (entry) console.error(`  Motivo registrato: ${entry.reason}`);
  }
  for (const table of unknownExceptions) {
    console.error(`- UNKNOWN-EXCEPTION ${table}`);
    console.error(`  L'allowlist cita una tabella assente da ${schemaFile}: rimuovi la voce.`);
  }
  process.exit(1);
}

function selfTest() {
  const failures = [];

  const schema = [
    "export const alpha = sqliteTable('alpha', {",
    "export const beta = sqliteTable(\"beta\", {",
    'const notExported = sqliteTable(\'gamma\', {',
  ].join('\n');
  const parsed = parseTables(schema);
  if (parsed.length !== 2) failures.push(`parseTables: expected 2 tables, got ${parsed.length}`);
  if (parsed[0]?.symbol !== 'alpha' || parsed[0]?.table !== 'alpha') failures.push('parseTables: single-quoted table not parsed');
  if (parsed[1]?.table !== 'beta') failures.push('parseTables: double-quoted table not parsed');

  const positives = [
    'await db.insert(alpha).values(row);',
    'await tx.update( alpha ).set(row);',
    'await db.delete(alpha).where(eq(alpha.id, id));',
  ];
  for (const sample of positives) {
    if (!writesTable(sample, 'alpha')) failures.push(`writesTable: missed a write in ${JSON.stringify(sample)}`);
  }

  const negatives = [
    'await db.select().from(alpha);',
    'await db.insert(alphaBeta).values(row);',
    'const alpha = 1;',
  ];
  for (const sample of negatives) {
    if (writesTable(sample, 'alpha')) failures.push(`writesTable: false positive on ${JSON.stringify(sample)}`);
  }

  for (const entry of allowlist) {
    if (!entry.reason || !entry.reference) failures.push(`allowlist: ${entry.table} lacks a reason or a reference`);
  }

  if (failures.length === 0) {
    console.log(`Schema writer gate self-test passed: ${positives.length} write form(s) detected, `
      + `${negatives.length} non-write form(s) rejected, ${allowlist.length} exception(s) documented.`);
    return;
  }
  console.error('Schema writer gate self-test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
