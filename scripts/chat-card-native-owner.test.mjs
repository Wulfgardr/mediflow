import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { testInstallation } from '../plugins/mediflow-chat-demo/test/card-runtime.mjs';
import { createNativeCardOwner } from './chat-card-native-owner.mjs';
import corpus from './fixtures/chat-card-corpus.json' with { type: 'json' };

const owners = [];
const make = () => { const owner = createNativeCardOwner(testInstallation()); owners.push(owner); return owner; };
const prepare = owner => owner.command({ command: 'prepare' });
const consume = owner => owner.command({ command: 'consume' });
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.close())); });

test('private native owner prepares exact redacted bytes, restores names only for the native review and emits once', async () => {
  const owner = make(), review = await prepare(owner);
  for (const token of corpus[0].gold.forbiddenTokens) assert.ok(!review.payload.includes(token));
  assert.equal(review.nativeSource.note, corpus[0].inputText);
  assert.equal(JSON.parse(review.payload).therapies[0].medicine, 'metformina');
  assert.equal((await consume(owner)).payload, review.payload);
  await assert.rejects(consume(owner), /synthetic_card_denied/);
});

test('no preparation, forged approval and unknown fields never emit', async () => {
  for (const input of [{ command: 'consume' }, { command: 'prepare', approved: true }, { command: 'prepare', pin: '2468' }, { command: 'recompose' }]) {
    await assert.rejects(make().command(input), /synthetic_card_denied/);
  }
});

test('native review expires at 30 seconds, without renewal by status or a second prepare', async () => {
  const owner = make(); await prepare(owner);
  const realNow = Date.now;
  try {
    const time = realNow() + 30_000;
    Date.now = () => time;
    await assert.rejects(consume(owner), /synthetic_card_denied/);
  } finally { Date.now = realNow; }
  await assert.rejects(prepare(owner), /synthetic_card_denied/);
});

test('revocation and clock rollback retire both bytes and RAM mappings', async () => {
  const owner = make(); await prepare(owner); await owner.close();
  await assert.rejects(consume(owner), /synthetic_card_denied/);
  const second = make(); await prepare(second);
  const realNow = Date.now;
  try { Date.now = () => 0; await assert.rejects(consume(second), /synthetic_card_denied/); }
  finally { Date.now = realNow; }
});

test('refresh or another owner cannot reuse approval or payload references', async () => {
  const first = make(), second = make();
  const a = await prepare(first), b = await prepare(second);
  assert.notEqual(a.payload, b.payload);
  await assert.rejects(second.command({ command: 'consume', payloadSha256: a.payloadSha256 }), /synthetic_card_denied/);
  assert.equal((await consume(first)).payload, a.payload);
});
