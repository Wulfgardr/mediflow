import assert from 'node:assert/strict';
import test from 'node:test';
import { compareWithRatchet, countLegacyButtonClasses } from './check-button-system.mjs';

test('conta le classi storiche e ignora quelle del sistema', () => {
    assert.equal(countLegacyButtonClasses('<button className="ui-btn-primary h-10">A</button>'), 1);
    assert.equal(countLegacyButtonClasses('className="mf-btn-secondary w-full" ui-btn-secondary graphite-mini-btn'), 3);
    assert.equal(countLegacyButtonClasses('<Button variant="secondary" className="mf-button-secondary">A</Button>'), 0);
});

test('una nuova occorrenza fuori dal ratchet fallisce e nomina la soluzione', () => {
    const problems = compareWithRatchet({ 'app/nuova/page.tsx': 1 }, {});
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Usa Button/);
});

test('una crescita fallisce, una diminuzione chiede di abbassare il ratchet', () => {
    assert.match(compareWithRatchet({ 'a.tsx': 3 }, { 'a.tsx': 2 })[0], /ne ammette 2/);
    assert.match(compareWithRatchet({}, { 'a.tsx': 2 })[0], /togliendo il file/);
    assert.deepEqual(compareWithRatchet({ 'a.tsx': 2 }, { 'a.tsx': 2 }), []);
});
