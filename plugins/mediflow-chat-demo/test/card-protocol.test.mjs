import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import corpus from '../../../scripts/fixtures/chat-card-corpus.json' with { type: 'json' };
import { CARD_TOOL, CARD_URI, CARD_DENIED } from '../src/card-server.mjs';
const SENTINEL = 'IDENTIFYING_SENTINEL_Serena_Falsa_17_04_1972';
async function protocol(flags, run) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).pathname, new URL('card-stdio-fixture.mjs', import.meta.url).pathname, ...flags], stderr: 'pipe',
    env: { PATH: process.env.PATH, MEDIFLOW_DATA_DIR: process.env.MEDIFLOW_DATA_DIR } });
  const frames = [], errors = [];
  let stderr = '';
  let receive;
  Object.defineProperty(transport, 'onmessage', { get: () => receive, set(handler) { receive = frame => { frames.push(structuredClone(frame)); handler?.(frame); }; } });
  const send = transport.send.bind(transport);
  transport.send = async frame => { frames.push(structuredClone(frame)); return send(frame); };
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'synthetic-card-boundary-test', version: '1' });
  client.onerror = error => errors.push(String(error));
  try {
    await client.connect(transport);
    await run(client, frames);
  } finally { await client.close(); }
  const wire = JSON.stringify(frames);
  assert.ok(frames.some(frame => frame.result?.protocolVersion), 'intercept actual inbound frames');
  for (const forbidden of [SENTINEL, ...corpus.flatMap(entry => entry.gold.forbiddenTokens), 'Serena Falsa', 'VLLMRT72D57F205Z', '/synthetic/', 'pythonSha256', 'payloadSha256', 'localSource']) {
    assert.equal(wire.includes(forbidden), false, forbidden);
    assert.equal(stderr.includes(forbidden), false);
    assert.equal(errors.join(' ').includes(forbidden), false);
  }
  assert.equal(stderr, '');
}
const call = (client, operation, view) => client.callTool({ name: CARD_TOOL, arguments: { operation, view } });
test('real stdio: one app-only tool; static resource; only approved broker bytes; following turn', async () => {
  await protocol([], async client => {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 1);
    assert.deepEqual(tools.tools[0]._meta.ui.visibility, ['app']);
    const resource = await client.readResource({ uri: CARD_URI });
    const html = resource.contents[0].text;
    for (const value of ['Elena', 'Serena', 'metformina', 'card_', 'src_', 'MF_PII_', '__DEMO_CONNECTION__']) assert.equal(html.includes(value), false, value);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
    const view = randomUUID();
    assert.equal((await call(client, 'share', view)).isError, true);
    assert.equal((await call(client, 'prepare', view)).structuredContent, undefined);
    assert.equal((await call(client, 'share', randomUUID())).isError, true);
    const result = await call(client, 'share', view);
    assert.equal(result.isError, undefined);
    const card = result.structuredContent;
    assert.equal(result.content[0].text, 'Scheda sintetica condivisa nella vista.');
    assert.deepEqual(result.structuredContent, card);
    assert.deepEqual(Object.keys(result).sort(), ['content', 'structuredContent']);
    assert.equal(card.history[0].condition, 'diabete mellito tipo 2');
    assert.deepEqual(card.therapies.map(t => [t.medicine, t.dose]), [['metformina', '500 mg'], ['paracetamolo', '1000 mg']]);
    assert.match(card.pseudonym, /^card_[a-f0-9]{32}$/);
    assert.equal((await call(client, 'share', view)).isError, true);
    await client.callTool({ name: CARD_TOOL, arguments: {} });
    assert.equal((await call(client, 'share', view)).isError, true);
    const next = randomUUID(); await call(client, 'prepare', next);
    const second = await call(client, 'share', next);
    assert.notEqual(second.structuredContent.pseudonym, card.pseudonym);
    assert.equal(JSON.stringify(second).includes(card.pseudonym), false);
    assert.equal(JSON.stringify(await client.readResource({ uri: CARD_URI })).includes(card.pseudonym), false);
  });
});
/** @type {Array<[string, string[]]>} */
const negativeCases = [['identifying fixture sentinel blocks every channel', ['--poison']], ['expired consent yields no bytes', ['--expired']]];
for (const [name, flags] of negativeCases) {
  test(name, async () => protocol(flags, async (client, frames) => {
    const view = randomUUID(); await call(client, 'prepare', view);
    const result = await call(client, 'share', view);
    assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: CARD_DENIED }] });
    assert.equal(JSON.stringify(frames).includes('metformina'), false);
  }));
}
test('denied consent, revocation during preparation, late answer, next view', async () => protocol(['--slow'], async (client, frames) => {
  const view = randomUUID();
  const pending = call(client, 'prepare', view);
  await new Promise(resolve => setTimeout(resolve, 75));
  await call(client, 'revoke', view);
  assert.equal((await pending).isError, true);
  assert.equal((await call(client, 'share', view)).isError, true);
  const next = randomUUID(); await call(client, 'prepare', next); await call(client, 'revoke', next);
  assert.equal((await call(client, 'share', next)).isError, true);
  assert.equal(JSON.stringify(frames).includes('metformina'), false);
}));
test('fixed failures do not echo rejected names or arguments', async () => protocol([], async client => {
  const result = await client.callTool({ name: 'not-a-tool', arguments: { identity: 'rejected' } });
  assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: CARD_DENIED }] });
  const bad = await client.callTool({ name: CARD_TOOL, arguments: { operation: 'share', view: 'not-a-uuid', patient: 'rejected' } });
  assert.deepEqual(bad, result);
  await assert.rejects(client.request({ method: 'unrecognized' }, EmptyResultSchema), error => error instanceof Error && error.message.endsWith(CARD_DENIED));
  await assert.rejects(client.readResource({ uri: 'ui://unknown' }), error => error instanceof Error && error.message.endsWith(CARD_DENIED));
}));
