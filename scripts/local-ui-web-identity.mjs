import crypto from 'node:crypto';

const webIdentityKey = Symbol.for('mediflow.local-ui.web-identity-key');

export function installWebIdentityKey(key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) return false;
  Reflect.set(process, webIdentityKey, key);
  return true;
}

export function ownedWebIdentityProof(challenge) {
  return webIdentityProof(Reflect.get(process, webIdentityKey), challenge);
}

export function webIdentityProof(secret, challenge) {
  if (!/^[a-f0-9]{64}$/u.test(secret ?? '') || !/^[a-f0-9]{64}$/u.test(challenge ?? '')) return null;
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`mediflow.local-ui.web.v1:${challenge}`).digest('hex');
}

export async function verifyOwnedWeb(origin, secret, signal) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) return false;
  const challenge = crypto.randomBytes(32).toString('hex');
  const expected = webIdentityProof(secret, challenge);
  if (!expected) return false;
  try {
    const response = await fetch(`${origin}/api/plugin-local-ui/identity`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'text/plain' }, body: challenge, signal: signal ?? AbortSignal.timeout(1000) });
    // Next 16.4 risponde a blocchi e non riporta Content-Length: se l'intestazione c'è deve dire 64,
    // e in ogni caso dal corpo si leggono al massimo 64 byte.
    const declared = response.headers.get('content-length');
    if (!response.ok || declared !== null && declared !== '64' || !response.body) return false;
    const reader = response.body.getReader(), chunks = [];
    for (let length = 0; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64) { await reader.cancel().catch(() => {}); return false; }
      chunks.push(value);
    }
    const proof = Buffer.concat(chunks).toString('latin1');
    return /^[a-f0-9]{64}$/u.test(proof) && crypto.timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
