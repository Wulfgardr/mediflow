import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import {
    EFFECT_MESSAGE,
    USE_EFFECT_RATCHET,
    compareWithRatchet,
    countEffectsInRatchetFiles,
} from './use-effect-ratchet.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: ROOT_DIR });

async function effectErrors(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT_DIR, filePath) });
    return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
}

const NEW_COMPONENT = `import { useEffect, useLayoutEffect } from 'react';
import * as React from 'react';
import { useEffect as useSync } from 'react';

export function Probe() {
    useEffect(() => {}, []);
    useLayoutEffect(() => {}, []);
    React.useEffect(() => {}, []);
    useSync(() => {}, []);
    return null;
}
`;

test('un file nuovo che usa useEffect fallisce il lint e il messaggio nomina le alternative', async () => {
    const errors = await effectErrors(NEW_COMPONENT, 'components/effect-ratchet-probe.tsx');
    assert.equal(errors.length, 4);
    for (const error of errors) {
        assert.equal(error.severity, 2);
        assert.equal(error.message, EFFECT_MESSAGE);
    }
    for (const alternative of ['dato derivato nel render', 'handler di evento', 'libreria di dati', 'useSyncExternalStore', 'lib/hooks/effects/']) {
        assert.match(EFFECT_MESSAGE, new RegExp(alternative.replace(/[/.]/g, '\\$&')));
    }
});

test('il divieto vale anche nel codice non React del repository', async () => {
    const errors = await effectErrors('export const run = (hooks) => hooks.useEffect(() => {});\n', 'lib/effect-ratchet-probe.ts');
    assert.equal(errors.length, 1);
});

test('un file nel ratchet continua a passare, anche con le parentesi quadre delle rotte Next', async () => {
    const file = 'app/patients/[id]/scales/page.tsx';
    assert.ok(USE_EFFECT_RATCHET[file] > 0);
    const errors = await effectErrors(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8'), file);
    assert.deepEqual(errors, []);
});

test('il modulo di hook dedicato può usare useEffect', async () => {
    assert.deepEqual(await effectErrors(NEW_COMPONENT, 'lib/hooks/effects/use-probe.ts'), []);
});

test('il ratchet fallisce se le occorrenze salgono, scendono senza aggiornare l\'elenco o compaiono in un file nuovo', () => {
    const ratchet = { 'a.tsx': 2, 'b.tsx': 1 };
    assert.deepEqual(compareWithRatchet({ 'a.tsx': 2, 'b.tsx': 1 }, ratchet), []);

    const decreased = compareWithRatchet({ 'a.tsx': 1, 'b.tsx': 1 }, ratchet);
    assert.equal(decreased.length, 1);
    assert.match(decreased[0], /^a\.tsx: 1 occorrenze, il ratchet ne elenca 2\..*può solo diminuire/);

    const removed = compareWithRatchet({ 'a.tsx': 2, 'b.tsx': 0 }, ratchet);
    assert.match(removed[0], /^b\.tsx: .*togliendo il file/);

    const increased = compareWithRatchet({ 'a.tsx': 3, 'b.tsx': 1 }, ratchet);
    assert.match(increased[0], /^a\.tsx: 3 occorrenze, il ratchet ne ammette 2\./);

    const outside = compareWithRatchet({ 'a.tsx': 2, 'b.tsx': 1, 'c.tsx': 1 }, ratchet);
    assert.match(outside[0], /^c\.tsx: 1 occorrenze fuori dal ratchet/);
});

test('il conteggio reale legge le occorrenze dei file del ratchet anche dove il lint le esenta', async () => {
    const counts = await countEffectsInRatchetFiles({ 'app/patients/[id]/scales/page.tsx': 1, 'components/does-not-exist.tsx': 1 });
    assert.equal(counts['app/patients/[id]/scales/page.tsx'], USE_EFFECT_RATCHET['app/patients/[id]/scales/page.tsx']);
    assert.equal(counts['components/does-not-exist.tsx'], undefined);
    assert.match(compareWithRatchet(counts, { 'components/does-not-exist.tsx': 1 })[0], /togliendo il file/);
});
