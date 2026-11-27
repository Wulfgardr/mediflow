#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_ROOTS = ['app', 'components', 'lib', 'packages'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SOLE_WRITER_FILE = 'lib/network-home-base-server.ts';
const PAIRING_MODEL_FILE = 'lib/network-pairing-model.ts';
const PAIRING_KEY_IDENT = 'NETWORK_PAIRING_STATE_KEY';
const PAIRING_INTENTS_KEY_IDENT = 'NETWORK_PAIRING_INTENTS_KEY';
const DEFAULT_PAIRING_KEY_LITERAL = 'network.pairing.state';
const DEFAULT_PAIRING_INTENTS_KEY_LITERAL = 'network.pairing.intents';
const PROTECTED_PAIRING_KEYS = [
    { ident: PAIRING_KEY_IDENT, defaultLiteral: DEFAULT_PAIRING_KEY_LITERAL },
    { ident: PAIRING_INTENTS_KEY_IDENT, defaultLiteral: DEFAULT_PAIRING_INTENTS_KEY_LITERAL },
];
const WRITE_METHODS = new Set(['insert', 'update', 'delete']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'artifacts', 'target']);

export function resolvePairingKeyLiterals(root = ROOT_DIR) {
    const modelPath = path.join(root, PAIRING_MODEL_FILE);
    if (!fs.existsSync(modelPath)) {
        return PROTECTED_PAIRING_KEYS.map(({ ident, defaultLiteral }) => ({ ident, literal: defaultLiteral }));
    }
    const ast = parseFile(PAIRING_MODEL_FILE, fs.readFileSync(modelPath, 'utf8'));
    const resolved = new Map();
    function visit(node) {
        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && PROTECTED_PAIRING_KEYS.some(({ ident }) => ident === node.name.text)
            && node.initializer
            && ts.isStringLiteralLike(node.initializer)
        ) {
            resolved.set(node.name.text, node.initializer.text);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return PROTECTED_PAIRING_KEYS.map(({ ident }) => {
        const literal = resolved.get(ident);
        if (!literal) {
            throw new Error(`Could not resolve string literal ${ident} in ${PAIRING_MODEL_FILE}.`);
        }
        return { ident, literal };
    });
}

export function resolvePairingKeyLiteral(root = ROOT_DIR) {
    return resolvePairingKeyLiterals(root).find(({ ident }) => ident === PAIRING_KEY_IDENT).literal;
}

export const FIX_GUIDANCE =
    `Route all ${PAIRING_KEY_IDENT} and ${PAIRING_INTENTS_KEY_IDENT} writes through ${SOLE_WRITER_FILE} `
    + '(mutateNetworkPairingState() / postNetworkPairingIntent()) '
    + 'to preserve compare-and-swap isolation and archive-generation fencing.';

function collectProductionFiles(root) {
    const files = [];
    function walk(relativeDir) {
        const absoluteDir = path.join(root, relativeDir);
        if (!fs.existsSync(absoluteDir)) return;
        for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const relativePath = path.posix.join(relativeDir, entry.name);
            if (entry.isDirectory()) {
                walk(relativePath);
                continue;
            }
            if (!EXTENSIONS.has(path.extname(entry.name))) continue;
            if (/(?:\.(?:test|spec|fixture)\.|-(?:test|fixture)\.)/u.test(entry.name)) continue;
            files.push(relativePath);
        }
    }
    for (const dir of PRODUCTION_ROOTS) walk(dir);
    return files.sort();
}

function parseFile(file, source) {
    const kind = file.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : file.endsWith('.ts')
            ? ts.ScriptKind.TS
            : ts.ScriptKind.JS;
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function referencesSettingsTable(node) {
    if (!node) return false;
    if (ts.isIdentifier(node)) return node.text === 'settings';
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'settings';
    return false;
}

export function inspectPairingStateSource(
    file,
    source,
    pairingKeys = PROTECTED_PAIRING_KEYS.map(({ ident, defaultLiteral }) => ({ ident, literal: defaultLiteral })),
) {
    const normalizedKeys = typeof pairingKeys === 'string'
        ? [
            { ident: PAIRING_KEY_IDENT, literal: pairingKeys },
            { ident: PAIRING_INTENTS_KEY_IDENT, literal: DEFAULT_PAIRING_INTENTS_KEY_LITERAL },
        ]
        : pairingKeys;
    const ast = parseFile(file, source);
    const mentionedKeys = new Set();
    let writesSettingsTable = false;
    let hasRawSettingsSql = false;
    let hasMutateFn = false;
    let hasImmediateTx = false;
    let hasGenerationFence = false;

    function visit(node) {
        if (ts.isIdentifier(node)) {
            for (const key of normalizedKeys) {
                if (node.text === key.ident) mentionedKeys.add(key.ident);
            }
        }
        if (ts.isStringLiteralLike(node)) {
            for (const key of normalizedKeys) {
                if (node.text.includes(key.literal)) mentionedKeys.add(key.ident);
            }
        }

        if (ts.isFunctionDeclaration(node) && node.name?.text === 'mutateNetworkPairingState') {
            hasMutateFn = true;
        }
        if (ts.isCallExpression(node)) {
            if (ts.isIdentifier(node.expression)) {
                if (node.expression.text === 'runDbServerImmediateTransaction') hasImmediateTx = true;
                if (node.expression.text === 'assertArchiveGeneration') hasGenerationFence = true;
            }
            if (ts.isPropertyAccessExpression(node.expression) && WRITE_METHODS.has(node.expression.name.text)) {
                if (referencesSettingsTable(node.arguments[0])) writesSettingsTable = true;
            }
            const firstArg = node.arguments[0];
            if (firstArg && ts.isStringLiteralLike(firstArg)) {
                if (/\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from)\s+["'`]?settings\b/iu.test(firstArg.text)) {
                    hasRawSettingsSql = true;
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(ast);

    const findings = [];
    if (file === SOLE_WRITER_FILE) {
        if (!hasMutateFn || !hasImmediateTx || !hasGenerationFence || !writesSettingsTable) {
            findings.push(
                `${file}: canonical writer mutateNetworkPairingState() must keep runDbServerImmediateTransaction(), `
                + 'assertArchiveGeneration(), and CAS writes to settings.',
            );
        }
        return findings;
    }

    if (mentionedKeys.size > 0 && (writesSettingsTable || hasRawSettingsSql)) {
        const keyNames = [...mentionedKeys].sort().join(', ');
        findings.push(`${file}: direct write to ${keyNames} detected outside ${SOLE_WRITER_FILE}. ${FIX_GUIDANCE}`);
    }
    return findings;
}

export function checkPairingStateWriters(root) {
    const pairingKeys = resolvePairingKeyLiterals(root);
    const files = collectProductionFiles(root);
    const findings = [];
    let checkedSoleWriter = false;
    for (const file of files) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        if (file === SOLE_WRITER_FILE) checkedSoleWriter = true;
        findings.push(...inspectPairingStateSource(file, source, pairingKeys));
    }
    if (!checkedSoleWriter) {
        findings.push(`Missing canonical pairing-state writer module: ${SOLE_WRITER_FILE}.`);
    }
    return { checkedFiles: files.length, findings };
}

function main() {
    const result = checkPairingStateWriters(ROOT_DIR);
    if (result.findings.length > 0) {
        process.stderr.write(`${result.findings.join('\n')}\n`);
        process.exit(1);
    }
    console.log(`Pairing-state single-writer guard: PASS (${result.checkedFiles} production files checked).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
