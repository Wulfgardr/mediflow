import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const formal = path.join(root, 'docs/formal/therapy-status');
const coverage = JSON.parse(fs.readFileSync(path.join(formal, 'coverage.json'), 'utf8'));
const base = process.env.MEDIFLOW_FORMAL_BASE_REF;
if (base && /^[a-f0-9]{40}$/i.test(base)) {
  const delta = spawnSync('git', ['diff', '--name-only', base, 'HEAD', '--',
    ...Object.keys(coverage.files), ...coverage.verificationInputs], { cwd: root, encoding: 'utf8' });
  if (delta.status === 0 && !delta.stdout.trim()) {
    console.log('Therapy formal verification: no covered input changed in this CI range.');
    process.exit(0);
  }
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
for (const [file, expected] of Object.entries(coverage.files)) {
  if (sha256(fs.readFileSync(path.join(root, file))) !== expected) {
    throw new Error(`Formal coverage drift: ${file}. Review transitions and assumptions against ${coverage.syncCommit}; update coverage only after checking the model and code tests. See docs/formal/therapy-status/README.md.`);
  }
}
function externalDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const real = fs.realpathSync(directory);
  for (const forbidden of [root, path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop')]) {
    if (real === forbidden || real.startsWith(forbidden + path.sep)) throw new Error(`Formal artifacts must be outside the repository and synchronized folders: ${real}`);
  }
  return real;
}
const output = externalDirectory(process.env.MEDIFLOW_FORMAL_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-therapy-formal-')));
const cache = externalDirectory(process.env.MEDIFLOW_TLA_CACHE || path.join(os.homedir(), '.cache/mediflow-formal/tla', coverage.tool.release));
const jar = path.join(cache, 'tla2tools.jar');
if (!fs.existsSync(jar)) {
  const response = await fetch(coverage.tool.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Official TLC download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== coverage.tool.sha256) throw new Error('Downloaded TLC hash mismatch');
  fs.writeFileSync(jar, bytes, { flag: 'wx' });
}
if (sha256(fs.readFileSync(jar)) !== coverage.tool.sha256) throw new Error('Cached TLC hash mismatch');
const results = [];
function run(name, executable, args, expected, env = {}) {
  const started = performance.now();
  const runResult = spawnSync(executable, args, { cwd: root, encoding: 'utf8',
    timeout: coverage.bounds.timeoutSecondsPerProcess * 1000, maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, ...env, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' } });
  const log = `${runResult.stdout || ''}${runResult.stderr || ''}`;
  fs.writeFileSync(path.join(output, `${name}.log`), log);
  if (runResult.error || !expected(runResult.status, log)) {
    throw new Error(`${name} failed (exit ${runResult.status}, ${runResult.error?.message || 'unexpected result'}). Inspect ${path.join(output, `${name}.log`)}`);
  }
  const counts = /([\d,]+) states generated, ([\d,]+) distinct states found, ([\d,]+) states left on queue/.exec(log);
  const result = { name, exit: runResult.status, elapsedMs: Math.round(performance.now() - started),
    logSha256: sha256(log), ...(counts ? { generated: Number(counts[1].replaceAll(',', '')), distinct: Number(counts[2].replaceAll(',', '')), queued: Number(counts[3].replaceAll(',', '')) } : {}) };
  results.push(result);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ syncCommit: coverage.syncCommit, tool: coverage.tool,
    bounds: coverage.bounds, results }, null, 2) + '\n');
  console.log(`${name}: expected result; ${result.elapsedMs} ms${counts ? `; ${result.distinct} distinct states` : ''}`);
  return log;
}
const model = fs.readFileSync(path.join(formal, 'TherapyStatus.tla'), 'utf8');
const baseConfig = fs.readFileSync(path.join(formal, 'MC.cfg'), 'utf8');
function tlc(name, { mutant, witness, invariant } = {}) {
  const directory = path.join(output, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'TherapyStatus.tla'), model);
  let config = baseConfig;
  if (mutant) config = config.replace(`${mutant} = FALSE`, `${mutant} = TRUE`);
  if (witness || invariant) config = config.replace(/INVARIANTS[\s\S]*/, `INVARIANT ${witness || invariant}\n`);
  fs.writeFileSync(path.join(directory, 'MC.cfg'), config);
  const failedInvariant = witness || (mutant ? invariant : null);
  return run(name, process.env.JAVA || 'java', ['-XX:+UseParallelGC', `-Xmx${coverage.bounds.heapMiB}m`, '-cp', jar, 'tlc2.TLC',
    '-workers', String(coverage.bounds.workers), '-fp', String(coverage.bounds.fingerprintPolynomialIndex), '-seed', '1', '-metadir', path.join(directory, 'states'),
    '-config', path.join(directory, 'MC.cfg'), path.join(directory, 'TherapyStatus.tla')],
  (status, log) => failedInvariant
    ? status === 12 && log.includes(`Invariant ${failedInvariant} is violated.`) && log.includes('The behavior up to this point is:')
    : status === 0 && log.includes('Model checking completed. No error has been found.') && /0 states left on queue/.test(log));
}
console.log(`Artifacts: ${output}`);
tlc('current');
tlc('mutant-abort-unlocks', { mutant: 'AbortUnlock', invariant: 'NoNewIntentWhileApplicable' });
tlc('mutant-admission-uncertain', { mutant: 'AdmissionUncertain', invariant: 'AdmissionIsNotUncertain' });
tlc('mutant-owner-blind-remove', { mutant: 'OwnerBlindRemove', invariant: 'OldOwnerPreservesMarker' });
for (const witness of ['NoRegisteredWitness', 'NoRejectedWitness', 'NoAdmissionWitness', 'NoSameVersionWitness', 'NoRecoveryWitness', 'NoReplacementWitness']) {
  tlc(`reach-${witness}`, { witness });
}
const data = path.join(output, 'synthetic-data');
fs.mkdirSync(data);
const testEnv = { MEDIFLOW_DATA_DIR: data };
run('code-current', process.execPath, ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap',
  'lib/therapy-status-confirmation.test.ts', 'lib/therapy-required-audit.test.ts'],
