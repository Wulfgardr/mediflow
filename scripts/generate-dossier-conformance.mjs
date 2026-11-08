import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = 'native/contracts/dossier-conformance';
const captured = ['preparedDossierFacts', 'anchorPreparedQuote', 'verifyPreparedFields', 'preparedTokens', 'preparedPatientKey', 'parsePreparedExtraction', 'evaluateDossierGroupIdentity', 'collectDossierPatientNames', 'preparedBulkDecisions', 'preparedFactEligible', 'dossierFactBlockers'];
await mkdir(directory, { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), 'mediflow-dossier-corpus-'));
try {
  for (const name of ['dossier-prepared', 'dossier-import']) {
    const output = path.join(scratch, `${name}.cjs`);
    await build({ entryPoints: [`lib/domain/documents/${name}.test.ts`], outfile: output, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'capture-verifier-inputs', setup(build) {
      build.onLoad({ filter: /\/dossier-(?:prepared|import)\.ts$/ }, async ({ path: sourcePath }) => {
        let contents = await readFile(sourcePath, 'utf8');
        for (const fn of captured) {
          if (!contents.includes(`export function ${fn}(`)) continue;
          contents = contents.replace(`export function ${fn}(`, `function ${fn}(`);
          contents += `\nexport { __capture_${fn} as ${fn} }; function __capture_${fn}(...args: Parameters<typeof ${fn}>) { const result = ${fn}(...args); globalThis.__dossierCapture?.('${fn}', args); return result; }\n`;
        }
        return { contents, loader: 'ts', resolveDir: path.dirname(sourcePath) };
      });
    } }], banner: { js: `const __calls = []; globalThis.__dossierCapture = (op, args) => { if (op === 'preparedBulkDecisions') { const i = args[0]; args = [{...i, assessments: Object.fromEntries(i.record.facts.map(f => [i.documentKey+'#'+f.factId, i.assessment(i.documentKey+'#'+f.factId) ?? null])), assessment: undefined}]; } __calls.push({op,args: JSON.parse(JSON.stringify(args, (k,v) => v instanceof Set ? [...v] : v))}); }; process.on('exit', () => require('node:fs').writeFileSync(${JSON.stringify(path.join(scratch, `${name}.json`))}, JSON.stringify(__calls)));` } });
    const run = spawnSync(process.execPath, [output], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(run.stdout + run.stderr);
  }
  const calls = (await Promise.all(['dossier-prepared', 'dossier-import'].map(async n => JSON.parse(await readFile(path.join(scratch, `${n}.json`), 'utf8'))))).flat();
  const unique = [...new Map(calls.map(c => [JSON.stringify(c), c])).values()];
  await writeFile(`${directory}/ts-cases.json`, JSON.stringify(unique));
  console.log(`Casi TS del verificatore: ${unique.length}`);
} finally { await rm(scratch, { recursive: true, force: true }); }
