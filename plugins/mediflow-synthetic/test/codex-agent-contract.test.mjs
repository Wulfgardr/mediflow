import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { examples, viewModel } from '../src/fixture.mjs';
import { createAgentVerifier as createVerifier, pluginId, tools, verifyInventory } from '../scripts/codex-agent-contract.mjs';

function createAgentVerifier() {
  const verifier = createVerifier('thread-synthetic');
  return { ...verifier, observe(method, params) {
    verifier.observe(method, { threadId: 'thread-synthetic', turnId: 'turn-synthetic', ...params,
      ...(params.turn ? { turn: { id: 'turn-synthetic', ...params.turn } } : {}) });
  } };
}

const content = [{ type: 'text', text: 'Only invented examples. No clinical data or writes.\n'
  + examples.map((example) => `${example.title}: ${example.excerpt}`).join('\n') }];
function item(tool = tools[0]) {
  return { id: tool, type: 'mcpToolCall', server: 'mediflow-synthetic', pluginId,
    tool, status: 'completed', arguments: {}, error: null, mcpAppUi: null,
    result: { content: structuredClone(content), structuredContent: viewModel(tool === tools[0] ? 'examples' : 'review'), _meta: null } };
}
function observeCall(verifier, call) {
  verifier.observe('item/started', { item: { ...call, status: 'inProgress', result: null } });
  verifier.observe('item/completed', { item: call });
}
const finishTurn = (verifier, status = 'completed') => verifier.observe('turn/completed', { turn: { status } });

test('actual matched agent calls verify exact text and structured fixed fixtures', () => {
  const verifier = createAgentVerifier();
  for (const tool of tools) observeCall(verifier, item(tool));
  finishTurn(verifier);
  const result = verifier.finish();
  assert.deepEqual(result.map((call) => call.view), ['examples', 'review']);
  assert.ok(result.every((call) => /^[a-f0-9]{64}$/.test(call.applicationPayloadSha256)));
  assert.ok(result.every((call) => call.uiResourceCaptured === false));
  assert.ok(!JSON.stringify(result).includes(examples[0].excerpt));
});

test('generic model prose and manually obtained results cannot substitute for agent calls', () => {
  const verifier = createAgentVerifier();
  verifier.observe('item/completed', { item: { type: 'agentMessage', text: 'Both tools worked.' } });
  finishTurn(verifier);
  assert.throws(() => verifier.finish());
  assert.throws(() => createAgentVerifier().observe('item/completed', { item: item() }));
});

test('duplicates, unmatched IDs, missing calls and failed turns fail qualification', () => {
  const verifier = createAgentVerifier();
  observeCall(verifier, item());
  assert.throws(() => observeCall(verifier, item()));
  finishTurn(verifier);
  assert.throws(() => verifier.finish());
  const unmatched = createAgentVerifier();
  unmatched.observe('item/started', { item: item() });
  assert.throws(() => unmatched.observe('item/completed', { item: { ...item(), id: 'different' } }));
  for (const status of ['failed', 'interrupted']) {
    const stopped = createAgentVerifier();
    for (const tool of tools) observeCall(stopped, item(tool));
    finishTurn(stopped, status);
    assert.throws(() => stopped.finish());
  }
});

test('wrong plugin, server, arguments, tool or other agent action is rejected', () => {
  for (const change of [{ pluginId: 'other@personal' }, { server: 'production' },
    { arguments: { patientId: 'invented' } }, { tool: 'mediflow.patient.read' },
    { type: 'commandExecution' }, { type: 'dynamicToolCall' }, { type: 'fileChange' }, { type: 'webSearch' }]) {
    assert.throws(() => createAgentVerifier().observe('item/started', { item: { ...item(), ...change } }));
  }
});

