/* @Codex — isolated test loader. No production module imports this file.
 * Synthetic pin substitution tests filesystem/layout behavior with the REAL
 * validation code. It is NOT evidence about the 220 MB public binary or signing.
 * Without the explicit test-only mode, every production pin remains unchanged.
 * Built-in TS transform also lets the tests run without npm/Xcode on a source slice. */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest, repositoryRoot, syntheticFiles } from './mac-packaging-test-support.mjs';

let synthetic = process.env.MEDIFLOW_PACKAGING_TEST_PINS === 'synthetic-only';
export function installSyntheticPackagingPins() { synthetic = true; }
function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Synthetic pin seam drifted: ${before}`);
  return source.replace(before, after);
}
function substitute(source, name) {
  const pins = {
    'execution-sandbox.ts': [['b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3', digest(syntheticFiles.codex)]],
    'execution-mac-assets.ts': [['bytes: 220584000', `bytes: ${syntheticFiles.codex.length}`]],
    'execution-mac-native.ts': [
      ['bytes: 20411', `bytes: ${syntheticFiles['mac-owner.c'].length}`],
      ['c26edcc883e311f279507fc5a80c792242a252d66e99ee97c5f67693bcb14fac', digest(syntheticFiles['mac-owner.c'])],
    ],
    'execution-mac-config.ts': [
      ['bytes: 200401', `bytes: ${syntheticFiles['schema/config.schema.json'].length}`],
      ['692da7699367f6f4fbbd46c0021278c1311440bcebf0bcb9b836690c05e56196', digest(syntheticFiles['schema/config.schema.json'])],
      ['bytes: 572', `bytes: ${syntheticFiles['schema/RECEIPT.json'].length}`],
      ['216fc490e6b2df23e01dbc729da65651d6622ab8a272d4feafc2685064448584', digest(syntheticFiles['schema/RECEIPT.json'])],
      ['bytes: 76594', `bytes: ${syntheticFiles['schema/config-loader-mod.rs'].length}`],
      ['6fc44b60c64065994c9aa18df248eb521dba6b0e9917a8cf69fc60e0035ac56a', digest(syntheticFiles['schema/config-loader-mod.rs'])],
      ['receiptBytes: 415', `receiptBytes: ${syntheticFiles['schema/LOADER-RECEIPT.json'].length}`],
      ['e2f902e74eae01e297466be3d0a49110e82b219b797ae255cdd4e97b96085ca2', digest(syntheticFiles['schema/LOADER-RECEIPT.json'])],
      ['bytes: 8330', `bytes: ${syntheticFiles['C1-RECEIPT.json'].length}`],
      ['2b07b00c3f0473acf5caafb706e07265db55c189e61e14259800e628e1d205ae', digest(syntheticFiles['C1-RECEIPT.json'])],
    ],
  };
  for (const [before, after] of pins[name] ?? []) source = once(source, before, after);
  return source;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { shortCircuit: true, url: 'data:text/javascript,export%20%7B%7D' };
    try { return next(specifier, context); }
    catch (error) {
      if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) throw error;
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.mjs`]) {
        if (candidate.startsWith(repositoryRoot + path.sep) && fs.existsSync(candidate)) return { shortCircuit: true, url: pathToFileURL(candidate).href };
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const file = fileURLToPath(url);
      if (file.startsWith(repositoryRoot + path.sep)) {
        let source = fs.readFileSync(file, 'utf8');
        if (synthetic) source = substitute(source, path.basename(file));
        return { shortCircuit: true, format: 'module', source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }) };
      }
    }
    return next(url, context);
  },
});
