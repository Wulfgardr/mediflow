/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const ROOT = process.cwd();
const SERVICE_PATH = 'lib/domain/documents/document-synthesis-service.ts';
const EXPECTED_COUNTS: Record<string, number> = {
    'components/document-upload.tsx': 2,
    'components/pdf-importer.tsx': 1,
    'app/patients/[id]/entries/new/page.tsx': 1,
};

type CallSite = { path: string; source: ts.SourceFile; call: ts.CallExpression };

function parseSource(filePath: string, text = fs.readFileSync(path.join(ROOT, filePath), 'utf8')): ts.SourceFile {
    return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function visit(node: ts.Node, callback: (child: ts.Node) => void): void {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
}

function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)
        ? unwrap(expression.expression)
        : expression;
}

function resolveImport(filePath: string, specifier: string): string | undefined {
    const base = specifier.startsWith('@/') ? path.join(ROOT, specifier.slice(2))
        : specifier.startsWith('.') ? path.resolve(ROOT, path.dirname(filePath), specifier)
            : undefined;
    if (!base) return undefined;
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find((candidate) => fs.existsSync(candidate));
    return resolved ? path.relative(ROOT, resolved).split(path.sep).join('/') : undefined;
}

function synthesisBindings(source: ts.SourceFile, filePath: string): string[] {
    const bindings: string[] = [];
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (resolveImport(filePath, statement.moduleSpecifier.text) !== SERVICE_PATH) continue;
        const clause = statement.importClause;
        assert.ok(!clause?.name, 'Default document-synthesis imports are unsupported.');
        const named = clause?.namedBindings;
        assert.ok(!named || !ts.isNamespaceImport(named), 'Namespace document-synthesis imports are unsupported.');
        if (!named || !ts.isNamedImports(named)) continue;
        for (const element of named.elements) {
            if ((element.propertyName?.text ?? element.name.text) === 'synthesizeDocument') bindings.push(element.name.text);
        }
    }
    assert.equal(new Set(bindings).size, bindings.length, 'Ambiguous synthesizeDocument bindings are unsupported.');
    return bindings;
}

function directCalls(source: ts.SourceFile, filePath: string): CallSite[] {
    const bindings = new Set(synthesisBindings(source, filePath));
    const calls: CallSite[] = [];
    if (bindings.size === 0) return calls;
    visit(source, (node) => {
        if (!ts.isIdentifier(node) || !bindings.has(node.text) || ts.isImportSpecifier(node.parent)) return;
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
            calls.push({ path: filePath, source, call: node.parent });
            return;
        }
        throw new Error(`Indirect synthesizeDocument use is unsupported in ${filePath}.`);
    });
    return calls;
}

function sourceFiles(directory: string): string[] {
    return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
        const relative = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(relative) : [relative];
    });
}

function collectProductionCalls(): CallSite[] {
    return ['app', 'components', 'lib'].flatMap(sourceFiles)
        .filter((filePath) => /\.tsx?$/.test(filePath) && !/\.test\.tsx?$/.test(filePath))
        .flatMap((filePath) => directCalls(parseSource(filePath), filePath));
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
    return (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
        && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : undefined;
}

function initializerBefore(source: ts.SourceFile, name: string, before: number): ts.Expression | undefined {
    let nearest: { start: number; initializer: ts.Expression } | undefined;
    visit(source, (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name || !node.initializer) return;
        const start = node.getStart(source);
        if (start < before && (!nearest || start > nearest.start)) nearest = { start, initializer: node.initializer };
    });
    return nearest?.initializer;
}

function sourceBytesInput(site: CallSite): { name: string; read: ts.CallExpression } {
    assert.equal(site.call.arguments.length, 4, `${site.path} must pass a fourth options argument.`);
    const options = unwrap(site.call.arguments[3]);
    assert.ok(ts.isObjectLiteralExpression(options), `${site.path} fourth argument must be an options object.`);
    const property = options.properties.find((item) => propertyName(item) === 'sourceBytes');
    assert.ok(property && (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)), `${site.path} options must contain sourceBytes.`);
    let initializer = ts.isPropertyAssignment(property)
        ? unwrap(property.initializer)
        : unwrap(initializerBefore(site.source, propertyName(property) as string, site.call.getStart(site.source)) as ts.Expression);
    if (ts.isIdentifier(initializer)) {
        const value = initializerBefore(site.source, initializer.text, site.call.getStart(site.source));
        assert.ok(value, `${site.path} sourceBytes must have a local initializer.`);
        initializer = unwrap(value as ts.Expression);
    }
    assert.ok(ts.isAwaitExpression(initializer), `${site.path} sourceBytes must await readSourceBytes.`);
    const reader = unwrap((initializer as ts.AwaitExpression).expression);
    assert.ok(ts.isCallExpression(reader) && ts.isIdentifier(reader.expression) && reader.expression.text === 'readSourceBytes', `${site.path} must read source bytes locally.`);
    const input = unwrap((reader as ts.CallExpression).arguments[0]);
    assert.ok(ts.isIdentifier(input), `${site.path} sourceBytes must come from a File or replay Blob binding.`);
    return { name: (input as ts.Identifier).text, read: reader as ts.CallExpression };
}

