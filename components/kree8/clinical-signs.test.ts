import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

function signs(source: string, selector: string) {
    const contents: string[] = [];
    postcss.parse(source).walkRules(rule => {
        if (rule.selectors.includes(selector)) {
            rule.walkDecls('content', declaration => {
                contents.push(declaration.value.replace(/^['"]|['"]$/g, ''));
            });
        }
    });
    return contents;
}

const source = readFileSync(new URL('./kree8-clinical-cockpit-foundation.module.css', import.meta.url), 'utf8');

test('la pillola critica usa ◆ e l’avviso usa ▲', () => {
    assert.deepEqual(signs(source, '.pillCritical::before'), ['◆']);
    assert.deepEqual(signs(source, '.pillWarning::before'), ['▲']);
});

test('il controllo legge anche selettori condivisi e rifiuta il segno di avviso per critico', () => {
    const shared = ".pillWarning::before, .pillCritical::before { content: '▲'; }";
    assert.deepEqual(signs(shared, '.pillCritical::before'), ['▲']);
    assert.notDeepEqual(signs(shared, '.pillCritical::before'), ['◆']);
    assert.deepEqual(signs(".pillCritical::before { content: '◆'; }", '.pillCritical::before'), ['◆']);
});
