import { installWebLease } from './local-ui-web-lease.mjs';
import { installWebPairing } from './local-ui-web-pairing.mjs';

const SCHEMA = 'mediflow.local-ui.navigation.v1';
const INTENTS = new Set(['search', 'identity', 'history', 'prescribing']);

export function installLocalUiWebNavigation(channel, origin, open, target = globalThis) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) throw new Error('navigation_unavailable');
  const closeLease = installWebLease(channel, target);
  let connected = true, currentRequestId = null;
  const receive = frame => {
    if (!connected || typeof frame !== 'string' || Buffer.byteLength(frame) > 256) return;
    let value;
    try { value = JSON.parse(frame); } catch { return; }
    if (!value) return;
    const publish = target[Symbol.for(SCHEMA)];
    if (value.schemaVersion === 'mediflow.local-ui.cancel.v1' && Object.keys(value).sort().join(',') === 'requestId,schemaVersion') {
      if (value.requestId === currentRequestId) {
        currentRequestId = null;
        try { if (typeof publish === 'function') publish('reset'); } catch { /* Navigation has no clinical effect. */ }
      }
      return;
    }
    if (Object.keys(value).sort().join(',') !== 'expiresAt,intent,requestId,schemaVersion'
      || value.schemaVersion !== SCHEMA || !INTENTS.has(value.intent)
      || !/^[a-f0-9-]{36}$/u.test(value.requestId) || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 8000) return;
    currentRequestId = value.requestId;
    try {
      if (typeof publish === 'function' && publish(value.intent) === true) return true;
      open(`${origin}/plugin-local-ui`);
      return true;
    } catch { /* navigation has no clinical effect */ }
  };
  const closePairing = installWebPairing(channel, { instance: process.env.MEDIFLOW_LOCAL_UI_INSTANCE,
    dataDir: process.env.MEDIFLOW_DATA_DIR, sourceFingerprint: process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT }, receive, target);
  const close = () => { closeLease(); closePairing(); connected = false; channel.off('message', receive); channel.off('disconnect', close); };
  channel.on('message', receive); channel.once('disconnect', close);
  channel.send?.('{"schemaVersion":"mediflow.local-ui.ready.v1"}');
  return close;
}
