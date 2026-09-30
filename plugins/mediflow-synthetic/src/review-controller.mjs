import { examples } from './fixture.mjs';

// Only explicit UI confirmation reaches the model-context transport.
// No file paths, user-entered excerpts, credentials, patient identifiers or writes.
export function createReviewController(getModelContext) {
  let selected = null;
  let pending = false;
  let inFlight = false;
  let attached = null;
  return Object.freeze({
    select(id) {
      if (inFlight) return false;
      selected = examples.find((example) => example.id === id) ?? null;
      pending = false;
      return selected !== null;
    },
    requestAttachment() {
      pending = selected !== null && !inFlight;
      return pending;
    },
    cancel() { pending = false; },
    async confirm() {
      if (inFlight) return 'busy';
      if (!pending || !selected) return 'cancelled';
      pending = false;
      const target = getModelContext();
      if (!target) return 'unsupported';
      if (attached === selected.id) return 'already_attached';
      const example = selected;
      inFlight = true;
      try {
        const result = await target.update({
          content: [{ type: 'text', text: example.excerpt }],
          structuredContent: { synthetic: true, exampleId: example.id },
        });
        if (!result?.updateId) return 'unconfirmed';
        attached = example.id;
        return 'attached';
      } catch { return 'failed'; }
      finally { inFlight = false; }
    },
  });
}
