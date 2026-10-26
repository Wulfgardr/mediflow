import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('the actual ordinary quota status renders only the manual credit candidate without a raw balance', () => {
    const source = readFileSync('components/function-models/function-model-picker.tsx', 'utf8');
    const ast = ts.createSourceFile('picker.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const projections: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isJsxExpression(node) && node.expression && node.expression.getText(ast).startsWith('view.state?.quota &&')) projections.push(node.expression.getText(ast));
        ts.forEachChild(node, visit);
    }
    visit(ast); assert.equal(projections.length, 1);
    const code = ts.transpileModule(`const rendered = ${projections[0]}; rendered;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'fixtureElement' } }).outputText;
    for (const includedUsage of ['available', 'exhausted']) {
        const rendered = runInNewContext(code, { view: { state: { quota: { includedUsage, creditAvailability: 'available', balance: 'PRIVATE_BALANCE_SENTINEL' } } }, fixtureElement: (_tag: unknown, _props: unknown, ...children: unknown[]) => children.join('') });
        assert.match(rendered, /Il singolo tentativo richiede il tuo gesto/u); assert.match(rendered, /non garantisce accesso o disponibilità/u); assert.doesNotMatch(rendered, /PRIVATE_|saldo|dollari/u);
        assert.match(rendered, includedUsage === 'exhausted' ? /Quota inclusa esaurita; crediti potenzialmente disponibili/u : /Quota inclusa osservata disponibile/u);
    }
});
