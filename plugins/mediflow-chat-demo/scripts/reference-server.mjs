import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createFixtureService } from '../src/fixture-service.mjs';
import { createDemoServer } from '../src/server.mjs';

const local = new URL('../.local/reference/', import.meta.url);
mkdirSync(local, { recursive: true });
const fixture = await createFixtureService({
  allowedOrigins: () => { try { return JSON.parse(readFileSync(new URL('allowed-origins.json', local), 'utf8')); } catch { return []; } },
  observe: event => writeFileSync(new URL('last-request.json', local), JSON.stringify(event) + '\n'),
});
const http = createServer(async (req, res) => {
  if (req.headers.host !== 'localhost:3017' || req.headers.origin !== 'http://localhost:8080' || req.url !== '/mcp') {
    res.writeHead(403); res.end(); return;
  }
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8080');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version, MCP-Session-Id');
    res.writeHead(204); res.end(); return;
  }
  const { server } = await createDemoServer(fixture);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  res.once('close', () => { void server.close(); });
  try { await transport.handleRequest(req, res); }
  catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
http.listen(3017, '127.0.0.1', () => console.log('Reference-only MCP endpoint: http://localhost:3017/mcp'));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  http.closeAllConnections(); http.close(); await fixture.close();
}
process.once('SIGINT', close); process.once('SIGTERM', close);
