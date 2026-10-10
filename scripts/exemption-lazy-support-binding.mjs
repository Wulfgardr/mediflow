import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const importer = 'lib/aifa-update-guide-route.test.ts';
const support = 'scripts/fixtures/exemption-import-session.ts';
const specifier = '../scripts/fixtures/exemption-import-session.ts';
const property = (node, name) => ts.isPropertyAccessExpression(node) && node.name.text === name;
const identifier = (node, name) => node && ts.isIdentifier(node) && node.text === name;
const literal = (node, value) => node && ts.isStringLiteral(node) && node.text === value;
const call = (node, count) => node && ts.isCallExpression(node) && node.arguments.length === count;
const namedCall = (node, object, name, count) => call(node, count) && property(node.expression, name)
    && identifier(node.expression.expression, object);
function declaration(statement, name) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)
        || statement.declarationList.declarations.length !== 1) return undefined;
    const value = statement.declarationList.declarations[0];
    return identifier(value.name, name) ? value.initializer : undefined;
}
function awaitedImport(statement, name, target) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)
        || statement.declarationList.declarations.length !== 1) return false;
    const value = statement.declarationList.declarations[0];
    return ts.isObjectBindingPattern(value.name) && value.name.elements.length === 1
        && !value.name.elements[0].propertyName && identifier(value.name.elements[0].name, name)
        && value.initializer && ts.isAwaitExpression(value.initializer)
        && call(value.initializer.expression, 1)
        && value.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword
        && literal(value.initializer.expression.arguments[0], target);
}

// A closed AST adapter for this one lazy fixture edge. No clinical code is loaded.
export function collectExemptionLazySupportBinding(root) {
    const errors = [];
    const deny = reason => errors.push(`EXEMPTION_LAZY_BINDING: ${reason}`);
    let source;
    try { source = fs.readFileSync(path.join(root, importer), 'utf8'); }
    catch { deny('importer missing'); }
    if (!fs.existsSync(path.join(root, support))) deny('support missing');
    if (source !== undefined) {
        const ast = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (ast.parseDiagnostics.length) deny('invalid importer syntax');
        for (const [name, module] of [['test', 'node:test'], ['fs', 'node:fs'], ['path', 'node:path']]) {
            if (!ast.statements.some(statement => ts.isImportDeclaration(statement)
                && literal(statement.moduleSpecifier, module) && !statement.importClause?.isTypeOnly
                && identifier(statement.importClause?.name, name))) deny(`missing runtime ${name} import`);
        }
        if (ast.statements.some(statement => ts.isImportDeclaration(statement)
            && literal(statement.moduleSpecifier, specifier))) deny('fixture hoisted');
        const tests = ast.statements.filter(statement => ts.isExpressionStatement(statement)
            && call(statement.expression, 3) && identifier(statement.expression.expression, 'test'));
        if (tests.length !== 1) deny('expected one direct test callback');
        else {
            const [title, options, callback] = tests[0].expression.arguments;
            if (!ts.isStringLiteral(title) || !ts.isObjectLiteralExpression(options)
                || options.properties.length !== 1 || !ts.isPropertyAssignment(options.properties[0])
                || !identifier(options.properties[0].name, 'timeout')
                || !ts.isNumericLiteral(options.properties[0].initializer)
                || !ts.isArrowFunction(callback) || !callback.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
                || !ts.isBlock(callback.body)) deny('test must be active with a direct async block');
            else {
                const statements = [...callback.body.statements];
                const parent = statements.findIndex(s => {
                    const value = declaration(s, 'parent');
                    const access = value && ts.isNonNullExpression(value) ? value.expression : value;
                    return access && property(access, 'MEDIFLOW_DATA_DIR') && property(access.expression, 'env')
                        && identifier(access.expression.expression, 'process');
                });
                const directory = statements.findIndex(s => {
                    const value = declaration(s, 'directory');
                    return namedCall(value, 'fs', 'mkdtempSync', 1)
                        && namedCall(value.arguments[0], 'path', 'join', 2)
                        && identifier(value.arguments[0].arguments[0], 'parent')
                        && ts.isStringLiteral(value.arguments[0].arguments[1]);
                });
                const environment = statements.findIndex(s => ts.isExpressionStatement(s)
                    && ts.isBinaryExpression(s.expression) && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
                    && property(s.expression.left, 'MEDIFLOW_DATA_DIR') && property(s.expression.left.expression, 'env')
                    && identifier(s.expression.left.expression.expression, 'process') && identifier(s.expression.right, 'directory'));
                const database = statements.findIndex(s => awaitedImport(s, 'dbServer', './db-server.ts'));
                const fixture = statements.findIndex(s => awaitedImport(s, 'syntheticExemptionSession', specifier));
                if (!(parent >= 0 && parent < directory && directory < environment
                    && environment < database && database < fixture)) deny('lazy import must follow isolated DB bootstrap');
                // Reject a branch/return wrapping or bypassing the direct initialization path.
                if (fixture >= 0 && statements.slice(0, fixture).some(s =>
                    !ts.isVariableStatement(s) && !ts.isExpressionStatement(s))) deny('conditional or interrupted bootstrap');
                if (fixture >= 0 && statements.slice(0, fixture).some((s, index) =>
                    index !== environment && ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression)
                    && s.expression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
                    && s.expression.operatorToken.kind <= ts.SyntaxKind.LastAssignment)) deny('bootstrap state reassigned');
            }
        }
    }
    return { importer, support, owner: '@Wulfgardr',
        reason: 'Synthetic session fixture loaded lazily by the selected AIFA route test after isolated SQLite bootstrap.', errors };
}