(status, log) => status === 0 && /# fail 0/.test(log), testEnv);
const source = fs.readFileSync(path.join(root, 'lib/therapy-status-confirmation.ts'), 'utf8');
const tests = fs.readFileSync(path.join(root, 'lib/therapy-status-confirmation.test.ts'), 'utf8');
const scratch = path.join(output, 'code-mutants');
fs.mkdirSync(scratch);
const guard = path.join(root, 'lib/locked-field-guard.ts');
for (const [name, before, after, testName, diagnostic] of [
  ['abort', 'const resolved = item.version! > command.version', 'const resolved = item.version! >= command.version', 'client abort before server commit keeps same-version readback unresolved', /reviewed[\s\S]*uncertain/],
  ['admission', "publish({ phase: 'unavailable', reason: 'admission', patientLabel: context.patientLabel, newAttemptNotSent: true });", "publish({ ...context, command, phase: 'uncertain', conflict: false });", 'P2 admission failure', /uncertain[\s\S]*unavailable/],
]) {
  if (!source.includes(before)) throw new Error(`Code mutant ${name} no longer maps to the implementation`);
  fs.writeFileSync(path.join(scratch, `${name}.ts`), source.replaceAll(before, after).replace("'./locked-field-guard'", JSON.stringify(guard)));
  const file = path.join(scratch, `${name}.test.ts`);
  fs.writeFileSync(file, tests.replace("'./therapy-status-confirmation'", JSON.stringify(path.join(scratch, `${name}.ts`))));
  run(`code-mutant-${name}`, process.execPath, ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', '--test-name-pattern', testName, file],
    (status, log) => status === 1 && log.includes('ERR_ASSERTION') && diagnostic.test(log), testEnv);
}
run('code-restored', process.execPath, ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', 'lib/therapy-status-confirmation.test.ts'],
  (status, log) => status === 0 && /# fail 0/.test(log), testEnv);
console.log(`Verified finite model, witnesses, negative controls and real controller/HTTP tests. Logs: ${output}`);
