import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function exactOrigin(value) {
  if (typeof value !== 'string' || value.length > 256 || value === 'null') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value ? value : null;
  } catch { return null; }
}

export async function createFixtureService({ port = 0, allowedOrigins = () => [],
  observe = (_event) => {}, sentinel = `SYNTHETIC_L_${randomUUID()}`, ttlMs = 60_000,
  now = () => Date.now() } = {}) {
  const serviceId = randomUUID();
  const sessions = new Map();
  let endpoint = '';
  let sequence = 0;
  const routes = new Map([
    ['/health', 'GET'], ['/admit', 'POST'], ['/fixture', 'GET'],
    ['/session', 'GET'], ['/revoke', 'POST'],
  ]);
  const server = createServer((req, res) => {
    const origin = exactOrigin(req.headers.origin);
    const route = routes.has(req.url) ? req.url : 'unknown';
    const method = ['GET', 'POST', 'OPTIONS'].includes(req.method) ? req.method : 'other';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    function reply(status, body = {}) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(status === 204 ? undefined : JSON.stringify(body));
      try { observe({ sequence: ++sequence, method, route, origin, status }); } catch {}
    }
    if (req.headers.host !== new URL(endpoint).host) return reply(403, { status: 'denied' });
    let allowed = false;
    try {
      const origins = allowedOrigins();
      allowed = origin !== null && Array.isArray(origins) && origins.some(value => exactOrigin(value) === origin);
    } catch {}
    if (!allowed) return reply(403, { status: 'origin_denied' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (route === 'unknown') return reply(404, { status: 'not_found' });
    if (req.method === 'OPTIONS') {
      const requested = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (req.headers['access-control-request-method'] !== routes.get(route)
        || requested.some(s => !['authorization', 'x-demo-view'].includes(s))) return reply(403, { status: 'denied' });
      res.setHeader('Access-Control-Allow-Methods', routes.get(route));
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Demo-View');
      return reply(204);
    }
    if (req.method !== routes.get(route) || req.headers['transfer-encoding']
      || Number(req.headers['content-length'] ?? 0) !== 0) return reply(400, { status: 'invalid_request' });
    if (route === '/health') return reply(200, { status: 'synthetic_service_ready', serviceId });
    const view = req.headers['x-demo-view'];
    if (typeof view !== 'string' || !/^[0-9a-f-]{36}$/.test(view)) return reply(400, { status: 'invalid_view' });
    for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
    if (route === '/admit') {
      for (const [key, session] of sessions) if (session.view === view && session.origin === origin) sessions.delete(key);
      if (sessions.size >= 16) return reply(429, { status: 'session_limit' });
      const token = randomUUID();
      const expiresAt = now() + ttlMs;
      sessions.set(token, { view, origin, expiresAt });
      return reply(200, { status: 'demo_session_authorized', serviceId, token, expiresAt });
    }
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = sessions.get(token);
    if (!session || session.origin !== origin || session.view !== view) return reply(401, { status: 'demo_session_required' });
    if (route === '/revoke') { sessions.delete(token); return reply(200, { status: 'demo_session_revoked' }); }
    if (route === '/session') return reply(200, { status: 'demo_session_authorized', serviceId });
    return reply(200, { status: 'synthetic_fixture', serviceId, sentinel });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture unavailable');
  endpoint = `http://127.0.0.1:${address.port}`;
  return { endpoint, serviceId, async close() {
    sessions.clear(); server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve(undefined)));
  } };
}
