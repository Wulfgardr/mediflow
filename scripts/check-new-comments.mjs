#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const LINE_COMMENT = new Map([
    ...['.rs', '.swift', '.kt', '.java', '.go', '.c', '.cc', '.cpp', '.h', '.m', '.mm', '.scss']
        .map((ext) => [ext, '//']),
    ['.css', null],
    ...['.py', '.sh', '.zsh', '.bash', '.rb', '.toml', '.yml', '.yaml'].map((ext) => [ext, '#']),
]);
const BLOCK_START = /^\s*\/\*(?!\*)/;
const DOC_BLOCK = /^\s*\/\*\*/;
const BLOCK_CONTINUATION = /^\s*\*(?!\/)/;
const FORBIDDEN_MARKER = /@Codex\b/i;
const ALLOWED = /SPDX-License-Identifier|Copyright|License|prettier-ignore|https?:\/\/|(eslint-disable\S*|@ts-expect-error|#\[allow\(|swiftlint:disable|noqa|type: ignore).*(--|reason:)\s*\S/i;

export const GUIDANCE = 'Commenti aggiunti o marcatori @Codex non ammessi. Rendi ovvio il codice (nome, estrazione, tipo, architettura) '
    + 'o codifica il vincolo in un test o in un lint, poi togli il commento. Ammessi: licenze, doc comment '
    + 'di API pubbliche, vincoli esterni con link alla fonte, prettier-ignore, soppressioni con motivo dopo `--`.';

function trailingMarkerIndex(text, marker) {
    let quote = null;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (char === '\\') index += 1;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') quote = char;
        else if (index > 0 && /\s/.test(text[index - 1]) && text.startsWith(marker, index)) return index;
    }
    return -1;
}

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
    if (marker && trailingMarkerIndex(text, marker) >= 0) return 'trailing';
    return null;
}

function gitDiff(repo, revision) {
    return execFileSync('git', ['-C', repo, 'diff', '--unified=0', '--no-color', '--no-ext-diff', revision], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
}

export function* addedLines(repo, base) {
    for (const [revision, diff] of [['HEAD', gitDiff(repo, `${base}...HEAD`)], [null, gitDiff(repo, 'HEAD')]]) {
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
                yield { file, lineNumber, text: raw.slice(1), revision };
                lineNumber += 1;
            }
        }
    }
}

function sourceReader(repo) {
    const cache = new Map();
    return (revision, file) => {
        const key = `${revision ?? 'worktree'}:${file}`;
        if (!cache.has(key)) {
            const text = revision
                ? execFileSync('git', ['-C', repo, 'show', `${revision}:${file}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
                : fs.readFileSync(path.join(repo, file), 'utf8');
            cache.set(key, text);
        }
        return cache.get(key);
    };
}

function insideDocBlock(lines, lineNumber) {
    for (let index = lineNumber - 2; index >= 0; index -= 1) {
        if (lines[index].includes('*/')) return false;
        if (DOC_BLOCK.test(lines[index])) return true;
        if (BLOCK_START.test(lines[index])) return false;
    }
    return false;
}

function typescriptCommentLines(file, source) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
    const lines = new Set();
    let tokenEnd = 0;

    function scanTrivia(end) {
        if (tokenEnd >= end) return;
        scanner.setText(source, tokenEnd, end - tokenEnd);
        for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
            if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
            const comment = scanner.getTokenText();
            const hasForbiddenMarker = FORBIDDEN_MARKER.test(comment);
            if (!hasForbiddenMarker && (DOC_BLOCK.test(comment) || comment.startsWith('///') || ALLOWED.test(comment))) continue;

            const firstLine = ast.getLineAndCharacterOfPosition(scanner.getTokenPos()).line;
            const lastLine = ast.getLineAndCharacterOfPosition(scanner.getTextPos() - 1).line;
            for (let line = firstLine; line <= lastLine; line += 1) lines.add(line + 1);
        }
    }

    function visit(node) {
        if (ts.isJSDoc(node)) {
            if (FORBIDDEN_MARKER.test(node.getText(ast))) {
                const firstLine = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line;
                const lastLine = ast.getLineAndCharacterOfPosition(node.end - 1).line;
                for (let line = firstLine; line <= lastLine; line += 1) lines.add(line + 1);
            }
            return;
        }
        const children = node.getChildren(ast);
        if (children.length > 0) {
            children.forEach(visit);
            return;
        }
        scanTrivia(node.getStart(ast));
        tokenEnd = node.end;
    }

    visit(ast);
    scanTrivia(source.length);
    return lines;
}

export function findNewComments(repo, base) {
    const found = [];
    const readSource = sourceReader(repo);
    const typescriptLines = new Map();
    for (const { file, lineNumber, text, revision } of addedLines(repo, base)) {
        const report = () => found.push({ file, lineNumber, text: text.trim().slice(0, 120) });
        if (TYPESCRIPT_EXTENSIONS.has(path.extname(file))) {
            const key = `${revision ?? 'worktree'}:${file}`;
            if (!typescriptLines.has(key)) {
                typescriptLines.set(key, typescriptCommentLines(file, readSource(revision, file)));
            }
            if (typescriptLines.get(key).has(lineNumber)) report();
            continue;
        }
        const kind = commentKind(file, text);
        if (kind === null) continue;
        if (FORBIDDEN_MARKER.test(text)) { report(); continue; }
        if (kind === 'doc') continue;
        if (kind === 'continuation' && insideDocBlock(readSource(revision, file).split('\n'), lineNumber)) continue;
        if (!ALLOWED.test(text)) report();
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
