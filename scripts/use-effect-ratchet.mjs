#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATCHET_PATH = path.join(ROOT_DIR, 'scripts', 'use-effect-ratchet.json');

export const EFFECT_HOOK_MODULE = 'lib/hooks/effects/**';

export const EFFECT_MESSAGE =
    'useEffect e useLayoutEffect sono vietati nel codice di prodotto. Alternative: un dato derivato nel render, '
    + 'un handler di evento, una libreria di dati, useSyncExternalStore per una sorgente esterna, oppure un hook '
    + `dedicato in ${EFFECT_HOOK_MODULE.replace('/**', '/')}, l'unico modulo dove sono ammessi.`;

const EFFECT_NAME = '/^use(Layout)?Effect$/';

export const EFFECT_RESTRICTIONS = [
    `CallExpression[callee.type='Identifier'][callee.name=${EFFECT_NAME}]`,
    `CallExpression[callee.type='MemberExpression'][callee.property.name=${EFFECT_NAME}]`,
    `ImportSpecifier[imported.name=${EFFECT_NAME}][local.name!=${EFFECT_NAME}]`,
].map((selector) => ({ selector, message: EFFECT_MESSAGE }));

export const USE_EFFECT_RATCHET = JSON.parse(fs.readFileSync(RATCHET_PATH, 'utf8'));

export const EFFECT_EXEMPT_PATTERNS = [
    ...Object.keys(USE_EFFECT_RATCHET).map((file) => file.replace(/[[\](){}*?!+@]/g, '\\$&')),
    EFFECT_HOOK_MODULE,
];

export function compareWithRatchet(counts, ratchet) {
    const problems = [];
    for (const [file, allowed] of Object.entries(ratchet)) {
        const found = counts[file] ?? 0;
        if (found > allowed) {
            problems.push(`${file}: ${found} occorrenze, il ratchet ne ammette ${allowed}. ${EFFECT_MESSAGE}`);
        } else if (found < allowed) {
            problems.push(
                `${file}: ${found} occorrenze, il ratchet ne elenca ${allowed}. `
                + `Abbassa il numero in scripts/use-effect-ratchet.json${found === 0 ? ' togliendo il file' : ''}: l'elenco può solo diminuire.`,
            );
        }
    }
    for (const [file, found] of Object.entries(counts)) {
        if (!(file in ratchet) && found > 0) problems.push(`${file}: ${found} occorrenze fuori dal ratchet. ${EFFECT_MESSAGE}`);
    }
    return problems;
}

export async function countEffectsInRatchetFiles(ratchet = USE_EFFECT_RATCHET) {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({
        cwd: ROOT_DIR,
        overrideConfig: [{ rules: { 'no-restricted-syntax': ['error', ...EFFECT_RESTRICTIONS] } }],
        ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-syntax',
    });
    const files = Object.keys(ratchet).filter((file) => fs.existsSync(path.join(ROOT_DIR, file)));
    const counts = {};
    for (const result of await eslint.lintFiles(files)) {
        const file = path.relative(ROOT_DIR, result.filePath).split(path.sep).join('/');
        counts[file] = result.messages.filter((message) => message.message === EFFECT_MESSAGE).length;
    }
    return counts;
}

async function main() {
    const problems = compareWithRatchet(await countEffectsInRatchetFiles(), USE_EFFECT_RATCHET);
    if (problems.length > 0) {
        console.error(problems.join('\n'));
        process.exit(1);
    }
    const total = Object.values(USE_EFFECT_RATCHET).reduce((sum, count) => sum + count, 0);
    console.log(`useEffect ratchet: ${total} occorrenze in ${Object.keys(USE_EFFECT_RATCHET).length} file, nessuna nuova.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
