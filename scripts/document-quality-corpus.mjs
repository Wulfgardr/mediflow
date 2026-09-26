#!/usr/bin/env node
/* @Codex: offline development-corpus validation; never runs a model or clinical runtime. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDocumentQualityDevelopmentCorpus } from '../lib/domain/documents/document-quality-corpus.mjs';

const fixture = new URL('./fixtures/document-quality-development-corpus.json', import.meta.url);
try {
  if (process.argv.length !== 2) throw new Error('only the bundled synthetic corpus is accepted; no arguments');
  const corpus = JSON.parse(readFileSync(fileURLToPath(fixture), 'utf8'));
  process.stdout.write(`${JSON.stringify(validateDocumentQualityDevelopmentCorpus(corpus), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`document-quality-corpus: ${error instanceof Error ? error.message : 'invalid corpus'}\n`);
  process.exitCode = 1;
}
