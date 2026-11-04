import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';
import { FABRIC_CAPABILITY_DESCRIPTORS } from '../lib/ai-providers/fabric/catalog';

const output = 'docs/analysis/2026-10-31-chat-catalog-fabric/catalogo-operativo.md';
const roots: Readonly<Record<string, string>> = {
    patient_insight: 'lib/ai-providers/fabric/patient-insight-host-capability.ts',
    smart_import: 'lib/domain/documents/patient-smart-import-host-capability.ts',
    document_synthesis: 'lib/ai-providers/fabric/document-synthesis-production-operation.ts',
    treatment_reasoning: 'lib/ai-providers/fabric/resolver.ts',
    ocr: 'lib/ai-providers/fabric/resolver.ts',
};
export function buildOperationalCatalog(sources: Map<string, string>, descriptors = Object.values(FABRIC_CAPABILITY_DESCRIPTORS)) {
    const dependencies = new Map<string, string[]>(), callers = new Map<string, string[]>();
    const testFile = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
    for (const [file, text] of sources) {
        if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
        const imports = ts.preProcessFile(text, true, true).importedFiles;
        const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const dynamicImports: string[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) dynamicImports.push(node.arguments[0].text);
            ts.forEachChild(node, visit);
        };
        visit(ast);
        const refs = [...imports, ...dynamicImports.map(fileName => ({ fileName }))].flatMap(({ fileName }) => {
            const base = fileName.startsWith('@/') ? fileName.slice(2) : fileName.startsWith('.') ? path.posix.join(path.posix.dirname(file), fileName) : '';
            if (!base) return [];
            const stem = base.replace(/\.[cm]?[jt]sx?$/, '');
            const found = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`].find(value => sources.has(value));
            return found ? [found] : [];
        });
        for (const match of text.matchAll(/['"](\/api\/[^'"?`]+)['"]/g)) {
            const route = `app${match[1]}/route.ts`;
            if (sources.has(route)) refs.push(route);
        }
        if (testFile(file)) {
            for (const match of text.matchAll(/['"]((?:lib|app)\/[^'"]+\.tsx?)['"]/g)) {
                if (sources.has(match[1])) refs.push(match[1]);
            }
        }
        dependencies.set(file, refs);
        for (const ref of refs) callers.set(ref, [...(callers.get(ref) ?? []), file]);
    }
    function reachable(start: string, graph: Map<string, string[]>, max: number) {
        const seen = new Set([start]); let frontier = [start];
        for (let depth = 0; depth < max; depth++) {
            const next = frontier.flatMap(file => graph.get(file) ?? []).filter(file => !seen.has(file));
            next.forEach(file => seen.add(file)); frontier = next.filter(file => !testFile(file));
        }
        return [...seen];
    }
    const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, allowJs: true };
    const compilerHost = ts.createCompilerHost(compilerOptions);
    const readLibrary = compilerHost.getSourceFile;
    const sourceFiles = new Map([...sources].filter(([file]) => /\.[cm]?[jt]sx?$/.test(file))
        .map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]));
    compilerHost.getCurrentDirectory = () => "/";
    compilerHost.getSourceFile = file => sourceFiles.get(file.replace(/^\//, '')) ?? (file.includes('/typescript/lib/lib.') ? readLibrary(file, ts.ScriptTarget.ESNext) : undefined);
    compilerHost.fileExists = file => sources.has(file);
    compilerHost.readFile = file => sources.get(file);
    compilerHost.resolveModuleNames = (names, file) => names.map(name => {
        const base = name.startsWith('@/') ? name.slice(2) : name.startsWith('.') ? path.posix.join(path.posix.dirname(file.replace(/^\//, '')), name) : '';
        const stem = base.replace(/\.[cm]?[jt]sx?$/, '');
        const resolvedFileName = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`].find(candidate => sources.has(candidate));
        return resolvedFileName ? { resolvedFileName } : undefined;
    });
    const program = ts.createProgram([...sourceFiles.keys()], compilerOptions, compilerHost);
    const checker = program.getTypeChecker();
    const guardPattern = /(?:verifyUnlockCredentials|admitNativeBootstrapRouteRequest|require.*(?:Auth|Session|Scope|Capability|Token|Context)|with(?:Auth|ArchiveRequestContext|FunctionModelDispatch|LeaseCriticalSection)|acquire(?:OrdinaryApplicationContext|Authenticated\w*)|assert.*(?:Consent|Session|FunctionAvailable)|\.killSwitch\.read|readLaneEnabled|this.getMasterKey)/;
    const permissionCache = new Map<string, { invokedFiles: Set<string>; evidence: string[] }>();
    function permissions(file: string, route: boolean) {
        const key = `${file}:${route}`;
        const cached = permissionCache.get(key);
        if (cached) return cached;
        const ast = sourceFiles.get(file)!;
        const guards = new Map<string, Set<string>>();
        const seen = new Map<ts.Node, number>();
        const invokedFiles = new Set<string>();
        let moduleDepth = 0;
        function follow(node: ts.Node, invoked = false) {
            let symbol = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
                ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
            if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
            for (const declaration of symbol?.declarations ?? []) {
                if (ts.isVariableDeclaration(declaration) && !invoked) continue;
                if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)
                    || ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)
                    || ts.isShorthandPropertyAssignment(declaration)) {
                    const step = declaration.getSourceFile() === node.getSourceFile() ? 0 : 1;
                    if (moduleDepth + step > 5) continue;
                    moduleDepth += step;
                    visit(declaration, true);
                    moduleDepth -= step;
                }
            }
        }
        function visit(node: ts.Node, invoked = false) {
            if ((seen.get(node) ?? Infinity) <= moduleDepth) return;
            if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
            if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && !invoked && !ts.isObjectLiteralExpression(node.parent)) return;
            seen.set(node, moduleDepth);
            invokedFiles.add(node.getSourceFile().fileName);
            const callback = ts.isIdentifier(node) && ((ts.isPropertyAssignment(node.parent) && node.parent.initializer === node)
                || ts.isShorthandPropertyAssignment(node.parent) || (ts.isCallExpression(node.parent) && node.parent.arguments.includes(node)));
            if (ts.isCallExpression(node) || callback) {
                const expression = ts.isCallExpression(node) ? node.expression : node;
                const name = expression.getText(node.getSourceFile());
                if (/^[\w.]+$/.test(name) && guardPattern.test(name)) {
                    const origin = node.getSourceFile().fileName;
                    if (!guards.has(origin)) guards.set(origin, new Set());
                    guards.get(origin)!.add(name);
                } else {
                    follow(ts.isPropertyAccessExpression(expression) ? expression.name : expression, true);
                }
            }
            if (ts.isIdentifier(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) follow(node);
            ts.forEachChild(node, child => visit(child));
        }
        for (const statement of ast.statements) {
            if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
            if (route && ts.isFunctionDeclaration(statement) && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(statement.name?.text ?? '')) continue;
            if (ts.isClassDeclaration(statement)) {
                for (const member of statement.members) visit(member, true);
            } else visit(statement, true);
        }
        const result = { invokedFiles, evidence: [...guards].sort(([a], [b]) => a.localeCompare(b)).map(([origin, names]) => `${origin}: ${[...names].sort().join(', ')}`) };
        permissionCache.set(key, result);
        return result;
    }
    const code = (value: string) => `\`${value}\``;
    const cell = (values: string[]) => values.length ? values.map(code).join('<br>') : 'Nessun percorso rilevato';
    const rows = descriptors.map(descriptor => {
        const service = roots[descriptor.id] ?? descriptor.entryPoint;
        if (!service || !sources.has(service)) throw new Error(`${descriptor.id}: servizio mancante`);
        const upstream = descriptor.id === 'ocr' || descriptor.id === 'treatment_reasoning' ? [service, ...reachable(service, callers, 1).filter(testFile)] : reachable(service, callers, 5);
        const candidateRoutes = [...new Set([...upstream, ...reachable(service, dependencies, 1)])].filter(file => /^app\/api\/.*\/route\.ts$/.test(file));
        const routes = candidateRoutes.filter(route => !route.startsWith('app/api/auth/') && ((dependencies.get(service) ?? []).includes(route) || permissions(route, true).invokedFiles.has(service)));
        const routeGuards = routes.map(route => {
            const { evidence } = permissions(route, true);
            if (!evidence.length) throw new Error(`${descriptor.id}: permesso non risolto per ${route}`);
            return evidence;
        });
        const capabilityGuards = upstream.filter(file => !testFile(file) && !file.startsWith('scripts/') && !file.startsWith('app/api/'))
            .map(file => permissions(file, false)).filter(result => result.invokedFiles.has(service)).flatMap(result => result.evidence);
        const guards = [...new Set([...permissions(service, false).evidence, ...routeGuards.flat(), ...capabilityGuards])];
        if (!guards.length) throw new Error(`${descriptor.id}: permesso non risolto`);
        const directTests = reachable(service, callers, 1).filter(testFile);
        const tests = (directTests.length ? directTests : upstream.filter(testFile)).sort();
        if (!tests.length) throw new Error(`${descriptor.id}: test mancante`);
        const routePaths = routes.map(file => file.replace(/^app/, '').replace(/\/route\.ts$/, ''));
        const matchesRoute = (text: string, route: string) => [route, ...(route.startsWith('/api/v1/') ? [route.slice('/api/v1/'.length)] : []), ...(route.includes('/ai/fabric/') ? ['ai/fabric/'] : [])].some(fragment => text.includes(fragment));
        const clients = [...sources].filter(([file, text]) => !testFile(file) && !file.startsWith('scripts/') && !file.startsWith('app/api/') && !/(?:^|\/)(?:Tests|tests|test_support)\//.test(file) && routePaths.some(route => matchesRoute(file.endsWith('.rs') ? text.split(/#\[cfg\(test\)\]\s*mod\s/)[0] : text, route)));
        const web = [...upstream.filter(file => /^(?:components\/|app\/.*page\.)/.test(file)), ...clients.filter(([file]) => /^(?:components|app|lib)\//.test(file)).map(([file]) => file)];
        const native = (pattern: RegExp) => clients.filter(([file]) => pattern.test(file)).map(([file]) => file);
        return [code(descriptor.id), code(service), descriptor.id === 'treatment_reasoning' ? 'Negata nella release' : descriptor.venues.length ? cell([...descriptor.venues]) : 'Nessuna venue ammessa', cell(guards.slice(0, 4)), cell([...new Set(web)].sort().slice(0, 4)), cell(native(/^experiments\/gpui-patient-pilot\//).slice(0, 4)), cell(native(/^native\/(?:MediFlow|Shared)/).slice(0, 4)), cell(native(/(?:chat_access|chat-access|mcp\/|plugins\/)/).slice(0, 4)), cell(tests.slice(0, 4))];
    });
    const text = `# Catalogo operativo Fabric\n\nGenerato da \`scripts/check-fabric-operational-catalog.ts\`. Non modificare a mano.\n\nOgni cella mostra fino a quattro riferimenti, ordinati per percorso. Il catalogo deriva dai descriptor e dai percorsi di importazione del codice corrente. Le route sono collegate tramite richiami al servizio o riferimenti API del servizio; la sola inizializzazione di un modulo condiviso non costituisce un ingresso alla funzione. I controlli elencati sono chiamate raggiungibili dagli export del servizio e dei suoi chiamanti o dagli handler API, seguendo simboli e callback fino a cinque passaggi fra moduli. Ogni route deve avere evidenza propria; la loro presenza non concede permessi. I test sono riferimenti di copertura del servizio, non prove dei desktop installati. I consumatori sono riferimenti sorgente alle route o importazioni: nessun percorso rilevato significa raccordo non dimostrato, non parità. Le dipendenze sono seguite per cinque passaggi verso i chiamanti e cinque verso i controlli API.\n\nOllama e ChatGPT hanno tre celle ciascuno nel gate 0.9.1. La venue del descriptor è distinta dal trasporto ChatGPT (cloud, abbonamento e consenso sui byte). OCR resta indisponibile; Treatment Reasoning è negato da \`assertFunctionAvailableInRelease\`. Le API opzionali non qualificano il gate.\n\n| Funzione | Servizio | Venue descriptor | Permesso e controllo | Web | GPUI | Apple | Chat/plugin | Test del servizio |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
    return { text, count: rows.length };
}

if (process.argv[1]?.endsWith('/check-fabric-operational-catalog.ts')) {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n');
    const sources = new Map(files.filter(file => /\.(?:[cm]?[jt]sx?|rs|swift|html)$/.test(file)).map(file => [file, readFileSync(file, 'utf8')]));
    const { text, count } = buildOperationalCatalog(sources);
    if (process.argv.includes('--write')) writeFileSync(output, text);
    else if (readFileSync(output, 'utf8') !== text) throw new Error('Catalogo operativo obsoleto: eseguire npm run check:fabric-operational-catalog -- --write');
    console.log(`Catalogo operativo: ${count} capacità con permessi e test`);
}
