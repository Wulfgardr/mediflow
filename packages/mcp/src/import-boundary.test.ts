/* @Codex */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const roots = [
  resolve(root, 'packages/mcp/src/server.ts'), resolve(root, 'packages/mini/src/cli.ts'),
  resolve(root, 'scripts/intelligent-host-mcp-stdio.mjs'),
];
const allowedExternal = new Set(['zod', '@modelcontextprotocol/server', '@modelcontextprotocol/server/stdio',
  'node:process', 'node:util']);
const allowedAip = new Set([resolve(root, 'packages/aip/src/operation-rpc.ts'),
  resolve(root, 'packages/aip/src/authenticated-ipc.ts')]);

test('keeps the exact MCP and Mini runtime graph on portable Application Service RPC only', async () => {
  const pending = [...roots]; const visited = new Set<string>(); let combined = '';
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const source = await readFile(path, 'utf8'); combined += `\n${source}`;
    assert.doesNotMatch(source, /\b(?:require|import)\s*\(/u, `dynamic import in ${path}`);
    for (const match of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) {
        assert.equal(allowedExternal.has(specifier), true, `unexpected external import ${specifier} in ${path}`);
        continue;
      }
      const candidate = resolve(dirname(path), specifier);
      const target = extname(candidate) ? candidate : `${candidate}.ts`;
      const insideMcp = target.startsWith(resolve(root, 'packages/mcp/src/'));
      assert.equal(insideMcp || allowedAip.has(target), true, `runtime boundary escape ${target}`);
      pending.push(target);
    }
  }
  assert.doesNotMatch(combined,
    /(?:better-sqlite3|lib\/db|lib\/schema|web-auth|next\/|node:(?:net|http|https|tls)|\.swift|AppKit|Foundation)/iu);
  assert.doesNotMatch(combined, /(?:\bfetch\s*\(|WebSocket|XMLHttpRequest|generic[._ -]?invoke)/iu);
  assert.deepEqual([...visited].sort(), [
    resolve(root, 'packages/aip/src/authenticated-ipc.ts'), resolve(root, 'packages/aip/src/operation-rpc.ts'),
    resolve(root, 'packages/mcp/src/contracts.ts'), resolve(root, 'packages/mcp/src/operation-client.ts'),
    resolve(root, 'packages/mcp/src/server.ts'), resolve(root, 'packages/mini/src/cli.ts'),
    resolve(root, 'scripts/intelligent-host-mcp-stdio.mjs'),
  ].sort());
});
