import { createPairingAuthority } from './local-ui-pairing-authority.mjs';

export function installWebPairing(channel, binding, deliver, target = globalThis) {
  let currentNavigation = null;
  const send = frame => {
    if (frame.type === 'mediflow-local-ui-pair-revoked' && currentNavigation?.nonce === frame.nonce) {
      deliver(JSON.stringify({ schemaVersion: 'mediflow.local-ui.cancel.v1', requestId: currentNavigation.requestId }));
      currentNavigation = null;
    }
    if (channel.connected) channel.send(frame, () => {});
  };
  const authority = createPairingAuthority(binding, send);
  target[Symbol.for('mediflow.local-ui.pairing.v1')] = authority;
  const receive = frame => {
    if (frame?.type === 'mediflow-local-ui-pair-offer') authority.offer(frame.request);
    if (frame?.type === 'mediflow-local-ui-pair-revoke') authority.revoke(frame.nonce);
    if (frame?.type === 'mediflow-local-ui-pair-use') {
      const accepted = authority.use(frame.nonce, frame.host) && deliver(frame.navigation) === true;
      if (accepted) currentNavigation = { nonce: frame.nonce, requestId: frame.requestId };
      send({ type: 'mediflow-local-ui-pair-result', requestId: frame.requestId, status: accepted ? 'accepted' : 'denied' });
    }
  };
  const close = () => {
    authority.close(); channel.off('message', receive); channel.off('disconnect', close);
    delete target[Symbol.for('mediflow.local-ui.pairing.v1')]; clearInterval(expiry);
  };
  const expiry = setInterval(() => authority.snapshot(), 250); expiry.unref?.();
  channel.on('message', receive); channel.once('disconnect', close);
  return close;
}
