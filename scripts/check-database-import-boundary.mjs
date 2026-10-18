#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const INVENTORY = 'docs/database-import-boundary.json';
const ROOTS = ['app', 'lib', 'components', 'hooks', 'packages'];
export const DATABASE_SCOPE = Object.freeze({ roots: ROOTS, entries: [
    'scripts/source-runtime.mjs', 'scripts/mediflow-headless-supervisor.mjs',
    'scripts/intelligent-host-mcp-stdio.mjs', 'scripts/run-scheduled-backup.mjs',
    'scripts/local-api-tls-proxy.mjs', 'scripts/restore-recovery-backup.ts',
] });
const CONNECTION_EXPORTS = new Map([
    ['lib/db-server.ts', null],
    ['lib/sqlite-schema-open.ts', new Set(['openVersionedSqliteDatabase'])],
    ['lib/sqlite-maintenance-admission.mjs', new Set(['openAdmittedSqlite'])],
]);
const DRIVERS = new Set(['better-sqlite3', 'sqlite3', 'sqlite', 'node:sqlite', 'sql.js', '@libsql/client', 'pg', 'postgres', 'mysql', 'mysql2', 'duckdb', '@duckdb/node-api', 'bun:sqlite']);
const DRIZZLE_ADAPTERS = new Set(['better-sqlite3', 'node-sqlite', 'sqlite-proxy', 'sql-js', 'libsql', 'bun-sqlite', 'node-postgres', 'postgres-js', 'mysql2', 'pglite']);
const digest = text => createHash('sha256').update(text).digest('hex');
const canonical = value => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const unique = values => [...new Set(values)].sort();
const slash = value => value.split(path.sep).join('/');
const unwrap = input => {
    let node = input;
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
        || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
    return node;
};
const member = node => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
function packageName(specifier) {
    return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
function driver(specifier, aliases) {
    const name = packageName(specifier.split(/[?#]/u)[0]);
    const actual = (aliases.get(name) ?? name).toLowerCase();
    const normalized = actual + specifier.slice(name.length);
    if (DRIVERS.has(actual)) return `driver:${actual}`;
    if (actual === 'drizzle-orm' && DRIZZLE_ADAPTERS.has(normalized.split('/')[1])) return `driver:${normalized.split('/').slice(0, 2).join('/')}`;
    return null;
}
function packageManifests(root) {
    const result = new Map([['package.json', JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))]]);
    function walk(directory) {
        if (!fs.existsSync(path.join(root, directory))) return;
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const file = `${directory}/${entry.name}`;
            if (entry.isSymbolicLink()) throw new Error(`SYMLINK ${file}`);
            if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) walk(file);
            else if (entry.isFile() && entry.name === 'package.json') result.set(file, JSON.parse(fs.readFileSync(regular(root, file), 'utf8')));
        }
    }
    walk('packages');
    return result;
}
function driverAliases(root, packageFiles) {
    const aliases = new Map();
    const manifests = [...packageFiles.values()];
    const lock = path.join(root, 'package-lock.json');
    if (fs.existsSync(lock)) {
        const packages = JSON.parse(fs.readFileSync(lock, 'utf8')).packages ?? {};
        manifests.push(...Object.values(packages));
        for (const [key, value] of Object.entries(packages)) {
            if (key.includes('node_modules/') && typeof value.name === 'string' && DRIVERS.has(value.name)) {
                aliases.set(key.slice(key.lastIndexOf('node_modules/') + 13), value.name);
            }
        }
    }
    for (const manifest of manifests) for (const section of ['dependencies', 'optionalDependencies', 'devDependencies']) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
            if (typeof version !== 'string' || !version.startsWith('npm:')) continue;
            const value = version.slice(4); const index = value.indexOf('@', value.startsWith('@') ? 1 : 0);
            aliases.set(name, index < 0 ? value : value.slice(0, index));
        }
    }
    return aliases;
}
function excludedRootFile(file) {
    return /\.(?:test|spec|test-support|fixtures?)\.[^.]+$/u.test(file)
        || /(?:^|\/)(?:test|tests|fixtures|test-fixtures|test-support|__tests__|__mocks__)\//u.test(file)
        || file.endsWith('.d.ts') || file.endsWith('.d.mts') || file.endsWith('.d.cts');
}
function regular(root, file) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) throw new Error(`OUTSIDE_ROOT ${file}`);
    let current = root;
    for (const segment of path.relative(root, absolute).split(path.sep)) {
        current = path.join(current, segment);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`SYMLINK ${file}`);
    }
    if (!fs.statSync(absolute).isFile()) throw new Error(`NOT_FILE ${file}`);
    return absolute;
}
function collect(root, relative) {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return [];
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`SYMLINK ${relative}`);
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const child = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error(`SYMLINK ${child}`);
        if (entry.isDirectory()) return ['node_modules', '.git', '.next', 'dist', 'coverage', '.build'].includes(entry.name) ? [] : collect(root, child);
        return entry.isFile() && EXTENSIONS.some(extension => child.endsWith(extension)) && !excludedRootFile(child) ? [child] : [];
    });
}
function resolver(root, manifests) {
    const config = path.join(root, 'tsconfig.json');
    const parsed = fs.existsSync(config) ? ts.readConfigFile(config, ts.sys.readFile) : { config: {} };
    if (parsed.error) throw new Error('INVALID_TSCONFIG');
    const options = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions ?? {}, root).options;
    const paths = options.paths ?? {};
    return (file, specifier) => {
        let value = specifier;
        if (value.startsWith('file:')) {
            try { value = fileURLToPath(value); } catch { throw new Error(`INVALID_MODULE_URL ${file}`); }
        }
        if (/^[./]|^[A-Za-z]:[/\\]/u.test(value) || path.isAbsolute(value)) {
            value = path.resolve(root, path.dirname(file), value);
        } else {
            let match;
            for (const [alias, targets] of Object.entries(paths)) {
                const [prefix, suffix] = alias.split('*');
                if (alias.includes('*') ? value.startsWith(prefix) && value.endsWith(suffix) : value === alias) {
                    if (targets.length !== 1) throw new Error(`AMBIGUOUS_ALIAS ${alias}`);
                    const middle = alias.includes('*') ? value.slice(prefix.length, suffix ? -suffix.length : undefined) : '';
                    match = path.resolve(options.baseUrl ?? root, targets[0].replace('*', middle)); break;
                }
            }
            if (!match) {
                const name = packageName(value);
                const localPackage = [...manifests].find(([, manifest]) => manifest.name === name);
                if (localPackage) {
                    const [manifestFile, manifest] = localPackage;
                    const subpath = value.slice(name.length);
                    const key = subpath ? '.' + subpath : '.';
                    let target = typeof manifest.exports === 'string' ? (subpath ? undefined : manifest.exports)
                        : manifest.exports?.[key] ?? (!subpath && manifest.exports && !Object.keys(manifest.exports).some(key => key.startsWith('.')) ? manifest.exports : undefined);
                    if (!manifest.exports) target = subpath ? '.' + subpath : manifest.main ?? './index.js';
                    const leaves = item => typeof item === 'string' ? [item] : item && typeof item === 'object' ? Object.values(item).flatMap(leaves) : [];
                    const targets = unique(leaves(target).filter(item => !item.endsWith('.d.ts') && !item.endsWith('.d.mts')));
                    if (targets.length !== 1) throw new Error(`UNSUPPORTED_PACKAGE_EXPORT ${value}`);
                    match = path.resolve(root, path.dirname(manifestFile), targets[0]);
                }
            }
            if (!match && value.startsWith('#')) {
                const owner = [...manifests].filter(([manifestFile]) => file.startsWith(path.posix.dirname(manifestFile) + '/') || manifestFile === 'package.json')
                    .sort(([a], [b]) => b.length - a.length)[0];
                const target = owner?.[1].imports?.[value];
                if (typeof target !== 'string') throw new Error(`UNSUPPORTED_PACKAGE_IMPORT ${value}`);
                match = path.resolve(root, path.dirname(owner[0]), target);
            }
            if (!match) return null;
            value = match;
        }
        value = value.split(/[?#]/u)[0];
        const bases = [value];
        if (/\.[cm]?jsx?$/u.test(value)) bases.push(value.replace(/\.[cm]?jsx?$/u, ''));
        const candidates = unique(bases.flatMap(base => [base, ...EXTENSIONS.map(extension => base + extension), ...EXTENSIONS.map(extension => path.join(base, 'index' + extension))]));
        const found = candidates.filter(candidate => fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory());
        if (!found.length) throw new Error(`UNRESOLVED_LOCAL ${file}: ${specifier}`);
        const selected = found.find(candidate => candidate === value) ?? found[0];
        const relative = slash(path.relative(root, selected)); regular(root, relative);
        return relative;
    };
}

function parseModule(file, source) {
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    if (ast.parseDiagnostics.length) throw new Error(`SYNTAX ${file}:${ast.getLineAndCharacterOfPosition(ast.parseDiagnostics[0].start ?? 0).line + 1}`);
    const declarations = new Map(); const destructured = new Map(); const imported = new Map(); const loads = []; const opaque = [];
    const printer = ts.createPrinter({ removeComments: true });
    const visitDeclarations = node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const values = declarations.get(node.name.text) ?? []; values.push(node); declarations.set(node.name.text, values);
        }
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) for (const binding of node.name.elements) {
            if (ts.isIdentifier(binding.name)) destructured.set(binding.name.text, { initializer: node.initializer, symbol: binding.propertyName?.text ?? binding.name.text });
        }
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.importClause && !node.importClause.isTypeOnly) {
            const specifier = node.moduleSpecifier.text; const clause = node.importClause;
            if (clause.name) imported.set(clause.name.text, { specifier, symbol: 'default' });
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, { specifier, symbol: '*' });
            if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) if (!binding.isTypeOnly) imported.set(binding.name.text, { specifier, symbol: binding.propertyName?.text ?? binding.name.text });
        }
        if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
            && ts.isStringLiteralLike(node.moduleReference.expression)) imported.set(node.name.text, { specifier: node.moduleReference.expression.text, symbol: '*' });
        ts.forEachChild(node, visitDeclarations);
    };
    visitDeclarations(ast);
    const declaration = node => {
        const candidates = declarations.get(node.text) ?? [];
        return candidates.filter(item => {
            let owner = item.parent;
            while (owner.parent && !ts.isBlock(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
            return owner.pos <= node.pos && owner.end >= node.end;
        }).sort((a, b) => b.pos - a.pos)[0];
    };
    const constant = (input, seen = new Set()) => {
        const node = unwrap(input); if (!node || seen.has(node)) return undefined;
        const next = new Set([...seen, node]);
        if (ts.isStringLiteralLike(node)) return node.text;
        if (ts.isIdentifier(node)) { const item = declaration(node); return item && (item.parent.flags & ts.NodeFlags.Const) ? constant(item.initializer, next) : undefined; }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = constant(node.left, next), right = constant(node.right, next); return left !== undefined && right !== undefined ? left + right : undefined;
        }
        if (ts.isTemplateExpression(node)) {
            let result = node.head.text;
            for (const span of node.templateSpans) { const value = constant(span.expression, next); if (value === undefined) return undefined; result += value + span.literal.text; }
            return result;
        }
        return undefined;
    };
    const loader = (input, seen = new Set()) => {
        const node = unwrap(input); if (!node || seen.has(node)) return null;
        const next = new Set([...seen, node]);
        if (node.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic';
        if (ts.isIdentifier(node)) {
            if (node.text === 'require') return 'require';
            if (['eval', 'Function'].includes(node.text)) return 'code';
            const binding = imported.get(node.text);
            if (binding && ['module', 'node:module'].includes(binding.specifier) && binding.symbol === 'createRequire') return 'factory';
            if (destructured.get(node.text)?.symbol === 'createRequire') return 'factory';
            const item = declaration(node); return item ? loader(item.initializer, next) : null;
        }
        if (ts.isCallExpression(node) && loader(node.expression, next) === 'factory') return 'require';
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const key = member(node); const base = unwrap(node.expression);
            if (['require', 'eval', 'Function'].includes(key) && ts.isIdentifier(base) && ['globalThis', 'global', 'window', 'self'].includes(base.text)) return key === 'require' ? 'require' : 'code';
            if (key === 'require' && ts.isIdentifier(base) && base.text === 'module') return 'require';
            if (key === 'getBuiltinModule') return 'builtin';
            if (key === 'dlopen') return 'native';
            const binding = ts.isIdentifier(base) ? imported.get(base.text) : null;
            if (key === '_load' && binding && ['module', 'node:module'].includes(binding.specifier)) return 'require';
            if (key === 'createRequire' && binding && ['module', 'node:module'].includes(binding.specifier)) return 'factory';
            if (key === 'createRequire') return 'factory';
        }
        return null;
    };
    const addOpaque = (node, kind) => opaque.push({ file, kind, expression: printer.printNode(ts.EmitHint.Unspecified, node, ast), sourceSha256: digest(source) });
    const addLoad = (node, specifier, form, symbols, typeOnly = false) => {
        if (typeOnly) return;
        if (specifier === undefined) addOpaque(node, form);
        else loads.push({ node, specifier, form, symbols: unique(symbols) });
    };
    const visit = node => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause; const symbols = [];
            if (!clause) symbols.push('*');
            else if (!clause.isTypeOnly) {
                if (clause.name) symbols.push('default');
                if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) symbols.push('*');
                if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) symbols.push(item.propertyName?.text ?? item.name.text);
            }
            if (symbols.length) addLoad(node, constant(node.moduleSpecifier), 'import', symbols);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
            const clause = node.exportClause;
            const symbols = clause && ts.isNamedExports(clause) ? clause.elements.filter(e => !e.isTypeOnly).map(e => e.propertyName?.text ?? e.name.text) : ['*'];
            if (symbols.length) addLoad(node, constant(node.moduleSpecifier), 're-export', symbols);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            addLoad(node, constant(node.moduleReference.expression), 'require', ['*'], node.isTypeOnly);
        } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            let kind = loader(node.expression); let argument = node.arguments?.[0];
            if (kind === 'factory') {
                const base = unwrap(argument);
                if (!base || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url' || !ts.isMetaProperty(base.expression)
                    || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword || node.arguments?.length !== 1) addOpaque(node, 'require-base');
            }
            const callee = unwrap(node.expression);
            if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && member(callee) === 'call' && loader(callee.expression) === 'require') { kind = 'require'; argument = node.arguments?.[1]; }
            if ((ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && ['apply', 'bind'].includes(member(callee)) && loader(callee.expression) === 'require') kind = 'loader-dispatch';
            if (kind && !['factory'].includes(kind)) {
                if (['code', 'native', 'loader-dispatch'].includes(kind)) addOpaque(node, kind);
                else addLoad(node, constant(argument), kind, ['*']);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    return { ast, source, loads, opaque, imported, declarations, declaration, destructured, constant };
}

function group(records) {
    const grouped = new Map();
    for (const record of records) {
        const key = canonical(record); const current = grouped.get(key);
        if (current) current.count += 1; else grouped.set(key, { ...record, count: 1 });
    }
    return [...grouped.values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

export async function analyzeDatabaseImports(root, scope) {
    root = fs.realpathSync(root);
    const manifests = packageManifests(root);
    const resolve = resolver(root, manifests), aliases = driverAliases(root, manifests); const modules = new Map();
    const queue = unique([...scope.roots.flatMap(relative => collect(root, relative)), ...scope.entries]);
    for (let index = 0; index < queue.length; index += 1) {
        const file = queue[index]; if (modules.has(file)) continue;
        const source = fs.readFileSync(regular(root, file), 'utf8'); const parsed = parseModule(file, source);
        for (const load of parsed.loads) {
            load.target = resolve(file, load.specifier);
            if (load.target && EXTENSIONS.some(extension => load.target.endsWith(extension)) && !queue.includes(load.target)) queue.push(load.target);
        }
        modules.set(file, parsed);
    }
    const exports = new Map([...modules.keys()].map(file => [file, new Map()]));
    const capabilities = (file, symbol) => {
        const permitted = CONNECTION_EXPORTS.get(file);
        if (CONNECTION_EXPORTS.has(file) && (permitted === null || symbol === '*' || permitted.has(symbol))) return [`server:${file}`];
        const table = exports.get(file);
        return symbol === '*' ? unique([...(table?.values() ?? [])].flat()) : unique([...(table?.get(symbol) ?? []), ...(table?.get('*') ?? [])]);
    };
    const forLoad = (load, symbol = '*') => load.target ? capabilities(load.target, symbol) : [driver(load.specifier, aliases)].filter(Boolean);
    for (let pass = 0; pass <= modules.size; pass += 1) {
        let changed = false;
        for (const [file, parsed] of modules) {
            const locals = new Map();
            for (const [name, binding] of parsed.imported) {
                const load = parsed.loads.find(item => ['import', 'require'].includes(item.form) && item.specifier === binding.specifier);
                if (load) locals.set(name, forLoad(load, binding.symbol));
            }
            const expressionCaps = (input, seen = new Set()) => {
                const node = unwrap(input); if (!node || seen.has(node)) return [];
                const next = new Set([...seen, node]);
                if (ts.isIdentifier(node)) {
                    if (locals.has(node.text)) return locals.get(node.text);
                    const binding = parsed.destructured.get(node.text);
                    if (binding) {
                        const load = parsed.loads.find(item => item.node === unwrap(binding.initializer));
                        return load ? forLoad(load, binding.symbol) : expressionCaps(binding.initializer, next);
                    }
                    return expressionCaps(parsed.declaration(node)?.initializer, next);
                }
                if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
                    const base = unwrap(node.expression); const key = member(node);
                    const binding = ts.isIdentifier(base) ? parsed.imported.get(base.text) : null;
                    if (binding?.symbol === '*' && key) { const load = parsed.loads.find(item => item.form === 'import' && item.specifier === binding.specifier); return load ? forLoad(load, key) : []; }
                    return expressionCaps(node.expression, next);
                }
                const load = parsed.loads.find(item => item.node === node);
                if (load) return forLoad(load);
                if (ts.isNewExpression(node)) return expressionCaps(node.expression, next);
                if (ts.isObjectLiteralExpression(node)) return unique(node.properties.flatMap(property => ts.isPropertyAssignment(property)
                    ? expressionCaps(property.initializer, next) : ts.isShorthandPropertyAssignment(property) ? expressionCaps(property.name, next) : []));
                if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
                    if (!node.body) return [];
                    if (!ts.isBlock(node.body)) return expressionCaps(node.body, next);
                    return unique(node.body.statements.filter(ts.isReturnStatement).flatMap(statement => expressionCaps(statement.expression, next)));
                }
                return [];
            };
            const put = (name, values) => {
                const current = exports.get(file); const merged = unique([...(current.get(name) ?? []), ...values]);
                if (merged.length && canonical(current.get(name)) !== canonical(merged)) { current.set(name, merged); changed = true; }
            };
            for (const statement of parsed.ast.statements) {
                if (ts.isExportDeclaration(statement)) {
                    const load = parsed.loads.find(item => item.node === statement); const clause = statement.exportClause;
                    if (clause && ts.isNamedExports(clause)) for (const item of clause.elements) {
                        if (statement.isTypeOnly || item.isTypeOnly) continue;
                        const name = item.propertyName?.text ?? item.name.text;
                        put(item.name.text, load ? forLoad(load, name) : expressionCaps(item.propertyName ?? item.name));
                    } else if (load) {
                        if (clause && ts.isNamespaceExport(clause)) put(clause.name.text, forLoad(load));
                        else if (load.target) {
                            for (const [name, values] of exports.get(load.target) ?? []) put(name, values);
                            if (CONNECTION_EXPORTS.has(load.target)) put('*', forLoad(load));
                        } else put('*', forLoad(load));
                    }
                } else if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
                    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) put(declaration.name.text, expressionCaps(declaration.initializer));
                } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
                    put(statement.name.text, expressionCaps(statement));
                } else if (ts.isExportAssignment(statement)) put('default', expressionCaps(statement.expression));
                else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
                    && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                    const left = statement.expression.left;
                    if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
                        const base = unwrap(left.expression); const key = member(left);
                        if (ts.isIdentifier(base) && base.text === 'exports') put(key ?? '*', expressionCaps(statement.expression.right));
                        if (ts.isIdentifier(base) && base.text === 'module' && key === 'exports') put('*', expressionCaps(statement.expression.right));
                        if ((ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) && member(base) === 'exports'
                            && ts.isIdentifier(base.expression) && base.expression.text === 'module') put(key ?? '*', expressionCaps(statement.expression.right));
                    }
                }
            }
        }
        if (!changed) break;
        if (pass === modules.size) throw new Error('EXPORT_GRAPH_DID_NOT_CONVERGE');
    }
    const edges = [], opaque = [];
    for (const [file, parsed] of modules) {
        opaque.push(...parsed.opaque);
        for (const load of parsed.loads) {
            const grouped = new Map();
            for (const symbol of load.symbols) {
                const values = load.target ? capabilities(load.target, symbol) : [driver(load.specifier, aliases)].filter(Boolean);
                const wildcard = load.target ? exports.get(load.target)?.get('*') ?? [] : [];
                for (const capability of unique([...values, ...wildcard])) {
                    const symbols = grouped.get(capability) ?? []; symbols.push(symbol); grouped.set(capability, symbols);
                }
            }
            for (const [capability, symbols] of grouped) edges.push({ file, target: load.target ?? load.specifier, capability, form: load.form, symbols: unique(symbols) });
        }
    }
    return { files: modules.size, edges: group(edges), opaqueLoaders: group(opaque) };
}

