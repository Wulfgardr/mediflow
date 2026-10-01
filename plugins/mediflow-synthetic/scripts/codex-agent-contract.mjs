import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { examples, viewModel } from '../src/fixture.mjs';

export const pluginId = 'mediflow-synthetic@personal';
export const tools = ['mediflow.synthetic.examples', 'mediflow.synthetic.review'];
export const mention = { type: 'mention', name: 'mediflow-synthetic', path: `plugin://${pluginId}` };
const text = 'Only invented examples. No clinical data or writes.\n'
  + examples.map((example) => `${example.title}: ${example.excerpt}`).join('\n');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Verification only: this module supplies no policy, consent or clinical authority.
export function verifyInventory(servers) {
  const active = servers.filter((server) => server.runtimeStatus !== 'disabled');
  assert.equal(active.length, 1, 'Unexpected active MCP inventory');
  const server = active[0];
  assert.equal(server.name, 'mediflow-synthetic');
  assert.equal(server.pluginId, pluginId);
  assert.equal(server.runtimeStatus, 'connected');
  assert.deepEqual(Object.keys(server.tools).sort(), tools);
}

export function createAgentVerifier(threadId) {
  assert.ok(typeof threadId === 'string' && threadId.length);
  const started = new Map();
  const completed = new Map();
  let turnStatus;
  let observedTurnId;
  return {
    observe(method, params) {
      if (!['turn/completed', 'item/started', 'item/completed'].includes(method)) return;
      assert.equal(params.threadId, threadId, 'Unexpected thread');
      const turnId = method === 'turn/completed' ? params.turn.id : params.turnId;
      assert.ok(typeof turnId === 'string' && turnId.length, 'Missing turn identity');
      observedTurnId ??= turnId;
      assert.equal(turnId, observedTurnId, 'Unexpected turn');
      if (method === 'turn/completed') {
        assert.equal(turnStatus, undefined, 'Duplicate turn completion');
        turnStatus = params.turn.status;
        return;
      }
      if (!['item/started', 'item/completed'].includes(method)) return;
      const item = params.item;
      if (['userMessage', 'agentMessage', 'reasoning'].includes(item.type)) return;
      assert.equal(item.type, 'mcpToolCall', 'Unexpected agent action');
      assert.ok(typeof item.id === 'string' && item.id.length, 'Missing call identity');
      assert.equal(item.server, 'mediflow-synthetic');
      assert.equal(item.pluginId, pluginId);
      assert.ok(tools.includes(item.tool), 'Unexpected tool');
      assert.deepEqual(item.arguments, {});
      if (method === 'item/started') {
        assert.equal(turnStatus, undefined, 'Call after completed turn');
        assert.ok(!started.has(item.tool), 'Repeated tool start');
        assert.ok(![...started.values()].includes(item.id), 'Repeated call identity');
        started.set(item.tool, item.id);
        return;
      }
      assert.equal(turnStatus, undefined, 'Result after completed turn');
      assert.equal(started.get(item.tool), item.id, 'Unmatched tool result');
      assert.ok(!completed.has(item.tool), 'Repeated tool result');
      assert.equal(item.status, 'completed');
      assert.ok(item.error == null, 'Tool error');
      const result = item.result;
      assert.ok(result && Object.keys(result).every((key) => ['content', 'structuredContent', '_meta'].includes(key)));
      assert.ok(result._meta == null, 'Unexpected result metadata');
      assert.deepEqual(result.content, [{ type: 'text', text }]);
      const view = item.tool === tools[0] ? 'examples' : 'review';
      assert.deepEqual(result.structuredContent, viewModel(view));
      completed.set(item.tool, { tool: item.tool, arguments: {}, view,
        applicationPayloadSha256: sha256(JSON.stringify({ content: result.content, structuredContent: result.structuredContent })),
        uiResourceCaptured: item.mcpAppUi != null });
    },
    bindTurn(turnId) { assert.equal(turnId, observedTurnId, 'Turn/start response mismatch'); },
    finish() {
      assert.equal(turnStatus, 'completed', 'Turn did not complete successfully');
      assert.deepEqual([...started.keys()].sort(), tools);
      assert.deepEqual([...completed.keys()].sort(), tools, 'Missing actual agent tool calls');
      return tools.map((tool) => completed.get(tool));
    },
  };
}
