import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const virtualRoot = '/__mediflow_git__';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8e6 });
const digest = value => createHash('sha256').update(value).digest('hex');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function extractDeclarations(content, path) {
  const ast = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse pinned source: ${path}`);
  const span = node => {
    const start = node.getStart(ast), end = node.getEnd();
    return { line: ast.getLineAndCharacterOfPosition(start).line + 1,
      endLine: ast.getLineAndCharacterOfPosition(end - 1).line + 1,
      anchor: content.slice(start, end) };
  };
  const declarations = [], omitted = [];
  for (const statement of ast.statements) {
    let specifier, syntax, typeUsage = 'value';
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      specifier = statement.moduleSpecifier.text;
      syntax = ts.isImportDeclaration(statement) ? 'import' : 're-export';
      const clause = ts.isImportDeclaration(statement) ? statement.importClause : statement.exportClause;
      const bindings = ts.isImportDeclaration(statement) ? clause?.namedBindings : clause;
      const parts = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements : [];
      const hasDefault = ts.isImportDeclaration(statement) && Boolean(clause?.name);
      if (statement.isTypeOnly || clause?.isTypeOnly || (!hasDefault && parts.length && parts.every(part => part.isTypeOnly))) typeUsage = 'type-only';
      else if (parts.some(part => part.isTypeOnly)) typeUsage = 'mixed';
      if (ts.isImportDeclaration(statement) && !clause) typeUsage = 'side-effect';
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)
        && statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) {
      specifier = statement.moduleReference.expression.text; syntax = 'import-equals';
      typeUsage = statement.isTypeOnly ? 'type-only' : 'value';
    } else continue;
    declarations.push({ specifier, syntax, typeUsage, ...span(statement) });
  }
  const visit = node => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      omitted.push({ syntax: node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require-call',
        specifier: node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null,
        reason: 'excluded-syntax', ...span(node) });
    } else if (ts.isImportTypeNode(node)) {
      omitted.push({ syntax: 'import-type-expression', specifier: null, reason: 'excluded-syntax', ...span(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { declarations, omitted };
}

export function createPinnedResolver(paths, readBlob, configContent) {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', configContent);
  if (parsed.error || parsed.config.extends) throw new Error('Unsupported pinned tsconfig');
  const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, virtualRoot);
  if (converted.errors.length) throw new Error('Invalid pinned compiler options');
  const tracked = new Set(paths), directories = new Set([virtualRoot]);
  for (const path of tracked) {
    let dir = posix.dirname(`${virtualRoot}/${path}`);
    while (dir.startsWith(virtualRoot)) { directories.add(dir); if (dir === virtualRoot) break; dir = posix.dirname(dir); }
  }
  const relative = path => path.startsWith(`${virtualRoot}/`) ? path.slice(virtualRoot.length + 1) : null;
  const host = {
    fileExists: path => tracked.has(relative(path)),
    readFile: path => tracked.has(relative(path)) ? readBlob(relative(path)) : undefined,
    directoryExists: path => directories.has(path),
    getCurrentDirectory: () => virtualRoot,
    realpath: path => path,
  };
  return (source, specifier) => {
    if (isBuiltin(specifier)) return { resolution: 'builtin', target: null };
    const alias = Object.keys(parsed.config.compilerOptions.paths || {}).some(pattern =>
      pattern.endsWith('*') ? specifier.startsWith(pattern.slice(0, -1)) : specifier === pattern);
    if (!specifier.startsWith('.') && !alias) return { resolution: 'external-package', target: null };
    // TypeScript does not resolve CSS as a module; attest only an exact tracked asset.
    if (/\.(css|svg|png|jpe?g|webp)$/.test(specifier)) {
      let asset = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(source), specifier)) : null;
      if (alias) {
        const mapping = parsed.config.compilerOptions.paths;
        if (specifier.startsWith('@/') && JSON.stringify(mapping['@/*']) === '["./*"]') asset = specifier.slice(2);
      }
      return tracked.has(asset) ? { resolution: 'resolved', target: asset } : { resolution: 'unresolved', target: null };
    }
    const result = ts.resolveModuleName(specifier, `${virtualRoot}/${source}`, converted.options, host).resolvedModule;
    const target = result && relative(result.resolvedFileName);
    return target && tracked.has(target) ? { resolution: 'resolved', target } : { resolution: 'unresolved', target: null };
  };
}

export function buildFileTopology(snapshot) {
  const commit = snapshot.sourceCommit;
  if (!/^[a-f0-9]{40}$/.test(commit) || git('rev-parse', `${commit}^{commit}`).trim() !== commit) throw new Error('Full source pin required');
  const paths = git('ls-tree', '-r', '--name-only', commit).trim().split('\n');
  const contents = new Map();
  const readBlob = path => { if (!contents.has(path)) contents.set(path, git('show', `${commit}:${path}`)); return contents.get(path); };
  const configContent = readBlob('tsconfig.json');
  const resolveImport = createPinnedResolver(paths, readBlob, configContent);
  const selectedPaths = [...new Set([...snapshot.nodes, ...snapshot.edges].flatMap(item => item.evidence.map(ref => ref.path)))].sort();
  const selected = new Set(selectedPaths);
  const memberships = [];
  for (const node of snapshot.nodes) for (const ref of node.evidence) memberships.push({ moduleId: node.id, fileId: ref.path, basis: 'node-evidence', evidenceId: node.id, reference: ref });
  for (const edge of snapshot.edges) for (const ref of edge.evidence) for (const moduleId of [edge.source, edge.target]) {
    memberships.push({ moduleId, fileId: ref.path, basis: 'edge-evidence', evidenceId: edge.id, reference: ref });
  }
  const declarations = [], omitted = [];
  const files = selectedPaths.map(path => {
    const content = readBlob(path), parsed = extractDeclarations(content, path);
    const sourceUrl = `${snapshot.repository}/blob/${commit}/${path}`;
    for (const [index, declaration] of parsed.declarations.entries()) {
      const resolved = resolveImport(path, declaration.specifier);
      const resolution = resolved.resolution === 'resolved' ? (selected.has(resolved.target) ? 'included' : 'outside-selection') : resolved.resolution;
      declarations.push({ id: `${path}:${index}`, source: path, ...declaration, ...resolved, resolution,
        url: `${sourceUrl}#L${declaration.line}-L${declaration.endLine}`,
        targetUrl: resolved.target ? `${snapshot.repository}/blob/${commit}/${resolved.target}` : null });
    }
    for (const item of parsed.omitted) omitted.push({ source: path, ...item, url: `${sourceUrl}#L${item.line}-L${item.endLine}` });
    return { id: path, path, blob: git('rev-parse', `${commit}:${path}`).trim(), sha256: digest(content),
      lineCount: content.split('\n').length, url: sourceUrl };
  });
  const pairs = new Map();
  for (const declaration of declarations.filter(item => item.resolution === 'included')) {
    const id = `${declaration.source}→${declaration.target}`;
    if (!pairs.has(id)) pairs.set(id, { id, source: declaration.source, target: declaration.target, declarationIds: [] });
    pairs.get(id).declarationIds.push(declaration.id);
  }
  const counts = Object.fromEntries(['included', 'outside-selection', 'builtin', 'external-package', 'unresolved'].map(key => [key, declarations.filter(item => item.resolution === key).length]));
  return { schemaVersion: 1, repository: snapshot.repository, sourceCommit: commit,
    modules: snapshot.nodes.map(node => ({ id: node.id, label: node.label })), files, memberships,
    declarations, edges: [...pairs.values()], omitted,
    coverage: { selectedFiles: files.length, trackedFiles: paths.length, declarations: declarations.length, counts, omittedConstructs: omitted.length, recursiveExpansion: false },
    limits: ['I moduli sono i 15 elementi curati; file citato come prova non significa proprietà o responsabilità esclusiva.',
      'Le relazioni tra file sono dichiarazioni statiche, comprese quelle di soli tipi; non dimostrano chiamate, flussi di dati o esecuzione.',
      'Sono analizzati soltanto i file citati dai nodi e dalle relazioni; i target esterni alla selezione non vengono analizzati ricorsivamente.',
      'Import dinamici, chiamate denominate require e import come espressioni di tipo sono segnalati ma esclusi dalle relazioni. Non sono analizzati i linguaggi nativi, gli asset o il runtime.'],
    provenance: { generator: 'tools/code-explorer/extract-files.mjs', parser: `typescript ${ts.version}`, curatedSnapshotSha256: digest(JSON.stringify(snapshot)),
      sourceTree: git('rev-parse', `${commit}^{tree}`).trim(), tsconfigBlob: git('rev-parse', `${commit}:tsconfig.json`).trim(), tsconfigSha256: digest(configContent),
      proofKind: 'pinned_static_declarations', executionVerified: false } };
}

