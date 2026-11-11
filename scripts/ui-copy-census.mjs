import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = process.env.MEDIFLOW_COPY_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selected = process.argv.find(a => a.startsWith('--surface='))?.split('=')[1];
const oldNames = /Patient Insight|Sintesi del quadro paziente|Supporto al ragionamento clinico|Sintesi con IA|Sintesi AI|Quadro attuale|Conosco solo l[’']anno \(stima\)|\bAI\b|\b[Hh]ost\b|\b[Pp]airing\b|\b[Cc]apability\b/;
const variants = ['Misure', 'Controlli', 'Parametri', 'Scale', 'Valutazione', 'Caregiver', 'Persona di riferimento'];
const presentationLibraries = [
    'lib/fabric-settings-view.ts', 'lib/function-models/browser.ts', 'lib/function-models/ordinary-browser.ts', 'lib/function-models/preview-client.ts', 'lib/ai-rollout-model-guard.ts', 'lib/ai-rollout-readiness-storage.ts', 'lib/network-operating-mode.ts',
    'lib/domain/documents/patient-review-queue-summary.ts',
    'lib/ai-providers/fabric/patient-insight-preview-contract.ts',
];
function files(dir, extension) {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const name = `${dir}/${entry.name}`;
        return entry.isDirectory() ? files(name, extension) : extension.test(name) && !/\.test\.|_tests\.rs$|\/tests?(?:\/|\.rs$)|\/rendered_command\.rs$/.test(name) ? [name] : [];
    });
}
function nativeStrings(source) {
    const result = [];
    for (let i = 0; i < source.length;) {
        if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
        if (source.startsWith('/*', i)) {
            let depth = 1; i += 2;
            while (i < source.length && depth) {
                if (source.startsWith('/*', i)) { depth++; i += 2; }
                else if (source.startsWith('*/', i)) { depth--; i += 2; }
                else i++;
            }
            continue;
        }
        const raw = /^(?:b?r)(#{0,8})"/.exec(source.slice(i));
        if (raw) { const end = source.indexOf('"' + raw[1], i + raw[0].length); i = end < 0 ? source.length : end + raw[1].length + 1; continue; }
        const character = /^'(?:\\.|[^'\\])'/.exec(source.slice(i));
        if (character) { i += character[0].length; continue; }
        if (source[i] !== '"') { i++; continue; }
        const start = i++;
        while (i < source.length) {
            if (source[i] === '\\') { i += 2; continue; }
            if (source[i] === '"') break;
            i++;
        }
        result.push({ start, value: source.slice(start + 1, i) }); i++;
    }
    return result;
}
export function census() {
    const rows = [];
    const add = (surface, file, source, start, value) => {
        const text = value.replace(/\s+/g, ' ').trim();
        if (text && !/^(?:Patient Insight preview input is unavailable\.|Network .*boundary excludes AI)/.test(text) && (text.includes(' ') || /^(AI|Host|Pairing|Capability|Misure|Controlli|Parametri|Scale|Valutazione|Caregiver|Patient Insight|Quadro attuale)$/.test(text)) && !/^(?:@?\/?(?:api|settings|lib|components)\/|#|npm run )/.test(text) && !/Intelligent Host/.test(text)) rows.push({ surface, file, line: source.slice(0, start).split('\n').length, text });
    };
    for (const file of [...files('app', /\.tsx$/), ...files('components', /\.tsx$/), ...presentationLibraries]) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        function visit(node) {
            if (ts.isJsxText(node)) add('web', file, source, node.pos, node.text);
            else if (ts.isStringLiteralLike(node) || ts.isTemplateSpan(node) && ts.isTemplateTail(node.literal)) {
                if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isImportSpecifier(node.parent)) return;
                if (ts.isJsxAttribute(node.parent) && /^(data-|className|id$|href$|src$|key$|type$|role$|name$|value$)/.test(node.parent.name.getText(ast))) return;
                if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
                if (ts.isPropertyAssignment(node.parent) && /^(id|key|href|className|data-testid)$/.test(node.parent.name.getText(ast))) return;
                add('web', file, source, node.pos, node.text ?? node.literal.text);
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
    }
    for (const [surface, sourceFiles] of [
        ['gpui', [...files('experiments/gpui-patient-pilot/app/src', /\.rs$/), ...files('experiments/gpui-patient-pilot/transport/src', /\.rs$/)]],
        ['apple', files('native/MediFlowMac/Sources', /\.swift$/)],
    ]) for (const file of sourceFiles) {
        const source = fs.readFileSync(path.join(root, file), 'utf8').split(/(?:pub\(crate\) )?mod tests\s*\{/)[0];
        for (const { start, value } of nativeStrings(source)) add(surface, file, source, start, value);

    }
    return selected ? rows.filter(row => row.surface === selected) : rows;
}
const rows = census();
const violations = rows.filter(row => oldNames.test(row.text.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, '')));
if (process.argv.includes('--counts')) {
    console.log(JSON.stringify(Object.fromEntries(['web', 'gpui', 'apple'].map(surface => [surface, Object.fromEntries(variants.map(term => [term, rows.filter(r => r.surface === surface).reduce((n, r) => n + [...r.text.matchAll(new RegExp(`\\b${term}\\b`, 'gi'))].length, 0)]))])), null, 2));
} else {
    console.log(JSON.stringify(process.argv.includes('--all') ? rows : violations, null, 2));
    if (process.argv.includes('--check') && violations.length) process.exitCode = 1;
}
