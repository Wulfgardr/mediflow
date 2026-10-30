import './register-strip-types-loader.mjs';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
const { createSyntheticCardBroker } = await import('../lib/chat-card/synthetic-card-broker.ts');

const denied = () => { throw new Error('synthetic_card_denied'); };

/** Private stdio child of GPUI. Never register this process as an MCP server. */
export function createNativeCardOwner(installation) {
  const broker = createSyntheticCardBroker(installation);
  let state = 'new', token, review, reviewedAt;
  let lastTime = Date.now();
  function now() { const time = Date.now(); if (!Number.isFinite(time) || time < lastTime) return denied(); lastTime = time; return time; }
  return Object.freeze({
    async command(input) {
      try {
        now();
        if (!input || Object.keys(input).join(',') !== 'command') return denied();
        if (input.command === 'prepare' && state === 'new') {
          state = 'preparing';
          await broker.owner.selectPatient('basic');
          token = await broker.owner.prepare({ historyLimit: 1, therapyLimit: 2, measureLimit: 2 });
          review = broker.owner.review(token);
          if (state !== 'preparing') return denied();
          reviewedAt = now();
          state = 'review';
          return { payload: review.payload, payloadSha256: review.payloadSha256,
            nativeSource: { ...broker.owner.resolveSource(token, JSON.parse(review.payload).history[0].sourceRef),
              note: broker.owner.recompose(token, JSON.parse(review.payload).history[0].note) } };
        }
        if (input.command === 'consume' && state === 'review' && now() - reviewedAt < 30_000) {
          state = 'consumed';
          const consent = broker.owner.approve(token, review.payloadSha256);
          return { payload: broker.reader.takeApprovedBytes(token, consent) };
        }
        return denied();
      } catch { state = 'closed'; await broker.owner.close(); return denied(); }
    },
    async close() { state = 'closed'; await broker.owner.close(); },
  });
}

async function main() {
  let owner;
  try {
    if (process.versions.node !== '24.18.0' || process.argv.length !== 3) return denied();
    owner = createNativeCardOwner(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.once('SIGTERM', () => { owner.close().then(() => process.exit(0), () => process.exit(1)); });
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (Buffer.byteLength(line) > 128) return denied();
      const result = await owner.command(JSON.parse(line));
      process.stdout.write(JSON.stringify(result) + '\n');
    }
  } catch { process.stdout.write('{"status":"denied"}\n'); process.exitCode = 1; }
  finally { await owner?.close(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