export function fileFallbackHtml(topology) {
  const describe = declaration => `${declaration.syntax} · ${declaration.typeUsage} · ${declaration.specifier} · ${declaration.resolution}`;
  const membershipHtml = file => topology.memberships.filter(item => item.fileId === file.id).map(item => `<li>${escape(topology.modules.find(module => module.id === item.moduleId).label)} · ${item.basis === 'node-evidence' ? 'fonte del modulo' : `fonte della relazione ${escape(item.evidenceId)}`} — <a href="${escape(item.reference.url)}">prova alla riga ${item.reference.line}</a></li>`).join('');
  return topology.files.map(file => `<details id="file-source-${escape(file.path)}"><summary>${escape(file.path)}</summary>
<p><a href="${escape(file.url)}">Leggi il file alla revisione indicata</a></p>
<p>File citato come prova per: ${[...new Set(topology.memberships.filter(item => item.fileId === file.id).map(item => topology.modules.find(module => module.id === item.moduleId).label))].map(escape).join(', ')}.</p>
<ul>${membershipHtml(file)}</ul>
<p>Dichiarazioni in uscita:</p><ul>${topology.declarations.filter(item => item.source === file.id).map(item => `<li>${escape(describe(item))} — <a href="${escape(item.url)}">righe ${item.line}–${item.endLine}</a>${item.targetUrl ? ` · <a href="${escape(item.targetUrl)}">${escape(item.target)}</a>` : ''}</li>`).join('') || '<li>Nessuna dichiarazione statica rilevata.</li>'}</ul>
<p>File selezionati che citano questo file:</p><ul>${topology.declarations.filter(item => item.target === file.id && item.resolution === 'included').map(item => `<li>${escape(item.source)} · ${escape(describe(item))} — <a href="${escape(item.url)}">righe ${item.line}–${item.endLine}</a></li>`).join('') || '<li>Nessuno nella selezione; non prova isolamento.</li>'}</ul>
<p>Costrutti esclusi:</p><ul>${topology.omitted.filter(item => item.source === file.id).map(item => `<li>${escape(item.syntax)} — <a href="${escape(item.url)}">righe ${item.line}–${item.endLine}</a></li>`).join('') || '<li>Nessuno dei costrutti cercati rilevato.</li>'}</ul></details>`).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot = JSON.parse(readFileSync(resolve(directory, 'snapshot.json'), 'utf8'));
  const topology = buildFileTopology(snapshot);
  const output = `${JSON.stringify(topology, null, 2)}\n`, path = resolve(directory, 'file-topology.json');
  if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== output) throw new Error('Stale file topology'); }
  else writeFileSync(path, output);
  console.log(`Verified ${topology.files.length} files / ${topology.edges.length} file pairs / ${topology.declarations.length} declarations at ${topology.sourceCommit}`);
}