test('text/structured mismatch, unexpected metadata, errors and resources are rejected', () => {
  const changes = [
    (call) => { call.result.content[0].text += ' altered'; },
    (call) => { call.result.structuredContent.view = 'review'; },
    (call) => { call.result.structuredContent.extra = 'invented'; },
    (call) => { call.result._meta = { hidden: 'invented' }; },
    (call) => { call.result.isError = true; },
    (call) => { call.result.content.push({ type: 'resource_link', uri: 'file:///invented' }); },
    (call) => { call.status = 'failed'; },
    (call) => { call.error = { message: 'invented' }; },
  ];
  for (const change of changes) {
    const verifier = createAgentVerifier();
    const call = item();
    verifier.observe('item/started', { item: call });
    change(call);
    assert.throws(() => verifier.observe('item/completed', { item: call }));
  }
});

test('results or calls after terminal notification do not revive qualification', () => {
  const verifier = createAgentVerifier();
  verifier.observe('item/started', { item: item() });
  finishTurn(verifier);
  assert.throws(() => verifier.observe('item/completed', { item: item() }));
  assert.throws(() => verifier.observe('item/started', { item: item(tools[1]) }));
  assert.throws(() => finishTurn(verifier));
});

test('wrong thread, turn, response identity and reused/missing call IDs cannot qualify', () => {
  for (const params of [{ threadId: 'other-thread' }, { turnId: null }]) {
    assert.throws(() => createAgentVerifier().observe('item/started', { item: item(), ...params }));
  }
  const verifier = createAgentVerifier();
  observeCall(verifier, item());
  assert.throws(() => verifier.observe('item/started', { item: item(tools[1]), turnId: 'other-turn' }));
  assert.throws(() => verifier.bindTurn('other-turn'));
  assert.throws(() => verifier.observe('item/started', { item: { ...item(tools[1]), id: tools[0] } }));
  assert.throws(() => createAgentVerifier().observe('item/started', { item: { ...item(), id: undefined } }));
});

test('inventory allows only the connected installed synthetic server and exact two tools', () => {
  const server = { name: 'mediflow-synthetic', pluginId, runtimeStatus: 'connected',
    tools: Object.fromEntries(tools.map((tool) => [tool, {}])) };
  verifyInventory([server, { name: 'other', runtimeStatus: 'disabled' }]);
  for (const servers of [[], [server, { name: 'other', runtimeStatus: 'connected' }],
    [{ ...server, pluginId: 'other@personal' }], [{ ...server, runtimeStatus: 'connecting' }],
    [{ ...server, tools: { ...server.tools, unexpected: {} } }]]) {
    assert.throws(() => verifyInventory(servers));
  }
});

test('harness stops on unexpected host permission request without logging payload or writing settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mf-codex-harness-'));
  const fake = join(directory, 'fake-codex');
  const marketplace = join(directory, 'marketplace.json');
  const config = join(directory, 'config.toml');
  try {
    await writeFile(marketplace, '{}');
    await writeFile(config, '# synthetic settings\n');
    await writeFile(fake, `#!/usr/bin/env node
if (process.argv.includes('--version')) console.log('codex-cli test');
else if (process.argv.includes('plugin')) console.log(JSON.stringify({installed:[{pluginId:'${pluginId}',enabled:true}]}));
else {
  process.stdin.once('data', () => console.log(JSON.stringify({id:99,method:'item/permissions/requestApproval',params:{privatePayload:'DO_NOT_PRINT_HOST_PAYLOAD'}})));
  setInterval(() => {}, 1000);
}
`);
    await chmod(fake, 0o755);
    const result = await promisify(execFile)(process.execPath,
      [new URL('../scripts/codex-agent-smoke.mjs', import.meta.url).pathname, '--codex-cli', fake, '--marketplace', marketplace],
      { env: { ...process.env, CODEX_HOME: directory }, timeout: 10_000 }).then(
      () => { throw new Error('Unexpected harness success'); },
      (error) => error,
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /CODEX_SYNTHETIC_SMOKE_FAILED \(initialize\)/);
    assert.ok(!result.stdout.includes('passed'));
    assert.ok(!result.stderr.includes('DO_NOT_PRINT_HOST_PAYLOAD'));
    assert.equal(await readFile(config, 'utf8'), '# synthetic settings\n');
    assert.equal(await readFile(marketplace, 'utf8'), '{}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
