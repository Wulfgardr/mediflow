import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GUIDANCE, commentKind, findNewComments } from './check-new-comments.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-new-comments.mjs');

function git(repo, ...args) {
    execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
}

function fixtureRepo(t) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-new-comments-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'ratchet@example.invalid');
    git(repo, 'config', 'user.name', 'ratchet');
    git(repo, 'config', 'commit.gpgsign', 'false');
    const write = (name, text) => {
        fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
        fs.writeFileSync(path.join(repo, name), text);
    };
    const commit = (message) => {
        git(repo, 'add', '-A');
        git(repo, 'commit', '-qm', message);
    };
    write('old.ts', '// commento vecchio, già presente\nexport const a = 1;\n');
    write('old.yml', '# commento vecchio\nkey: 1\n');
    commit('base');
    git(repo, 'branch', 'base');
    const flagged = () => {
        commit('change');
        return findNewComments(repo, 'base').map(({ text }) => text);
    };
    const cli = () => spawnSync(process.execPath, [SCRIPT, '--base', 'base', '--repo', repo], { encoding: 'utf8' });
    const moveBase = () => git(repo, 'branch', '-f', 'base');
    return { repo, write, commit, flagged, cli, moveBase };
}

test('blocca commenti narrativi, ripieghi giustificati e codice commentato', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('new.ts', [
        '// carica i pazienti',
        'export function f() {',
        '  setTimeout(go, 0); // workaround: il render non è pronto',
        '  /* vecchio codice',
        '  g(); */',
        '}',
        '',
    ].join('\n'));
    write('x.py', '# spiegazione inutile\nx = 1\n');
    write('y.rs', '// TODO sistemare\nfn main() {}\n');
    write('w.yml', 'steps:\n  # passo che spiega se stesso\n  - run: true\n');
    const got = flagged();
    for (const expected of [
        '// carica i pazienti',
        'setTimeout(go, 0); // workaround: il render non è pronto',
        '/* vecchio codice',
        '# spiegazione inutile',
        '// TODO sistemare',
        '# passo che spiega se stesso',
    ]) assert.ok(got.includes(expected), expected);
});

test('ammette licenze, doc comment di API, link alla fonte, prettier-ignore e soppressioni motivate', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('ok.ts', [
        '// SPDX-License-Identifier: MIT',
        '/**',
        ' * Restituisce il paziente per id. Lancia se assente.',
        ' */',
        'export function p(id: string) { return id; }',
        '/// doc di API',
        '// Safari tronca a 2 MB: https://bugs.webkit.org/show_bug.cgi?id=1',
        '// prettier-ignore',
        '// eslint-disable-next-line no-console -- output della CLI',
        "const url = 'https://example.org//path';",
        'const s = "a // b";',
        '',
    ].join('\n'));
    write('lib.rs', '//! Contratto pubblico del crate.\npub fn f() {}\n');
    write('run.sh', '#!/bin/sh\necho ok\n');
    assert.deepEqual(flagged(), []);
});

test('blocca una soppressione senza motivo', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('s.ts', '// eslint-disable-next-line react-hooks/exhaustive-deps\nexport const b = 2;\n');
    assert.deepEqual(flagged(), ['// eslint-disable-next-line react-hooks/exhaustive-deps']);
});

test('i commenti già presenti nella base non contano', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('old.ts', '// commento vecchio, già presente\nexport const a = 2;\n');
    write('old.yml', '# commento vecchio\nkey: 2\n');
    assert.deepEqual(flagged(), []);
});

test('conta anche le aggiunte non ancora committate', (t) => {
    const { repo, write } = fixtureRepo(t);
    write('draft.ts', '// appunto non ancora committato\nexport const c = 3;\n');
    git(repo, 'add', 'draft.ts');
    assert.deepEqual(findNewComments(repo, 'base').map(({ text }) => text), ['// appunto non ancora committato']);
});

