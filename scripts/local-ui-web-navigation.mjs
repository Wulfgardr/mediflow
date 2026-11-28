import { localUiNavigationDeadline } from './local-ui-navigation-deadline.mjs';
import { isLocalUiIntent } from '../packages/mcp/src/local-ui-intents.mjs';
import { installWebLease } from './local-ui-web-lease.mjs';
import { installWebPairing } from './local-ui-web-pairing.mjs';

const SCHEMA = 'mediflow.local-ui.navigation.v1';

export function installLocalUiWebNavigation(channel, origin, open, target = globalThis) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) throw new Error('navigation_unavailable');
  const closeLease = installWebLease(channel, target);
  let connected = true, currentRequest = null;
  const publish = (intent, id) => target[Symbol.for(SCHEMA)]?.(intent, id);
  const deliver = (frame, link = 'initial') => {
    if (!connected || typeof frame !== 'string' || Buffer.byteLength(frame) > 256) return;
    let value;
    try { value = JSON.parse(frame); } catch { return; }
    if (!value) return;
    if (value.schemaVersion === 'mediflow.local-ui.client-closed.v1' && Object.keys(value).length === 1 && link === 'initial') {
      if (currentRequest?.link === link) currentRequest = null;
      publish('revoke', link);
      return;
    }
    if (value.schemaVersion === 'mediflow.local-ui.cancel.v1' && Object.keys(value).sort().join(',') === 'requestId,schemaVersion') {
      if (value.requestId === currentRequest?.requestId) {
        currentRequest = null;
        try { publish('reset', value.requestId); } catch {}
      }
      return;
    }
    if (Object.keys(value).sort().join(',') !== 'expiresAt,intent,requestId,schemaVersion'
      || value.schemaVersion !== SCHEMA || !isLocalUiIntent(value.intent)
      || !/^[a-f0-9-]{36}$/u.test(value.requestId) || localUiNavigationDeadline(value.expiresAt) === null) return;
    currentRequest = { requestId: value.requestId, link };
    try {
      if (publish(value.intent, `${value.requestId}/${link}`) === true) return true;
      open(`${origin}/plugin-local-ui`);
      return true;
    } catch { /* navigation has no clinical effect */ }
  };
  const receive = frame => deliver(frame);
  const closePairing = installWebPairing(channel, { instance: process.env.MEDIFLOW_LOCAL_UI_INSTANCE,
    dataDir: process.env.MEDIFLOW_DATA_DIR, sourceFingerprint: process.env.MEDIFLOW_APP_SOURCE_FINGERPRINT }, deliver, target, link => publish('revoke', link));
  const close = () => { closeLease(); closePairing(); connected = false; channel.off('message', receive); channel.off('disconnect', close); };
  channel.on('message', receive); channel.once('disconnect', close);
  channel.send?.('{"schemaVersion":"mediflow.local-ui.ready.v1"}');
  return close;
}
