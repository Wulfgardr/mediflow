import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const output = mkdtempSync(join(tmpdir(), 'mediflow-chat-therapy-mutations-'));
const root = process.cwd();
const require = createRequire(import.meta.url);
function copy(file, destination, replacements = {}, transform = s => s) {
  const original = readFileSync(resolve(file), 'utf8');
  const text = transform(original).replace(/from (['"])([^.'"\n][^'"\n]*)\1/g, (all, quote, specifier) => specifier.startsWith('node:') || specifier === 'server-only' ? all : 'from ' + quote + require.resolve(specifier) + quote).replace(/(['"])(\.{1,2}\/[^'"\n]+)\1/g, (_, quote, path) => {
    const target = resolve(dirname(resolve(file)), path);
    return quote + (replacements[target] ?? (existsSync(target + '.ts') ? target + '.ts' : target)) + quote;
  });
  writeFileSync(destination, text);
}
for (const name of ['baseline', 'cas', 'threshold', 'view-lifetime', 'single-use', 'restored']) {
  const directory = join(output, name); mkdirSync(directory);
  const native = join(directory, 'native.ts'), common = join(directory, 'common.ts'), writer = join(directory, 'writer.ts'), test = join(directory, 'test.ts'), approvals = join(directory, 'approvals.ts');
  const replacements = { [resolve('lib/native-chat-write-approval')]: approvals, [resolve('lib/native-chat-write-approval.ts')]: approvals, [resolve('lib/chat-therapy-status.ts')]: native, [resolve('lib/therapy-status-command-service')]: common, [resolve('lib/therapy-status-command-service.ts')]: common,
    [resolve('lib/therapy-write-operation')]: writer };
  copy('lib/therapy-write-operation.ts', writer, {}, source => name === 'cas' ? source.replace('if (existing.version !== input.expectedVersion)', 'if (false)').replace('eq(therapies.version, input.expectedVersion)', 'eq(therapies.version, existing.version)') : source);
  copy('lib/therapy-status-command-service.ts', common, replacements);
  copy('lib/native-chat-write-approval.ts', approvals, replacements, source => name === 'threshold' ? source.replaceAll('now() - preview.at >= 30_000', 'false')
    : name === 'view-lifetime' ? source.replaceAll('now() - preview.viewAt >= 300_000', 'false')
    : name === 'single-use' ? source.replace("|| preview.phase !== 'preview'", '').replace('finish: retire', 'finish: () => undefined') : source);
  copy('lib/chat-therapy-status.ts', native, replacements);
  copy('lib/chat-therapy-status.test.ts', test, replacements);
  const run = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', test], { cwd: root,
    env: { ...process.env, MEDIFLOW_DATA_DIR: directory }, encoding: 'utf8' });
  const log = run.stdout + run.stderr; writeFileSync(join(directory, 'result.log'), log);
  const green = ['baseline', 'restored'].includes(name);
  assert.equal(run.status, green ? 0 : 1, `${name}: unexpected result; ${directory}/result.log`);
  if (!green) assert.match(log, /ERR_ASSERTION/, `${name}: expected a causal assertion failure`);
  console.log(`${name}: ${green ? 'PASS' : 'intended assertion failure'}`);
}
console.log(`Full evidence: ${output}`);
