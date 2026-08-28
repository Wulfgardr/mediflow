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
    fingerprint('scripts/benchmark-clinical-entities.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', 'pathToFileURL(adapterModule).href'),
    fingerprint('scripts/benchmark-redaction.ts', 'dynamic', 'PropertyAccessExpression', 'VariableStatement', 'pathToFileURL(adapterModule).href'),
]);
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
    const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
            const list = declarations.get(node.name.text) ?? []; list.push(node); declarations.set(node.name.text, list);
        }
        ts.forEachChild(node, collect);
    };
    collect(ast);
    const unwrap = (input: ts.Expression): ts.Expression => {
        let node = input;
        while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
            || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
        return node;
    };
    const declaration = (name: string, position: number) => declarations.get(name)?.filter((item) => item.pos < position).at(-1)?.initializer;
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
        return { known: false, escaped: false };
    };
    const targetPath = path.resolve(repositoryRoot, target); const targetReal = safeRealpath(targetPath); const filePath = path.resolve(repositoryRoot, file);
    const expected = path.relative(path.dirname(filePath), targetPath).replaceAll(path.sep, '/'); const relative = expected.startsWith('.') ? expected : `./${expected}`;
    const sensitiveText = (input: ts.Expression) => {
        const evaluated = evaluate(input); const text = evaluated.known && typeof evaluated.value === 'string' ? evaluated.value : input.getText(ast);
        const decoded = decode(text).decoded.toLocaleLowerCase('en-US'); return decoded.includes(path.basename(target).toLocaleLowerCase('en-US'));
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
        const allowed = !decoded.encoded && !decoded.malformed && !hasSuffix
            && (raw === `@/${target}` || raw === relative || (file.endsWith('.test.ts') && raw === `${relative}.ts`));
        return { target: targetMatch, invalid: targetMatch && (!allowed || evaluated.escaped), unresolved: false };
    };
    const memberKey = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null => {
        if (ts.isPropertyAccessExpression(node)) return node.name.text;
        if (!node.argumentExpression) return null;
        const key = evaluate(node.argumentExpression); return key.known && ['string', 'number'].includes(typeof key.value) ? String(key.value) : null;
    };
    const propertyKey = (node: ts.ObjectLiteralElementLike): string | null => {
        if (!node.name) return null;
        if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) return node.name.text;
        if (!ts.isComputedPropertyName(node.name)) return null;
        const key = evaluate(node.name.expression); return key.known && ['string', 'number'].includes(typeof key.value) ? String(key.value) : null;
    };
    const resolveCallee = (input: ts.Expression, seen = new Set<ts.Expression>(), depth = 0): ts.Expression | null => {
        const node = unwrap(input);
        if (depth >= 16 || seen.has(node)) return null;
        const next = new Set(seen); next.add(node);
        if (ts.isIdentifier(node)) {
            if (['eval', 'Function', 'require'].includes(node.text)) return node;
            const matches = declarations.get(node.text)?.filter((item) => item.pos < node.pos) ?? [];
            return matches.length === 1 && matches[0]?.initializer ? resolveCallee(matches[0].initializer, next, depth + 1) : null;
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const key = memberKey(node); if (key === null) return null;
            const base = resolveCallee(node.expression, next, depth + 1);
            if (base && ts.isObjectLiteralExpression(base)) {
                const matches = base.properties.filter((property) => propertyKey(property) === key);
                if (matches.length !== 1) return null;
                const property = matches[0]; const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : null;
                return value ? resolveCallee(value, next, depth + 1) : null;
            }
            if (base && ts.isArrayLiteralExpression(base) && /^\d+$/u.test(key)) {
                const element = base.elements[Number(key)]; return element && !ts.isSpreadElement(element) ? resolveCallee(element, next, depth + 1) : null;
            }
            return ['eval', 'Function', 'require'].includes(key) ? node : null;
        }
        return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isObjectLiteralExpression(node)
            || ts.isArrayLiteralExpression(node) || node.kind === ts.SyntaxKind.ImportKeyword ? node : null;
    };
    const intrinsic = (input: ts.Expression): string | null => {
        const node = resolveCallee(input); if (!node) return null;
        if (node.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic';
        if (ts.isIdentifier(node)) return node.text;
        return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? memberKey(node) : null;
    };
    const loader = (input: ts.Expression): 'dynamic' | 'require' | null => {
        const kind = intrinsic(input); return kind === 'dynamic' || kind === 'require' ? kind : null;
    };
    const codeLoaderKind = (input: ts.Expression) => ['eval', 'Function'].includes(intrinsic(input) ?? '');
    const loaderWrapper = (input: ts.Expression): Readonly<{ kind: 'code' | 'dynamic' | 'require'; parameter: number }> | null => {
        const initializer = resolveCallee(input); if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) return null;
        const body = ts.isBlock(initializer.body) && initializer.body.statements.length === 1 && ts.isReturnStatement(initializer.body.statements[0]) ? initializer.body.statements[0].expression : initializer.body;
        if (!body || !ts.isCallExpression(unwrap(body as ts.Expression))) return null;
        const call = unwrap(body as ts.Expression) as ts.CallExpression; const kind = loader(call.expression) ?? (codeLoaderKind(call.expression) ? 'code' : null); const argument = call.arguments[0];
        if (!kind || !argument) return null;
        const parameter = initializer.parameters.findIndex((item) => ts.isIdentifier(item.name) && argument.getText(ast).includes(item.name.text));
        return parameter < 0 ? null : { kind, parameter };
    };
    const sensitiveCallee = (input: ts.Node, seen = new Set<ts.Node>(), depth = 0): boolean => {
        const node = ts.isParenthesizedExpression(input) || ts.isAsExpression(input) || ts.isTypeAssertionExpression(input)
            || ts.isSatisfiesExpression(input) || ts.isNonNullExpression(input) ? unwrap(input) : input;
        if (depth >= 16) return true; if (seen.has(node)) return true;
        const next = new Set(seen); next.add(node);
        if (node.kind === ts.SyntaxKind.ImportKeyword) return true;
        if (ts.isIdentifier(node)) {
            if (['eval', 'Function', 'require'].includes(node.text)) return true;
            return (declarations.get(node.text)?.filter((item) => item.pos < node.pos) ?? []).some((item) => item.initializer && sensitiveCallee(item.initializer, next, depth + 1));
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const key = memberKey(node); if (key !== null && ['eval', 'Function', 'require'].includes(key)) return true;
            return sensitiveCallee(node.expression, next, depth + 1);
        }
        if (ts.isObjectLiteralExpression(node)) {
            return node.properties.some((property) => (ts.isPropertyAssignment(property) ? sensitiveCallee(property.initializer, next, depth + 1)
                : ts.isShorthandPropertyAssignment(property) && sensitiveCallee(property.name, next, depth + 1)));
        }
        if (ts.isArrayLiteralExpression(node)) return node.elements.some((element) => !ts.isSpreadElement(element) && sensitiveCallee(element, next, depth + 1));
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return sensitiveCallee(node.body, next, depth + 1);
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) return sensitiveCallee(node.expression, next, depth + 1);
        if (ts.isBlock(node)) return node.statements.some((statement) => sensitiveCallee(statement, next, depth + 1));
        if (ts.isReturnStatement(node) && node.expression) return sensitiveCallee(node.expression, next, depth + 1);
        if (ts.isExpressionStatement(node)) return sensitiveCallee(node.expression, next, depth + 1);
        return false;
    };
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
        else if (ts.isNewExpression(node)) {
            if (codeLoaderKind(node.expression)) codeLoader(node);
            else if (sensitiveCallee(node.expression) && (node.arguments ?? []).some(sensitiveText)) add('unsupported-callee');
        }
        else if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression); const wrapper = loaderWrapper(callee);
            const memberCall = (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && memberKey(callee) === 'call' && loader(callee.expression) === 'require';
            const kind = wrapper?.kind === 'code' ? null : wrapper?.kind ?? (memberCall ? 'require' : loader(node.expression));
            const argument = wrapper ? node.arguments[wrapper.parameter] : node.arguments[memberCall ? 1 : 0];
            if (kind && argument) record(argument, node.arguments.length === (memberCall ? 2 : 1) ? kind : `${kind}-options`, kind === 'dynamic' ? namedFromBinding(node) : ['*']);
            const code = wrapper?.kind === 'code' || codeLoaderKind(callee);
            if (code) codeLoader(node);
            else if (!kind && sensitiveCallee(callee) && node.arguments.some(sensitiveText)) add('unsupported-callee');
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
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

export const moduleCalleeAliasFixtures = (specifier: string): readonly Readonly<{ form: string; source: string }>[] => Object.freeze([
    { form: 'code-loader', source: `const loaders={run:eval};loaders.run(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'code-loader', source: `const loaders=[eval];loaders[0](${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'require', source: `const loaders={run:require};loaders.run(${JSON.stringify(specifier)});` },
    { form: 'require', source: `const loaders=[require];loaders[0](${JSON.stringify(specifier)});` },
    { form: 'require', source: `const loaders={run:require};(((loaders.run as typeof require) satisfies typeof require)!)(${JSON.stringify(specifier)});` },
    { form: 'code-loader', source: `globalThis['ev'+'al'](${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'code-loader', source: `new globalThis['Fun'+'ction'](${JSON.stringify(`return import(${JSON.stringify(specifier)})`)})();` },
    { form: 'dynamic', source: `const load=(value:string)=>import(value);const loaders={['r'+'un']:load};loaders.run(${JSON.stringify(specifier)});` },
    { form: 'unsupported-callee', source: `const loaders={run:eval};loaders[pick()](${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'unsupported-callee', source: `const loop=loop;loop(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'unsupported-callee', source: `const run=eval;{const run=String;}run(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
    { form: 'unsupported-callee', source: `const load17=eval;${Array.from({ length: 17 }, (_, index) => `const load${16 - index}=load${17 - index};`).join('')}load0(${JSON.stringify(`import(${JSON.stringify(specifier)})`)});` },
]);
