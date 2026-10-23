import crypto from 'node:crypto';

export function webIdentityProof(secret, challenge) {
  if (!/^[a-f0-9]{64}$/u.test(secret ?? '') || !/^[a-f0-9]{64}$/u.test(challenge ?? '')) return null;
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`mediflow.local-ui.web.v1:${challenge}`).digest('hex');
}

export async function verifyOwnedWeb(origin, secret) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(origin)) return false;
  const challenge = crypto.randomBytes(32).toString('hex');
  const expected = webIdentityProof(secret, challenge);
  if (!expected) return false;
  try {
    const response = await fetch(`${origin}/api/plugin-local-ui/identity`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'text/plain' }, body: challenge, signal: AbortSignal.timeout(1000) });
    if (!response.ok || response.headers.get('content-length') !== '64') return false;
    const proof = await response.text();
    return /^[a-f0-9]{64}$/u.test(proof) && crypto.timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}
