#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TAX_CODE = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/iu;
const DATE_PATTERN = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/u;
const HEADER_NOISE = /^(?:esame|analita|parametro|risultato|valore|unita|unità|intervallo|range|valori? di riferimento|metodo|materiale|campione|paziente|assistit[oa]|cognome|nome|data|codice|referto)\b/iu;
const FACILITY_KEYWORD = /\b(?:ASST|ATS|IRCCS|Ospedale|Policlinico|Centro\s+Diagnostico|CDI|REDACTED|REDACTED|REDACTED|REDACTED|REDACTED|San\s+Raffaele|REDACTED|REDACTED|Laboratorio\s+(?:Analisi|Clinico|di\s+Analisi))\b/iu;
const FACILITY_STOP = /^(?:paziente|assistit[oa]|sig(?:\.|ra|nor[ae]?)?|nome|cognome|nat[oa]|cf|c\.f\.|codice|data|via|viale|piazza|corso|tel|fax|dott|dr|prof|referto|pag|richiedente|medico|sesso|et[aà])\b/iu;
const FACILITY_WORD = /^[\p{Lu}][\p{L}'’]*$/u;
const UNKNOWN_LABORATORY = 'Laboratorio non identificato';

const NUMBER_SOURCE = String.raw`(?:[<>]=?\s*)?-?\d+(?:[.,]\d+)?`;
const UNIT_TOKENS = [
    String.raw`mL\/min\/1[.,]73\s*m(?:2|²)`,
    String.raw`ml\/min\/1[.,]73\s*m(?:2|²)`,
    String.raw`10(?:\^|\*)[369]\/[µμu]?L`,
    String.raw`10(?:\^|\*)12\/L`,
    String.raw`x10\^[369]\/L`,
    String.raw`mmol\/mol(?:\s*creatinina)?`,
    String.raw`mg\/g(?:\s*creatinina)?`,
    String.raw`mg\/mmol`,
    String.raw`mg\/dL`, String.raw`mg\/L`, String.raw`g\/dL`, String.raw`g\/L`,
    String.raw`mmol\/L`, String.raw`pmol\/L`, String.raw`pmol\/l`, String.raw`nmol\/L`, String.raw`nmol\/l`,
    String.raw`[µμu]mol\/L`, String.raw`mEq\/L`,
    String.raw`ng\/mL`, String.raw`ng\/ml`, String.raw`ng\/dL`, String.raw`ng\/L`, String.raw`ng\/l`,
    String.raw`pg\/mL`, String.raw`[µμu]g\/dL`, String.raw`[µμu]g\/L`,
    String.raw`m?[µμu]?UI\/mL`, String.raw`m?UI\/L`, String.raw`IU\/mL`, String.raw`U\/L`,
    String.raw`mm\/h`, String.raw`mm\/1h`, String.raw`sec`, String.raw`s`,
    String.raw`fL`, String.raw`pg`, String.raw`%`,
    String.raw`\/[µμu]L`, String.raw`\/campo`, String.raw`INR`, String.raw`ratio`,
].join('|');
const RANGE_SOURCE = String.raw`(?:${NUMBER_SOURCE}\s*[-–]\s*${NUMBER_SOURCE}|[<>]=?\s*${NUMBER_SOURCE})`;
const LAB_LINE = new RegExp(
    String.raw`^(?<analyte>[\p{L}][\p{L}\p{N}()./' +%-]{1,79}?)\s+(?:\*{1,2}\s*)?(?:${NUMBER_SOURCE})(?:\s*\*{1,2})?\s+(?<unit>${UNIT_TOKENS})\s+\(?(?:${RANGE_SOURCE})\)?(?:\s+(?:H|L|ALTO|BASSO|HIGH|LOW|↑|↓|\*{1,2}))?$`,
    'iu',
);

function collectPdfFiles(rootDir) {
    const found = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) found.push(full);
        }
    }
    return found.sort();
}

