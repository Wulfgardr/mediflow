import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import corpus from '../../../scripts/fixtures/chat-card-corpus.json' with { type: 'json' };
import { createCardServer, CARD_TOOL, CARD_URI, CARD_DENIED } from '../src/card-server.mjs';
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
    await run(client, frames, transport);
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
const bindings = new Map(), nonces = new Map();
const proof = (view, nonce) => createHmac('sha256', Buffer.from(bindings.get(view), 'hex')).update(nonce ?? '').digest('hex');
async function open(client) {
  const resource = await client.readResource({ uri: CARD_URI });
  const bootstrap = resource.contents[0].text.match(/\{"view":"[^"]+","gestureKey":"[^"]+"\}/);
  const binding = bootstrap ? JSON.parse(bootstrap[0]) : { view: randomUUID(), gestureKey: undefined };
  if (binding.gestureKey) bindings.set(binding.view, binding.gestureKey);
  return { ...binding, resource };
}
async function call(client, operation, view) {
  const result = await client.callTool({ name: CARD_TOOL, arguments: { operation, view,
    ...(operation === 'share' && bindings.has(view) ? { nonce: nonces.get(view), gestureProof: proof(view, nonces.get(view)) } : {}) } });
  if (operation === 'prepare') nonces.set(view, result._meta?.consentNonce);
  return result;
}
test('real stdio: model-visible opener and app-only sharing; data-free resource; only approved broker bytes; following turn', async () => {
  let pseudonym;
  await protocol([], async client => {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 2);
    const opener = tools.tools.find(tool => tool.name === 'mediflow_synthetic_card_open');
    assert.deepEqual(opener._meta.ui.visibility, ['model']);
    assert.equal(opener._meta.ui.resourceUri, CARD_URI);
    assert.deepEqual(tools.tools.find(tool => tool.name === CARD_TOOL)._meta.ui.visibility, ['app']);
    const opened = await client.callTool({ name: opener.name, arguments: {} });
    assert.deepEqual(opened, { content: [{ type: 'text', text: 'Apri la vista per scegliere se condividere la scheda sintetica.' }] });
    assert.equal((await client.callTool({ name: opener.name, arguments: { operation: 'share' } })).isError, true);
    const { resource, view } = await open(client);
    const html = resource.contents[0].text;
    for (const value of ['Elena', 'Serena', 'metformina', 'card_', 'src_', '__DEMO_CONNECTION__']) assert.equal(html.includes(value), false, value);
    assert.doesNotMatch(html, /\{\{MF_PII_[a-f0-9]{32}_\d+\}\}/);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
    assert.equal((await call(client, 'share', view)).isError, true);
    assert.equal((await call(client, 'prepare', view)).structuredContent, undefined);
    assert.equal((await call(client, 'share', randomUUID())).isError, true);
    const result = await call(client, 'share', view);
    assert.equal(result.isError, undefined);
    const card = result.structuredContent;
    pseudonym = card.pseudonym;
    assert.equal(result.content[0].text, 'Scheda sintetica condivisa nella vista.');
    assert.deepEqual(result.structuredContent, card);
    assert.equal(result._meta.approvedPayload, JSON.stringify(card), 'the broker serialization is retained verbatim for context delivery');
    assert.deepEqual(Object.keys(result).sort(), ['_meta', 'content', 'structuredContent']);
    assert.equal(card.history[0].condition, 'diabete mellito tipo 2');
    assert.deepEqual(card.therapies.map(t => [t.medicine, t.dose]), [['metformina', '500 mg'], ['paracetamolo', '1000 mg']]);
    assert.match(card.pseudonym, /^card_[a-f0-9]{32}$/);
    assert.equal((await call(client, 'share', view)).isError, true);
    await client.callTool({ name: CARD_TOOL, arguments: {} });
    assert.equal((await call(client, 'share', view)).isError, true);
    await assert.rejects(client.readResource({ uri: CARD_URI }), 'a frame cannot retrieve a second gesture binding');
  });
  await protocol([], async client => {
    const { view, resource } = await open(client);
    await call(client, 'prepare', view);
    const result = await call(client, 'share', view);
    assert.ok(result.structuredContent);
    assert.notEqual(result.structuredContent.pseudonym, pseudonym);
    assert.equal(JSON.stringify(result).includes(pseudonym), false);
    assert.equal(JSON.stringify(resource).includes(pseudonym), false);
  });
});
/** @type {Array<[string, string[]]>} */
const negativeCases = [['identifying fixture sentinel blocks every channel', ['--poison']], ['expired consent yields no bytes', ['--expired']]];
for (const [name, flags] of negativeCases) {
  test(name, async () => protocol(flags, async (client, frames) => {
    const { view } = await open(client); await call(client, 'prepare', view);
    const result = await call(client, 'share', view);
    assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: CARD_DENIED }] });
    assert.equal(JSON.stringify(frames).includes('metformina'), false);
  }));
}
test('denied consent, revocation during preparation, late answer, next view', async () => protocol(['--slow'], async (client, frames) => {
  const { view } = await open(client);
  const pending = call(client, 'prepare', view);
  await new Promise(resolve => setTimeout(resolve, 75));
  await call(client, 'revoke', view);
  assert.equal((await pending).isError, true);
  assert.equal((await call(client, 'share', view)).isError, true);
  await call(client, 'prepare', view); await call(client, 'revoke', view);
  assert.equal((await call(client, 'share', view)).isError, true);
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

test('Astra P1: same stdin write prepare/revoke invalidates the pending epoch', async () => protocol([], async (client, frames, transport) => {
  const { view } = await open(client);
  const original = transport.send;
  const batch = [];
  transport.send = async frame => {
    if (frame.method !== 'tools/call' || !['prepare', 'revoke'].includes(frame.params.arguments?.operation)) return original(frame);
    frames.push(structuredClone(frame)); batch.push(frame);
    if (batch.length === 2) transport['_process'].stdin.write(batch.map(item => JSON.stringify(item) + '\n').join(''));
  };
  const preparing = call(client, 'prepare', view);
  const revoking = call(client, 'revoke', view);
  const [prepared, revoked] = await Promise.all([preparing, revoking]);
  assert.equal(revoked.isError, undefined);
  assert.equal(prepared.isError, true, 'a preparation superseded by a confirmed revocation must fail');
  assert.equal((await call(client, 'share', view)).isError, true);
  assert.equal(frames.some(frame => frame.result?.structuredContent), false);
}));

test('nonce is short-lived, bound to the current attempt and consumed once; messages cannot mint the gesture binding', async () => protocol([], async client => {
  const { view } = await open(client);
  const first = await call(client, 'prepare', view);
  const staleNonce = first._meta.consentNonce;
  const staleProof = proof(view, staleNonce);
  const forged = args => client.callTool({ name: CARD_TOOL, arguments: { operation: 'share', view, ...args } });
  assert.equal((await forged({ nonce: staleNonce })).isError, true);
  assert.equal((await forged({ nonce: staleNonce, gestureProof: '0'.repeat(64) })).isError, true);
  const second = await call(client, 'prepare', view);
  assert.notEqual(second._meta.consentNonce, staleNonce);
  assert.equal((await forged({ nonce: staleNonce, gestureProof: staleProof })).isError, true);
  assert.equal((await call(client, 'share', view)).isError, undefined);
  assert.equal((await call(client, 'share', view)).isError, true);
  const observedProof = proof(view, second._meta.consentNonce);
  const third = await call(client, 'prepare', view);
  assert.equal((await forged({ nonce: third._meta.consentNonce, gestureProof: observedProof })).isError, true, 'an observed signature cannot approve a later preparation');
  assert.equal((await call(client, 'share', view)).isError, undefined);
  await assert.rejects(client.readResource({ uri: CARD_URI }));
}));

test('adapter preserves approved serialization bytes, including whitespace and Unicode, for model context', async () => {
  const payload = '{ "pseudonym": "synthetic", "note": "è già approvato" }\n';
  const nonce = 'a'.repeat(64);
  const owner = { async close() {}, async revoke() {}, async prepare() { return nonce; }, share() { return payload; } };
  const { server } = await createCardServer(owner);
  const client = new Client({ name: 'exact-serialization-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { view } = await open(client);
    await call(client, 'prepare', view);
    const result = await call(client, 'share', view);
    assert.equal(result._meta.approvedPayload, payload);
    assert.deepEqual(result.structuredContent, JSON.parse(payload));
    assert.notEqual(result._meta.approvedPayload, JSON.stringify(result.structuredContent));
  } finally { await client.close(); await server.close(); }
});
