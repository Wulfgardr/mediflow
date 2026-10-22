import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFixtureService } from '../src/fixture-service.mjs';
import { readFile, mkdir, mkdtemp, copyFile, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { createDemoServer, TOOL, URI } = await import(process.env.DEMO_TEST_SERVER_MODULE ?? '../src/server.mjs');
const sentinel = 'SYNTHETIC_L_11111111-2222-3333-4444-555555555555';
export function noSentinel(value) { assert.equal(JSON.stringify(value).includes(sentinel), false, 'sentinel in observable channel'); }

test('MCP boundary: strict empty tool, constant receipt, MIME, no data in observable output or errors', async () => {
  const observed = [];
  const fixture = await createFixtureService({ sentinel, observe: event => observed.push(event) });
  const { server } = await createDemoServer(fixture);
  const client = new Client({ name: 'demo-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const messages = [];
  const send = st.send.bind(st);
  st.send = async (...args) => { messages.push(args[0]); return send(...args); };
  try {
    await server.connect(st); await client.connect(ct);
    const catalog = await client.listTools();
    assert.equal(catalog.tools.length, 1);
    const tool = catalog.tools[0];
    assert.equal(tool.name, TOOL);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.equal(tool._meta.ui['resourceUri'], URI);
    assert.equal(tool.annotations.readOnlyHint, true);
    const args = /** @type {Record<string, unknown>} */ ({});
    noSentinel(args);
    const result = await client.callTool({ name: TOOL, arguments: args });
    noSentinel(result);
    assert.deepEqual(result, { content: [{ type: 'text', text: '{"status":"demo_view_ready"}' }] });
    assert.deepEqual(await client.callTool({ name: TOOL, arguments: {} }), result);
    for (const name of [TOOL, 'write_patient', sentinel]) {
      const rejected = await client.callTool({ name, arguments: { patientId: sentinel, url: sentinel, text: sentinel } });
      assert.equal(rejected.isError, true); noSentinel(rejected);
    }
    const resource = await client.readResource({ uri: URI });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource.contents[0]._meta.ui['csp'], { connectDomains: [fixture.endpoint], resourceDomains: [] });
    assert.match(resource.contents[0]['text'], /Elena Vela/);
    assert.equal(resource.contents[0]['text'].includes('__DEMO_CONNECTION__'), false);
    try { await client.readResource({ uri: sentinel }); assert.fail('must reject'); }
    catch (error) { noSentinel(error.message); }
    noSentinel(resource); noSentinel(messages); noSentinel(observed);
    noSentinel(await readFile(new URL('../dist/app.html', import.meta.url), 'utf8'));
  } finally { await client.close(); await server.close(); await fixture.close(); }
});

test('stdio emits no diagnostics or sentinel and closes its fixture listener with the client', async () => {
  const local = new URL('../.local/', import.meta.url);
  await mkdir(local, { recursive: true });
  const isolated = await mkdtemp(path.join(fileURLToPath(local), 'stdio-test-'));
  await mkdir(path.join(isolated, 'src')); await mkdir(path.join(isolated, 'dist'));
  for (const file of ['stdio.mjs', 'server.mjs', 'fixture-service.mjs']) {
    await copyFile(new URL(`../src/${file}`, import.meta.url), path.join(isolated, 'src', file));
  }
  await copyFile(new URL('../dist/app.html', import.meta.url), path.join(isolated, 'dist/app.html'));
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(isolated, 'node_modules'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(isolated, 'src/stdio.mjs')], stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'stdio-demo-test', version: '1' });
  let endpoint;
  try {
    await client.connect(transport);
    noSentinel(await client.callTool({ name: TOOL, arguments: {} }));
    noSentinel(await client.callTool({ name: TOOL, arguments: { patientId: sentinel } }));
    const resource = await client.readResource({ uri: URI });
    noSentinel(resource);
    endpoint = JSON.parse(resource.contents[0]['text'].match(/<script id="demo-connection" type="application\/json">(.*?)<\/script>/s)[1]).endpoint;
    assert.equal((await fetch(`${endpoint}/health`, { headers: { Origin: 'https://not-admitted.example' } })).status, 403);
  } finally { await client.close(); await rm(isolated, { recursive: true, force: true }); }
  assert.equal(stderr, ''); noSentinel(stderr);
  await assert.rejects(fetch(`${endpoint}/health`));
});
