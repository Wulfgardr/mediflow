/* @Codex */
import { realpathSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export type ModuleImportUse = Readonly<{ file: string; form: string; symbol: string; typeOnly: boolean }>;
type StaticValue = string | number | boolean | readonly StaticValue[] | StaticObject;
interface StaticObject { readonly [key: string]: StaticValue }
type StaticResult = Readonly<{ known: boolean; value?: StaticValue; escaped: boolean }>;
type Options = Readonly<{
    file: string;
    repositoryRoot: string;
    source: string;
    target: string;
    allowUnresolvedExpressions?: ReadonlySet<string>;
}>;

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;
const fingerprint = (file: string, form: string, expressionKind: string, statementKind: string, expression: string) =>
    [file, form, expressionKind, statementKind, expression].join('|');
const protectedFingerprint = (target: string, file: string, form: string, expressionKind: string, statementKind: string, expression: string) =>
    [target, fingerprint(file, form, expressionKind, statementKind, expression)].join('|');
export const allowedGenericLoaderExpressions: ReadonlySet<string> = new Set([
    fingerprint('lib/ai-providers/fabric/document-synthesis-provider-binding.test.ts', 'dynamic', 'TemplateExpression', 'VariableStatement', "`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`"),
    fingerprint('lib/ai-providers/fabric/document-synthesis-provider-envelope.test.ts', 'dynamic', 'TemplateExpression', 'VariableStatement', "`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`"),
    fingerprint('lib/ai-providers/fabric/document-synthesis-source-set-currentness-owner.test.ts', 'dynamic', 'Identifier', 'VariableStatement', 'foreignPath'),
    fingerprint('lib/pm2-manager.test.ts', 'require', 'Identifier', 'VariableStatement', 'managerPath'),
    fingerprint('lib/pm2-manager.test.ts', 'require', 'Identifier', 'ExpressionStatement', 'managerPath'),
    fingerprint('lib/security/web-auth-control-owner.test.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', "pathToFileURL(join(directory, 'web-auth-control-owner.ts')).href"),
    fingerprint('lib/security/web-auth-control-owner.test.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', "pathToFileURL(join(directory, 'server-session.ts')).href"),
    fingerprint('lib/security/web-auth-control-record.test.ts', 'dynamic', 'PropertyAccessExpression', 'ReturnStatement', 'pathToFileURL(target).href'),
    fingerprint('lib/security/web-auth-session-issuer.test.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', "pathToFileURL(join(directory, 'web-auth-session-issuer.ts')).href"),
    fingerprint('lib/security/web-auth-session-issuer.test.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', "pathToFileURL(join(directory, 'server-session.ts')).href"),
    fingerprint('lib/security/server-session.test.ts', 'require', 'ElementAccessExpression', 'ExpressionStatement', 'paths[0]'),
    fingerprint('lib/security/server-session.test.ts', 'require', 'ElementAccessExpression', 'ExpressionStatement', 'paths[1]'),
    fingerprint('lib/domain/documents/attachment-extraction-source-authority.test.ts', 'dynamic', 'TemplateExpression', 'VariableStatement',
        ["`${new URL('./attachment-extraction-source-authority.ts', import.meta", ".url).href}?copy=synthetic`"].join('')),
    fingerprint('lib/domain/documents/attachment-extraction-source-authority.test.ts', 'dynamic', 'TemplateExpression', 'VariableStatement',
        ["`${new URL('./attachment-extraction-source-authority.ts', import.meta", ".url).href}?restore-copy=synthetic`"].join('')),
    fingerprint('scripts/benchmark-clinical-entities.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', 'pathToFileURL(adapterModule).href'),
    fingerprint('scripts/benchmark-redaction.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', 'pathToFileURL(adapterModule).href'),
]);
const allowedUnsafeLoaderExpressions: ReadonlySet<string> = new Set([
    fingerprint('scripts/document-evidence-backfill-live-db.ts', 'unsafe:require', 'CallExpression', 'VariableStatement', "require('better-sqlite3')"),
    fingerprint('scripts/treatment-reasoning-live-db-smoke.ts', 'unsafe:require', 'CallExpression', 'VariableStatement', "require('better-sqlite3')"),
    fingerprint('lib/pm2-manager.ts', 'unsafe:require', 'CallExpression', 'VariableStatement', "require('pm2')"),
    fingerprint('lib/pm2-manager.test.ts', 'unsafe:require', 'CallExpression', 'VariableStatement', 'require(managerPath)'),
    fingerprint('lib/pm2-manager.test.ts', 'unsafe:require', 'CallExpression', 'ExpressionStatement', 'require(managerPath)'),
    fingerprint('lib/backup-restore-preflight.ts', 'unsafe:require', 'CallExpression', 'ReturnStatement', "require('./data-dir')"),
    fingerprint('lib/pdfjs-server.ts', 'unsafe:Function', 'NewExpression', 'VariableStatement', "new Function('specifier', 'return import(specifier);')"),
]);
const allowedProtectedLoaderExpressions: ReadonlyMap<string, number> = new Map([
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-resolve', 'CallExpression', 'VariableStatement', "nodeRequire.resolve('./server-session.ts')"), 30],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-read', 'ElementAccessExpression', 'VariableStatement', 'nodeRequire.cache[modulePath]'), 28],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-delete', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[modulePath]'), 56],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-write', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[modulePath]'), 28],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-read', 'ElementAccessExpression', 'VariableStatement', 'nodeRequire.cache[sessionPath]'), 2],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-delete', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[sessionPath]'), 4],
    [protectedFingerprint('lib/security/server-session', 'lib/security/server-session.test.ts', 'loader-cache-write', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[sessionPath]'), 2],
    [protectedFingerprint('lib/security/web-auth-control-record', 'lib/security/server-session.test.ts', 'loader-resolve', 'CallExpression', 'VariableStatement', 'nodeRequire.resolve(AUTH_CONTROL_MODULE_PATH)'), 2],
    [protectedFingerprint('lib/security/web-auth-control-record', 'lib/security/server-session.test.ts', 'loader-cache-read', 'ElementAccessExpression', 'VariableStatement', 'nodeRequire.cache[authPath]'), 2],
    [protectedFingerprint('lib/security/web-auth-control-record', 'lib/security/server-session.test.ts', 'loader-cache-delete', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[authPath]'), 4],
    [protectedFingerprint('lib/security/web-auth-control-record', 'lib/security/server-session.test.ts', 'loader-cache-write', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[authPath]'), 2],
]);
const allowedUnresolvedProtectedLoaderExpressions: ReadonlyMap<string, number> = new Map([
    ...['lib/security/server-session', 'lib/security/web-auth-control-record'].flatMap((protectedTarget) => [
        [protectedFingerprint(protectedTarget, 'lib/security/server-session.test.ts', 'loader-resolve-unresolved', 'CallExpression', 'VariableStatement', 'nodeRequire.resolve(`./${name}`)'), 1] as const,
        [protectedFingerprint(protectedTarget, 'lib/security/server-session.test.ts', 'loader-cache-read-unresolved', 'ElementAccessExpression', 'VariableStatement', 'nodeRequire.cache[path]'), 1] as const,
        [protectedFingerprint(protectedTarget, 'lib/security/server-session.test.ts', 'loader-cache-delete-unresolved', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[path]'), 1] as const,
        [protectedFingerprint(protectedTarget, 'lib/security/server-session.test.ts', 'loader-cache-write-unresolved', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[paths[index]]'), 1] as const,
        [protectedFingerprint(protectedTarget, 'lib/security/server-session.test.ts', 'loader-cache-delete-unresolved', 'ElementAccessExpression', 'ExpressionStatement', 'nodeRequire.cache[paths[index]]'), 1] as const,
    ]),
]);
// Controller policy: these spellings are reserved loader identities even when a local binding shadows the global.
const RESERVED_LOADER_IDENTITIES: ReadonlySet<string> = new Set(['eval', 'Function', 'require', 'createRequire']);
const normalizeIdentity = (value: string) => path.normalize(value).normalize('NFC').toLocaleLowerCase('en-US');
const safeRealpath = (value: string) => {
    try { return realpathSync.native(value); } catch { return null; }
};
const decode = (value: string) => {
    let decoded = value; let encoded = false;
    try {
        for (let index = 0; index < 4; index += 1) {
            const next = decodeURIComponent(decoded); if (next === decoded) break;
            decoded = next; encoded = true;
        }
        return { decoded, encoded, malformed: false };
    } catch { return { decoded, encoded, malformed: true }; }
};

export function inventoryModuleImports(options: Options): ModuleImportUse[] {
    const { file, repositoryRoot, source, target } = options;
    const uses: ModuleImportUse[] = []; const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const printer = ts.createPrinter({ removeComments: true });
    const add = (form: string, symbol = '*', typeOnly = false) => uses.push({ file, form, symbol, typeOnly });
    const unresolved: Array<Readonly<{
        fingerprint: string;
        form: string;
        invalid: boolean;
        symbols: readonly string[];
        typeOnly: boolean;
    }>> = [];
    const declarations = new Map<string, ts.VariableDeclaration[]>();
    const localBindings = new Map<string, ts.Node[]>();
    const loaderWrappers = new Map<string, Readonly<{ kind: 'dynamic' | 'require'; parameter: number }>>();
    const createRequireFactories = new Set<string>(); const moduleNamespaces = new Set<string>();
    const collect = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            && ['module', 'node:module'].includes(node.moduleSpecifier.text) && node.importClause) {
            const bindings = node.importClause.namedBindings;
            if (!node.importClause.isTypeOnly && node.importClause.name) moduleNamespaces.add(node.importClause.name.text);
            if (!node.importClause.isTypeOnly && bindings && ts.isNamespaceImport(bindings)) moduleNamespaces.add(bindings.name.text);
            if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
                if (!node.importClause.isTypeOnly && !item.isTypeOnly
                    && (item.propertyName?.text ?? item.name.text) === 'createRequire') createRequireFactories.add(item.name.text);
            }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
            const list = declarations.get(node.name.text) ?? []; list.push(node); declarations.set(node.name.text, list);
        }
        const binding = (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
            || ts.isFunctionExpression(node) || ts.isBindingElement(node)) && node.name && ts.isIdentifier(node.name) ? node.name.text : null;
        if (binding) { const list = localBindings.get(binding) ?? []; list.push(node); localBindings.set(binding, list); }
        ts.forEachChild(node, collect);
    };
    collect(ast);
    const unwrap = (input: ts.Expression): ts.Expression => {
        let node = input;
        while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
            || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
        return node;
    };
    const syntacticMemberKey = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null => {
        if (ts.isPropertyAccessExpression(node)) return node.name.text;
        const argument = node.argumentExpression && unwrap(node.argumentExpression);
        return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument.text : null;
    };
    const bindingOwner = (binding: ts.Node) => {
        let owner = binding;
        if (ts.isParameter(binding)) while (owner.parent && !ts.isFunctionLike(owner.parent)) owner = owner.parent;
        else while (owner.parent && !ts.isBlock(owner.parent) && !ts.isSourceFile(owner.parent)) owner = owner.parent;
        return owner.parent ?? owner;
    };
    const shadowed = (name: string, reference: ts.Node, except?: ts.Node) => (localBindings.get(name) ?? [])
        .some((binding) => binding !== except && bindingOwner(binding).pos <= reference.pos && reference.pos < bindingOwner(binding).end);
    const importMetaUrl = (input: ts.Expression) => {
        const node = unwrap(input);
        if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'url') return false;
        const base = unwrap(node.expression);
        return ts.isMetaProperty(base) && base.keywordToken === ts.SyntaxKind.ImportKeyword;
    };
    const createRequireFactory = (input: ts.Expression) => {
        const node = unwrap(input);
        if (ts.isIdentifier(node)) return createRequireFactories.has(node.text) && !shadowed(node.text, node);
        if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
        if (node.questionDotToken) return false;
        const base = unwrap(node.expression);
        return ts.isIdentifier(base) && moduleNamespaces.has(base.text) && !shadowed(base.text, base)
            && syntacticMemberKey(node) === 'createRequire';
    };
    const canonicalCreateRequire = (input: ts.Expression): input is ts.CallExpression => {
        const node = unwrap(input);
        return ts.isCallExpression(node) && !node.questionDotToken && createRequireFactory(node.expression)
            && node.arguments.length === 1 && importMetaUrl(node.arguments[0]!);
    };
    const declarationNode = (name: string, position: number) => declarations.get(name)?.filter((item) => {
        let scope: ts.Node = item;
        while (scope.parent && !ts.isBlock(scope.parent) && !ts.isSourceFile(scope.parent)) scope = scope.parent;
        const owner = scope.parent ?? scope;
        return item.pos < position && owner.pos <= position && position < owner.end;
    }).at(-1);
    const declaration = (name: string, position: number) => declarationNode(name, position)?.initializer;
    const createRequireLoader = (node: ts.Identifier) => {
        const selected = declarationNode(node.text, node.pos); const initializer = selected?.initializer;
        return selected !== undefined && !shadowed(node.text, node, selected)
            && initializer !== undefined && canonicalCreateRequire(initializer);
    };
    const evaluate = (input: ts.Expression, seen = new Set<ts.Expression>()): StaticResult => {
        const node = unwrap(input); if (seen.has(node)) return { known: false, escaped: false };
        const nextSeen = new Set(seen); nextSeen.add(node);
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const raw = node.getText(ast); return { known: true, value: node.text, escaped: raw.slice(1, -1) !== node.text };
        }
        if (ts.isNumericLiteral(node)) return { known: true, value: Number(node.text), escaped: false };
        if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { known: true, value: node.kind === ts.SyntaxKind.TrueKeyword, escaped: false };
        if (ts.isTemplateExpression(node)) {
            let value = node.head.text; let escaped = node.head.getText(ast).slice(1) !== node.head.text;
            for (const span of node.templateSpans) {
                const part = evaluate(span.expression, nextSeen); if (!part.known || typeof part.value !== 'string') return { known: false, escaped };
                value += part.value + span.literal.text; escaped ||= part.escaped;
            }
            return { known: true, value, escaped };
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = evaluate(node.left, nextSeen); const right = evaluate(node.right, nextSeen);
            if (!left.known || !right.known || !['string', 'number'].includes(typeof left.value) || !['string', 'number'].includes(typeof right.value)) return { known: false, escaped: left.escaped || right.escaped };
            return { known: true, value: String(left.value) + String(right.value), escaped: left.escaped || right.escaped };
        }
        if (ts.isIdentifier(node)) {
            const initializer = declaration(node.text, node.pos); return initializer ? evaluate(initializer, nextSeen) : { known: false, escaped: false };
        }
        if (ts.isArrayLiteralExpression(node)) {
            const values: StaticValue[] = []; let escaped = false;
            for (const element of node.elements) {
                if (ts.isSpreadElement(element)) return { known: false, escaped };
                const value = evaluate(element, nextSeen); if (!value.known || value.value === undefined) return { known: false, escaped };
                values.push(value.value); escaped ||= value.escaped;
            }
            return { known: true, value: values, escaped };
        }
        if (ts.isObjectLiteralExpression(node)) {
            const values: Record<string, StaticValue> = {}; let escaped = false;
            for (const property of node.properties) {
                if (!ts.isPropertyAssignment(property)) return { known: false, escaped };
                const name = property.name; const key = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
                const value = evaluate(property.initializer, nextSeen); if (key === null || !value.known || value.value === undefined) return { known: false, escaped };
                values[key] = value.value; escaped ||= value.escaped;
            }
            return { known: true, value: values, escaped };
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const base = evaluate(node.expression, nextSeen); if (!base.known || base.value === undefined || typeof base.value !== 'object') return { known: false, escaped: base.escaped };
            const key = ts.isPropertyAccessExpression(node) ? { known: true, value: node.name.text, escaped: false } : node.argumentExpression ? evaluate(node.argumentExpression, nextSeen) : { known: false, escaped: false };
            if (!key.known || !['string', 'number'].includes(typeof key.value)) return { known: false, escaped: base.escaped || key.escaped };
            const value = (base.value as Readonly<Record<string, StaticValue>>)[String(key.value)];
            return value === undefined ? { known: false, escaped: base.escaped || key.escaped } : { known: true, value, escaped: base.escaped || key.escaped };
        }
        if (ts.isCallExpression(node) && node.arguments.length === 1) {
            const callee = unwrap(node.expression);
            if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
                const base = unwrap(callee.expression);
                if (syntacticMemberKey(callee) !== 'resolve' || !ts.isIdentifier(base) || !createRequireLoader(base)) return { known: false, escaped: false };
                const value = evaluate(node.arguments[0]!, nextSeen);
                if (value.known && typeof value.value === 'string') {
                    return { known: true, value: path.resolve(path.dirname(path.resolve(repositoryRoot, file)), value.value), escaped: value.escaped };
                }
                return { known: false, escaped: value.escaped };
            }
        }
        return { known: false, escaped: false };
    };
    const targetPath = path.resolve(repositoryRoot, target); const targetReal = safeRealpath(targetPath); const filePath = path.resolve(repositoryRoot, file);
    const expected = path.relative(path.dirname(filePath), targetPath).replaceAll(path.sep, '/'); const relative = expected.startsWith('.') ? expected : `./${expected}`;
    const sensitiveText = (input: ts.Expression) => {
        const evaluated = evaluate(input); const text = evaluated.known && typeof evaluated.value === 'string' ? evaluated.value : input.getText(ast);
        const decoded = decode(text).decoded.toLocaleLowerCase('en-US'); return decoded.includes(path.basename(target).toLocaleLowerCase('en-US'));
    };
    const canonicalResolvedSpecifier = (input: ts.Expression, seen = new Set<ts.Expression>()): boolean => {
        const node = unwrap(input); if (seen.has(node)) return false;
        if (ts.isIdentifier(node)) {
            const initializer = declaration(node.text, node.pos);
            return initializer !== undefined && canonicalResolvedSpecifier(initializer, new Set(seen).add(node));
        }
        if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false;
        const callee = unwrap(node.expression);
        if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return false;
        const base = unwrap(callee.expression);
        return syntacticMemberKey(callee) === 'resolve' && ts.isIdentifier(base) && createRequireLoader(base);
    };
    const relation = (expression: ts.Expression) => {
        const evaluated = evaluate(expression);
        if (!evaluated.known || typeof evaluated.value !== 'string') return { target: false, invalid: sensitiveText(expression), unresolved: true };
        const raw = evaluated.value; const decoded = decode(raw);
        if (decoded.malformed) return { target: false, invalid: sensitiveText(expression), unresolved: false };
        const delimiter = decoded.decoded.search(/[?#]/u);
        const pathValue = delimiter < 0 ? decoded.decoded : decoded.decoded.slice(0, delimiter); const hasSuffix = delimiter >= 0;
        let resolved: string;
        try {
            resolved = pathValue.startsWith('file:') ? fileURLToPath(new URL(pathValue))
                : pathValue.startsWith('@/') ? path.resolve(repositoryRoot, pathValue.slice(2)) : path.resolve(path.dirname(filePath), pathValue);
        } catch { return { target: sensitiveText(expression), invalid: sensitiveText(expression), unresolved: false }; }
        const candidates = [resolved, ...EXTENSIONS.filter((extension) => resolved.endsWith(extension)).map((extension) => resolved.slice(0, -extension.length))];
        const targetMatch = candidates.some((candidate) => normalizeIdentity(candidate) === normalizeIdentity(targetPath)
            || (targetReal !== null && safeRealpath(candidate) !== null && normalizeIdentity(safeRealpath(candidate)!) === normalizeIdentity(targetReal)));
        const resolvedOwnTestReload = file === `${target}.test.ts` && canonicalResolvedSpecifier(expression);
        const allowed = !decoded.encoded && !decoded.malformed && !hasSuffix
            && (raw === `@/${target}` || raw === relative || (file.endsWith('.test.ts') && raw === `${relative}.ts`) || resolvedOwnTestReload);
        return { target: targetMatch, invalid: targetMatch && (!allowed || evaluated.escaped), unresolved: false };
    };
    const memberKey = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null => {
        if (ts.isPropertyAccessExpression(node)) return node.name.text;
        if (!node.argumentExpression) return null;
        const key = evaluate(node.argumentExpression); return key.known && typeof key.value === 'string' ? key.value : null;
    };
    const loader = (input: ts.Expression): 'dynamic' | 'require' | null => {
        const node = unwrap(input); if (node.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic';
        if (ts.isIdentifier(node) && (node.text === 'require' || createRequireLoader(node))) return 'require';
        if (canonicalCreateRequire(node)) return 'require';
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberKey(node) === 'require') return 'require';
        return null;
    };
    const codeLoaderKind = (input: ts.Expression): boolean => {
        const node = unwrap(input);
        if (ts.isIdentifier(node)) return ['eval', 'Function'].includes(node.text);
        return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ['eval', 'Function'].includes(memberKey(node) ?? '');
    };
    for (const [name, items] of declarations) {
        const initializer = items.at(-1)?.initializer; if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) continue;
        const body = ts.isBlock(initializer.body) && initializer.body.statements.length === 1 && ts.isReturnStatement(initializer.body.statements[0]) ? initializer.body.statements[0].expression : initializer.body;
        if (!body || !ts.isCallExpression(unwrap(body as ts.Expression))) continue;
        const call = unwrap(body as ts.Expression) as ts.CallExpression; const kind = loader(call.expression); const argument = call.arguments[0];
        if (!kind || !argument) continue;
        const parameter = initializer.parameters.findIndex((item) => ts.isIdentifier(item.name) && argument.getText(ast).includes(item.name.text));
        if (parameter >= 0) loaderWrappers.set(name, { kind, parameter });
    }
    const namedFromBinding = (node: ts.CallExpression) => {
        let parent: ts.Node = node.parent; if (ts.isAwaitExpression(parent)) parent = parent.parent;
        if (!ts.isVariableDeclaration(parent) || !ts.isObjectBindingPattern(parent.name)) return ['*'];
        return parent.name.elements.map((element) => element.propertyName?.getText(ast) ?? element.name.getText(ast));
    };
    const stableKind = (node: ts.Node) => ts.isVariableStatement(node) ? 'VariableStatement' : ts.SyntaxKind[node.kind];
    const unresolvedFingerprint = (expression: ts.Expression, form: string) => {
        let statement: ts.Node = expression;
        while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
        return fingerprint(file, form, stableKind(expression), stableKind(statement), printer.printNode(ts.EmitHint.Expression, expression, ast));
    };
    const record = (expression: ts.Expression, form: string, symbols: readonly string[] = ['*'], typeOnly = false) => {
        const found = relation(expression);
        if (found.unresolved) {
            unresolved.push({ fingerprint: unresolvedFingerprint(expression, form), form, invalid: found.invalid, symbols, typeOnly });
            return;
        }
        if (!found.target && !found.invalid) return;
        if (found.invalid) add('module-path', '*', typeOnly); for (const symbol of symbols) add(form, symbol, typeOnly);
    };
    const codeLoader = (node: ts.CallExpression | ts.NewExpression) => {
        for (const argument of node.arguments ?? []) {
            const value = evaluate(argument); if ((value.known && typeof value.value === 'string' && sensitiveText(argument)) || (!value.known && sensitiveText(argument))) add('code-loader');
        }
    };
    const unsafeLoaderCandidates: string[] = [];
    const protectedLoaderCandidates: Array<Readonly<{ fingerprint: string; invalid: boolean }>> = [];
    const unresolvedProtectedLoaderCandidates: string[] = [];
    const unsafeLoaderFingerprint = (identity: string, expression: ts.CallExpression | ts.NewExpression) => {
        let statement: ts.Node = expression;
        while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
        return fingerprint(file, `unsafe:${identity}`, stableKind(expression), stableKind(statement), printer.printNode(ts.EmitHint.Expression, expression, ast));
    };
    const protectedLoaderFingerprint = (form: string, expression: ts.Expression) => {
        let statement: ts.Node = expression;
        while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
        return protectedFingerprint(target, file, form, stableKind(expression), stableKind(statement), printer.printNode(ts.EmitHint.Expression, expression, ast));
    };
    const inTypePosition = (node: ts.Node) => {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !ts.isStatement(parent) && !ts.isSourceFile(parent)) {
            if (ts.isTypeNode(parent)) return true;
            parent = parent.parent;
        }
        return false;
    };
    const declarationName = (node: ts.Identifier) => {
        const parent = node.parent;
        return ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
            || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isBindingElement(parent)
            || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) && parent.name === node)
            || (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
            || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent)
                || ts.isSetAccessorDeclaration(parent)) && parent.name === node);
    };
    const safeFixedMember = (node: ts.Identifier) => {
        const parent = node.parent;
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node || parent.questionDotToken) return false;
        return node.text === 'Function' ? ['call', 'prototype'].includes(parent.name.text)
            : node.text === 'require' && ['cache', 'resolve'].includes(parent.name.text);
    };
    const globalObject = (input: ts.Expression) => ts.isIdentifier(input) && ['global', 'globalThis', 'self', 'window'].includes(input.text);
    const canonicalFactoryContext = (call: ts.CallExpression) => {
        let parent: ts.Node = call.parent;
        while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)
            || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)) parent = parent.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.initializer !== undefined
            && unwrap(parent.initializer) === call && ts.isVariableDeclarationList(parent.parent)
            && (parent.parent.flags & ts.NodeFlags.Const) !== 0;
        return ts.isCallExpression(parent) && unwrap(parent.expression) === call;
    };
    const unsafeIdentityVisit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !node.questionDotToken
            && RESERVED_LOADER_IDENTITIES.has(node.expression.text)
            && (node.expression.text !== 'createRequire' || createRequireFactory(node.expression))
            && !(canonicalCreateRequire(node) && canonicalFactoryContext(node))) {
            unsafeLoaderCandidates.push(unsafeLoaderFingerprint(node.expression.text, node));
        } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
            unsafeLoaderCandidates.push(unsafeLoaderFingerprint('Function', node));
        }
        if (ts.isImportDeclaration(node) && node.importClause) {
            const validModule = ts.isStringLiteral(node.moduleSpecifier) && ['module', 'node:module'].includes(node.moduleSpecifier.text);
            const bindings = node.importClause.namedBindings;
            const importedCreateRequire = bindings && ts.isNamedImports(bindings)
                ? bindings.elements.filter((item) => (item.propertyName?.text ?? item.name.text) === 'createRequire') : [];
            if (!validModule && (node.importClause.name?.text === 'createRequire' || importedCreateRequire.length > 0)) add('reserved-loader-identity');
        }
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberKey(node) === 'createRequire') {
            const parent = node.parent;
            const validFactory = ts.isCallExpression(parent) && unwrap(parent.expression) === node
                && canonicalCreateRequire(parent) && canonicalFactoryContext(parent);
            if (!validFactory) add('reserved-loader-identity');
        }
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && globalObject(node.expression)
            && memberKey(node) !== 'createRequire' && RESERVED_LOADER_IDENTITIES.has(memberKey(node) ?? '')) add('reserved-loader-identity');
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
            for (const element of node.name.elements) {
                const name = element.propertyName ?? element.name;
                const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text
                    : ts.isComputedPropertyName(name) ? evaluate(name.expression).value : null;
                if (key === 'createRequire' || (typeof key === 'string' && globalObject(unwrap(node.initializer))
                    && RESERVED_LOADER_IDENTITIES.has(key))) add('reserved-loader-identity');
            }
        }
        if (ts.isIdentifier(node) && createRequireFactories.has(node.text) && !shadowed(node.text, node) && !declarationName(node)) {
            const parent = node.parent;
            if (!(ts.isCallExpression(parent) && parent.expression === node && !parent.questionDotToken)) add('reserved-loader-identity');
        }
        if (ts.isIdentifier(node) && createRequireLoader(node) && !declarationName(node)) {
            const parent = node.parent; const directCall = ts.isCallExpression(parent) && parent.expression === node && !parent.questionDotToken;
            const fixedMember = ts.isPropertyAccessExpression(parent) && parent.expression === node && !parent.questionDotToken
                && ['cache', 'resolve'].includes(parent.name.text);
            if (!directCall && !fixedMember) add('reserved-loader-identity');
        }
        if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
            && ts.isIdentifier(unwrap(node.expression)) && createRequireLoader(unwrap(node.expression) as ts.Identifier)) {
            const key = memberKey(node); const parent = node.parent;
            const directResolve = key === 'resolve' && ts.isCallExpression(parent) && unwrap(parent.expression) === node && !parent.questionDotToken;
            const directCacheIndex = key === 'cache' && (ts.isElementAccessExpression(parent) || ts.isPropertyAccessExpression(parent))
                && unwrap(parent.expression) === node && !parent.questionDotToken;
            if (['resolve', 'cache'].includes(key ?? '') && !directResolve && !directCacheIndex) add('reserved-loader-identity');
        }
        if (ts.isIdentifier(node) && node.text !== 'createRequire' && RESERVED_LOADER_IDENTITIES.has(node.text) && !inTypePosition(node) && !declarationName(node)) {
            const parent = node.parent; const directCall = ts.isCallExpression(parent) && parent.expression === node && !parent.questionDotToken;
            const directFunctionNew = node.text === 'Function' && ts.isNewExpression(parent) && parent.expression === node;
            const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
                || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent)
                    || ts.isSetAccessorDeclaration(parent)) && parent.name === node);
            if (!directCall && !directFunctionNew && !propertyName && !safeFixedMember(node)) add('reserved-loader-identity');
        }
        if (ts.isIdentifier(node) && node.text === 'createRequire' && !createRequireFactory(node)
            && !inTypePosition(node) && !declarationName(node)) {
            const parent = node.parent;
            const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
            if (!propertyName) add('reserved-loader-identity');
        }
        ts.forEachChild(node, unsafeIdentityVisit);
    };
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause; const imported: ModuleImportUse[] = [];
            if (!clause) imported.push({ file, form: 'side-effect', symbol: '*', typeOnly: false });
            else {
                if (clause.name) imported.push({ file, form: 'default', symbol: 'default', typeOnly: clause.isTypeOnly });
                if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imported.push({ file, form: 'namespace', symbol: '*', typeOnly: clause.isTypeOnly });
                if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) imported.push({ file, form: 'named', symbol: item.propertyName?.text ?? item.name.text, typeOnly: clause.isTypeOnly || item.isTypeOnly });
            }
            const found = relation(node.moduleSpecifier); if (found.target || found.invalid) { if (found.invalid) add('module-path'); uses.push(...imported); }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) record(node.moduleSpecifier, 're-export', ['*'], node.isTypeOnly);
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) record(node.moduleReference.expression, 'require', [node.name.text], node.isTypeOnly);
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) record(node.argument.literal, 'import-type', ['*'], true);
        else if (ts.isNewExpression(node) && codeLoaderKind(node.expression)) codeLoader(node);
        else if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression); const wrapper = ts.isIdentifier(callee) ? loaderWrappers.get(callee.text) : undefined;
            const memberCall = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && memberKey(callee) === 'call' && loader(callee.expression) === 'require';
            const kind = wrapper?.kind ?? (memberCall ? 'require' : loader(node.expression));
            const argument = wrapper ? node.arguments[wrapper.parameter] : node.arguments[memberCall ? 1 : 0];
            if (kind && argument) record(argument, node.arguments.length === (memberCall ? 2 : 1) ? kind : `${kind}-options`, kind === 'dynamic' ? namedFromBinding(node) : ['*']);
            if (codeLoaderKind(callee)) codeLoader(node);
        }
        ts.forEachChild(node, visit);
    };
    visit(ast); unsafeIdentityVisit(ast);
    const protectedVisit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression);
            if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
                && memberKey(callee) === 'resolve' && ts.isIdentifier(unwrap(callee.expression))
                && createRequireLoader(unwrap(callee.expression) as ts.Identifier) && node.arguments[0]) {
                const found = relation(node.arguments[0]);
                if (found.unresolved) unresolvedProtectedLoaderCandidates.push(protectedLoaderFingerprint('loader-resolve-unresolved', node));
                if (found.target || found.invalid) protectedLoaderCandidates.push({ fingerprint: protectedLoaderFingerprint('loader-resolve', node), invalid: found.invalid });
            }
        }
        if (ts.isElementAccessExpression(node) && node.argumentExpression
            && (ts.isPropertyAccessExpression(unwrap(node.expression)) || ts.isElementAccessExpression(unwrap(node.expression)))) {
            const cache = unwrap(node.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
            const base = unwrap(cache.expression);
            if (memberKey(cache) === 'cache' && ts.isIdentifier(base) && createRequireLoader(base)) {
                const found = relation(node.argumentExpression);
                const parent = node.parent; const form = ts.isDeleteExpression(parent) ? 'loader-cache-delete'
                    : ts.isBinaryExpression(parent) && parent.left === node ? 'loader-cache-write' : 'loader-cache-read';
                if (found.unresolved) unresolvedProtectedLoaderCandidates.push(protectedLoaderFingerprint(`${form}-unresolved`, node));
                if (found.target || found.invalid) {
                    protectedLoaderCandidates.push({ fingerprint: protectedLoaderFingerprint(form, node), invalid: found.invalid });
                }
            }
        }
        ts.forEachChild(node, protectedVisit);
    };
    protectedVisit(ast);
    const unresolvedProtectedCounts = new Map<string, number>();
    for (const item of unresolvedProtectedLoaderCandidates) unresolvedProtectedCounts.set(item, (unresolvedProtectedCounts.get(item) ?? 0) + 1);
    if ([...unresolvedProtectedCounts].some(([item, count]) => allowedUnresolvedProtectedLoaderExpressions.get(item) !== count)) add('protected-loader-unsupported');
    for (const [allowed, expectedCount] of allowedUnresolvedProtectedLoaderExpressions) {
        if (!allowed.startsWith(`${target}|${file}|`) || unresolvedProtectedCounts.get(allowed) === expectedCount) continue;
        add((unresolvedProtectedCounts.get(allowed) ?? 0) > expectedCount
            ? 'protected-loader-unresolved-allowlist-duplicate' : 'protected-loader-unresolved-allowlist-drift');
    }
    const unsafeLoaderCounts = new Map<string, number>();
    for (const item of unsafeLoaderCandidates) unsafeLoaderCounts.set(item, (unsafeLoaderCounts.get(item) ?? 0) + 1);
    for (const item of unsafeLoaderCandidates) {
        if (!allowedUnsafeLoaderExpressions.has(item) || unsafeLoaderCounts.get(item) !== 1) add('reserved-loader-identity');
    }
    for (const allowed of allowedUnsafeLoaderExpressions) {
        if (allowed.startsWith(`${file}|`) && unsafeLoaderCounts.get(allowed) !== 1) add(unsafeLoaderCounts.has(allowed) ? 'reserved-loader-allowlist-duplicate' : 'reserved-loader-allowlist-drift');
    }
    const protectedCounts = new Map<string, number>();
    for (const item of protectedLoaderCandidates) protectedCounts.set(item.fingerprint, (protectedCounts.get(item.fingerprint) ?? 0) + 1);
    for (const item of protectedLoaderCandidates) {
        const expectedCount = allowedProtectedLoaderExpressions.get(item.fingerprint);
        if (expectedCount === protectedCounts.get(item.fingerprint)) continue;
        if (expectedCount !== undefined) continue;
        add('protected-loader-access'); if (item.invalid) add('module-path');
    }
    for (const [allowed, expectedCount] of allowedProtectedLoaderExpressions) {
        if (!allowed.startsWith(`${target}|${file}|`) || protectedCounts.get(allowed) === expectedCount) continue;
        add((protectedCounts.get(allowed) ?? 0) > expectedCount ? 'protected-loader-allowlist-duplicate' : 'protected-loader-allowlist-drift');
    }
    const counts = new Map<string, number>();
    for (const item of unresolved) counts.set(item.fingerprint, (counts.get(item.fingerprint) ?? 0) + 1);
    for (const item of unresolved) {
        if (options.allowUnresolvedExpressions?.has(item.fingerprint) && counts.get(item.fingerprint) === 1) continue;
        add('unsupported-expression', '*', item.typeOnly);
        if (item.invalid) {
            add('module-path', '*', item.typeOnly);
            for (const symbol of item.symbols) add(item.form, symbol, item.typeOnly);
        }
    }
    for (const allowed of options.allowUnresolvedExpressions ?? []) {
        if (allowed.startsWith(`${file}|`) && counts.get(allowed) !== 1) add(counts.has(allowed) ? 'allowlist-duplicate' : 'allowlist-drift');
    }
    return uses;
}

