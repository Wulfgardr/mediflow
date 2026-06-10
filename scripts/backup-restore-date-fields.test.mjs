import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

import {
  DATE_FIELDS as RUNNER_DATE_FIELDS,
  normalizeRowDates,
} from './scheduled-backup-date-fields.mjs';

function parseSource(filePath, scriptKind) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function unwrapExpression(expression) {
  return ts.isAsExpression(expression) ? unwrapExpression(expression.expression) : expression;
}

function findDateFields(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'DATE_FIELDS') continue;

      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      if (!initializer || !ts.isNewExpression(initializer)) {
        throw new Error('DATE_FIELDS must be initialized as a Set.');
      }

      const [fieldsExpression] = initializer.arguments ?? [];
      const fields = fieldsExpression && unwrapExpression(fieldsExpression);
      if (!fields || !ts.isArrayLiteralExpression(fields)) {
        throw new Error('DATE_FIELDS must be initialized from a literal array.');
      }

      return fields.elements.map((element) => {
        const value = unwrapExpression(element);
        if (!ts.isStringLiteral(value)) {
          throw new Error('DATE_FIELDS entries must be string literals.');
        }
        return value.text;
      });
    }
  }

  throw new Error('DATE_FIELDS declaration not found.');
}

function loadRouteFunction(sourceFile, functionName) {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === functionName) {
      const transpiled = ts.transpileModule(statement.getText(sourceFile), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return new Function(`${transpiled}; return ${functionName};`)();
    }
  }

  throw new Error(`${functionName} declaration not found.`);
}

test('backup restore normalizes soft-delete tombstone timestamps', () => {
  const routeSource = parseSource('app/api/system/backup-restore/route.ts', ts.ScriptKind.TS);
  const dateFields = findDateFields(routeSource);

  assert.ok(
    dateFields.includes('deletedAt'),
    'deletedAt must be normalized before restore inserts Drizzle timestamp rows',
  );
});

test('scheduled runner date-field list matches the restore DATE_FIELDS', () => {
  const routeSource = parseSource('app/api/system/backup-restore/route.ts', ts.ScriptKind.TS);
  const routeDateFields = findDateFields(routeSource);

  assert.deepEqual([...RUNNER_DATE_FIELDS].sort(), [...routeDateFields].sort());
});

test('scheduled runner converts unix-seconds date fields to ISO strings', () => {
  const row = normalizeRowDates({
    id: 'patient-1',
    firstName: 'Mario',
    lastName: 'Rossi',
    birthDate: -631152000,
    createdAt: 1750000000,
    updatedAt: '2026-06-01T10:00:00.000Z',
    deletedAt: null,
    notes: 'nota non temporale',
  });

  assert.equal(row.createdAt, '2025-06-15T15:06:40.000Z');
  assert.equal(row.birthDate, '1950-01-01T00:00:00.000Z');
  assert.equal(row.updatedAt, '2026-06-01T10:00:00.000Z');
  assert.equal(row.deletedAt, null);
  assert.equal(row.id, 'patient-1');
  assert.equal(row.notes, 'nota non temporale');
});

test('backup restore coerces unix-seconds integers from legacy scheduled artifacts', () => {
  const routeSource = parseSource('app/api/system/backup-restore/route.ts', ts.ScriptKind.TS);
  const normalizeDateValue = loadRouteFunction(routeSource, 'normalizeDateValue');

  const fromSeconds = normalizeDateValue(1750000000);
  assert.ok(fromSeconds instanceof Date);
  assert.equal(fromSeconds.getTime(), 1750000000 * 1000);

  const preEpochSeconds = normalizeDateValue(-631152000);
  assert.ok(preEpochSeconds instanceof Date);
  assert.equal(preEpochSeconds.toISOString(), '1950-01-01T00:00:00.000Z');

  const fromMilliseconds = normalizeDateValue(1750000000000);
  assert.ok(fromMilliseconds instanceof Date);
  assert.equal(fromMilliseconds.getTime(), 1750000000000);

  const fromIso = normalizeDateValue('2026-06-10T08:30:00.000Z');
  assert.ok(fromIso instanceof Date);
  assert.equal(fromIso.toISOString(), '2026-06-10T08:30:00.000Z');

  assert.equal(normalizeDateValue(null), null);
  assert.equal(normalizeDateValue(''), null);
});

// WUL-306 (ADR 0066): soft-deleted patients MUST travel in backup artifacts so a
// restore preserves the tombstone. The export dataset must not filter them out.
test('backup export keeps soft-deleted patients (tombstone roundtrip)', () => {
  const routeSource = fs.readFileSync('app/api/system/backup-restore/route.ts', 'utf8');

  assert.ok(
    !routeSource.includes('activePatients('),
    'backup-restore must not apply the activePatients() read filter',
  );
  assert.ok(
    !routeSource.includes('isNull(patients.deletedAt)'),
    'backup-restore must not filter patients by deletedAt',
  );
});
