import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(ROOT_DIR, 'docs/design/lume/canon/lume-cockpit.template.html');
const EXPECTED_BUILD_SHA256 = '0c265db8c4174fd22d7b2e532e27669b6f76b8eed44da215432ee2cedcaab127';
const FONT_REPLACEMENTS = [
  ['__INTER__', 'app/fonts/Inter-Variable-Latin.woff2'],
  ['__PLEX400__', 'app/fonts/IBM-Plex-Mono-400-Latin.woff2'],
  ['__PLEX500__', 'app/fonts/IBM-Plex-Mono-500-Latin.woff2'],
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function renderCanon() {
  let output = readFileSync(TEMPLATE_PATH, 'utf8');

  for (const [placeholder, fontPath] of FONT_REPLACEMENTS) {
    const occurrences = output.split(placeholder).length - 1;
    if (occurrences !== 1) {
      throw new Error(`placeholder ${placeholder} atteso una sola volta, trovate ${occurrences} occorrenze.`);
    }
    const encodedFont = readFileSync(join(ROOT_DIR, fontPath)).toString('base64');
    output = output.replace(placeholder, encodedFont);
  }

  return output;
}

function temporaryOutputPath() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'mediflow-lume-canon-'));
  return join(temporaryDirectory, 'lume-cockpit.html');
}

function writeBuild(outputPath) {
  const renderedCanon = renderCanon();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderedCanon, 'utf8');
  return sha256(renderedCanon);
}

function printUsage() {
  console.log('Uso: node scripts/build-lume-canon.mjs [percorso-output]');
  console.log('     node scripts/build-lume-canon.mjs --verify');
}

function main() {
  const argumentsList = process.argv.slice(2);

  if (argumentsList[0] === '--help' || argumentsList[0] === '-h') {
    if (argumentsList.length !== 1) throw new Error('opzioni non compatibili con --help.');
    printUsage();
    return;
  }

  if (argumentsList[0] === '--verify') {
    if (argumentsList.length !== 1) throw new Error('--verify non accetta un percorso di output.');
    const outputPath = temporaryOutputPath();
    try {
      const hash = writeBuild(outputPath);
      console.log(`SHA-256: ${hash}`);
      if (hash !== EXPECTED_BUILD_SHA256) {
        console.error(`Verifica fallita: atteso ${EXPECTED_BUILD_SHA256}.`);
        process.exitCode = 1;
        return;
      }
      console.log('Verifica canone Lume: OK');
    } finally {
      rmSync(dirname(outputPath), { recursive: true, force: true });
    }
    return;
  }

  if (argumentsList.length > 1 || argumentsList[0]?.startsWith('--')) {
    throw new Error('argomenti non validi. Usa --help per la sintassi.');
  }

  const outputPath = argumentsList[0]
    ? resolve(process.cwd(), argumentsList[0])
    : temporaryOutputPath();
  const hash = writeBuild(outputPath);
  console.log(`Output: ${outputPath}`);
  console.log(`SHA-256: ${hash}`);
}

try {
  main();
} catch (error) {
  console.error(`Errore build canone Lume: ${error.message}`);
  process.exitCode = 1;
}
