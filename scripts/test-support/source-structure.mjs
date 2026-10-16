import ts from 'typescript';

const parse = source => ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

export function hasSourceDirective(source, directive) {
  for (const statement of parse(source).statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

export function hasSideEffectImport(source, specifier) {
  return parse(source).statements.some(statement => ts.isImportDeclaration(statement)
    && !statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === specifier);
}

export function sourceVariableDeclaration(source, name) {
  const file = parse(source);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      if (declaration) throw new Error(`Ambiguous source variable: ${name}`);
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!declaration) throw new Error(`Missing source variable: ${name}`);
  return declaration.getText(file);
}
