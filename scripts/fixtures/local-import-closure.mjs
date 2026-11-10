import fs from 'node:fs';
import path from 'node:path';

// Import statici relativi: `import ... from './x'`, `export ... from './x'`, `import './x'`.
// Gli import di soli tipi spariscono a runtime; gli import dinamici restano fuori
// apposta (es. native-first-install carica il database solo su richiesta).
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gmu;
const EXTENSIONS = ['', '.ts', '.mjs', '.js'];

function resolveLocal(root, importer, specifier) {
  const base = path.resolve(root, path.dirname(importer), specifier);
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(root, candidate).split(path.sep).join('/');
  }
  throw new Error(`MISSING_LOCAL_IMPORT: ${importer} imports ${specifier}, not found under ${root}`);
}

/**
 * I file da copiare perché `entries` si carichino fuori dal repository: gli
 * ingressi più tutto ciò che importano staticamente, con percorsi relativi a `root`.
 * Una fixture che copia questo elenco non si rompe al prossimo modulo aggiunto.
 */
export function localImportClosure(root, entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(?:[cm]?[jt]s)$/u.test(file)) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) pending.push(resolveLocal(root, file, match[1]));
  }
  return [...seen].sort();
}