function assertReadHasGate(site: CallSite, fragment: string): void {
    assert.ok(hasIfAncestor(sourceBytesInput(site).read, site.source, fragment), `${site.path} readSourceBytes must be gated by ${fragment}.`);
}

function assertFallibleReader(source: ts.SourceFile): void {
    const reader = source.statements.find((statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'readSourceBytes');
    assert.ok(reader?.body, `${source.fileName} must define a local readSourceBytes helper.`);
    let arrayBuffer = false;
    let undefinedCatch = false;
    visit(reader.body, (node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'arrayBuffer') arrayBuffer = true;
        if (ts.isCatchClause(node)) visit(node.block, (child) => {
            if (ts.isReturnStatement(child) && child.expression && ts.isIdentifier(child.expression) && child.expression.text === 'undefined') undefinedCatch = true;
        });
    });
    assert.ok(arrayBuffer && undefinedCatch, `${source.fileName} readSourceBytes must fail closed to undefined.`);
}

function hasIfAncestor(node: ts.Node, source: ts.SourceFile, fragment: string): boolean {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (ts.isIfStatement(current) && current.expression.getText(source).includes(fragment)) return true;
    }
    return false;
}

function assertExpectedCalls(calls: CallSite[]): void {
    const counts = new Map<string, number>();
    for (const site of calls) counts.set(site.path, (counts.get(site.path) ?? 0) + 1);
    for (const filePath of counts.keys()) assert.ok(filePath in EXPECTED_COUNTS, `Unexpected productive call-site in ${filePath}.`);
    for (const [filePath, count] of Object.entries(EXPECTED_COUNTS)) assert.equal(counts.get(filePath), count, `Missing productive call-site count for ${filePath}.`);
}

function namedCalls(source: ts.SourceFile, name: string): ts.CallExpression[] {
    const calls: ts.CallExpression[] = [];
    visit(source, (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    });
    return calls;
}

function assertTypeScriptSyntaxValid(source: string): void {
    const result = ts.transpileModule(source, { reportDiagnostics: true });
    assert.deepEqual(result.diagnostics ?? [], []);
}

function assertNoComputedSourceBytesAccess(source: ts.SourceFile): void {
    const accesses: ts.ElementAccessExpression[] = [];
    visit(source, (node) => {
        if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
            && node.argumentExpression.text === 'sourceBytes') accesses.push(node);
    });
    assert.equal(accesses.length, 0, 'sourceBytes must not use computed access in the synthesis service.');
}

test('source bytes stay local, gated, and binding-checked across all productive callers', () => {
    const calls = collectProductionCalls();
    assertExpectedCalls(calls);
    const byPath = (filePath: string) => calls.filter((site) => site.path === filePath);
    const upload = byPath('components/document-upload.tsx');
    assert.deepEqual(upload.map((site) => sourceBytesInput(site).name), ['file', 'blob']);
    assert.equal(sourceBytesInput(byPath('components/pdf-importer.tsx')[0]).name, 'file');
    const entry = byPath('app/patients/[id]/entries/new/page.tsx')[0];
    assert.equal(sourceBytesInput(entry).name, 'file');
    for (const site of [...upload, byPath('components/pdf-importer.tsx')[0], entry]) assertFallibleReader(site.source);

    for (const site of [...upload, byPath('components/pdf-importer.tsx')[0], entry]) assertReadHasGate(site, 'documentSynthesisEnabled');
    assertReadHasGate(upload[1], 'replay.outcome');
    const replayHash = namedCalls(upload[0].source, 'sha256Hex').find((call) => call.arguments[0]?.getText(upload[0].source) === 'file.data');
    assert.ok(replayHash && replayHash.getStart(upload[0].source) < upload[1].call.getStart(upload[1].source), 'Replay Data URL hash must remain separate and precede source-byte reading.');
    const entryGate = initializerBefore(entry.source, 'documentSynthesisEnabled', entry.call.getStart(entry.source));
    const entryGateCall = entryGate ? unwrap(entryGate) : undefined;
    assert.ok(entryGateCall && ts.isCallExpression(entryGateCall) && ts.isIdentifier(entryGateCall.expression) && entryGateCall.expression.text === 'isAiDocumentSynthesisEnabledValue', 'NewEntryPage must resolve the document-synthesis kill switch before reading bytes.');

    const service = parseSource(SERVICE_PATH);
    assertNoComputedSourceBytesAccess(service);
    const sourceByteIdentifiers: ts.Identifier[] = [];
    visit(service, (node) => { if (ts.isIdentifier(node) && node.text === 'sourceBytes') sourceByteIdentifiers.push(node); });
    assert.equal(sourceByteIdentifiers.length, 1, 'sourceBytes may only be declared in service options during C2C1b.');
    assert.ok(ts.isPropertySignature(sourceByteIdentifiers[0].parent), 'sourceBytes must not reach AI, logging, insight, or storage.');
    const router = namedCalls(service, 'routeDocumentClassForSynthesis')[0];
    const routerOptions = unwrap(router.arguments[2]);
    assert.ok(ts.isObjectLiteralExpression(routerOptions), 'Router must receive a narrowed options object.');
    assert.deepEqual(routerOptions.properties.map(propertyName), ['pdfMetadata']);
    assert.equal((routerOptions.properties[0] as ts.PropertyAssignment).initializer.getText(service), 'options.pdfMetadata');
});