async function readPdfText(filePath) {
    try {
        return execFileSync('pdftotext', ['-layout', filePath, '-'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 20 * 1024 * 1024,
        });
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    const { readFileSync } = await import('node:fs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(filePath)), useSystemFonts: true }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const byRow = new Map();
        for (const item of content.items) {
            if (!('str' in item) || !item.str.trim()) continue;
            const y = Math.round(item.transform[5]);
            const list = byRow.get(y) ?? [];
            list.push({ x: item.transform[4], end: item.transform[4] + item.width, size: Math.abs(item.transform[0]) || 1, str: item.str });
            byRow.set(y, list);
        }
        const rows = [...byRow.entries()]
            .sort(([a], [b]) => b - a)
            .map(([, cells]) => joinRowCells(cells.sort((a, b) => a.x - b.x)));
        pages.push(rows.join('\n'));
    }
    return pages.join('\n');
}

function joinRowCells(cells) {
    return cells.reduce((row, cell, index) => {
        if (index === 0) return cell.str;
        const gap = cell.x - cells[index - 1].end;
        return row + (gap > 1.5 * cell.size ? '  ' : gap > 0.1 * cell.size ? ' ' : '') + cell.str;
    }, '');
}

export function detectLaboratory(text) {
    for (const line of text.split(/\r?\n/u).slice(0, 25)) {
        const match = FACILITY_KEYWORD.exec(line);
        if (!match) continue;
        const words = [match[0].replace(/\s+/gu, ' ')];
        const sameColumn = line.slice(match.index + match[0].length).replace(/^ /u, '').split(/\s{2,}|\t/u)[0];
        for (const word of sameColumn.split(' ').filter(Boolean)) {
            if (words.length === 4 || !FACILITY_WORD.test(word) || FACILITY_STOP.test(word)) break;
            words.push(word);
        }
        return words.join(' ');
    }
    return UNKNOWN_LABORATORY;
}

export function extractAnalyteUnitPairs(text) {
    const pairs = [];
    for (const rawLine of text.replace(/\r/gu, '').split('\n')) {
        const line = rawLine.replace(/\u00a0/gu, ' ').replace(/[|;\t]+/gu, ' ').replace(/\s+/gu, ' ').trim();
        if (!line || HEADER_NOISE.test(line)) continue;
        const match = LAB_LINE.exec(line);
        if (!match?.groups) continue;
        const esame = match.groups.analyte.trim();
        const unita = match.groups.unit.replace(/\s+/gu, '').trim();
        if (esame.length < 2 || TAX_CODE.test(esame) || DATE_PATTERN.test(esame) || /\d{5,}/u.test(esame) || esame.split(/\s+/u).some((word) => FACILITY_STOP.test(word))) continue;
        pairs.push({ esame, unita });
    }
    return pairs;
}

export async function summarizeLabFolder(rootDir, readText = readPdfText) {
    const files = collectPdfFiles(rootDir);
    const byLab = new Map();
    let filesRead = 0;
    let filesFailed = 0;
    for (const filePath of files) {
        let text;
        try {
            text = await readText(filePath);
            filesRead += 1;
        } catch {
            filesFailed += 1;
            continue;
        }
        const lab = detectLaboratory(text);
        const counts = byLab.get(lab) ?? new Map();
        for (const { esame, unita } of extractAnalyteUnitPairs(text)) {
            const key = `${esame}\u0000${unita}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        byLab.set(lab, counts);
    }
    const laboratori = [...byLab.entries()]
        .sort(([left], [right]) => left.localeCompare(right, 'it-IT'))
        .map(([laboratorio, counts]) => ({
            laboratorio,
            coppie: [...counts.entries()]
                .map(([key, occorrenze]) => {
                    const [esame, unita] = key.split('\u0000');
                    return { esame, unita, occorrenze };
                })
                .sort((left, right) => left.esame.localeCompare(right.esame, 'it-IT') || left.unita.localeCompare(right.unita, 'it-IT')),
        }));
    return { fileTrovati: files.length, fileLetti: filesRead, fileNonLeggibili: filesFailed, laboratori };
}

function formatMarkdown(summary) {
    const lines = [
        `File PDF trovati: ${summary.fileTrovati} (letti: ${summary.fileLetti}, non leggibili: ${summary.fileNonLeggibili})`,
        '',
    ];
    for (const entry of summary.laboratori) {
        lines.push(`## ${entry.laboratorio}`, '', '| Esame | Unità | Occorrenze |', '|---|---|---:|');
        for (const pair of entry.coppie) lines.push(`| ${pair.esame} | ${pair.unita} | ${pair.occorrenze} |`);
        lines.push('');
    }
    return lines.join('\n');
}

async function main(argv) {
    const jsonMode = argv.includes('--json');
    const target = argv.find((arg) => !arg.startsWith('--'));
    if (!target) {
        process.stderr.write('Uso: node scripts/estrai-unita-referti.mjs <cartella-pdf> [--json]\n');
        process.exit(64);
    }
    const resolved = path.resolve(target);
    if (!statSync(resolved).isDirectory()) {
        process.stderr.write('Il percorso indicato non è una cartella.\n');
        process.exit(64);
    }
    const summary = await summarizeLabFolder(resolved);
    process.stdout.write(jsonMode ? `${JSON.stringify(summary, null, 2)}\n` : formatMarkdown(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main(process.argv.slice(2));
}
