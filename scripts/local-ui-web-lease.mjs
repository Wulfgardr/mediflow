export function installWebLease(channel, target = globalThis) {
  const key = Symbol.for('mediflow.local-ui.lease.v1');
  const pending = new Map();
  const receive = frame => {
    if (frame?.type !== 'mediflow-ui-lease-result') return;
    pending.get(frame.requestId)?.(frame.accepted === true);
  };
  target[key] = (id, expiresAt) => new Promise(resolve => {
    if (!channel.connected) return resolve(false);
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => finish(false), 2000);
    const finish = accepted => { clearTimeout(timer); pending.delete(requestId); resolve(accepted); };
    pending.set(requestId, finish);
    channel.send({ type: 'mediflow-ui-lease', requestId, id, expiresAt }, error => { if (error) finish(false); });
  });
  channel.on('message', receive);
  const close = () => {
    channel.off('message', receive); channel.off('disconnect', close); delete target[key];
    for (const finish of pending.values()) finish(false);
  };
  channel.once('disconnect', close);
  return close;
}
