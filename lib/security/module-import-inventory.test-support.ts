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
    allowUnresolvedFiles?: ReadonlySet<string>;
}>;

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;
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
    const add = (form: string, symbol = '*', typeOnly = false) => uses.push({ file, form, symbol, typeOnly });
    const declarations = new Map<string, ts.VariableDeclaration[]>();
    const loaderWrappers = new Map<string, Readonly<{ kind: 'dynamic' | 'require'; parameter: number }>>();
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
    const loader = (input: ts.Expression, seen = new Set<string>()): 'dynamic' | 'require' | null => {
        const node = unwrap(input); if (node.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic';
        if (ts.isIdentifier(node)) {
            if (node.text === 'require') return 'require';
            if (!seen.has(node.text)) { const initializer = declaration(node.text, node.pos); if (initializer) { const next = new Set(seen); next.add(node.text); return loader(initializer, next); } }
        }
        if ((ts.isPropertyAccessExpression(node) && node.name.text === 'require')
            || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'require')) return 'require';
        return null;
    };
    const codeLoaderKind = (input: ts.Expression, seen = new Set<string>()): boolean => {
        const node = unwrap(input);
        if (ts.isIdentifier(node)) {
            if (['eval', 'Function'].includes(node.text)) return true;
            if (!seen.has(node.text)) { const initializer = declaration(node.text, node.pos); if (initializer) { const next = new Set(seen); next.add(node.text); return codeLoaderKind(initializer, next); } }
        }
        return (ts.isPropertyAccessExpression(node) && ['eval', 'Function'].includes(node.name.text))
            || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && ['eval', 'Function'].includes(node.argumentExpression.text));
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
    const record = (expression: ts.Expression, form: string, symbols: readonly string[] = ['*'], typeOnly = false) => {
        const found = relation(expression);
        if (found.unresolved && options.allowUnresolvedFiles?.has(file)) return;
        if (found.unresolved) add('unsupported-expression', '*', typeOnly);
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
        else if (ts.isNewExpression(node) && codeLoaderKind(node.expression)) codeLoader(node);
        else if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression); const wrapper = ts.isIdentifier(callee) ? loaderWrappers.get(callee.text) : undefined;
            const memberCall = ts.isPropertyAccessExpression(callee) && callee.name.text === 'call' && loader(callee.expression) === 'require';
            const kind = wrapper?.kind ?? (memberCall ? 'require' : loader(node.expression)); const argument = wrapper ? node.arguments[wrapper.parameter] : node.arguments[memberCall ? 1 : 0];
            if (kind && argument) record(argument, node.arguments.length === (memberCall ? 2 : 1) ? kind : `${kind}-options`, kind === 'dynamic' ? namedFromBinding(node) : ['*']);
            if (codeLoaderKind(callee)) codeLoader(node);
        }
        ts.forEachChild(node, visit);
    };
    visit(ast); return uses;
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