export const repositoryTypeScriptSources = (root: string): Record<string, string> => {
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory() && !['.git', '.next', 'node_modules'].includes(entry.name)) return files(absolute);
        return entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name) ? [absolute] : [];
    });
    return Object.fromEntries(files(root).map((absolute) => [path.relative(root, absolute), readFileSync(absolute, 'utf8')]));
};

export const moduleImportBypassFixtures = (specifier: string, absoluteTarget: string): readonly string[] => Object.freeze([
    `import(${JSON.stringify(`${specifier}?inventory=1`)});`, `import(${JSON.stringify(`${specifier}#inventory`)});`,
    `import(${JSON.stringify(specifier.replace('server', '%73erver').replace('web-auth', 'web-%61uth'))});`,
    `import(${JSON.stringify(`${specifier}%ZZ`)});`,
    `import(${JSON.stringify(specifier.toLocaleUpperCase('en-US'))});`, `import(${JSON.stringify(`${specifier}.js`)});`,
    `const paths={target:${JSON.stringify(specifier)}};import(paths['target']);`, `const paths=[${JSON.stringify(specifier)}];import(paths[0]);`,
    `eval(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});`, `new Function(${JSON.stringify(`return import(${JSON.stringify(specifier)})`)})();`,
    `const run=eval;run(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});`,
    `const load=(value:string)=>import(value);load(${JSON.stringify(specifier)});`, `import(pick());`,
    `import(${JSON.stringify(pathToFileURL(absoluteTarget).href)});`,
]);

