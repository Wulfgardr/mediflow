/* @Codex: STATIC integration checks, not React rendering or an authentication proof. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), 'utf8');
const panelName = 'components/patient-bulk-import-panel.tsx';
const panel = read(panelName);
const parsed = ts.createSourceFile(panelName, panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes<T extends ts.Node>(source: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
    const found: T[] = [];
    const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
    visit(source); return found;
}
const tags = nodes(parsed, (node): node is ts.JsxOpeningLikeElement => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));
function attribute(tag: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
    return tag.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(parsed) === name);
}
function literalAttribute(tag: ts.JsxOpeningLikeElement, name: string): string | undefined {
    const initializer = attribute(tag, name)?.initializer;
    return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}
for (const name of [panelName, 'app/patients/import/page.tsx', 'app/patients/new/page.tsx']) {
    test(`syntax-only TSX transpilation: ${name}`, () => {
        const result = ts.transpileModule(read(name), { fileName: name, reportDiagnostics: true,
            compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
        });
        assert.deepEqual((result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
    });
}
test('Nuova scheda has the real shell primary action to the import route', () => {
    const source = read('app/patients/new/page.tsx');
    assert.match(source, /primaryAction=\{\{ href: "\/patients\/import", label: "Importa elenco CSV", icon: FileSpreadsheet \}\}/u);
    assert.match(source, /import .*FileSpreadsheet.* from 'lucide-react'/u);
});
test('server route awaits Next cookies and passes an observation, not a session credential', () => {
    const source = read('app/patients/import/page.tsx');
    assert.match(source, /await cookies\(\)/u);
    assert.match(source, /initialAmbulatoryCookie=\{cookieStore\.get\('ambulatory_id'\)\?\.value \?\? null\}/u);
    assert.doesNotMatch(source, /\.set\(|Authorization|token|fetch\(/u);
});
test('patient create is wired exactly once to the existing encrypted client; no alternate writes', () => {
    const calls = nodes(parsed, ts.isCallExpression).map(node => node.expression.getText(parsed));
    assert.equal(calls.filter(name => name === 'db.patients.add').length, 1);
    assert(calls.includes('db.patients.toArray')); assert(calls.includes('db.patients.get'));
    assert(calls.includes('db.ambulatories.toArray'));
    assert.equal(calls.some(name => /(^|\.)(sendBeacon|bulkPut|put|clear|delete|update|restore|eval)$/u.test(name)), false);
    const fetches = nodes(parsed, ts.isCallExpression).filter(node => node.expression.getText(parsed) === 'fetch');
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].arguments[0].getText(parsed), "'/api/patients/create-context'");
    assert.doesNotMatch(fetches[0].getText(parsed), /method:|body:|POST/u);
    assert.match(panel, /addPatient: \(patient, guard\) => db\.patients\.add\(patient as Patient, \{ createContext:/u);
    for (const property of ['nonce', 'ambulatoryId', 'expiresAt']) assert(panel.includes(`guard.precondition.${property}`));
    assert(panel.includes('signal: guard.signal, isCurrent: guard.isCurrent'));
    assert(panel.includes('data-testid="patient-bulk-destination"'));
    assert(panel.includes('{snapshot.ambulatoryName}'));
    assert.doesNotMatch(panel, /localStorage|sessionStorage|dangerouslySetInnerHTML|new Function|console\./u);
});
test('file change only prepares; manual checked revision is passed by the confirm button', () => {
    const fileInput = tags.find(tag => literalAttribute(tag, 'data-testid') === 'patient-bulk-file');
    assert(fileInput); assert.equal(literalAttribute(fileInput, 'type'), 'file');
    const change = attribute(fileInput, 'onChange')?.getText(parsed) ?? '';
    assert.match(change, /session\?\.prepare\(file\)/u); assert.doesNotMatch(change, /\.confirm|\.add\(/u);
    const confirmButton = tags.find(tag => attribute(tag, 'onClick')?.getText(parsed).includes('session?.confirm'));
    assert(confirmButton); assert.equal(literalAttribute(confirmButton, 'type'), 'button');
    assert.match(attribute(confirmButton, 'disabled')?.getText(parsed) ?? '', /!reviewed/u);
    assert.match(attribute(confirmButton, 'onClick')?.getText(parsed) ?? '', /confirm\(snapshot\.previewRevision, reviewed\)/u);
    assert.match(panel, /const reviewed = consentRevision === snapshot\.previewRevision/u);
});
test('revocation, navigation, pending-form owner and template lifecycle are wired', () => {
    for (const expression of ['db.getSessionReadSignal()', 'db.isKeySet()', 'useSecurity()',
        'useRuntimeTwinPendingForm(pending)', "window.addEventListener('pagehide', retire)",
        "window.removeEventListener('pagehide', retire)", 'controller.dispose()', 'const unsubscribe = controller.subscribe(notify)', 'unsubscribe()',
        'useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getServerSnapshot)']) {
        assert(panel.includes(expression), expression);
    }
    assert.match(panel, /data:text\/csv;charset=utf-8,\$\{encodeURIComponent\(PATIENT_CSV_TEMPLATE\)\}/u);
    assert.doesNotMatch(panel, /createObjectURL|revokeObjectURL|setTemplateUrl|setSession|setSnapshot|eslint-disable|setTimeout/u);
    const effects = nodes(parsed, ts.isCallExpression).filter(node => node.expression.getText(parsed) === 'useEffect');
    assert.equal(effects.length, 1);
    assert.doesNotMatch(effects[0].arguments[0].getText(parsed), /set[A-Z]|new PatientBulkImportSession|subscribe/u);
    assert.match(effects[0].getText(parsed), /focus/u);
    assert.match(panel, /cookie !== initialAmbulatoryCookie/u);
});
test('sensitive preview cells are plain JSX inside the existing PrivacyBlur and errors are explicit', () => {
    assert(nodes(parsed, ts.isJsxElement).filter(node => node.openingElement.tagName.getText(parsed) === 'PrivacyBlur').length >= 5);
    assert.match(panel, /'in-flight': 'In corso'/u); assert.match(panel, /unknown: 'Esito sconosciuto'/u);
    assert(panel.includes('Non ripetere l’importazione'));
    assert(panel.includes('Non è un ripristino'));
    assert.match(panel, /getPatient: \(id, signal\) => db\.patients\.get\(id, \{ signal \}\)/u);
});
test('focus, live status, table semantics and existing Lume token vocabulary (not visual qualification)', () => {
    assert.match(panel, /aria-live="polite"/u); assert.match(panel, /previewTitle\.current\?\.focus\(\)/u);
    assert.match(panel, /resultTitle\.current\?\.focus\(\)/u); assert.match(panel, /scope="col"/u);
    const css = read('components/patient-bulk-import-panel.module.css');
    assert.match(css, /min-height: 44px/u); assert.match(css, /border-radius: 12px/u);
    assert.match(css, /:focus-visible/u); assert.match(css, /max-width: 640px/u);
    assert.match(css, /prefers-reduced-motion/u); assert.match(css, /forced-colors/u);
    const globals = read('app/globals.css');
    const tokens = [...new Set([...css.matchAll(/var\((--[a-z-]+)\)/gu)].map(match => match[1]))];
    assert(tokens.length > 0);
    for (const token of tokens) assert(globals.includes(`var(${token})`), `Token not used by the supplied globals.css: ${token}`);
});

test('E2E candidate parses and retains the original isolated runtime without auth or runner substitutes', () => {
    const name = 'e2e/patient-bulk-import.spec.ts';
    const source = read(name);
    const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
    });
    assert.deepEqual((result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
    assert(source.includes("from './fixtures/isolated-runtime'"));
    assert.doesNotMatch(source, /test\.(skip|fixme|setTimeout)|waitForTimeout|route\.(fulfill|abort)|page\.route\(/u);
    assert(source.includes("name: 'Concludi Setup'"));
    assert(source.includes("name: 'Crea scheda'"));
    assert(source.includes('expect(after.find(item => item.id === before.id)).toEqual(before)'));
});