test('la riga di comando esce 0 su un diff pulito e 1 con file, riga e indicazione', (t) => {
    const { write, commit, cli } = fixtureRepo(t);
    write('clean.ts', 'export const ok = 1;\n');
    commit('clean');
    assert.equal(cli().status, 0);
    write('dirty.ts', '// racconto\nexport const ko = 1;\n');
    commit('dirty');
    const result = cli();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /dirty\.ts:1: \/\/ racconto/);
    assert.ok(result.stderr.includes(GUIDANCE));
});

test('modificare una riga dentro un doc comment esistente resta ammesso, dentro un blocco normale no', (t) => {
    const { write, commit, flagged, moveBase } = fixtureRepo(t);
    write('api.ts', [
        '/**',
        ' * Documentazione originale della API pubblica.',
        ' * Seconda riga.',
        ' */',
        'export function api() {}',
        '/*',
        ' * blocco narrativo',
        ' */',
        'export const x = 1;',
        '',
    ].join('\n'));
    commit('api');
    moveBase();
    write('api.ts', [
        '/**',
        ' * Documentazione aggiornata della API pubblica.',
        ' * Seconda riga.',
        ' */',
        'export function api() {}',
        '/*',
        ' * blocco narrativo riscritto',
        ' */',
        'export const x = 1;',
        '',
    ].join('\n'));
    const got = flagged();
    assert.ok(got.includes('* blocco narrativo riscritto'));
    assert.ok(!got.some((line) => line.includes('Documentazione')));
});

test('il rilevatore YAML distingue un commento in coda dal testo di una stringa', () => {
    assert.equal(commentKind('w.yml', 'key: "a # b"'), null);
    assert.equal(commentKind('w.yml', 'key: "a" # spiega'), 'trailing');
});

test('aggiornare solo una riga di un doc comment esistente non viene segnalato', (t) => {
    const { write, commit, flagged, moveBase } = fixtureRepo(t);
    write('doc.ts', '/**\n * Documentazione originale della API pubblica.\n */\nexport function api() {}\n');
    commit('doc');
    moveBase();
    write('doc.ts', '/**\n * Documentazione aggiornata della API pubblica.\n */\nexport function api() {}\n');
    assert.deepEqual(flagged(), []);
});

test('blocca i commenti JS e TS anche senza spazi, dentro JSX e sulle righe interne di un blocco', (t) => {
    const { write, commit, flagged, moveBase } = fixtureRepo(t);
    write('edit.mjs', '/*\nvecchio testo\n*/\nexport const value = 1;\n');
    commit('blocco esistente');
    moveBase();
    write('edit.mjs', '/*\nnuovo ripiego\n*/\nexport const value = 1;\n');
    write('inline.ts', 'export const value = 1;/* ripiego in coda */\n');
    write('view.tsx', 'export const view = <div>{/* ripiego nel JSX */}</div>;\n');

    assert.deepEqual(flagged().sort(), [
        'nuovo ripiego',
        'export const value = 1;/* ripiego in coda */',
        'export const view = <div>{/* ripiego nel JSX */}</div>;',
    ].sort());
});

test('ignora testo JSX, espressioni regolari e template che contengono marcatori di commento', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('text.tsx', [
        'const text = `prima',
        '// testo del template',
        '/* ancora testo del template */',
        '`;',
        'const pattern = /[/*]/;',
        'export const view = <div>',
        '// testo in pagina',
        '/* ancora testo in pagina */',
        '</div>;',
    ].join('\n'));

    assert.deepEqual(flagged(), []);
});

test('blocca i marcatori @Codex anche nei doc comment, nei triple-slash e nelle righe con link', (t) => {
    const { write, flagged } = fixtureRepo(t);
    write('marker.ts', [
        '/** @Codex nota di agente */',
        'export function a() { return 1; }',
        '/// @Codex doc comment',
        'export const b = 2;',
        '// @Codex https://example.org/spec',
        'export const c = 3;',
        '',
    ].join('\n'));
    write('marker.rs', '/// @Codex marcatore Rust\npub fn f() {}\n');
    const got = flagged();
    assert.ok(got.includes('/** @Codex nota di agente */'));
    assert.ok(got.includes('/// @Codex doc comment'));
    assert.ok(got.includes('// @Codex https://example.org/spec'));
    assert.ok(got.includes('/// @Codex marcatore Rust'));
});
