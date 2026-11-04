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
    function permissions(files: string[]) {
        return files.flatMap(file => {
            const text = sources.get(file)!;
            const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
            const guards = new Set<string>();
            const visit = (node: ts.Node) => {
                if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))) {
                    const name = node.expression.getText(ast);
                    if (!/^[\w.]+$/.test(name)) return;
                    if (/(?:require.*(?:Auth|Session|Scope|Capability|Token|Context)|with(?:Auth|ArchiveRequestContext|FunctionModelDispatch|LeaseCriticalSection)|acquire(?:OrdinaryApplicationContext|Authenticated\w*)|assert.*(?:Consent|Session|FunctionAvailable)|\.killSwitch\.read|readLaneEnabled|this.getMasterKey)/.test(name)) guards.add(name);
                }
                ts.forEachChild(node, visit);
            };
            visit(ast);
            return guards.size ? [`${file}: ${[...guards].sort().join(', ')}`] : [];
        });
    }
    const code = (value: string) => `\`${value}\``;
    const cell = (values: string[]) => values.length ? values.map(code).join('<br>') : 'Nessun percorso rilevato';
    const rows = descriptors.map(descriptor => {
        const service = roots[descriptor.id] ?? descriptor.entryPoint;
        if (!service || !sources.has(service)) throw new Error(`${descriptor.id}: servizio mancante`);
        const upstream = descriptor.id === 'ocr' || descriptor.id === 'treatment_reasoning' ? [service, ...reachable(service, callers, 1).filter(testFile)] : reachable(service, callers, 5);
        const routes = [...new Set([...upstream, ...reachable(service, dependencies, 1)])].filter(file => /^app\/api\/.*\/route\.ts$/.test(file));
        const guardFiles = [...new Set([service, ...routes.flatMap(route => reachable(route, dependencies, 2)), ...upstream.filter(file => !testFile(file) && !file.startsWith('scripts/')).flatMap(file => reachable(file, dependencies, 1))])];
        const guards = permissions(guardFiles);
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
    const text = `# Catalogo operativo Fabric\n\nGenerato da \`scripts/check-fabric-operational-catalog.ts\`. Non modificare a mano.\n\nOgni cella mostra fino a quattro riferimenti, ordinati per percorso. Il catalogo deriva dai descriptor e dai percorsi di importazione del codice corrente. I controlli elencati sono chiamate nel servizio e nei suoi confini API; la loro presenza non concede permessi. I test sono riferimenti di copertura del servizio, non prove dei desktop installati. I consumatori sono riferimenti sorgente alle route o importazioni: nessun percorso rilevato significa raccordo non dimostrato, non parità. Le dipendenze sono seguite per cinque passaggi verso i chiamanti e due verso i controlli API.\n\nOllama e ChatGPT hanno tre celle ciascuno nel gate 0.9.1. La venue del descriptor è distinta dal trasporto ChatGPT (cloud, abbonamento e consenso sui byte). OCR resta indisponibile; Treatment Reasoning è negato da \`assertFunctionAvailableInRelease\`. Le API opzionali non qualificano il gate.\n\n| Funzione | Servizio | Venue descriptor | Permesso e controllo | Web | GPUI | Apple | Chat/plugin | Test del servizio |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
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
