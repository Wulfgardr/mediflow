#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATCHET_PATH = path.join(ROOT_DIR, 'scripts', 'check-button-system.json');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib'];
const SOURCE_FILE = /\.(?:tsx|ts|jsx|js)$/u;

export const LEGACY_BUTTON_CLASS = /\b(?:ui-btn-(?:primary|secondary)|mf-btn-secondary|graphite-mini-btn)\b/gu;

export const BUTTON_SYSTEM_MESSAGE =
    'Le classi di pulsante storiche (ui-btn-*, mf-btn-secondary, graphite-mini-btn) non crescono. '
    + 'Usa Button da components/ui/button.tsx o le classi mf-button-primary, mf-button-secondary, '
    + 'mf-button-text, mf-button-destructive, mf-button-icon (docs/design/punto-inchiostro/05-sistema-web.md).';

export function countLegacyButtonClasses(source) {
    return [...source.matchAll(LEGACY_BUTTON_CLASS)].length;
}

export function compareWithRatchet(counts, ratchet) {
    const problems = [];
    for (const [file, allowed] of Object.entries(ratchet)) {
        const found = counts[file] ?? 0;
        if (found > allowed) problems.push(`${file}: ${found} occorrenze, il ratchet ne ammette ${allowed}. ${BUTTON_SYSTEM_MESSAGE}`);
        else if (found < allowed) problems.push(`${file}: ${found} occorrenze, il ratchet ne elenca ${allowed}. Abbassa il numero in scripts/check-button-system.json${found === 0 ? ' togliendo il file' : ''}: l'elenco può solo diminuire.`);
    }
    for (const [file, found] of Object.entries(counts)) {
        if (!(file in ratchet) && found > 0) problems.push(`${file}: ${found} occorrenze fuori dal ratchet. ${BUTTON_SYSTEM_MESSAGE}`);
    }
    return problems;
}

function walk(relative, files) {
    for (const entry of fs.readdirSync(path.join(ROOT_DIR, relative), { withFileTypes: true })) {
        const child = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) walk(child, files);
        else if (SOURCE_FILE.test(entry.name) && !/\.test\.[jt]sx?$/u.test(entry.name)) files.push(child);
    }
    return files;
}

export function countRepository() {
    const counts = {};
    for (const dir of SOURCE_DIRS) {
        if (!fs.existsSync(path.join(ROOT_DIR, dir))) continue;
        for (const file of walk(dir, [])) {
            const found = countLegacyButtonClasses(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8'));
            if (found > 0) counts[file] = found;
        }
    }
    return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const counts = countRepository();
    if (process.argv.includes('--write')) {
        fs.writeFileSync(RATCHET_PATH, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
        process.exit(0);
    }
    const problems = compareWithRatchet(counts, JSON.parse(fs.readFileSync(RATCHET_PATH, 'utf8')));
    if (problems.length) {
        for (const problem of problems) console.error(problem);
        process.exit(1);
    }
    console.log(`Classi di pulsante storiche: ${Object.values(counts).reduce((a, b) => a + b, 0)} occorrenze in ${Object.keys(counts).length} file, nessuna nuova.`);
}
