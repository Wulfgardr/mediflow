const SCHEMA = 'mediflow.local-ui.navigation.v1';
const INTENTS = new Set(['search', 'identity', 'history', 'prescribing']);

export function installLocalUiWebNavigation(channel, origin, open, target = globalThis) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) throw new Error('navigation_unavailable');
  let connected = true;
  const receive = frame => {
    if (!connected || typeof frame !== 'string' || Buffer.byteLength(frame) > 256) return;
    let value;
    try { value = JSON.parse(frame); } catch { return; }
    if (!value || Object.keys(value).sort().join(',') !== 'intent,schemaVersion'
      || value.schemaVersion !== SCHEMA || !INTENTS.has(value.intent)) return;
    const publish = target[Symbol.for(SCHEMA)];
    try {
      if (typeof publish === 'function' && publish(value.intent) === true) return;
      open(`${origin}/plugin-local-ui`);
    } catch { /* navigation has no clinical effect */ }
  };
  const close = () => { connected = false; channel.off('message', receive); channel.off('disconnect', close); };
  channel.on('message', receive); channel.once('disconnect', close);
  channel.send?.('{"schemaVersion":"mediflow.local-ui.ready.v1"}');
  return close;
}
