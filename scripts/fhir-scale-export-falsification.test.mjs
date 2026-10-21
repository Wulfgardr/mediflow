import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

for (const [mode, failures, passes] of [
  ['no-precheck', 24, 5],
  ['number-first', 6, 23],
  ['empty-title', 9, 20],
]) {
  test(`consumer regressions reject the in-memory ${mode} mutation`, () => {
    const loader = `
      import { registerHooks } from 'node:module';
      const mode = ${JSON.stringify(mode)};
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        const target = mode === 'no-precheck' ? '/lib/fhir/export-precheck.ts' : '/lib/fhir/scale-validation.ts';
        if (!url.endsWith(target)) return result;
        const source = String(result.source);
        let mutated;
        if (mode === 'no-precheck') {
          const start = source.indexOf('    for (const entry of input.entries) {');
          const end = source.indexOf('    const bundle =', start);
          if (start < 0 || end < 0) throw new Error('MUTATION_TARGET_MISSING');
          mutated = source.slice(0, start) + source.slice(end);
        } else if (mode === 'number-first') {
          const start = source.indexOf('function toIntegerScaleScore(score) {');
          const end = source.indexOf('function validateFhirScaleEntry(entry)', start);
          if (start < 0 || end < 0) throw new Error('MUTATION_TARGET_MISSING');
          mutated = source.slice(0, start) + \`function toIntegerScaleScore(score) {
            const parsed = typeof score === 'number' ? score
              : typeof score === 'string' && score.trim() !== '' ? Number(score) : NaN;
            return Number.isInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647 ? parsed : null;
          }\` + source.slice(end);
        } else {
          mutated = source.replace(/    if \\(typeof title !== 'string' \\|\\| title\\.trim\\(\\) === ''\\)\\s*throw new FhirScaleTitleError\\(entry\\.id\\);/, '');
        }
        if (!mutated || mutated === source) throw new Error('MUTATION_NOT_APPLIED');
        console.error('MUTATION_APPLIED:' + mode);
        return { ...result, source: mutated };
      } });
    `;
    const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-fhir-scale-falsify-'));
    try {
      const run = spawnSync(process.execPath, [
        'scripts/run-strip-types.mjs', '--import', `data:text/javascript,${encodeURIComponent(loader)}`,
        '--test', '--test-reporter=tap', 'lib/fhir/export-consumers.test.ts',
      ], { cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: directory }, encoding: 'utf8', timeout: 30_000 });
      assert.ifError(run.error);
      const output = run.stdout + run.stderr;
      assert.equal(run.status, 1, output);
      assert.match(output, new RegExp(`MUTATION_APPLIED:${mode}`));
      assert.match(output, new RegExp(`# fail ${failures}\\b`), output);
      assert.match(output, new RegExp(`# pass ${passes}\\b`), output);
      for (const consumer of ['modules', 'editor', 'share']) {
        assert.match(output, new RegExp(`not ok \\d+ - ${consumer}:`), output);
      }
      assert.doesNotMatch(output, /SyntaxError|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND|MUTATION_TARGET_MISSING|MUTATION_NOT_APPLIED/);
      console.log(`${mode}: ${failures} expected consumer failures, ${passes} passes`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
