import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('new-entry history explicitly rejects unavailable authenticated lists', () => {
    const file = new URL('../app/patients/[id]/entries/new/page.tsx', import.meta.url);
    const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'entriesRead'
            && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert(callback && ts.isArrowFunction(callback));
    const read = callback.body;
    assert(ts.isCallExpression(read) && ts.isPropertyAccessExpression(read.expression));
    assert.equal(read.expression.name.text, 'toArray');
    assert.equal(read.expression.expression.getText(source), 'db.entries.query({ patientId: id })');
    const options = read.arguments[0];
    assert(options && ts.isObjectLiteralExpression(options));
    assert(options.properties.some(property => ts.isPropertyAssignment(property)
        && property.name.getText(source) === 'rejectAuthUnavailable'
        && property.initializer.kind === ts.SyntaxKind.TrueKeyword));
});