test('AST fixtures reject aliases only when bound safely and reject fragile bypasses', () => {
    const serviceImport = "import { synthesizeDocument as synthesize } from '@/lib/domain/documents/document-synthesis-service';";
    const alias = directCalls(parseSource('components/fixture.tsx', [serviceImport, 'async function run() {', '  return synthesize(', '    text, file.name, patientId,', '    { sourceBytes: await readSourceBytes(file) },', '  );', '}'].join('\n')), 'components/fixture.tsx');
    assert.equal(sourceBytesInput(alias[0]).name, 'file');
    const nested = directCalls(parseSource('components/nested.tsx', [serviceImport, 'async function run() { return consume(await synthesize(text, file.name, patientId, { attachmentId })); }'].join('\n')), 'components/nested.tsx');
    assert.throws(() => sourceBytesInput(nested[0]), /sourceBytes/);
    assert.throws(() => directCalls(parseSource('components/namespace.tsx', "import * as synthesis from '@/lib/domain/documents/document-synthesis-service';"), 'components/namespace.tsx'), /Namespace/);
    assert.throws(() => directCalls(parseSource('components/indirect.tsx', [serviceImport, 'const later = synthesize; later(text, name, id, { sourceBytes });'].join('\n')), 'components/indirect.tsx'), /Indirect/);
    const newCaller = directCalls(parseSource('components/new-caller.tsx', [serviceImport, 'synthesize(text, name, id, { sourceBytes: await readSourceBytes(file) });'].join('\n')), 'components/new-caller.tsx');
    assert.throws(() => assertExpectedCalls(newCaller), /Unexpected productive/);
    const fragile = directCalls(parseSource('components/fragile.tsx', [serviceImport, '// obsolete exception components/document-upload.tsx:139', 'synthesize(text, name, id, { attachmentId });'].join('\n')), 'components/fragile.tsx');
    assert.throws(() => sourceBytesInput(fragile[0]), /sourceBytes/);
});

test('guard rejects a source-byte read hoisted before replay and kill-switch gates', () => {
    const text = [
        "import { synthesizeDocument } from '@/lib/domain/documents/document-synthesis-service';",
        'async function run() {',
        '  const sourceBytes = await readSourceBytes(blob);',
        "  if (replay.outcome === 'applied' && documentSynthesisEnabled) {",
        '    return synthesizeDocument(text, name, patientId, { sourceBytes });',
        '  }',
        '}',
    ].join('\n');
    assertTypeScriptSyntaxValid(text);
    const source = parseSource('components/early-read.tsx', text);
    const site = directCalls(source, 'components/early-read.tsx')[0];
    assert.equal(sourceBytesInput(site).name, 'blob');
    assert.throws(() => assertReadHasGate(site, 'replay.outcome'), /readSourceBytes must be gated/);
});

test('guard rejects computed sourceBytes access in the synthesis service', () => {
    const original = fs.readFileSync(path.join(ROOT, SERVICE_PATH), 'utf8');
    const text = original.replace(
        '    const normalized = normalizeDocumentInput(rawMarkdown);',
        "    console.warn(options['sourceBytes']);\n    const normalized = normalizeDocumentInput(rawMarkdown);",
    );
    assertTypeScriptSyntaxValid(text);
    const source = parseSource(SERVICE_PATH, text);
    assert.throws(() => assertNoComputedSourceBytesAccess(source), /must not use computed access/);
});
