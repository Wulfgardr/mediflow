/* C09: exact pinned initializer fragments, never a historical backend import. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

export function readPinnedSource(root, commit, descriptor) {
  const reference = `${commit}:${descriptor.path}`;
  const blob = execFileSync('git', ['rev-parse', '--verify', reference], { cwd: root, encoding: 'utf8' }).trim();
  const source = execFileSync('git', ['show', reference], { cwd: root, encoding: 'utf8' });
  if (blob !== descriptor.blob || createHash('sha256').update(source).digest('hex') !== descriptor.sha256) throw new Error(`Pinned source mismatch: ${reference}`);
  return source;
}

export function initializerProgram(root, family) {
  const commit = family.tags[0].commit;
  const fragments = [];
  const provenance = [];
  for (const descriptor of family.runtimeSources) {
    const source = readPinnedSource(root, commit, descriptor);
    const ast = ts.createSourceFile(descriptor.path, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw new Error(`Invalid historical TypeScript: ${descriptor.path}`);
    const requested = new Set(descriptor.declarations);
    if (requested.size !== descriptor.declarations.length) throw new Error('Duplicate declaration allowlist');
    const found = new Set();
    const selected = [];
    let tryCount = 0;
    for (const node of ast.statements) {
      const names = ts.isVariableStatement(node) ? node.declarationList.declarations.map(declaration => declaration.name.getText(ast)) : node.name ? [node.name.getText(ast)] : [];
      if (names.some(name => requested.has(name))) {
        if (names.some(name => !requested.has(name)) || names.some(name => found.has(name))) throw new Error(`Ambiguous selected declaration: ${descriptor.path}`);
        names.forEach(name => found.add(name)); selected.push(node);
      } else if (descriptor.topLevelTryBlocks && ts.isTryStatement(node)) { selected.push(node); tryCount++; }
    }
    if (found.size !== requested.size || (descriptor.topLevelTryBlocks && !tryCount)) throw new Error(`Missing initializer node: ${descriptor.path}`);
    const extracted = selected.map(node => node.getText(ast)).join('\n');
    const code = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const emitted = ts.createSourceFile('initializer.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const forbidden = new Set(['require', 'process', 'global', 'globalThis', 'fetch', 'fs', 'path', 'Database', 'drizzle', 'resolveDataPath', 'recoverSwapArtifacts', 'swapDatabaseFromFile', 'sqliteHandle', 'dbServer']);
    function validate(node) {
      if (ts.isImportDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node) && forbidden.has(node.text))) throw new Error(`Forbidden initializer dependency: ${descriptor.path}: ${node.getText(emitted)}`);
      ts.forEachChild(node, validate);
    }
    validate(emitted);
    if (descriptor.path === 'lib/db-server.ts' && family.initializePragmas) fragments.push('initSqlitePragmas(sqlite);');
    fragments.push(code);
    provenance.push({ path: descriptor.path, blob: descriptor.blob, declarations: [...found], topLevelTryBlocks: tryCount,
      ranges: selected.map(node => [ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, ast.getLineAndCharacterOfPosition(node.end).line + 1]) });
  }
  if (!['top-level-guards', 'applySchemaGuards', 'applySchemaGuardsSerially'].includes(family.entrypoint)) throw new Error('Unsupported initializer entrypoint');
  if (family.entrypoint !== 'top-level-guards') fragments.push(`${family.entrypoint}();`);
  const assembled = fragments.join('\n');
  // Ask TypeScript's own binder for missing identifiers before touching SQLite.
  // Only the SQLite handle, exports and console are host-provided; standard
  // ECMAScript globals come from the compiler library, not historical imports.
  const virtual = '/c09-pinned-initializer.js';
  const input = 'var sqlite; var exports;\n' + assembled;
  const options = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...rest) => file === virtual
    ? ts.createSourceFile(file, input, languageVersion, true, ts.ScriptKind.JS) : getSourceFile(file, languageVersion, ...rest);
  const checked = ts.createProgram([virtual], options, host);
  const missing = checked.getSemanticDiagnostics().filter(diagnostic => [2304, 2552].includes(diagnostic.code));
  if (missing.length) throw new Error(`Unresolved initializer names: ${missing.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')}`);
  const script = new vm.Script(assembled, { filename: `${family.tags[0].tag}-pinned-initializers.js` });
  return { script, provenance };
}

export function replayInitializers(program, sqlite, warnings = []) {
  const log = (...values) => {
    // Preserve historically swallowed SQLite errors, but never hide an incomplete
    // extracted dependency closure as a historically tolerated schema warning.
    if (values.some(value => value?.name === 'ReferenceError' || value?.name === 'TypeError')) throw new Error(`Unresolved initializer dependency: ${values.map(String).join(' ')}`);
    warnings.push(values.map(String).join(' '));
  };
  const context = vm.createContext({ sqlite, exports: {}, console: { warn: log, error: log, log } }, { codeGeneration: { strings: false, wasm: false } });
  program.script.runInContext(context, { timeout: 10_000 });
  return warnings;
}
