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
    await previous?.broker.owner.close();
  }
  return Object.freeze({
    async prepare(view) {
      const retired = retire();
      const epoch = generation;
      await retired;
      if (epoch !== generation) return fail();
      const broker = createSyntheticCardBroker(installation);
      const attempt = { view, broker, token: undefined, digest: undefined, expires: Date.now() + 120_000, used: false };
      active = attempt;
      try {
        await broker.owner.selectPatient('basic');
        const token = await broker.owner.prepare(selection);
        const review = broker.owner.review(token);
        if (active !== attempt || epoch !== generation || Date.now() >= attempt.expires) return fail();
        attempt.token = token; attempt.digest = review.payloadSha256;
      } catch { await broker.owner.close(); if (active === attempt) active = undefined; return fail(); }
    },
    share(view) {
      const attempt = active;
      if (!attempt || attempt.view !== view || !attempt.token || !attempt.digest || attempt.used || Date.now() >= attempt.expires) return fail();
      attempt.used = true;
      const consent = attempt.broker.owner.approve(attempt.token, attempt.digest);
      return attempt.broker.reader.takeApprovedBytes(attempt.token, consent);
    },
    async revoke(view) {
      if (active?.view === view) await retire();
    },
    close: retire,
  });
}
