import { readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const mutation = new URL('../src/.falsified.mjs', import.meta.url);
try {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const changed = source.replace('{"status":"demo_view_ready"}', '{"status":"demo_view_ready","injected":"SYNTHETIC_L_11111111-2222-3333-4444-555555555555"}');
  assert.notEqual(changed, source, 'Mutation not applied');
  await writeFile(mutation, changed);
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=MCP boundary', 'test/protocol.test.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, DEMO_TEST_SERVER_MODULE: mutation.href }, timeout: 15_000 });
  assert.equal(result.status, 1, 'Mutation must fail the boundary test');
  assert.equal(result.stdout.includes('sentinel in observable channel'), true, 'Mutation must fail for disclosure');
  console.log('PASS: the actual tool-result mutation fails the boundary test. Mutation output withheld.');
} finally { await unlink(mutation).catch(() => {}); }
