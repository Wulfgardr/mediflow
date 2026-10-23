import 'server-only';
import { requireSession } from './server-auth';
import { currentArchiveGeneration } from './archive-session-generation';
import { mintResourcePort, releaseResourcePort, beginResourceUse, commitResourceUse,
  registerPrivateResource, unregisterPrivateResource } from './web-auth-lifecycle-owner-adapter';
import { isPluginLocalUiRuntime } from './plugin-local-ui-runtime';

type Lifecycle = { current(): boolean; dispose(): void };
type Pairing = {
  snapshot(): { pending: { nonce: string; expiresAt: number }[]; active: string[] };
  decide(nonce: string, allow: boolean, session?: { current(): boolean; dispose(): void }, proof?: string): boolean;
  observe(nonce: string, lifecycle: Lifecycle): boolean;
  revoke(nonce: string): void;
};
const authority = () => (globalThis as unknown as Record<symbol, Pairing | undefined>)[Symbol.for('mediflow.local-ui.pairing.v1')];
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const denial = () => response({ status: 'unavailable' }, 404);
function localRequest(request: Request, write = false) {
  const url = new URL(request.url);
  return isPluginLocalUiRuntime() && url.hostname === '127.0.0.1'
    && ['same-origin', 'none'].includes(request.headers.get('sec-fetch-site') ?? '')
    && (!write || request.headers.get('origin') === url.origin);
}

export async function readLocalUiPairing(request: Request) {
  if (!localRequest(request)) return denial();
  const session = await requireSession(), pairing = authority();
  if (!session) return denial();
  const status = pairing?.snapshot() ?? { pending: [], active: [] };
  if (pairing) for (const { nonce } of status.pending) {
    const lifecycle = bindPairingSession(session, pairing, nonce);
    if (lifecycle && !pairing.observe(nonce, lifecycle)) lifecycle.dispose();
  }
  return response(status);
}

export async function decideLocalUiPairing(request: Request) {
  if (!localRequest(request, true) || Number(request.headers.get('content-length')) > 256) return denial();
  const session = await requireSession(), pairing = authority();
  if (!session || !pairing) return denial();
  let value: { nonce?: unknown; action?: unknown; code?: unknown };
  try { value = JSON.parse(await request.text()); } catch { return denial(); }
  if (!value || !['action,nonce', 'action,code,nonce'].includes(Object.keys(value).sort().join(',')) || typeof value.nonce !== 'string'
    || !/^[a-f0-9-]{36}$/u.test(value.nonce) || !['allow', 'deny', 'revoke'].includes(String(value.action))) return denial();
  const nonce = value.nonce;
  if (value.action === 'revoke') { pairing.revoke(nonce); return response({ status: 'updated' }); }
  if (value.action === 'deny') { pairing.decide(nonce, false); return response({ status: 'updated' }); }
  const lifecycle = bindPairingSession(session, pairing, nonce);
  if (!lifecycle) return denial();
  if (!pairing.decide(nonce, true, lifecycle, typeof value.code === 'string' ? value.code.trim() : '')) { lifecycle.dispose(); return denial(); }
  return response({ status: 'updated' });
}

function bindPairingSession(session: NonNullable<Awaited<ReturnType<typeof requireSession>>>, pairing: Pairing, nonce: string): Lifecycle | null {
  const port = mintResourcePort(session);
  if (!port) return null;
  const generation = currentArchiveGeneration();
  const registration = registerPrivateResource(port, () => { pairing.revoke(nonce); });
  if (!registration) { releaseResourcePort(port); return null; }
  const current = () => {
    try {
      const use = beginResourceUse(port);
      if (!use) return false;
      return commitResourceUse(use) && generation === currentArchiveGeneration();
    } catch { return false; }
  };
  const dispose = () => { unregisterPrivateResource(port, registration); releaseResourcePort(port); };
  return { current, dispose };
}
