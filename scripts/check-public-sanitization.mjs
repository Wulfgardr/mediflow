#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.txt',
    '.rs', '.swift', '.py', '.yml', '.yaml', '.csv', '.html', '.css', '.sh',
]);

const SKIP_PATHS = new Set([
    'package-lock.json',
    'Cargo.lock',
    'assets/reference-data/lombardia/nomenclatore-regionale.csv',
    'assets/reference-data/lombardia/esenzioni-prestazioni.csv',
    'assets/reference-data/loinc/esami-laboratorio-it.csv',
    'assets/reference-data/loinc/unita-ucum-it.csv',
]);

function decodeTokens(encodedList) {
    return encodedList.map((entry) => Buffer.from(entry, 'base64').toString('utf8'));
}

const FACILITY_TOKENS = decodeTokens([
    'RmF0ZWJlbmVmcmF0ZWxsaQ==',
    'RkJG',
    'T3NwZWRhbGUgU2FjY28=',
    'THVpZ2kgU2FjY28=',
    'U2FuIFJhZmZhZWxl',
    'TmlndWFyZGE=',
    'SHVtYW5pdGFz',
    'QXV4b2xvZ2ljbw==',
    'U2FudGFnb3N0aW5v',
    'U3lubGFi',
    'QmlhbmFsaXNp',
    'Q2VyYmE=',
    'TGlmZWJyYWlu',
    'T3NwZWRhbGUgQnV6emk=',
    'TWFjZWRvbmlvIE1lbGxvbmk=',
    'R2FsZWF6emk=',
    'TW9uemlubw==',
    'TXVsdGlNZWRpY2E=',
    'Q2VudHJvIERpYWdub3N0aWNvIEl0YWxpYW5v',
]);

const REAL_DOC_FINGERPRINTS = decodeTokens([
    'UmVmZXJ0b0NpdHRhZGlubw==',
]);

function escapeRegex(literal) {
    return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
}

const FACILITY_PATTERNS = FACILITY_TOKENS.map((token) => ({
    id: 'REAL_FACILITY_OR_ROLE',
    regex: new RegExp(String.raw`\b${escapeRegex(token)}\b`, 'iu'),
}));

const FINGERPRINT_PATTERNS = REAL_DOC_FINGERPRINTS.map((token) => ({
    id: 'REAL_DOCUMENT_FINGERPRINT',
    regex: new RegExp(String.raw`\b${escapeRegex(token)}\b`, 'iu'),
}));

const REAL_FEEDING_PATTERNS = [
    {
        id: 'REAL_DOCUMENT_FEEDING_EVIDENCE',
        regex: /\b(?:sulle|sui|su)\s+\d+\s+(?:ricett[ae]|refert[io]|document[io]|promemoria)\b/iu,
    },
    {
        id: 'REAL_DOCUMENT_FEEDING_EVIDENCE',
        regex: /\bricett[ae]\s+(?:bianch[ae]\s+)?reali\b/iu,
    },
    {
        id: 'REAL_DOCUMENT_FEEDING_EVIDENCE',
        regex: /\bpromemoria\s+reali\b/iu,
    },
];

const NEGATIVE_POLICY_CONTEXT = /\b(?:nessun[oa]?|non\s+(?:provat|verificat|allegar|usar|introdurr|eseguit|son[oa]\s+stat)|senza|esclus[ioae]|vietat[ioae]|mai|fuori\s+da\s+git)\b/iu;

const SACCO_SIGNAL_PATTERN = /['"`]sacco['"`]/iu;

export function scanTextForPublicSanitization(text, label) {
    const violations = [];
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineNumber = index + 1;

        for (const rule of FACILITY_PATTERNS) {
            if (rule.regex.test(line)) {
                violations.push({ file: label, line: lineNumber, rule: rule.id });
            }
        }
        if (SACCO_SIGNAL_PATTERN.test(line)) {
            violations.push({ file: label, line: lineNumber, rule: 'REAL_FACILITY_OR_ROLE' });
        }
        for (const rule of FINGERPRINT_PATTERNS) {
            if (rule.regex.test(line)) {
                violations.push({ file: label, line: lineNumber, rule: rule.id });
            }
        }
        for (const rule of REAL_FEEDING_PATTERNS) {
            if (rule.regex.test(line) && !NEGATIVE_POLICY_CONTEXT.test(line)) {
                violations.push({ file: label, line: lineNumber, rule: rule.id });
            }
        }
    }
    return violations;
}

function listTrackedFiles(root) {
    const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return output.split(/\r?\n/u).filter(Boolean);
}

export function checkRepositoryPublicSanitization(root = ROOT_DIR) {
    const files = listTrackedFiles(root);
    const violations = [];
    let scannedFiles = 0;

    for (const relPath of files) {
        if (SKIP_PATHS.has(relPath)) continue;
        const ext = path.extname(relPath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) continue;
        const fullPath = path.join(root, relPath);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
        scannedFiles += 1;
        const content = fs.readFileSync(fullPath, 'utf8');
        violations.push(...scanTextForPublicSanitization(content, relPath));
    }

    return { scannedFiles, violations };
}

function main(argv) {
    if (argv.includes('--stdin')) {
        const labelIndex = argv.indexOf('--label');
        const label = labelIndex >= 0 && argv[labelIndex + 1] ? argv[labelIndex + 1] : 'stdin';
        const input = fs.readFileSync(0, 'utf8');
        const violations = scanTextForPublicSanitization(input, label);
        if (violations.length > 0) {
            for (const v of violations) {
                process.stderr.write(`${v.rule}: ${v.file}:${v.line}\n`);
            }
            process.exit(1);
        }
        console.log(`Public sanitization check (${label}): clean.`);
        return;
    }

    const result = checkRepositoryPublicSanitization(ROOT_DIR);
    if (result.violations.length > 0) {
        for (const v of result.violations) {
            process.stderr.write(`${v.rule}: ${v.file}:${v.line}\n`);
        }
        process.stderr.write(`Public sanitization failed: ${result.violations.length} violation(s) across ${result.scannedFiles} files.\n`);
        process.exit(1);
    }
    console.log(`Public sanitization check: ${result.scannedFiles} tracked files clean.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2));
}
