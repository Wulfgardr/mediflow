import { randomBytes } from 'node:crypto';
import { createSyntheticCardBroker } from '../../../lib/chat-card/synthetic-card-broker.ts';

const fail = () => { throw new Error('synthetic_card_denied'); };
const selection = Object.freeze({ historyLimit: 1, therapyLimit: 2, measureLimit: 2 });

/** Synthetic owner only. The adapter never receives reviews, maps or sources. */
export function createCardOwner(installation) {
  let active;
  let generation = 0;
  async function retire() {
    generation++;
    const previous = active;
    active = undefined;
    await previous?.broker?.owner.close();
  }
  return Object.freeze({
    async prepare(view) {
      const retired = retire();
      const epoch = generation;
      const attempt = { view, epoch, broker: undefined, token: undefined, digest: undefined, nonce: undefined, expires: 0, used: false, attemptId: undefined, delivered: false };
      active = attempt;
      try {
        await retired;
        if (active !== attempt || epoch !== generation) return fail();
        const broker = createSyntheticCardBroker(installation);
        attempt.broker = broker;
        await broker.owner.selectPatient('basic');
        const token = await broker.owner.prepare(selection);
        const review = broker.owner.review(token);
        if (active !== attempt || epoch !== generation) return fail();
        attempt.token = token; attempt.digest = review.payloadSha256;
        attempt.nonce = randomBytes(32).toString('hex');
        attempt.expires = Date.now() + 30_000;
        return attempt.nonce;
      } catch { await attempt.broker?.owner.close(); if (active === attempt) active = undefined; return fail(); }
    },
    share(view, nonce) {
      const attempt = active;
      if (!attempt || attempt.view !== view || !attempt.token || !attempt.digest || !nonce || nonce !== attempt.nonce || attempt.epoch !== generation || attempt.used || Date.now() >= attempt.expires) return fail();
      attempt.used = true;
      const consent = attempt.broker.owner.approve(attempt.token, attempt.digest);
      const payload = attempt.broker.reader.takeApprovedBytes(attempt.token, consent);
      if (active !== attempt || attempt.epoch !== generation) return fail();
      attempt.attemptId = randomBytes(32).toString('hex');
      return { payload, attemptId: attempt.attemptId };
    },
    deliver(view, attemptId) {
      const attempt = active;
      if (!attempt || attempt.view !== view || !attemptId || attempt.attemptId !== attemptId || attempt.epoch !== generation || !attempt.used || attempt.delivered || Date.now() >= attempt.expires) return fail();
      attempt.delivered = true;
      return attemptId;
    },
    async revoke(view) {
      await retire();
    },
    close: retire,
  });
}
