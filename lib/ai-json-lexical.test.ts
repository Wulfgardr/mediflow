/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { scanJsonObject } from './ai-json-lexical';

test('ranges preserve exact JSON syntax and decoded paths without serializing numbers', () => {
    const input = ' { "a\\u0062" : [ -0, 9007199254740993, "Testo\\n\\\"🙂" ], "nested": {"x":"fine"} } ';
    const result = scanJsonObject(input);
    assert.ok(result);
    assert.ok(Object.isFrozen(result));
    const values = result.filter(item => !item.key);
    assert.deepEqual(values.map(item => item.path), [['ab', 2], ['nested', 'x']]);
    for (const item of result) {
        assert.ok(Object.isFrozen(item)); assert.ok(Object.isFrozen(item.path));
        assert.equal(JSON.parse(input.slice(item.start, item.end)), item.value);
    }
    const first = values[0]!;
    const replaced = input.slice(0, first.start) + JSON.stringify('Nuovo\n"🙂') + input.slice(first.end);
    assert.ok(replaced.includes('-0, 9007199254740993'));
    assert.equal(JSON.parse(replaced).ab[2], 'Nuovo\n"🙂');
});

test('denies duplicate decoded keys, nonfinite numbers and incomplete or multiple objects', () => {
    for (const input of [null, {}, '', '[]', 'null', '{}{}', '{} trailing', '{"a":1,"a":2}', '{"x":1,"\\u0078":2}', '{"a":[{"x":0,"x":1}]}', '{"n":1e999}', '{"n":-1e999}', '{"n":NaN}', '{"a":01}', '{"a":true,}', '{"a":"unfinished}', '{"a":"bad\\x"}', '{"a":"line\nbreak"}']) {
        assert.equal(scanJsonObject(input), null);
    }
    for (const input of ['{}', '{"a":[]}', '{"a":1e308,"b":null,"c":false}', '{"x":1,"nested":{"x":2}}']) assert.notEqual(scanJsonObject(input), null);
});

test('bounds content, nesting and nodes before exposing any partial ranges', () => {
    assert.equal(scanJsonObject(' '.repeat(262_145)), null);
    assert.equal(scanJsonObject('{"a":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}'), null);
    assert.equal(scanJsonObject(JSON.stringify({ a: Array(16_385).fill(0) })), null);
    assert.notEqual(scanJsonObject('{"a":' + '['.repeat(62) + '0' + ']'.repeat(62) + '}'), null);
});