export const unsafeLoaderIdentityFixtures = (specifier: string): readonly string[] => Object.freeze([
    'const loaders={run:eval};', 'const loaders=[eval];', 'const {eval:run}=globalThis;', 'const [run]=[eval];',
    "const loaders={run(){return eval('1')}};", 'const loaders={get run(){return eval}};', 'const loaders=[...eval];',
    'let run;run=eval;', 'consume(eval);', 'function loader(){return eval;}', 'const run=eval;',
    "globalThis['ev'+'al']('1');", "const make=globalThis['Fun'+'ction'];", `globalThis['req'+'uire'](${JSON.stringify(specifier)});`,
    "eval?.('1');", `require?.(${JSON.stringify(specifier)});`, 'const run=require;', "eval('1');",
    "new Function('return 1');", `require(${JSON.stringify(`${specifier}-not-allowlisted`)});`,
]);

export const reservedLoaderBindingFixtures: readonly string[] = Object.freeze([
    'const require=()=>undefined;require();',
    'function invoke(Function:()=>void){Function();}',
    "import require from './synthetic-safe';require();",
    "import {synthetic as eval} from './synthetic-safe';eval();",
]);

export const createRequireBypassFixtures = (specifier: string): readonly string[] => {
    const metaUrl = ['import', 'meta', 'url'].join('.');
    return Object.freeze([
        `import {createRequire} from 'node:module';createRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire as makeRequire} from 'module';makeRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `import * as Module from 'node:module';Module.createRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const make=createRequire;make(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const make=()=>createRequire(${metaUrl});make()(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});const load=nodeRequire;load(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});nodeRequire(${JSON.stringify(specifier)},{});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});nodeRequire(${JSON.stringify(`${specifier}?inventory=1`)});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});nodeRequire(${JSON.stringify(`${specifier}#inventory`)});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});nodeRequire(${JSON.stringify(specifier.replace('server', '%73erver').replace('web-auth', 'web-%61uth'))});`,
        `import {createRequire} from 'node:module';const nodeRequire=createRequire(${metaUrl});nodeRequire(pick());`,
        `import * as Module from 'node:module';Module['create'+'Require'](${metaUrl})(${JSON.stringify(specifier)});`,
        `process.getBuiltinModule('node:module').createRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `import * as Module from 'node:module';const {createRequire:make}=Module;make(${metaUrl})(${JSON.stringify(specifier)});`,
        `const {createRequire}=await import('node:module');createRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `createRequire(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';createRequire?.(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire as makeRequire} from 'module';makeRequire?.(${metaUrl})(${JSON.stringify(specifier)});`,
        `import * as Module from 'node:module';Module.createRequire?.(${metaUrl})(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolved=loader.resolve(${JSON.stringify(specifier)});loader.cache[resolved]?.exports;`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader['resolve'](${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve?.(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});(loader.resolve)(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve.call(null,${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve.apply(null,[${JSON.stringify(specifier)}]);`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve.bind(loader)(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolve=loader.resolve;resolve(${JSON.stringify(specifier)});`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.cache[loader.resolve(${JSON.stringify(specifier)})]?.['exports'];`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolved=loader.resolve(${JSON.stringify(specifier)});loader.cache[resolved]={exports:{}};`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolved=loader.resolve(${JSON.stringify(specifier)});delete loader.cache[resolved];`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolved=loader.resolve(${JSON.stringify(specifier)});loader.cache?.[resolved]?.exports;`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const resolved=loader.resolve(${JSON.stringify(specifier)});const cache=loader.cache;cache[resolved]?.exports;`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const cache=loader.cache;cache[pick()]?.exports;`,
    ]);
};

export const createRequireUnresolvedFixtures = (specifier: string): readonly string[] => {
    const metaUrl = ['import', 'meta', 'url'].join('.');
    return Object.freeze([
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const pick=()=>${JSON.stringify(specifier)};const resolved=loader.resolve(pick());loader.cache[resolved]?.exports;`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});const target=pick();loader.resolve(target);`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});function target(){return pick()}loader.resolve(target());`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve(pick()?${JSON.stringify(specifier)}:'./unrelated');`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.resolve(\`${'${pick()}'}${specifier}\`);`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader['resolve']?.(pick());`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.cache[pick()]?.exports;`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.cache[pick()]={exports:{}};`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});delete loader.cache[pick()];`,
        `import {createRequire} from 'node:module';const loader=createRequire(${metaUrl});loader.cache?.[pick()]?.exports;`,
    ]);
};

export const createRequireShadowFixtures = (specifier: string): readonly string[] => {
    const metaUrl = ['import', 'meta', 'url'].join('.');
    return Object.freeze([
        `import {createRequire} from 'node:module';function f(createRequire:Function){createRequire(${metaUrl})(${JSON.stringify(specifier)});}`,
        `import * as Module from 'node:module';function f(Module:object){Module.createRequire(${metaUrl})(${JSON.stringify(specifier)});}`,
    ]);
};
