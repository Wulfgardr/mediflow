import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

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

test('backup restore normalizes soft-delete tombstone timestamps', () => {
  const routeSource = parseSource('app/api/system/backup-restore/route.ts', ts.ScriptKind.TS);
  const dateFields = findDateFields(routeSource);

  assert.ok(
    dateFields.includes('deletedAt'),
    'deletedAt must be normalized before restore inserts Drizzle timestamp rows',
  );
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
