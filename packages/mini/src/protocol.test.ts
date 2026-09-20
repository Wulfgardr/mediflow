/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMiniRequest, serializeMiniResponse } from './protocol.ts';

test('shared serializer preserves nested data without invoking inherited object or array toJSON', () => {
  let calls = 0;
  const toJSON = () => { calls += 1; return 'alternate representation'; };
  const item = Object.assign(Object.create({ toJSON }), { code: 'synthetic', count: 1 });
  const items = [item];
  Object.setPrototypeOf(items, Object.assign(Object.create(Array.prototype), { toJSON }));
  const envelope = Object.assign(Object.create({ toJSON }), { ok: true, result: { items } });
  assert.equal(serializeMiniResponse(envelope), '{"ok":true,"result":{"items":[{"code":"synthetic","count":1}]}}\n');
  assert.equal(calls, 0);
});

test('shared parser keeps UTF-8, duplicate key, input byte budget and exact command guards', () => {
  const encode = (source: string) => Buffer.from(source, 'utf8');
  assert.deepEqual(parseMiniRequest(encode('{"command":"open-loops","args":{}}')),
    { command: 'open-loops', args: {} });
  for (const input of [Buffer.from([0xff]), Buffer.alloc(16 * 1024 + 1, 32),
    encode('{"command":"status","command":"capabilities","args":{}}'),
    encode('{"command":"open-loops","args":{"patientId":"synthetic"}}'),
    encode('{"command":"apply","args":{}}')]) {
    assert.throws(() => parseMiniRequest(input));
  }
});
