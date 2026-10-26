// WUL-306 (ADR 0066): anti-drift guard for PATIENT_CHILD_TABLES (WUL-316 pattern).
// Clinical patient children must be covered; the exact ADR0168 terminal ledger
// retains historical bindings after patient purge and must never enter the cascade.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import ts from 'typescript';
import { ensureTherapyStatusCommandSchema } from '../lib/therapy-status-command-schema.ts';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function parseSource(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function unwrapExpression(expression) {
  if (!expression) return undefined;
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

// Collects every `export const <name> = sqliteTable('<sqlName>', { ... })` declaration
// and whether its column map contains a column bound to the SQL name 'patient_id'.
function collectSchemaTables(sourceFile) {
  const tables = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'sqliteTable'
    ) {
      const [sqlNameArg, columnsArg] = node.initializer.arguments;
      const sqlName = sqlNameArg && ts.isStringLiteral(sqlNameArg) ? sqlNameArg.text : null;
      const hasPatientId = columnsArg
        ? columnsArg.getText(sourceFile).includes("'patient_id'")
        : false;
      const hasReferences = columnsArg ? /\breferences\b/u.test(columnsArg.getText(sourceFile)) : false;
      tables.push({ exportName: node.name.text, sqlName, hasPatientId, hasReferences });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return tables;
}

function findVariableInitializer(sourceFile, variableName) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializer;
}

// PATIENT_CHILD_TABLES entries are `{ name: '<n>', table: <ident>, patientId: ... }`.
function extractCascadeEntries(sourceFile) {
  const initializer = unwrapExpression(findVariableInitializer(sourceFile, 'PATIENT_CHILD_TABLES'));
  assert(initializer && ts.isArrayLiteralExpression(initializer), 'PATIENT_CHILD_TABLES must be an array literal');
  return initializer.elements.map((element) => {
    assert(ts.isObjectLiteralExpression(element), 'PATIENT_CHILD_TABLES entries must be object literals');
    const entry = {};
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
      if (property.name.text === 'name' && ts.isStringLiteral(property.initializer)) {
        entry.name = property.initializer.text;
      }
      if (property.name.text === 'table' && ts.isIdentifier(property.initializer)) {
        entry.tableExport = property.initializer.text;
      }
    }
    assert(entry.name && entry.tableExport, 'PATIENT_CHILD_TABLES entries must declare name and table');
    return entry;
  });
}

function assertCascadeSchemaCoverage(schemaTables, cascadeEntries) {
  const terminal = schemaTables.filter(table => table.exportName === 'therapyStatusCommands' && table.sqlName === 'therapy_status_commands');
  assert.equal(terminal.length, 1, 'the exact ADR0168 terminal ledger must exist once');
  assert.equal(terminal[0].hasPatientId, true);
  assert.equal(terminal[0].hasReferences, false, 'historical command bindings must not reference patient/therapy rows');
  const required = schemaTables
    .filter((table) => table.hasPatientId && table !== terminal[0])
    .map((table) => table.exportName)
    .sort();
  const covered = cascadeEntries.map((entry) => entry.tableExport).sort();
  assert.equal(covered.includes('therapyStatusCommands'), false, 'terminal ledger must survive patient purge');
  assert.deepEqual(covered, required);
}

test('every patientId table is classified as a clinical child or the exact preserved terminal ledger', () => {
  assertCascadeSchemaCoverage(collectSchemaTables(parseSource('lib/schema.ts')), extractCascadeEntries(parseSource('lib/patient-cascade.ts')));
});

test('unclassified patient tables and a cascaded or foreign-key-bound terminal ledger still fail closed', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'lib/schema.ts'), 'utf8');
  const cascade = extractCascadeEntries(parseSource('lib/patient-cascade.ts'));
  const tables = collectSchemaTables(parseSource('lib/schema.ts'));
  const mutated = ts.createSourceFile('schema-negative.ts', `${source}\nexport const unclassifiedPatientChildren = sqliteTable('unclassified_patient_children', { patientId: text('patient_id') });`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.throws(() => assertCascadeSchemaCoverage(collectSchemaTables(mutated), cascade), /unclassifiedPatientChildren/);
  assert.throws(() => assertCascadeSchemaCoverage(tables, [...cascade, { name: 'therapyStatusCommands', tableExport: 'therapyStatusCommands' }]), /terminal ledger must survive/);
  assert.throws(() => assertCascadeSchemaCoverage(tables.map(table => table.exportName === 'therapyStatusCommands' ? { ...table, hasReferences: true } : table), cascade), /must not reference/);
  assert.throws(() => assertCascadeSchemaCoverage(tables.map(table => table.exportName === 'therapyStatusCommands' ? { ...table, sqlName: 'renamed_terminal' } : table), cascade), /exact ADR0168/);
});

test('a bootstrapped DB classifies patient_id tables and gives the preserved ledger no foreign keys', () => {
  const schemaTables = collectSchemaTables(parseSource('lib/schema.ts'));
  const sqlNameByExport = new Map(schemaTables.map((table) => [table.exportName, table.sqlName]));
  const cascadeSqlNames = new Set(
    extractCascadeEntries(parseSource('lib/patient-cascade.ts'))
      .map((entry) => sqlNameByExport.get(entry.tableExport))
      .filter(Boolean),
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cascade-guard-'));
  const sqlite = new Database(path.join(dir, 'medical.db'));
  try {
    const migrationsDir = path.join(ROOT_DIR, 'drizzle');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
    for (const fileName of migrationFiles) {
      const sql = fs
        .readFileSync(path.join(migrationsDir, fileName), 'utf8')
        .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
      if (sql.trim().length === 0) continue;
      sqlite.exec(sql);
    }

    // Raw-SQL tables that exist only in lib/sqlite-schema.ts must be covered too.
    const dbServerSource = fs.readFileSync(path.join(ROOT_DIR, 'lib/sqlite-schema.ts'), 'utf8');
    const createStatements = (dbServerSource.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?\n\s*\)/g) ?? [])
      .filter((statement) => /^CREATE TABLE IF NOT EXISTS [A-Za-z_]/.test(statement));
    assert.ok(createStatements.length > 0, 'expected raw CREATE TABLE statements in lib/sqlite-schema.ts');
    for (const statement of createStatements) {
      sqlite.exec(statement);
    }
    ensureTherapyStatusCommandSchema(sqlite);
    assert.equal(cascadeSqlNames.has('therapy_status_commands'), false);
    assert.deepEqual(sqlite.pragma('foreign_key_list(therapy_status_commands)'), []);

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);

    for (const tableName of tableNames) {
      if (tableName === 'patients') continue;
      const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
      if (!columns.includes('patient_id')) continue;
      if (tableName === 'therapy_status_commands') continue;
      assert.ok(
        cascadeSqlNames.has(tableName),
        `Table '${tableName}' has a patient_id column but is missing from PATIENT_CHILD_TABLES (lib/patient-cascade.ts)`,
      );
    }
  } finally {
    sqlite.close();
  }
});

test('the cascade keeps the ADR 0066 child-first ordering', () => {
  const names = extractCascadeEntries(parseSource('lib/patient-cascade.ts')).map((entry) => entry.name);
  assert.deepEqual(names, [
    'servicePrescriptionItems',
    'servicePrescriptions',
    'prostheticPrescriptions',
    'sissHandoffEvents',
    'documentDiagnosisProposals',
    'durableReviewPatientLinks',
    'observations',
    'checkups',
    'therapies',
    'entries',
    'attachments',
    'patientsToAmbulatories',
  ]);
});
