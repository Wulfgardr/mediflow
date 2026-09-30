import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSyntheticServer } from '../src/server.mjs';

test('plain MCP host lists global/thread tools and gets stable text fallback', async () => {
  const { server } = await createSyntheticServer();
  const client = new Client({ name: 'plain-test-host', version: '1' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 2);
    assert.deepEqual(tools.map((tool) => tool._meta['openai/ui'].entrypoints[0].type), ['global', 'thread']);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      const first = await client.callTool({ name: tool.name, arguments: {} });
      assert.equal(first.isError, undefined);
      assert.equal(first.structuredContent.synthetic, true);
      assert.equal(first.structuredContent.clinicalDataAccess, false);
      assert.equal(first.structuredContent.writesPerformed, 0);
      assert.match(first.content[0].text, /ESEMPIO INVENTATO/);
      assert.deepEqual(await client.callTool({ name: tool.name, arguments: {} }), first);
      const denied = await client.callTool({ name: tool.name, arguments: { patientId: 'forbidden' } });
      assert.equal(denied.isError, true);
    }
    const resource = await client.readResource({ uri: 'ui://mediflow-synthetic/review' });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource.contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
    assert.match(resource.contents[0].text, /Conferma aggiunta/);
    assert.equal(resource.contents[0].text.includes('<!-- APP_SCRIPT -->'), false);
  } finally { await client.close(); await server.close(); }
});

test('real stdio process ignores clinical paths, performs no persistent writes or diagnostic data logging', async () => {
  const trap = await mkdtemp(path.join(os.tmpdir(), 'mediflow-plugin-trap-'));
  const sentinel = 'NOT_A_DATABASE__SYNTHETIC_TEST_SENTINEL';
  await writeFile(path.join(trap, 'medical.db'), sentinel);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [new URL('../src/stdio.mjs', import.meta.url).pathname], cwd: trap,
    env: { MEDIFLOW_DATA_DIR: trap, MEDIFLOW_AIP_PARENT: 'must-not-be-used' }, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const client = new Client({ name: 'stdio-test', version: '1' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'mediflow.synthetic.review', arguments: {} });
    assert.equal(result.structuredContent.apply, 'none');
    assert.equal(result.structuredContent.synthetic, true);
    assert.deepEqual(await readdir(trap), ['medical.db']);
    assert.equal(await readFile(path.join(trap, 'medical.db'), 'utf8'), sentinel);
  } finally {
    await client.close();
    await rm(trap, { recursive: true, force: true });
  }
  assert.equal(diagnostics, '');
});
