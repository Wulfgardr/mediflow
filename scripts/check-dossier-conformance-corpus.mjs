#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GENERATED_CORPUS_FILES = Object.freeze([
    'ts-cases.json',
    'banco-cases.json',
    'banco-index.json',
    'catalog-cases.json',
    'catalog.json',
    'expected.json',
]);

export const REGENERATE_COMMAND = 'npm run generate:dossier-conformance';

function runStep(root, args) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Generator step failed (${args.join(' ')}):\n${result.stdout}${result.stderr}`);
    }
}

export function generateCorpusInto(root, outDir) {
    runStep(root, ['scripts/generate-dossier-conformance.mjs', '--out-dir', outDir]);
    runStep(root, ['scripts/run-strip-types.mjs', 'scripts/prepare-dossier-banco-cases.ts', '--out-dir', outDir]);
    runStep(root, ['scripts/run-strip-types.mjs', 'scripts/update-dossier-conformance.ts', '--out-dir', outDir]);
}

export function compareCorpusDirectories(committedDir, generatedDir, files = GENERATED_CORPUS_FILES) {
    const mismatches = [];
    for (const file of files) {
        const committedPath = path.join(committedDir, file);
        const generatedPath = path.join(generatedDir, file);
        const generatedBytes = fs.readFileSync(generatedPath);
        if (!fs.existsSync(committedPath)) {
            mismatches.push({ file, reason: 'missing', generatedBytes: generatedBytes.length });
            continue;
        }
        const committedBytes = fs.readFileSync(committedPath);
        if (!committedBytes.equals(generatedBytes)) {
            mismatches.push({
                file,
                reason: 'differs',
                committedBytes: committedBytes.length,
                generatedBytes: generatedBytes.length,
            });
        }
    }
    return mismatches;
}

export function checkDossierConformanceCorpus(root = ROOT_DIR, committedDir = path.join(root, 'native/contracts/dossier-conformance')) {
    const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-dossier-conformance-check-'));
    try {
        generateCorpusInto(root, generatedDir);
        const mismatches = compareCorpusDirectories(committedDir, generatedDir);
        return { ok: mismatches.length === 0, mismatches };
    } finally {
        fs.rmSync(generatedDir, { recursive: true, force: true });
    }
}

function main(argv) {
    const committedIndex = argv.indexOf('--committed-dir');
    const committedDir = committedIndex >= 0
        ? path.resolve(argv[committedIndex + 1])
        : path.join(ROOT_DIR, 'native/contracts/dossier-conformance');
    const result = checkDossierConformanceCorpus(ROOT_DIR, committedDir);
    if (!result.ok) {
        const details = result.mismatches
            .map((entry) => (entry.reason === 'missing'
                ? `- ${entry.file}: file mancante (generati ${entry.generatedBytes} byte)`
                : `- ${entry.file}: committati ${entry.committedBytes} byte, generati ${entry.generatedBytes} byte`))
            .join('\n');
        process.stderr.write(
            `Corpus di conformita Dossier non allineato al generatore:\n${details}\n`
            + `Rigenera e committa il corpus con: ${REGENERATE_COMMAND}\n`,
        );
        process.exit(1);
    }
    console.log(`Corpus di conformita Dossier allineato (${GENERATED_CORPUS_FILES.length} file identici al generatore).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2));
}
