import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const functions = ['preparedDossierFacts', 'anchorPreparedQuote', 'verifyPreparedFields', 'preparedTokens', 'preparedPatientKey', 'parsePreparedExtraction', 'evaluateDossierGroupIdentity', 'collectDossierPatientNames', 'preparedBulkDecisions', 'preparedFactEligible', 'dossierFactBlockers'];
export async function bundleDossierWorker() {
  const result = await build({ entryPoints: ['experiments/gpui-patient-pilot/worker/dossier.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true, write: false,
    plugins: [{ name: 'native-verifier', setup(builder) {
      builder.onLoad({ filter: /\/dossier-(?:prepared|import)\.ts$/ }, async ({ path: sourcePath }) => {
        let contents = await readFile(sourcePath, 'utf8');
        for (const name of functions) {
          if (!contents.includes(`export function ${name}(`)) continue;
          contents = contents.replace(`export function ${name}(`, `function ${name}(`);
          contents += `\nexport { native_${name} as ${name} }; function native_${name}(...args: Parameters<typeof ${name}>) { const result = ${name}(...args); globalThis.dossierVerify('${name}', args, result); return result; }\n`;
        }
        return { contents, loader: 'ts', resolveDir: path.dirname(sourcePath) };
      });
    } }] });
  return result.outputFiles[0].text;
}
// Senza await al livello del modulo: il test di allineamento lo carica con require().
if (process.argv[1] === new URL(import.meta.url).pathname) {
  bundleDossierWorker().then(async result => {
    await writeFile('experiments/gpui-patient-pilot/worker/dossier.bundle.mjs', result);
    console.log(`Worker locale: ${Buffer.byteLength(result)} byte`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
