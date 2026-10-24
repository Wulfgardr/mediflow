const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);

export function createPairingAuthority(binding, notify, clock = Date.now) {
  const pending = new Map(), grants = new Map(), seen = new Set();
  let closed = false;
  const revoke = nonce => {
    const present = pending.has(nonce) || grants.has(nonce);
    pending.get(nonce)?.observer?.dispose?.(); pending.delete(nonce);
    grants.get(nonce)?.dispose?.(); grants.delete(nonce);
    if (present) notify({ type: 'mediflow-local-ui-pair-revoked', nonce });
  };
  const snapshot = () => {
    for (const [nonce, request] of pending) if (request.expiresAt <= clock() || (request.observer && !request.observer.current())) revoke(nonce);
    for (const [nonce, grant] of grants) if (!grant.current()) revoke(nonce);
    return { pending: [...pending.values()].map(({ nonce, expiresAt }) => ({ nonce, expiresAt })),
      active: [...grants.keys()] };
  };
  return {
    offer(request) {
      if (closed || seen.size >= 256 || !request
        || Object.keys(request).sort().join(',') !== 'dataDir,expiresAt,host,instance,nonce,sourceFingerprint'
        || !uuid(request.nonce) || !uuid(request.host) || seen.has(request.nonce)
        || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= clock() || request.expiresAt > clock() + 60000
        || request.instance !== binding.instance || request.dataDir !== binding.dataDir
        || request.sourceFingerprint !== binding.sourceFingerprint) return false;
      seen.add(request.nonce); pending.set(request.nonce, { ...request, observer: null });
      return true;
    },
    snapshot,
    observe(nonce, observer) {
      const request = pending.get(nonce);
      if (closed || !request || request.observer) return false;
      request.observer = observer; return true;
    },
    decide(nonce, allow, session, proof) {
      const request = pending.get(nonce); pending.delete(nonce);
      const observed = !request?.observer || request.observer.current();
      request?.observer?.dispose?.();
      if (!observed || closed || !request || request.expiresAt <= clock() || !allow || !session?.current() || !/^[a-f0-9]{24}$/u.test(proof ?? '')) {
        if (request) notify({ type: 'mediflow-local-ui-pair-revoked', nonce });
        return false;
      }
      grants.set(nonce, { ...session, host: request.host });
      notify({ type: 'mediflow-local-ui-pair-approved', nonce, proof });
      return true;
    },
    use(nonce, host) {
      const grant = grants.get(nonce);
      if (closed || !grant || grant.host !== host) return false;
      if (!grant.current()) { revoke(nonce); return false; }
      return true;
    },
    revoke,
    close() { closed = true; for (const nonce of [...pending.keys(), ...grants.keys()]) revoke(nonce); },
  };
}
