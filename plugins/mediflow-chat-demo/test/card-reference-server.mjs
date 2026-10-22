import { testInstallation } from './card-runtime.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
const { createCardOwner } = await import('../src/card-owner.mjs');
const { createCardServer, fixedCardErrors } = await import('../src/card-server.mjs');
const sessions = new Map();
const http = createServer(async (req, res) => {
  if (req.headers.host !== 'localhost:3017' || req.headers.origin !== 'http://localhost:8080' || req.url !== '/mcp') { res.writeHead(403); res.end(); return; }
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version, MCP-Session-Id');
    res.writeHead(204); res.end(); return;
  }
  let session = sessions.get(req.headers['mcp-session-id']);
  try {
    if (!session) {
      if (req.headers['mcp-session-id'] || req.method !== 'POST') { res.writeHead(400); res.end(); return; }
      const owner = createCardOwner(testInstallation());
      const measuredOwner = { ...owner, async prepare(view) { const start = performance.now(); try { return await owner.prepare(view); } finally { console.log('REFERENCE_PREPARATION_MS', performance.now() - start); } } };
      const { server } = await createCardServer(measuredOwner);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
        onsessioninitialized(id) { sessions.set(id, { owner, server, transport }); } });
      await server.connect(fixedCardErrors(transport));
      transport.onclose = () => { sessions.delete(transport.sessionId); void owner.close(); };
      session = { owner, server, transport };
    }
    await session.transport.handleRequest(req, res);
  } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
http.listen(3017, '127.0.0.1', () => console.log('Reference-only MCP endpoint: http://localhost:3017/mcp'));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  http.closeAllConnections(); http.close();
  await Promise.all([...sessions.values()].map(async session => { await session.owner.close(); await session.server.close(); }));
}
process.once('SIGINT', close); process.once('SIGTERM', close);
