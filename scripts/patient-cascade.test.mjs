// WUL-306 (ADR 0066): anti-drift guard for PATIENT_CHILD_TABLES (WUL-316 pattern).
// Every table that carries a patientId column, whether defined in lib/schema.ts or
// created via raw SQL in lib/db-server.ts, MUST be covered by the canonical cascade.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import ts from 'typescript';

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
      tables.push({ exportName: node.name.text, sqlName, hasPatientId });
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

test('every schema table with a patientId column is covered by PATIENT_CHILD_TABLES', () => {
  const schemaTables = collectSchemaTables(parseSource('lib/schema.ts'));
  const required = schemaTables
    .filter((table) => table.hasPatientId)
    .map((table) => table.exportName)
    .sort();

  const cascadeEntries = extractCascadeEntries(parseSource('lib/patient-cascade.ts'));
  const covered = cascadeEntries.map((entry) => entry.tableExport).sort();

  assert.deepEqual(covered, required);
});

test('a bootstrapped DB has no patient_id table outside the canonical cascade', () => {
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

    // Raw-SQL tables that exist only in lib/db-server.ts must be covered too.
    const dbServerSource = fs.readFileSync(path.join(ROOT_DIR, 'lib/db-server.ts'), 'utf8');
    const createStatements = dbServerSource.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?\n\s*\)/g) ?? [];
    assert.ok(createStatements.length > 0, 'expected raw CREATE TABLE statements in lib/db-server.ts');
    for (const statement of createStatements) {
      sqlite.exec(statement);
    }

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);

    for (const tableName of tableNames) {
      if (tableName === 'patients') continue;
      const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
      if (!columns.includes('patient_id')) continue;
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
    'observations',
    'checkups',
    'therapies',
    'entries',
    'attachments',
    'patientsToAmbulatories',
  ]);
});
