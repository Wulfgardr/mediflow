import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectNativeDecryptBridgeSelection, NATIVE_DECRYPT_BRIDGE_CONSUMER } from './native-decrypt-bridge-selection.mjs';
const root = path.resolve(import.meta.dirname, '..');
const descriptor = 'lib/chatgpt-product/fixtures/native-client-decrypt-swift-bridge.json';
const bridge = 'lib/chatgpt-product/fixtures/native-client-decrypt-swift-bridge.cjs';

test('cross-language descriptor binds the conditional child without executing Swift or Node bridge', () => {
  const result = collectNativeDecryptBridgeSelection(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.files, [bridge]);
  assert.equal(result.mode, 'child');
  assert.equal(result.binding.consumer, NATIVE_DECRYPT_BRIDGE_CONSUMER);
  assert.equal(result.binding.invocationVerified, true);
  assert.equal(result.binding.conditional, true);
  assert.equal(result.binding.execution, 'NOT_ASSESSED');
});

test('missing descriptor, altered executable/argv/framing and comment-only bindings fail closed', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-bridge-binding-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sources = Object.fromEntries([descriptor, bridge, NATIVE_DECRYPT_BRIDGE_CONSUMER].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const reset = () => { for (const [file, content] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.writeFileSync(path.join(temp, file), content);
  } };
  const mutations = [
    [descriptor, () => null],
    [descriptor, value => value.replace('"nodeMajor": 24', '"nodeMajor": 25')],
    [NATIVE_DECRYPT_BRIDGE_CONSUMER, value => value.replace('?? fallbackExecutable', '?? "/unapproved/node"')],
    [NATIVE_DECRYPT_BRIDGE_CONSUMER, value => value.replace('+ [file.path]', '+ ["other.cjs"]')],
    [NATIVE_DECRYPT_BRIDGE_CONSUMER, value => value.replace('data.append(lineTerminator)', 'data.append(0)')],
    [NATIVE_DECRYPT_BRIDGE_CONSUMER, value => value.replace('try process.run()', '// try process.run()')],
    [NATIVE_DECRYPT_BRIDGE_CONSUMER, value => value.replace('try process.run()', 'let decoy = #"try process.run()"#')],
    [bridge, value => value.replace('run(JSON.parse(line))', '`run(JSON.parse(line))`')],
    [bridge, value => value.replace('run(JSON.parse(line))', '"run(JSON.parse(line))"')],
    [bridge, value => value.replace('input:process.stdin', 'input:process.stderr')],
    [bridge, value => value.replace('line.length<=contract.maxLineBytes', 'true')],
  ];
  for (const [file, change] of mutations) {
    reset(); const altered = change(sources[file]);
    if (altered === null) fs.unlinkSync(path.join(temp, file)); else { assert.notEqual(altered, sources[file]); fs.writeFileSync(path.join(temp, file), altered); }
    const result = collectNativeDecryptBridgeSelection(temp);
    assert.deepEqual(result.files, []); assert.equal(result.errors.length, 1); assert.equal(result.binding, null);
  }
});
