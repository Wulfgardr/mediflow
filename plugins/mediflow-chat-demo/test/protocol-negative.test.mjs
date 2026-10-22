import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const local = new URL('.local/', root);
await mkdir(local, { recursive: true });
const evidence = await mkdtemp(path.join(fileURLToPath(local), 'protocol-negative-'));
const original = Object.fromEntries(await Promise.all(['server.mjs', 'fixture-service.mjs', 'stdio.mjs']
  .map(async file => [file, await readFile(new URL(`src/${file}`, root), 'utf8')])));
const controls = [
  { name: 'accepted-unknown-uri', pattern: 'MCP boundary', expected: 'unknown UI URI must be rejected',
    changes: { 'server.mjs': [["    if (request.params.uri !== URI) throw new McpError(ErrorCode.InvalidParams, 'Demo resource unavailable.');", '']] } },
  { name: 'child-sentinel-in-result', pattern: 'stdio emits', expected: 'child sentinel in protocol messages',
    changes: { 'server.mjs': [['? receipt() : denied()', '? { ...receipt(), _meta: { leaked: sentinel } } : denied()']] } },
  { name: 'child-sentinel-in-error', pattern: 'stdio emits', expected: 'child sentinel in protocol messages',
    changes: { 'server.mjs': [["ErrorCode.InvalidParams, 'Demo resource unavailable.'", 'ErrorCode.InvalidParams, sentinel']] } },
  { name: 'child-sentinel-in-notification', pattern: 'stdio emits', expected: 'child sentinel in protocol messages',
    changes: { 'server.mjs': [['    const args = request.params.arguments;',
      "    await server.server.transport.send({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: sentinel } });\n    const args = request.params.arguments;"]] } },
  { name: 'child-sentinel-in-stderr', pattern: 'stdio emits', expected: 'child sentinel in stderr',
    changes: { 'stdio.mjs': [['  ({ server } = await createDemoServer(fixture));',
      '  process.stderr.write(fixture.sentinel);\n  ({ server } = await createDemoServer(fixture));']] } },
];

for (const control of controls) {
  test(`negative control: ${control.name}`, async () => {
    const record = path.join(evidence, control.name);
    const sandbox = path.join(record, 'sandbox');
    await mkdir(path.join(sandbox, 'src'), { recursive: true });
    await mkdir(path.join(sandbox, 'test')); await mkdir(path.join(sandbox, 'dist'));
    try {
      const changes = { ...control.changes };
      if (control.pattern === 'stdio emits') {
        changes['fixture-service.mjs'] = [['return { endpoint, serviceId, async close()', 'return { endpoint, serviceId, sentinel, async close()']];
        changes['server.mjs'] = [['createDemoServer({ endpoint, serviceId })', 'createDemoServer({ endpoint, serviceId, sentinel })'],
          ...(changes['server.mjs'] ?? [])];
      }
      for (const [file, source] of Object.entries(original)) {
        let mutated = source;
        for (const [before, after] of changes[file] ?? []) {
          assert.equal(mutated.split(before).length, 2, `mutation must have one target: ${control.name}/${file}`);
          mutated = mutated.replace(before, after);
        }
        await writeFile(path.join(record, `original-${file}`), source);
        await writeFile(path.join(record, `mutant-${file}`), mutated);
        await writeFile(path.join(sandbox, 'src', file), mutated);
      }
      await copyFile(new URL('test/protocol.test.mjs', root), path.join(record, 'protocol.test.mjs'));
      await copyFile(new URL('test/protocol.test.mjs', root), path.join(sandbox, 'test/protocol.test.mjs'));
      await copyFile(new URL('dist/app.html', root), path.join(sandbox, 'dist/app.html'));
      await symlink(fileURLToPath(new URL('node_modules', root)), path.join(sandbox, 'node_modules'));
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT; delete env.DEMO_TEST_SERVER_MODULE;
      const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${control.pattern}`, 'test/protocol.test.mjs'], {
        cwd: sandbox, env, encoding: 'utf8', timeout: 15_000 });
      await writeFile(path.join(record, 'stdout.log'), result.stdout ?? '');
      await writeFile(path.join(record, 'stderr.log'), result.stderr ?? '');
      await writeFile(path.join(record, 'result.json'), JSON.stringify({
        command: [process.execPath, '--test', `--test-name-pattern=${control.pattern}`, 'test/protocol.test.mjs'],
        status: result.status, signal: result.signal, error: result.error?.message,
        expectedFailure: control.expected,
      }, null, 2) + '\n');
      assert.equal(result.error, undefined, 'negative control must complete without timeout or spawn errors');
      assert.equal(result.status, 1, 'mutated implementation must fail');
      assert.equal(result.stdout.includes(control.expected), true, 'must fail the targeted assertion');
      assert.match(result.stdout, /tests 1\b/);
      assert.match(result.stdout, /fail 1\b/);
    } finally { await rm(sandbox, { recursive: true, force: true }); }
  });
}
