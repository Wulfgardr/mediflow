import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
const mutations = [
  ['inline', 'src/card-server.mjs', "export const CARD_OPEN_TOOL = 'mediflow_synthetic_card_open'", "export const CARD_OPEN_TOOL = 'disabled_synthetic_card_open'", 'reference host did not mount'],
  ['delivery', 'src/card-app.mjs', "await app.updateModelContext({ content: [{ type: 'text', text: result._meta.approvedPayload }] }, { signal: delivery.signal });", 'await Promise.resolve();', 'consent sends exactly one context update'],
  ['theme', 'src/app.css', ':root[data-card]', ':root[data-disabled-card]', 'Giorno uses its Lume field'],
  ['placeholders', 'src/card-app.mjs', "String(text).replace(/\\{\\{MF_PII_[^{}]+\\}\\}/gu, '[omesso]')", 'String(text)', 'MF_PII_'],
  ['expiry', 'src/card-app.mjs', 'if (!event.isTrusted || !ready) return;\n    clearTimeout(expiry);', 'if (!event.isTrusted || !ready) return;', 'shared card survives the decision deadline'],
  ['turn-input', 'src/card-app.mjs', 'initializing && !initialInputSeen', '!initialInputSeen', 'Timeout 1500ms'],
  ['turn-result', 'src/card-app.mjs', 'initializing && !initialResultSeen', '!initialResultSeen', 'Timeout 1500ms'],
];
for (const [name, file, before, after, failure] of mutations) {
  const target = new URL(file, root);
  const source = await readFile(target, 'utf8');
  assert.ok(source.includes(before), `${name}: mutation must apply`);
  try {
    await writeFile(target, source.replace(before, after));
    assert.equal(run(['scripts/build.mjs']).status, 0, `${name}: mutated build`);
    const result = run(['scripts/run-reference.mjs', '--card', '--desktop-regressions', `--case=${name}`]);
    assert.equal(result.status, 1, `${name}: removal of fix must fail`);
    assert.ok(result.stdout.includes(failure), `${name}: must fail for the original defect`);
    console.log(`PASS: ${name} regression rejects removal of its fix.`);
  } finally { await writeFile(target, source); }
}
assert.equal(run(['scripts/build.mjs']).status, 0, 'restore original bundle');
const restored = run(['scripts/run-reference.mjs', '--card', '--desktop-regressions']);
assert.equal(restored.status, 0, `restored fixes must pass: ${restored.stdout}\n${restored.stderr}`);
console.log('PASS: restored desktop regressions.');