export function compareDatabaseInventory(observed, expected) {
    const issues = [], actual = new Map(), allowed = new Map();
    const key = record => canonical(Object.fromEntries(Object.entries(record).filter(([name]) => !['count', 'reason', 'classification'].includes(name)).sort(([a], [b]) => a.localeCompare(b))));
    for (const [records, target, label] of [[observed, actual, 'observed'], [expected, allowed, 'inventory']]) for (const record of records) {
        const identity = key(record);
        if (target.has(identity)) issues.push(`DUPLICATE ${label}: ${record.file}`);
        if (!Number.isSafeInteger(record.count) || record.count < 1) issues.push(`INVALID_COUNT ${record.file}`);
        target.set(identity, record);
    }
    for (const [identity, record] of actual) {
        if (!allowed.has(identity)) issues.push(`NEW_EDGE ${identity}`);
        else if (record.count !== allowed.get(identity).count) issues.push(`COUNT ${record.file}: expected ${allowed.get(identity).count}, found ${record.count}`);
    }
    for (const [identity, record] of allowed) if (!actual.has(identity)) issues.push(`STALE_EDGE ${identity}: ${record.file}`);
    return issues;
}

export async function runDatabaseImportGuard(root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
    const inventory = JSON.parse(fs.readFileSync(regular(root, INVENTORY), 'utf8'));
    if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.scope?.roots) || !Array.isArray(inventory.scope?.entries)
        || !Array.isArray(inventory.edges) || !Array.isArray(inventory.opaqueLoaders)) throw new Error('Malformed database import inventory');
    if (canonical(inventory.scope) !== canonical(DATABASE_SCOPE)) throw new Error('SCOPE_DRIFT database import surfaces must match the declared runtime scope');
    const string = value => typeof value === 'string' && value.trim().length > 0;
    for (const edge of inventory.edges) {
        const keys = ['file', 'target', 'capability', 'form', 'symbols', 'count', 'classification'];
        if (canonical(Object.keys(edge).sort()) !== canonical(keys.sort()) || !['file', 'target', 'capability', 'form', 'classification'].every(key => string(edge[key]))
            || !Array.isArray(edge.symbols) || !edge.symbols.length || edge.symbols.some(symbol => !string(symbol))
            || canonical(edge.symbols) !== canonical(unique(edge.symbols)) || !string(inventory.classifications?.[edge.classification])) throw new Error(`INVALID_EDGE ${edge.file ?? '?'}`);
    }
    for (const loader of inventory.opaqueLoaders) {
        const keys = ['file', 'kind', 'expression', 'sourceSha256', 'count', 'reason'];
        if (canonical(Object.keys(loader).sort()) !== canonical(keys.sort()) || !['file', 'kind', 'expression', 'reason'].every(key => string(loader[key]))
            || !/^[a-f0-9]{64}$/u.test(loader.sourceSha256)) throw new Error(`INVALID_OPAQUE_LOADER ${loader.file ?? '?'}`);
    }
    const result = await analyzeDatabaseImports(root, inventory.scope);
    const issues = [...compareDatabaseInventory(result.edges, inventory.edges), ...compareDatabaseInventory(result.opaqueLoaders, inventory.opaqueLoaders)];
    if (issues.length) throw new Error(`Database import boundary failed:\n${issues.join('\n')}`);
    return { files: result.files, edges: result.edges.length, occurrences: result.edges.reduce((sum, item) => sum + item.count, 0), opaqueLoaders: result.opaqueLoaders.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
        if (process.argv.includes('--observe')) {
            const inventory = JSON.parse(fs.readFileSync(path.join(root, INVENTORY), 'utf8'));
            process.stdout.write(JSON.stringify(await analyzeDatabaseImports(root, inventory.scope), null, 2) + '\n');
        } else process.stdout.write(`Database import boundary passed: ${JSON.stringify(await runDatabaseImportGuard(root))}\n`);
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
