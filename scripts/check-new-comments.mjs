#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINE_COMMENT = new Map([
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.rs', '.swift', '.kt', '.java', '.go', '.c', '.cc', '.cpp', '.h', '.m', '.mm', '.scss']
        .map((ext) => [ext, '//']),
    ['.css', null],
    ...['.py', '.sh', '.zsh', '.bash', '.rb', '.toml', '.yml', '.yaml'].map((ext) => [ext, '#']),
]);
const BLOCK_START = /^\s*\/\*(?!\*)/;
const DOC_BLOCK = /^\s*\/\*\*/;
const BLOCK_CONTINUATION = /^\s*\*(?!\/)/;
const ALLOWED = /SPDX-License-Identifier|Copyright|License|prettier-ignore|https?:\/\/|(eslint-disable\S*|@ts-expect-error|#\[allow\(|swiftlint:disable|noqa|type: ignore).*(--|reason:)\s*\S/i;

export const GUIDANCE = 'Commenti aggiunti non ammessi. Rendi ovvio il codice (nome, estrazione, tipo, architettura) '
    + 'o codifica il vincolo in un test o in un lint, poi togli il commento. Ammessi: licenze, doc comment '
    + 'di API pubbliche, vincoli esterni con link alla fonte, prettier-ignore, soppressioni con motivo dopo `--`.';

export function commentKind(file, text) {
    const ext = path.extname(file);
    if (!LINE_COMMENT.has(ext)) return null;
    const marker = LINE_COMMENT.get(ext);
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (marker === '//' && (trimmed.startsWith('///') || trimmed.startsWith('//!'))) return 'doc';
    if (DOC_BLOCK.test(text)) return 'doc';
    if (marker && trimmed.startsWith(marker) && !trimmed.startsWith('#!')) return 'line';
    if (marker === '//' || ext === '.css') {
        if (BLOCK_START.test(text)) return 'block';
        if (BLOCK_CONTINUATION.test(text)) return 'continuation';
    }
    const trail = marker ? /\s(\/\/|#)\s/.exec(text) : null;
    if (trail && trail[1] === marker && !/https?:\/\//.test(text.slice(0, trail.index + 1))
        && !/["'`][^"'`]*$/.test(text.slice(0, trail.index))) return 'trailing';
    return null;
}

function gitDiff(repo, revision) {
    return execFileSync('git', ['-C', repo, 'diff', '--unified=0', '--no-color', '--no-ext-diff', revision], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
}

export function* addedLines(repo, base) {
    for (const diff of [gitDiff(repo, `${base}...HEAD`), gitDiff(repo, 'HEAD')]) {
        let file = null;
        let lineNumber = 0;
        for (const raw of diff.split('\n')) {
            if (raw.startsWith('+++ ')) {
                file = raw.startsWith('+++ b/') ? raw.slice(6) : null;
                continue;
            }
            const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
            if (hunk) {
                lineNumber = Number(hunk[1]);
                continue;
            }
            if (raw.startsWith('+') && file) {
                yield { file, lineNumber, text: raw.slice(1) };
                lineNumber += 1;
            }
        }
    }
}

export function findNewComments(repo, base) {
    const found = [];
    const insideDocBlock = new Map();
    for (const { file, lineNumber, text } of addedLines(repo, base)) {
        const kind = commentKind(file, text);
        if (kind === 'doc') {
            insideDocBlock.set(file, !text.trimEnd().endsWith('*/'));
            continue;
        }
        if (kind === 'continuation' && insideDocBlock.get(file)) {
            if (text.trimEnd().endsWith('*/')) insideDocBlock.set(file, false);
            continue;
        }
        if (kind === null) {
            insideDocBlock.set(file, false);
            continue;
        }
        if (!ALLOWED.test(text)) found.push({ file, lineNumber, text: text.trim().slice(0, 120) });
    }
    return found;
}

function main(argv) {
    const baseIndex = argv.indexOf('--base');
    const repoIndex = argv.indexOf('--repo');
    const base = baseIndex >= 0 ? argv[baseIndex + 1] : `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
    const repo = repoIndex >= 0 ? argv[repoIndex + 1] : process.cwd();
    const found = findNewComments(repo, base);
    if (found.length > 0) {
        console.error(GUIDANCE);
        for (const { file, lineNumber, text } of found) console.error(`${file}:${lineNumber}: ${text}`);
        process.exit(1);
    }
    console.log(`Nessun commento nuovo non ammesso rispetto a ${base}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
